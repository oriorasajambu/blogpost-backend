import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
const ADVISORY = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/;
// Dev/CI-only package directories; neither is installed in the runtime image.
const PREFIXES = new Set(['docker/auth', 'tools/mock']);

/**
 * Validates the bounded npm audit exception policy. Each entry names one advisory in one
 * dev/CI-only package directory and expires, so it must be reviewed again.
 */
export function auditExceptions(policy, now = new Date()) {
  if (
    policy?.schemaVersion !== 1 ||
    !Array.isArray(policy.exceptions) ||
    policy.exceptions.length > 10
  )
    throw new Error('Invalid bounded audit exception policy.');
  const seen = new Set();
  for (const item of policy.exceptions) {
    const key = item?.prefix + ' ' + item?.advisory;
    if (
      !item ||
      Object.keys(item).sort().join(',') !==
        'advisory,expires,package,prefix,reason' ||
      !PREFIXES.has(item.prefix) ||
      typeof item.advisory !== 'string' ||
      !ADVISORY.test(item.advisory) ||
      typeof item.package !== 'string' ||
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]{1,100}$/.test(item.package) ||
      typeof item.reason !== 'string' ||
      item.reason.length < 20 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.expires) ||
      !Number.isFinite(Date.parse(item.expires)) ||
      new Date(item.expires + 'T23:59:59Z') < now ||
      seen.has(key)
    )
      throw new Error('Audit exception is invalid, duplicated or expired.');
    seen.add(key);
  }
  return policy.exceptions;
}

/**
 * Returns the reasons an `npm audit --json` report fails at `level` for `prefix`. Excepted
 * advisories are ignored, but an exception that no longer matches a reported advisory fails,
 * so it is removed once the fix ships.
 */
export function auditFailures(report, policy, prefix, level, now = new Date()) {
  const minimum = LEVELS.indexOf(level);
  if (minimum < 0) throw new Error('Unknown audit level.');
  if (
    !report ||
    typeof report !== 'object' ||
    report.error ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object'
  )
    throw new Error('npm audit did not return a readable report.');
  const exceptions = auditExceptions(policy, now).filter(
    (item) => item.prefix === prefix,
  );
  const used = new Set();
  const failures = new Set();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability?.via ?? []) {
      // String entries point at another package's entry, which is checked on its own.
      if (!via || typeof via !== 'object') continue;
      const advisory = /\/(GHSA-[a-z0-9-]+)$/.exec(String(via.url))?.[1];
      const match = exceptions.find(
        (item) => item.advisory === advisory && item.package === via.name,
      );
      if (match) {
        used.add(match);
        continue;
      }
      const severity = LEVELS.indexOf(via.severity);
      if (severity < 0 || severity >= minimum)
        failures.add(
          `${via.name}: ${advisory ?? via.url} (${via.severity ?? 'unknown'})`,
        );
    }
  }
  for (const item of exceptions)
    if (!used.has(item))
      failures.add(
        `${item.advisory} for ${item.package} is no longer reported; remove its exception.`,
      );
  return [...failures].sort();
}

async function main() {
  const [prefix, level] = process.argv.slice(2);
  if (!PREFIXES.has(prefix) || !LEVELS.includes(level))
    throw new Error(
      'Usage: node scripts/ci/audit.mjs <docker/auth|tools/mock> <level>',
    );
  const policy = JSON.parse(
    await readFile('config/ci/audit-exceptions.json', 'utf8'),
  );
  // Under `npm run`, reuse that npm's CLI so no shell is needed on Windows either.
  const args = ['audit', '--json', '--prefix', prefix];
  const cli = process.env.npm_execpath;
  const result = spawnSync(
    cli ? process.execPath : 'npm',
    cli ? [cli, ...args] : args,
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  const failures = auditFailures(
    JSON.parse(result.stdout),
    policy,
    prefix,
    level,
  );
  if (failures.length) {
    console.error(`npm audit (${prefix}, ${level}+) failed:`);
    for (const failure of failures) console.error('  ' + failure);
    process.exitCode = 1;
    return;
  }
  console.log(
    `npm audit (${prefix}, ${level}+): passed with bounded exceptions.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
