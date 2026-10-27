import { createHash, randomUUID } from 'node:crypto';
import { request } from 'node:https';
import { execFileSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  writeFile,
  rm,
  rename,
  chmod,
} from 'node:fs/promises';
import { resolve, sep, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function validateArchive(bytes, asset) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== asset.size ||
    hash(bytes) !== asset.sha256
  )
    throw new Error('Gitleaks archive verification failed.');
}
export async function safeDirectory(root, relative) {
  root = resolve(root);
  let directory = root;
  for (const part of relative.split('/')) {
    if (!part || !/^[a-zA-Z0-9._-]+$/.test(part) || ['.', '..'].includes(part))
      throw new Error('Unsafe tool directory.');
    directory = join(directory, part);
    try {
      await mkdir(directory);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Unsafe tool directory.');
  }
  return directory;
}
export async function downloadArchive(url, limit, redirects = 0) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' ||
    target.port ||
    target.username ||
    target.password ||
    ![
      'github.com',
      'release-assets.githubusercontent.com',
      'objects.githubusercontent.com',
    ].includes(target.hostname) ||
    redirects > 5
  )
    throw new Error('Unapproved tool download.');
  return new Promise((resolvePromise, reject) => {
    const req = request(
      target,
      { headers: { 'User-Agent': 'blogpost-pinned-toolchain' } },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (!response.headers.location) {
            reject(new Error('Tool download failed.'));
            return;
          }
          downloadArchive(
            new URL(response.headers.location, target),
            limit,
            redirects + 1,
          ).then(resolvePromise, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error('Tool download failed.'));
          return;
        }
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > limit)
            response.destroy(new Error('Tool download exceeded its bound.'));
          else chunks.push(chunk);
        });
        response.on('end', () => resolvePromise(Buffer.concat(chunks)));
        response.on('error', () => reject(new Error('Tool download failed.')));
      },
    );
    req.setTimeout(30000, () =>
      req.destroy(new Error('Tool download timed out.')),
    );
    req.on('error', () => reject(new Error('Tool download failed.')));
    req.end();
  });
}
export async function installGitleaks(root = process.cwd()) {
  root = resolve(root);
  const lock = JSON.parse(
    await readFile(
      new URL('../../tools/gitleaks/toolchain.json', import.meta.url),
      'utf8',
    ),
  );
  const asset = lock.assets[process.platform + '-' + process.arch];
  if (!asset || !/^8\.[0-9]+\.[0-9]+$/.test(lock.version))
    throw new Error('Unsupported pinned Gitleaks platform.');
  const directory = await safeDirectory(
    root,
    '.local/tools/gitleaks/' + lock.version,
  );
  const archive = join(
    directory,
    process.platform === 'win32' ? 'download.zip' : 'download.tar.gz',
  );
  let bytes;
  try {
    const stat = await lstat(archive);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.size)
      throw new Error('Unsafe cached tool archive.');
    bytes = await readFile(archive);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = await downloadArchive(asset.url, asset.size);
    validateArchive(bytes, asset);
    await writeFile(archive, bytes, { flag: 'wx' });
  }
  validateArchive(bytes, asset);
  const executable = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  const extraction = await safeDirectory(
    root,
    '.local/tools/gitleaks/' + lock.version + '/extract-' + randomUUID(),
  );
  const tool = join(directory, executable);
  try {
    execFileSync('tar', ['-xf', archive, '-C', extraction, '--', executable], {
      stdio: 'pipe',
      timeout: 30000,
      windowsHide: true,
    });
    const fresh = join(extraction, executable);
    const stat = await lstat(fresh);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 32 * 1024 * 1024 ||
      stat.size < 1024
    )
      throw new Error('Unsafe extracted tool.');
    await chmod(fresh, 0o755);
    try {
      const old = await lstat(tool);
      if (!old.isFile() || old.isSymbolicLink())
        throw new Error('Unsafe installed tool.');
      await rm(tool);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await rename(fresh, tool);
    const version = execFileSync(tool, ['version'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      windowsHide: true,
    }).trim();
    if (version !== lock.version)
      throw new Error('Pinned Gitleaks version disagrees.');
    return tool;
  } finally {
    if (!resolve(extraction).startsWith(directory + sep))
      throw new Error('Unsafe extraction cleanup.');
    await rm(extraction, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await installGitleaks();
    console.log('Verified pinned Gitleaks installed.');
  } catch {
    console.error('Pinned Gitleaks installation failed.');
    process.exitCode = 1;
  }
}
