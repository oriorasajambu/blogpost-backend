import { readFile, stat } from 'node:fs/promises';
import {
  ConfigurationCheckError,
  verifyCloudRunConfiguration,
  verifyLiveCloudRunConfiguration,
} from './cloud-run-config.mjs';

async function read(path, limit = 1048576) {
  const info = await stat(path);
  if (!info.isFile() || info.size > limit)
    throw new Error('Invalid input file');
  const value = await readFile(path);
  if (value.length > limit) throw new Error('Invalid input file');
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}
try {
  const options = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (
      ![
        '--provenance',
        '--target',
        '--project-file',
        '--resource-file',
        '--access-token-file',
      ].includes(key) ||
      !value ||
      options.has(key)
    )
      throw new Error('Invalid arguments');
    options.set(key, value);
  }
  if (!options.has('--provenance') || !options.has('--target'))
    throw new Error('Missing arguments');
  const provenance = JSON.parse(await read(options.get('--provenance'), 16384));
  const target = JSON.parse(await read(options.get('--target'), 16384));
  let receipt;
  if (options.has('--access-token-file')) {
    if (options.has('--project-file') || options.has('--resource-file'))
      throw new Error('Ambiguous observation source');
    receipt = await verifyLiveCloudRunConfiguration({
      provenance,
      target,
      accessToken: (
        await read(options.get('--access-token-file'), 4096)
      ).trim(),
    });
  } else {
    if (!options.has('--project-file') || !options.has('--resource-file'))
      throw new Error('Missing observations');
    receipt = verifyCloudRunConfiguration({
      provenance,
      target,
      project: JSON.parse(await read(options.get('--project-file'))),
      resource: JSON.parse(await read(options.get('--resource-file'))),
    });
  }
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      event: 'configuration_check_failed',
      code:
        error instanceof ConfigurationCheckError ? error.code : 'INVALID_INPUT',
    }) + '\n',
  );
  process.exitCode = 1;
}
