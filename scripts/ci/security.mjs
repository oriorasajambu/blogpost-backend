import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { workingFiles } from '../build/inputs.mjs';
import { gitText } from './policy.mjs';
import { installGitleaks, safeDirectory } from './install-gitleaks.mjs';

const exampleValues = Object.freeze({
  APP_ENV: 'development',
  NODE_ENV: 'development',
  PORT: '8080',
  IDENTITY_PROJECT_ID: 'demo-blogpost-local',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  MEDIA_ADAPTER: 'local',
  MEDIA_LOCAL_ROOT: '.local/media',
  API_ORIGIN: 'http://localhost:8080',
  WEB_ORIGIN: 'http://localhost:3000',
  SQL_HOST: '127.0.0.1',
  SQL_PORT: '5432',
  SQL_DATABASE: 'blogpost',
  SQL_ROOT_USER: 'postgres',
  SQL_APP_PASSWORD: 'replace-with-generated-local-password',
  SQL_MIGRATOR_PASSWORD: 'replace-with-generated-local-password',
  SQL_ROOT_PASSWORD: 'replace-with-generated-local-password',
  CURSOR_SIGNING_KEY:
    'replace-with-a-separate-random-64-character-lowercase-hex-key',
});
export function securityConfiguration(policy, now = new Date()) {
  if (
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.exceptions) ||
    policy.exceptions.length > 10
  )
    throw new Error('Invalid bounded scanner exception policy.');
  const lines = [
    'title = "Blogpost pinned default rules"',
    '[extend]',
    'useDefault = true',
  ];
  for (const item of policy.exceptions) {
    if (
      Object.keys(item).sort().join(',') !== 'expires,literal,reason,rule' ||
      item.rule !== 'generic-api-key' ||
      typeof item.reason !== 'string' ||
      item.reason.length < 20 ||
      typeof item.literal !== 'string' ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(item.literal) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.expires) ||
      !Number.isFinite(Date.parse(item.expires)) ||
      new Date(item.expires + 'T23:59:59Z') < now
    )
      throw new Error('Scanner exception is invalid or expired.');
  }
  if (policy.exceptions.length)
    lines.push(
      '[[rules]]',
      'id = "generic-api-key"',
      '[[rules.allowlists]]',
      'regexTarget = "secret"',
      'regexes = [' +
        policy.exceptions
          .map((item) => "'''^" + item.literal + "$'''")
          .join(',') +
        ']',
    );
  return lines.join('\n') + '\n';
}
export function validateEnvironmentExample(text) {
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (
      !match ||
      seen.has(match[1]) ||
      !Object.hasOwn(exampleValues, match[1]) ||
      exampleValues[match[1]] !== match[2]
    )
      throw new Error(
        'Environment example is not approved placeholder-only input.',
      );
    seen.add(match[1]);
  }
  if (seen.size !== Object.keys(exampleValues).length)
    throw new Error('Environment example is incomplete.');
}
export async function scanWithGitleaks(
  tool,
  target,
  scratch,
  mode,
  logOptions,
  exceptionPolicy = { schemaVersion: 1, exceptions: [] },
) {
  if (!['git', 'dir'].includes(mode))
    throw new Error('Invalid security scan mode.');
  const configuration = join(scratch, 'default-rules.toml');
  const ignores = join(scratch, 'empty-ignore');
  const report = join(scratch, mode + '-redacted.json');
  await writeFile(configuration, securityConfiguration(exceptionPolicy));
  await writeFile(ignores, '');
  // Explicit configuration/empty ignore input prevents contributor-controlled local overrides.
  const args = [
    mode,
    target,
    '--config',
    configuration,
    '--gitleaks-ignore-path',
    ignores,
    '--ignore-gitleaks-allow',
    '--redact=100',
    '--no-banner',
    '--no-color',
    '--log-level=error',
    '--report-format=json',
    '--report-path',
    report,
    '--timeout=180',
    '--max-decode-depth=5',
    '--max-archive-depth=0',
  ];
  if (mode === 'git')
    args.push(
      '--log-opts=' +
        (logOptions ?? '--full-history --no-renames --root -m HEAD'),
    );
  const result = spawnSync(tool, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 200000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  try {
    if (result.error || result.signal || ![0, 1].includes(result.status))
      throw new Error('Required secret scan did not complete.');
    let findings;
    try {
      findings = JSON.parse(await readFile(report, 'utf8'));
    } catch {
      throw new Error('Required secret scan report is unavailable.');
    }
    if (
      !Array.isArray(findings) ||
      findings.length > 10000 ||
      (result.status === 0) !== (findings.length === 0)
    )
      throw new Error('Required secret scan report disagrees.');
    return findings.map((finding) => {
      if (
        typeof finding.RuleID !== 'string' ||
        !/^[a-z0-9-]+$/.test(finding.RuleID) ||
        !Number.isInteger(finding.StartLine)
      )
        throw new Error('Invalid secret scan finding.');
      const rawPath = String(finding.File ?? '').replaceAll('\\', '/');
      const prefix = resolve(target).replaceAll('\\', '/') + '/';
      const path = rawPath.startsWith(prefix)
        ? rawPath.slice(prefix.length)
        : rawPath;
      if (!path || path.startsWith('/') || /[\u0000-\u001f\u007f:]/.test(path))
        throw new Error('Invalid secret scan path.');
      return {
        rule: finding.RuleID,
        path,
        line: finding.StartLine,
        commit: /^[a-f0-9]{40}$/.test(finding.Commit ?? '')
          ? finding.Commit
          : null,
      };
    });
  } finally {
    await rm(report, { force: true });
  }
}
export async function securityCheck(root = process.cwd()) {
  root = resolve(root);
  const files = await workingFiles(root);
  const example = files.find((file) => file.path === '.env.example');
  if (!example?.bytes)
    throw new Error('Required placeholder example is missing.');
  validateEnvironmentExample(example.bytes.toString('utf8'));
  const directory = await safeDirectory(root, '.local/ci/security');
  const exceptionPolicy = JSON.parse(
    await readFile(
      new URL('../../config/ci/security-exceptions.json', import.meta.url),
      'utf8',
    ),
  );
  const scratch = await mkdtemp(join(directory, 'scan-'));
  let receipt;
  try {
    const snapshot = join(scratch, 'source');
    await mkdir(snapshot);
    for (const file of files) {
      if (!file.bytes) continue;
      const destination = resolve(snapshot, file.path);
      if (!destination.startsWith(snapshot + sep))
        throw new Error('Invalid security snapshot path.');
      await mkdir(join(destination, '..'), { recursive: true });
      await writeFile(destination, file.bytes, { flag: 'wx' });
    }
    const tool = await installGitleaks(root);
    const current = await scanWithGitleaks(
      tool,
      snapshot,
      scratch,
      'dir',
      undefined,
      exceptionPolicy,
    );
    const history = await scanWithGitleaks(
      tool,
      root,
      scratch,
      'git',
      undefined,
      exceptionPolicy,
    );
    receipt = {
      schemaVersion: 1,
      status: current.length + history.length ? 'FAILED' : 'PASSED',
      scannerVersion: '8.30.1',
      sourceSha: gitText(root, ['rev-parse', 'HEAD']),
      scopes: [
        'working-source-including-docs',
        'complete-reachable-HEAD-history',
      ],
      findings: { current, history },
      archiveTraversal: false,
      exceptions: exceptionPolicy.exceptions,
    };
    await writeFile(
      join(directory, 'result.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    );
    if (receipt.status !== 'PASSED')
      throw new Error(
        'Secret scan found potential credentials; redacted rule/line metadata is in the private local report.',
      );
    return receipt;
  } finally {
    if (!resolve(scratch).startsWith(directory + sep))
      throw new Error('Unsafe security cleanup.');
    await rm(scratch, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = await securityCheck();
    console.log(
      JSON.stringify({
        status: result.status,
        scannerVersion: result.scannerVersion,
        scopes: result.scopes,
      }),
    );
  } catch (error) {
    console.error(
      error.message ===
        'Secret scan found potential credentials; redacted rule/line metadata is in the private local report.'
        ? error.message
        : 'Required security validation failed.',
    );
    process.exitCode = 1;
  }
}
