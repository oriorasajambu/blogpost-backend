import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { installGitleaks, safeDirectory } from './install-gitleaks.mjs';
import { scanWithGitleaks } from './security.mjs';
import { gitText } from './policy.mjs';

const directory = await safeDirectory(
  process.cwd(),
  '.local/ci/security-fixtures',
);
const scratch = await mkdtemp(join(directory, 'fixture-'));
try {
  const tool = await installGitleaks();
  const exceptionPolicy = JSON.parse(
    await (
      await import('node:fs/promises')
    ).readFile('config/ci/security-exceptions.json', 'utf8'),
  );
  const alphabet =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const token = [
    'ghp',
    Array.from(
      randomBytes(36),
      (byte) => alphabet[byte % alphabet.length],
    ).join(''),
  ].join('_');
  await writeFile(
    join(scratch, 'example.txt'),
    'github_token="' + token + '" # gitleaks:allow\n',
  );
  const current = await scanWithGitleaks(
    tool,
    scratch,
    scratch,
    'dir',
    undefined,
    exceptionPolicy,
  );
  assert.ok(current.some((finding) => finding.rule === 'github-pat'));
  gitText(scratch, ['init', '--initial-branch=main']);
  gitText(scratch, ['config', 'user.name', 'Security Fixture']);
  gitText(scratch, ['config', 'user.email', 'fixture@example.test']);
  gitText(scratch, ['add', 'example.txt']);
  gitText(scratch, ['commit', '-m', 'Synthetic token detector fixture']);
  await rm(join(scratch, 'example.txt'));
  gitText(scratch, ['add', '-u']);
  gitText(scratch, ['commit', '-m', 'Synthetic removed token fixture']);
  const history = await scanWithGitleaks(
    tool,
    scratch,
    scratch,
    'git',
    undefined,
    exceptionPolicy,
  );
  assert.ok(history.some((finding) => finding.rule === 'github-pat'));
  assert.ok(!JSON.stringify({ current, history }).includes(token));
  console.log(
    'Pinned scanner detects current, inline-ignore and deleted-history synthetic credentials; output is redacted.',
  );
} finally {
  if (!resolve(scratch).startsWith(directory + sep))
    throw new Error('Unsafe security fixture cleanup.');
  await rm(scratch, { recursive: true, force: true });
}
