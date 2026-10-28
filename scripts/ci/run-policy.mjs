import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { validateRun, PolicyError } from './policy.mjs';
try {
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  const config = JSON.parse(await readFile('config/repository.json', 'utf8'));
  const result = validateRun(process.cwd(), process.env, event, config);
  await mkdir('.local/ci', { recursive: true });
  await writeFile(
    '.local/ci/policy.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      'docs_only=' +
        result.docsOnly +
        '\nclassification=' +
        result.classification +
        '\npromotion=' +
        result.promotion +
        '\ndraft=' +
        result.draft +
        '\nsource_sha=' +
        result.sourceSha +
        '\nbase_sha=' +
        result.baseSha +
        '\n',
    );
  console.log(
    JSON.stringify({ status: 'PASSED', ...result, paths: undefined }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'ci_policy_failed',
      code: error instanceof PolicyError ? error.code : 'INVALID_EVENT_DATA',
    }),
  );
  process.exitCode = 1;
}
