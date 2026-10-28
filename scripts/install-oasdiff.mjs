import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const lock = JSON.parse(await readFile('tools/oasdiff/toolchain.json', 'utf8'));
export const toolPath = resolve(
  '.local/tools/oasdiff',
  lock.version,
  process.platform === 'win32' ? 'oasdiff.exe' : 'oasdiff',
);
export async function installOasdiff() {
  try {
    await access(toolPath);
    return toolPath;
  } catch {}
  const asset = lock.assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('No pinned oasdiff asset for this platform.');
  const directory = resolve('.local/tools/oasdiff', lock.version);
  await mkdir(directory, { recursive: true });
  const response = await fetch(asset.url);
  if (!response.ok)
    throw new Error(`oasdiff download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error('oasdiff archive checksum mismatch.');
  const archive = resolve(directory, 'download.tar.gz');
  await writeFile(archive, bytes);
  // Extract only the expected executable; do not extract arbitrary archive paths.
  await promisify(execFile)('tar', [
    '-xzf',
    archive,
    '-C',
    directory,
    process.platform === 'win32' ? 'oasdiff.exe' : 'oasdiff',
  ]);
  console.log(
    `Verified oasdiff ${lock.version} installed in the ignored local tool directory.`,
  );
  return toolPath;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  await installOasdiff();
