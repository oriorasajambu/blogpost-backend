import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fail, gitText, sha } from '../ci/policy.mjs';
import { uniqueJson } from '../ci/evidence/unique-json.mjs';
import { recoveryResultInputs } from './result-inputs.mjs';
import { verifyRecoveryResult, verifyLiveRecoveryResult } from './result.mjs';

async function fileJson(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2097152)
    fail('INVALID_RECOVERY_RESULT_INPUT_FILE');
  const file = await open(path, 'r');
  try {
    const opened = await file.stat();
    if (
      !opened.isFile() ||
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.size > 2097152
    )
      fail('INVALID_RECOVERY_RESULT_INPUT_FILE');
    const buffer = Buffer.alloc(2097153);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 2097152) fail('INVALID_RECOVERY_RESULT_INPUT_FILE');
    return uniqueJson(
      new TextDecoder('utf-8', { fatal: true }).decode(
        buffer.subarray(0, size),
      ),
    );
  } finally {
    await file.close();
  }
}
export function resultArguments(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (
      !['--request', '--source-sha', '--live', '--observations'].includes(
        key,
      ) ||
      Object.hasOwn(values, key)
    )
      fail('INVALID_RECOVERY_RESULT_ARGUMENTS');
    if (key === '--live') values[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--'))
        fail('INVALID_RECOVERY_RESULT_ARGUMENTS');
      values[key] = value;
    }
  }
  if (
    !values['--request'] ||
    Boolean(values['--live']) === Boolean(values['--observations'])
  )
    fail('INVALID_RECOVERY_RESULT_ARGUMENTS');
  if (values['--source-sha']) sha(values['--source-sha']);
  return values;
}
export async function verifyResultCli(
  args,
  { root = process.cwd(), env = process.env, now = Date.now } = {},
) {
  const values = resultArguments(args);
  const request = await fileJson(resolve(values['--request']));
  const sourceSha =
    values['--source-sha'] ?? sha(gitText(root, ['rev-parse', 'HEAD']));
  if (values['--live'])
    return verifyLiveRecoveryResult({
      root,
      request,
      sourceSha,
      accessToken: env.GCP_ACCESS_TOKEN,
      now,
    });
  const inputs = await recoveryResultInputs(root, request, sourceSha);
  return verifyRecoveryResult(
    inputs,
    await fileJson(resolve(values['--observations'])),
    typeof now === 'function' ? now() : now,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(
      JSON.stringify(await verifyResultCli(process.argv.slice(2)), null, 2) +
        '\n',
    );
  } catch (error) {
    // Provider bodies, tokens, file contents and raw exceptions are never printed.
    process.stderr.write(
      'Cloud Build result verification failed: ' +
        (error?.code?.match(/^[A-Z][A-Z0-9_]{1,79}$/)?.[0] ??
          'RESULT_UNAVAILABLE') +
        '\n',
    );
    process.exitCode = 1;
  }
}
