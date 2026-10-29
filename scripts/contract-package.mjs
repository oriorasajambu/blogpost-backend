import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { gzipSync, inflateRawSync, crc32 } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 32 * 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const trees = [
  'contracts',
  'mock',
  'tools/kotlin/consumer',
  'tools/kotlin/templates',
  'tools/mock',
  'test/contract',
  'test/mock',
  'test/conformance',
  'docs/plans',
];
const files = [
  'package.json',
  'package-lock.json',
  '.npmrc',
  '.nvmrc',
  '.prettierrc.json',
  'tsconfig.json',
  'tools/kotlin/toolchain.json',
  'tools/oasdiff/toolchain.json',
  'scripts/build-contract.mjs',
  'scripts/generate-typescript.mjs',
  'scripts/generate-kotlin.mjs',
  'scripts/kotlin-tools.mjs',
  'scripts/test-kotlin.mjs',
  'scripts/contract-manifest.mjs',
  'scripts/contract-compatibility.mjs',
  'scripts/test-compatibility.mjs',
  'scripts/install-oasdiff.mjs',
  'scripts/contract-policy.mjs',
  'scripts/contract-package.mjs',
  'scripts/dev/mock.mjs',
  'scripts/deploy/wire-contract.mjs',
  'scripts/deploy/wire-contract.d.mts',
  'src/modules/posts/draft.ts',
  'src/modules/posts/markdown.ts',
  'src/modules/media/image-normalizer.ts',
  'src/modules/meta/meta.controller.ts',
  'src/platform/errors/api-error.ts',
  'src/platform/http/envelope.ts',
  'src/platform/http/metadata.ts',
  'src/platform/http/metadata-rules.json',
  'src/platform/http/transport.ts',
  'src/platform/text/unicode.ts',
  'src/platform/config/config.ts',
  'src/platform/config/provenance.ts',
  'src/platform/config/build-model.ts',
  'src/platform/config/input-policy.ts',
  'test/helpers.ts',
];
const ignored = new Set(['node_modules', '.gradle', '.kotlin', 'build']);
const generated = new Set([
  'HANDOFF.md',
  'tsconfig.handoff.json',
  'PACKAGE-MANIFEST.json',
  'SHA256SUMS',
]);
function safePath(path) {
  return (
    typeof path === 'string' &&
    path.length <= 240 &&
    /^[A-Za-z0-9_.\/-]+$/.test(path) &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path.split('/').every((part) => part && part !== '.' && part !== '..') &&
    !path
      .split('/')
      .some(
        (part) =>
          ignored.has(part) ||
          part === '.git' ||
          part === '.local' ||
          part.toLowerCase().startsWith('.env'),
      )
  );
}
function allowed(path) {
  return (
    safePath(path) &&
    (generated.has(path) ||
      files.includes(path) ||
      trees.some((tree) => path.startsWith(tree + '/')))
  );
}
const fail = (message) => {
  throw new Error('Contract package: ' + message);
};
const ordered = (entries) =>
  [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
function handoff(version) {
  return Buffer.from(
    `# Blogpost API contract ${version} handoff\n\nStatus: DRAFT, unreleased review candidate. This archive is not an approved freeze, published release or evidence of cloud/client readiness. SHA-256 checksums establish byte integrity, not publisher authenticity. Keep the reviewed archive checksum in the consuming repository; never silently replace a published package. The source repository remains UNLICENSED; no license grant is added here.\n\nThe archive contains the bundled OpenAPI JSON/YAML, approved wire plan, full operation/error/Markdown/media fixtures, generated TypeScript/Kotlin models, defensive Kotlin consumer, stateful Fastify mock with its Prism toolchain, conformance sources and locked reproduction inputs. Source paths are preserved. Runtime dependencies and caches are excluded. The root package.json/lockfile are the unchanged backend dependency graph; only the handoff commands listed here are intended in this extracted subset.\n\nUse the Node version in .nvmrc and npm version in package.json, then run:\n\n\`\`\`sh\nnpm ci --ignore-scripts\nnode scripts/contract-package.mjs --verify ../blogpost-api-contract-${version}.tar.gz\nnode scripts/build-contract.mjs --check\nnode scripts/generate-typescript.mjs --check\nnode node_modules/typescript/bin/tsc --noEmit -p tsconfig.handoff.json\nnode node_modules/tsx/dist/cli.mjs --test test/contract/*.test.ts test/mock/*.test.ts\nnode scripts/dev/mock.mjs --smoke\nnode scripts/test-compatibility.mjs\nnode scripts/generate-kotlin.mjs --check\nnode scripts/test-kotlin.mjs\n\`\`\`\n\nThe verifier expects SHA256SUMS beside the archive. Run it before extraction with the source checkout's verifier; inside the extracted directory the relative example above assumes the archive remains in its parent. The mock task starts the scenario server and schema-validating Prism proxy on loopback only. See mock/README.md for fixture identities, reset, clock advance, faults and isolated ports. Prism dependencies install from tools/mock/package-lock.json with scripts disabled. Generator/compatibility/JVM checks can download checksum-pinned tools and require Java 17; caches stay under .local/.\n\nSee contracts/README.md, contracts/CONTRACT.md, contracts/CHANGELOG.md and contracts/compatibility-report.json for the exact draft state and compatibility limits. No historical released client is invented by these tests. test/conformance contains the verifier, scenario registry and bounded remote read-only probe; protected/mutating real-backend conformance must use the backend's disposable identity/SQL fixture, never run example writes against a saved or cloud database.\n`,
  );
}
async function sourceEntries(root) {
  const entries = new Map();
  const add = async (path) => {
    if (!allowed(path)) fail('unapproved source path');
    const info = await lstat(join(root, ...path.split('/')));
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES)
      fail('unsafe source file');
    entries.set(path, await readFile(join(root, ...path.split('/'))));
  };
  const walk = async (directory) => {
    for (const item of await readdir(join(root, directory), {
      withFileTypes: true,
    })) {
      if (ignored.has(item.name)) continue;
      const path = directory + '/' + item.name;
      if (item.isSymbolicLink()) fail('source links are forbidden');
      if (item.isDirectory()) await walk(path);
      else await add(path);
    }
  };
  for (const tree of trees) await walk(tree);
  for (const path of files) await add(path);
  const manifest = JSON.parse(entries.get('contracts/manifest.json'));
  const expected = ordered(
    [...entries]
      .filter(
        ([path]) =>
          path.startsWith('contracts/') && path !== 'contracts/manifest.json',
      )
      .map(([path, bytes]) => ({ path, sha256: sha256(bytes) })),
  );
  if (
    !json({
      contractVersion: manifest.contractVersion,
      status: manifest.status,
      files: expected,
    }).equals(entries.get('contracts/manifest.json'))
  )
    fail('contract manifest is stale or malformed');
  const spec = JSON.parse(entries.get('contracts/openapi-v1.json'));
  const version = spec.info?.version;
  if (
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(
      version ?? '',
    ) ||
    manifest.contractVersion !== version ||
    spec['x-contract-status'] !== 'DRAFT' ||
    manifest.status !== 'DRAFT'
  )
    fail('expected an unreleased versioned draft');
  entries.set('HANDOFF.md', handoff(version));
  entries.set(
    'tsconfig.handoff.json',
    json({
      extends: './tsconfig.json',
      include: [
        'mock/**/*.ts',
        'test/contract/**/*.ts',
        'test/mock/**/*.ts',
        'test/helpers.ts',
        'test/conformance/verify.ts',
        'test/conformance/backend-scenarios.ts',
      ],
    }),
  );
  return {
    version,
    entries: ordered([...entries].map(([path, bytes]) => ({ path, bytes }))),
  };
}

function octal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0') + '\0';
  if (text.length !== length) fail('tar numeric bound');
  header.write(text, offset, length, 'ascii');
}
function headerFor(path, size) {
  const header = Buffer.alloc(512);
  let name = path,
    prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const split = path.lastIndexOf('/');
    prefix = path.slice(0, split);
    name = path.slice(split + 1);
  }
  if (name.length > 100 || prefix.length > 155) fail('tar path bound');
  header.write(name, 0, 100, 'ascii');
  octal(header, 100, 8, 0o644);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, size);
  octal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'ascii');
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}
function encode(entries, packageName) {
  const chunks = [];
  for (const { path, bytes } of ordered(entries)) {
    if (!allowed(path) || !Buffer.isBuffer(bytes))
      fail('invalid package entry');
    chunks.push(
      headerFor(packageName + '/' + path, bytes.length),
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
    );
  }
  const tar = Buffer.concat([...chunks, Buffer.alloc(1024)]);
  if (tar.length > MAX_BYTES) fail('archive size bound');
  const gzip = gzipSync(tar, { level: 9 });
  gzip[9] = 255;
  return gzip;
}

export async function buildContractPackage(root = process.cwd()) {
  const { version, entries } = await sourceEntries(resolve(root));
  const packageName = 'blogpost-api-contract-' + version;
  const manifest = {
    schemaVersion: 1,
    packageName,
    contractVersion: version,
    status: 'DRAFT',
    archiveFormat: 'normalized-ustar-gzip',
    files: entries.map(({ path, bytes }) => ({
      path,
      size: bytes.length,
      sha256: sha256(bytes),
    })),
  };
  entries.push({ path: 'PACKAGE-MANIFEST.json', bytes: json(manifest) });
  entries.push({
    path: 'SHA256SUMS',
    bytes: Buffer.from(
      ordered(entries)
        .map(({ path, bytes }) => sha256(bytes) + '  ' + path + '\n')
        .join(''),
    ),
  });
  const archive = encode(entries, packageName);
  const result = verifyContractPackage(archive);
  return {
    ...result,
    archive,
    manifest: json(manifest),
    filename: packageName + '.tar.gz',
    archiveSha256: sha256(archive),
  };
}

export function verifyContractPackage(archive) {
  if (
    !Buffer.isBuffer(archive) ||
    archive.length < 18 ||
    archive.length > MAX_BYTES
  )
    fail('invalid archive size');
  let tar;
  try {
    // Require the normalized gzip wrapper, but do not re-compress trusted
    // contents: a valid deflate representation may differ between zlib versions.
    if (
      !archive
        .subarray(0, 8)
        .equals(Buffer.from([31, 139, 8, 0, 0, 0, 0, 0])) ||
      ![0, 2, 4].includes(archive[8]) ||
      archive[9] !== 255
    )
      fail('noncanonical gzip header');
    const decoded = inflateRawSync(archive.subarray(10), {
      info: true,
      maxOutputLength: MAX_BYTES,
    });
    const trailer = 10 + decoded.engine.bytesWritten;
    if (
      trailer + 8 !== archive.length ||
      crc32(decoded.buffer) !== archive.readUInt32LE(trailer) ||
      decoded.buffer.length !== archive.readUInt32LE(trailer + 4)
    )
      fail('invalid gzip framing or checksum');
    tar = decoded.buffer;
  } catch {
    fail('invalid or excessive gzip stream');
  }
  const entries = [];
  let offset = 0,
    packageName;
  const stringAt = (header, start, length) =>
    header
      .subarray(start, start + length)
      .toString('ascii')
      .replace(/\0.*$/s, '');
  while (
    offset + 512 <= tar.length &&
    tar.subarray(offset, offset + 512).some(Boolean)
  ) {
    const header = tar.subarray(offset, offset + 512);
    const path = [stringAt(header, 345, 155), stringAt(header, 0, 100)]
      .filter(Boolean)
      .join('/');
    packageName ??= path.split('/')[0];
    const relative = path.slice(packageName.length + 1);
    const sizeText = stringAt(header, 124, 12);
    if (
      !/^blogpost-api-contract-\d+\.\d+\.\d+$/.test(packageName) ||
      !path.startsWith(packageName + '/') ||
      !allowed(relative) ||
      !/^[0-7]{11}$/.test(sizeText)
    )
      fail('unsafe tar member');
    const size = Number.parseInt(sizeText, 8);
    if (
      size > MAX_BYTES ||
      offset + 512 + size > tar.length ||
      !headerFor(path, size).equals(header)
    )
      fail('noncanonical tar header');
    const paddingEnd = offset + 512 + size + ((512 - (size % 512)) % 512);
    if (tar.subarray(offset + 512 + size, paddingEnd).some(Boolean))
      fail('nonzero tar padding');
    entries.push({
      path: relative,
      bytes: Buffer.from(tar.subarray(offset + 512, offset + 512 + size)),
    });
    offset = paddingEnd;
  }
  if (
    !entries.length ||
    tar.length !== offset + 1024 ||
    tar.subarray(offset).some(Boolean) ||
    new Set(entries.map((entry) => entry.path)).size !== entries.length ||
    ordered(entries).some((entry, index) => entry.path !== entries[index].path)
  )
    fail('noncanonical or duplicate archive');
  const lookup = new Map(entries.map((entry) => [entry.path, entry.bytes]));
  if ([...files, ...generated].some((path) => !lookup.has(path)))
    fail('required package source is missing');
  const contractManifest = JSON.parse(
    lookup.get('contracts/manifest.json') ?? '{}',
  );
  const contractEntries = ordered(
    entries.filter(
      (entry) =>
        entry.path.startsWith('contracts/') &&
        entry.path !== 'contracts/manifest.json',
    ),
  ).map(({ path, bytes }) => ({ path, sha256: sha256(bytes) }));
  if (
    !json({
      contractVersion: contractManifest.contractVersion,
      status: contractManifest.status,
      files: contractEntries,
    }).equals(lookup.get('contracts/manifest.json') ?? Buffer.alloc(0))
  )
    fail('packaged contract manifest disagrees');
  let manifest;
  try {
    manifest = JSON.parse(lookup.get('PACKAGE-MANIFEST.json'));
  } catch {
    fail('missing package manifest');
  }
  const payload = entries.filter(
    (entry) => !['PACKAGE-MANIFEST.json', 'SHA256SUMS'].includes(entry.path),
  );
  const expected = {
    schemaVersion: 1,
    packageName,
    contractVersion: packageName.slice('blogpost-api-contract-'.length),
    status: 'DRAFT',
    archiveFormat: 'normalized-ustar-gzip',
    files: ordered(payload).map(({ path, bytes }) => ({
      path,
      size: bytes.length,
      sha256: sha256(bytes),
    })),
  };
  if (
    !json(expected).equals(
      lookup.get('PACKAGE-MANIFEST.json') ?? Buffer.alloc(0),
    )
  )
    fail('manifest contents or checksums disagree');
  const sums = ordered(entries.filter((entry) => entry.path !== 'SHA256SUMS'))
    .map(({ path, bytes }) => sha256(bytes) + '  ' + path + '\n')
    .join('');
  if (lookup.get('SHA256SUMS')?.toString('utf8') !== sums)
    fail('SHA256SUMS disagrees');
  const spec = JSON.parse(lookup.get('contracts/openapi-v1.json') ?? '{}');
  if (
    spec.info?.version !== expected.contractVersion ||
    spec['x-contract-status'] !== 'DRAFT'
  )
    fail('contract identity disagrees');
  return {
    packageName,
    contractVersion: expected.contractVersion,
    status: 'DRAFT',
    fileCount: entries.length,
    manifest,
    entries,
  };
}

export async function verifyContractPackageFile(path) {
  const filename = path.split(/[\\/]/).at(-1);
  if (
    !/^blogpost-api-contract-(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.tar\.gz$/.test(
      filename ?? '',
    )
  )
    fail('invalid archive filename');
  if ((await lstat(path)).size > MAX_BYTES) fail('invalid archive size');
  const archive = await readFile(path);
  const sums = await readFile(join(dirname(path), 'SHA256SUMS'), 'utf8');
  if (sums !== sha256(archive) + '  ' + filename + '\n')
    fail('external archive checksum disagrees');
  const verified = verifyContractPackage(archive);
  if (filename !== verified.packageName + '.tar.gz')
    fail('archive filename and contract identity disagree');
  return verified;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args[0] === '--verify' && args.length === 2) {
    const result = await verifyContractPackageFile(resolve(args[1]));
    console.log(
      JSON.stringify({
        status: 'VERIFIED',
        contractStatus: result.status,
        packageName: result.packageName,
        files: result.fileCount,
      }),
    );
  } else if (!args.length || (args.length === 1 && args[0] === '--check')) {
    const result = await buildContractPackage();
    const directory = join('.local', 'contracts', result.packageName);
    const output = join(directory, result.filename);
    const sums = Buffer.from(
      result.archiveSha256 + '  ' + result.filename + '\n',
    );
    if (args[0] === '--check') {
      if (
        !(await readFile(output)).equals(result.archive) ||
        !(await readFile(join(directory, 'SHA256SUMS'))).equals(sums)
      )
        fail('existing package differs from current inputs');
    } else {
      await mkdir(directory, { recursive: true });
      await writeFile(output, result.archive);
      await writeFile(join(directory, 'SHA256SUMS'), sums);
      await writeFile(
        join(directory, 'PACKAGE-MANIFEST.json'),
        result.manifest,
      );
    }
    console.log(
      JSON.stringify({
        status: args[0] === '--check' ? 'REPRODUCIBLE' : 'PACKAGED',
        contractStatus: result.status,
        path: posix.join(...output.split(/[\\/]/)),
        sha256: result.archiveSha256,
        files: result.fileCount,
      }),
    );
  } else
    fail(
      'usage: node scripts/contract-package.mjs [--check | --verify ARCHIVE]',
    );
}
