import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { gitText, git } from '../../scripts/ci/policy.mjs';

export const repository = {
  full_name: 'fixture/backend',
  id: 42,
  owner: { id: 7 },
};
export const config = {
  fullName: repository.full_name,
  repositoryId: '42',
  ownerId: '7',
  bootstrapSha: '0'.repeat(40),
};
export async function fixture(t, version = '0.0.0') {
  const root = await mkdtemp(join(tmpdir(), 'blogpost-ci-'));
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep))
    throw new Error('Unsafe fixture path');
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = (args, input) =>
    input === undefined
      ? gitText(root, args)
      : git(root, args, input).toString('utf8').trimEnd();
  run(['init', '--initial-branch=main']);
  run(['config', 'user.name', 'CI Fixture']);
  run(['config', 'user.email', 'fixture@example.test']);
  run(['config', 'core.autocrlf', 'false']);
  const write = async (path, text) => {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(
      join(root, path),
      typeof text === 'string' ? text : JSON.stringify(text) + '\n',
    );
  };
  const release = async (next = version, publish = false) => {
    const pkg = {
      name: 'fixture-backend',
      version: next,
      private: true,
      dependencies: { a: '1.0.0', b: '1.0.0' },
    };
    await write('package.json', pkg);
    await write('package-lock.json', {
      name: pkg.name,
      version: next,
      packages: { '': { ...pkg, dependencies: { b: '1.0.0', a: '1.0.0' } } },
    });
    await write('.release/release.json', {
      application: 'backend',
      version: next,
      publish,
      apiContractVersion: '1.0.0',
    });
  };
  await release();
  await write('contracts/openapi-v1.json', { info: { version: '1.0.0' } });
  await write('src/main.ts', 'export const value = 1;\n');
  await write('.gitignore', '.local/\n');
  const commit = () => {
    run(['add', '.']);
    run(['commit', '--allow-empty', '-m', 'Synthetic CI fixture']);
    return run(['rev-parse', 'HEAD']);
  };
  const base = commit();
  run(['branch', 'rc']);
  return { root, run, write, commit, base, release };
}
export function pushEvent(source, before, branch = 'chore/ci-foundation') {
  const ref = 'refs/heads/' + branch;
  return {
    env: {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_SHA: source,
      GITHUB_REF: ref,
      GITHUB_REPOSITORY: repository.full_name,
      GITHUB_REPOSITORY_ID: String(repository.id),
      GITHUB_WORKFLOW_REF:
        repository.full_name +
        '/.github/workflows/' +
        (branch === 'main'
          ? 'release.yml'
          : branch === 'rc'
            ? 'staging.yml'
            : 'ci.yml') +
        '@' +
        ref,
    },
    event: { repository, before, after: source, ref, deleted: false },
  };
}
export function prEvent(base, head, merge, options = {}) {
  const pull_request = {
    base: { ref: 'rc', sha: base, repo: repository },
    head: { ref: 'chore/ci-foundation', sha: head, repo: repository },
    draft: false,
    ...options,
  };
  return {
    env: {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_SHA: merge,
      GITHUB_REF: 'refs/pull/9/merge',
      GITHUB_REPOSITORY: repository.full_name,
      GITHUB_REPOSITORY_ID: '42',
    },
    event: { repository, number: 9, action: 'opened', pull_request },
  };
}
