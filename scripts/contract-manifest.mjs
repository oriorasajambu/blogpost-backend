import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
async function files(dir) {
  const results = await Promise.all(
    (await readdir(dir, { withFileTypes: true })).map(async (entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : [join(dir, entry.name)],
    ),
  );
  return results.flat();
}
const paths = (await files('contracts'))
  .filter((path) => path.replaceAll('\\', '/') !== 'contracts/manifest.json')
  .sort();
const entries = await Promise.all(
  paths.map(async (path) => ({
    path: path.replaceAll('\\', '/'),
    sha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  })),
);
const content =
  JSON.stringify(
    { contractVersion: '1.0.0', status: 'DRAFT', files: entries },
    null,
    2,
  ) + '\n';
if (process.argv.includes('--check')) {
  if ((await readFile('contracts/manifest.json', 'utf8')) !== content)
    throw new Error(
      'Contract manifest is stale. Run npm run contract:manifest.',
    );
} else await writeFile('contracts/manifest.json', content);
