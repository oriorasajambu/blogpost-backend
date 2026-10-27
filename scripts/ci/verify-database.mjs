import { lstat, readFile } from 'node:fs/promises';
import { expectedDatabaseSql } from './evidence/database-inputs.mjs';
import { verifyDatabaseExecution } from '../deploy/database-proof.mjs';
import { verifyLiveDatabaseExecution } from '../deploy/database-reader.mjs';

async function read(path, limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
    throw Error('Invalid input');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw Error('Invalid input');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
try {
  const options = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i],
      value = process.argv[i + 1];
    if (
      ![
        '--provenance',
        '--target',
        '--context',
        '--observations',
        '--access-token-file',
      ].includes(key) ||
      !value ||
      options.has(key)
    )
      throw Error('Invalid input');
    options.set(key, value);
  }
  if (
    !['--provenance', '--target', '--context'].every((key) =>
      options.has(key),
    ) ||
    options.has('--observations') === options.has('--access-token-file')
  )
    throw Error('Invalid input');
  const provenance = JSON.parse(await read(options.get('--provenance'), 16384));
  const target = JSON.parse(await read(options.get('--target'), 16384));
  const context = JSON.parse(await read(options.get('--context'), 16384));
  const expectedSql = expectedDatabaseSql(process.cwd(), provenance.sourceSha);
  let result;
  if (options.has('--access-token-file'))
    result = await verifyLiveDatabaseExecution({
      provenance,
      target,
      context,
      expectedSql,
      accessToken: (
        await read(options.get('--access-token-file'), 4096)
      ).trim(),
    });
  else {
    const observations = JSON.parse(
      await read(options.get('--observations'), 2097152),
    );
    const names = Object.keys(observations).sort().join(',');
    if (names !== 'execution,job,logPage,project,tasks')
      throw Error('Invalid input');
    result = verifyDatabaseExecution({
      provenance,
      target,
      context,
      expectedSql,
      ...observations,
    });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      event: 'database_evidence_failed',
      code:
        typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code)
          ? error.code
          : 'INVALID_DATABASE_INPUT',
    }) + '\n',
  );
  process.exitCode = 1;
}
