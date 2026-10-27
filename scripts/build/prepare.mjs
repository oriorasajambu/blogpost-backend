import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  lstat,
  rename,
  unlink,
  readdir,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  canonical,
  digest,
  validateProvenance,
} from '../../src/platform/config/build-model.ts';
import { prepareProvenance } from './inputs.mjs';
import { isNonexecutingDocumentation } from '../../src/platform/config/input-policy.ts';

async function safeDirectory(root, path) {
  const parts = relative(root, path).split(sep).filter(Boolean);
  if (parts.some((part) => part === '..') || !path.startsWith(root + sep))
    throw new Error('Build output escaped the checkout');
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Unsafe build output directory');
  }
}
async function immutableFile(root, path, bytes, mode = 0o644) {
  await safeDirectory(root, dirname(path));
  try {
    await writeFile(path, bytes, { flag: 'wx', mode });
  } catch (error) {
    if (
      error.code !== 'EEXIST' ||
      !(await lstat(path)).isFile() ||
      (await lstat(path)).isSymbolicLink() ||
      !(await readFile(path)).equals(Buffer.from(bytes))
    )
      throw new Error('Build snapshot collision');
  }
  await chmod(path, mode);
}
async function verifySnapshot(directory, expectedFiles) {
  const expectedDirectories = new Set();
  for (const path of expectedFiles) {
    let parent = dirname(path);
    while (parent !== '.') {
      expectedDirectories.add(parent);
      parent = dirname(parent);
    }
  }
  async function visit(path = '') {
    for (const entry of await readdir(resolve(directory, path), {
      withFileTypes: true,
    })) {
      const child = path ? path + sep + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Unsafe snapshot entry');
      if (entry.isDirectory() && expectedDirectories.has(child))
        await visit(child);
      else if (!entry.isFile() || !expectedFiles.has(child))
        throw new Error('Unexpected snapshot entry');
    }
  }
  await visit();
}
export async function writeNativeProvenance(root, provenance) {
  provenance = validateProvenance(provenance);
  if (provenance.environment !== 'development')
    throw new Error('Native metadata is development only');
  root = resolve(root);
  const directory = resolve(root, '.build');
  await safeDirectory(root, directory);
  const destination = resolve(directory, 'provenance.json');
  try {
    const stat = await lstat(destination);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Unsafe native metadata file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = resolve(
    directory,
    '.provenance-' + randomBytes(12).toString('hex') + '.tmp',
  );
  try {
    await writeFile(temporary, canonical(provenance) + '\n', {
      flag: 'wx',
      mode: 0o644,
    });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
export async function prepareBuild(
  root,
  environment = 'development',
  profile = null,
  event = process.env,
) {
  root = resolve(root);
  const { provenance, manifest, files } = await prepareProvenance(
    root,
    environment,
    profile,
    event,
  );
  const directory = resolve(root, '.local/build-metadata', digest(provenance));
  const metadataDirectory = resolve(directory, 'metadata');
  const sourceDirectory = resolve(directory, 'source');
  await immutableFile(
    root,
    resolve(metadataDirectory, 'provenance.json'),
    canonical(provenance) + '\n',
  );
  await immutableFile(
    root,
    resolve(metadataDirectory, 'input-manifest.json'),
    canonical(manifest) + '\n',
  );
  const expectedFiles = new Set();
  for (const file of files) {
    if (
      file.bytes === null ||
      file.path === '.release/release.json' ||
      isNonexecutingDocumentation(file.path)
    )
      continue;
    expectedFiles.add(file.path.split('/').join(sep));
    await immutableFile(
      root,
      resolve(sourceDirectory, file.path),
      file.bytes,
      file.mode === '100755' ? 0o755 : 0o644,
    );
  }
  await verifySnapshot(sourceDirectory, expectedFiles);
  return { metadataDirectory, sourceDirectory, provenance };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const options = new Map();
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i];
      const value = process.argv[i + 1];
      if (
        !['--environment', '--profile'].includes(key) ||
        value === undefined ||
        options.has(key)
      )
        throw new Error('Invalid build arguments');
      options.set(key, value);
    }
    const profile = options.has('--profile')
      ? JSON.parse(await readFile(options.get('--profile'), 'utf8'))
      : null;
    const result = await prepareBuild(
      process.cwd(),
      options.get('--environment') ?? 'development',
      profile,
    );
    process.stdout.write(
      JSON.stringify({
        metadataDirectory: result.metadataDirectory,
        sourceDirectory: result.sourceDirectory,
        environment: result.provenance.environment,
        sourceSha: result.provenance.sourceSha,
        dirty: result.provenance.dirty,
        runtimeInputDigest: result.provenance.runtimeInputDigest,
        sourceInputDigest: result.provenance.sourceInputDigest,
      }) + '\n',
    );
  } catch {
    process.stderr.write('{"event":"build_metadata_failed"}\n');
    process.exitCode = 1;
  }
}
