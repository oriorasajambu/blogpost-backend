import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
if (
  args.some(
    (arg) =>
      !['--build', '--compiled-operations', '--copy-reports'].includes(arg),
  )
)
  throw new Error(
    'Usage: contract:conformance:full [--build] [--compiled-operations] [--copy-reports]',
  );
const started = Date.now();
const result = spawnSync(
  process.execPath,
  ['scripts/dev/test-identity.mjs', ...args],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const path = resolve(root, '.local/conformance/backend-full.json');
const report = JSON.parse(await readFile(path, 'utf8'));
if (
  (await stat(path)).mtimeMs < started ||
  report.status !== 'PASSED' ||
  report.complete !== true ||
  report.executed !== 52 ||
  report.pending.length
)
  throw new Error('Full conformance report is missing, stale or incomplete');
console.log(
  JSON.stringify({
    scope: report.scope,
    status: report.status,
    executed: report.executed,
    contractSha256: report.contractSha256,
  }),
);
