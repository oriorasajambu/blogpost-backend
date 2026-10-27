import { execFileSync } from 'node:child_process';
import { canonical } from '../../src/platform/config/build-model.ts';
import {
  isForbiddenSourcePath,
  isNonexecutingDocumentation,
} from '../../src/platform/config/input-policy.ts';

export class PolicyError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export const fail = (code) => {
  throw new PolicyError(code);
};
export function git(root, args, input) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      input,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    fail('GIT_EVIDENCE_UNAVAILABLE');
  }
}
export const gitText = (root, args) =>
  new TextDecoder('utf-8', { fatal: true }).decode(git(root, args)).trimEnd();
export function sha(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value) ||
    value.length !== 40
  )
    fail('INVALID_SOURCE_SHA');
  return value;
}
const parse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    fail('INVALID_JSON');
  }
};
export const jsonAt = (root, commit, path) =>
  parse(gitText(root, ['show', sha(commit) + ':' + path]));
const work = /^(feature|bug|chore|docs)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
function safeRef(value) {
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    /[\s\u0000-\u001f]/.test(value)
  )
    fail('INVALID_REF');
  return value;
}
export function prRoute(pr, repository) {
  if (
    !pr ||
    pr.base?.repo?.full_name !== repository.full_name ||
    String(pr.base?.repo?.id) !== String(repository.id)
  )
    fail('WRONG_BASE_REPOSITORY');
  const base = safeRef(pr.base.ref);
  const head = safeRef(pr.head?.ref);
  const same =
    String(pr.head?.repo?.id) === String(repository.id) &&
    pr.head.repo.full_name === repository.full_name;
  if (base === 'rc' && (work.test(head) || (head === 'main' && same)))
    return {
      promotion: false,
      route: head === 'main' ? 'synchronization' : 'work',
    };
  if (base === 'main' && head === 'rc' && same)
    return { promotion: true, route: 'promotion' };
  fail('UNAPPROVED_PR_ROUTE');
}
export function stableVersion(value) {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    value.trim() !== value ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value)
  )
    fail('INVALID_APPLICATION_VERSION');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) fail('INVALID_APPLICATION_VERSION');
  return parts;
}
const greater = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
};
export function metadata(root, commit) {
  const marker = jsonAt(root, commit, '.release/release.json');
  const keys = Object.keys(marker).sort().join(',');
  if (
    keys !== 'apiContractVersion,application,publish,version' ||
    marker.application !== 'backend' ||
    typeof marker.publish !== 'boolean'
  )
    fail('INVALID_RELEASE_MARKER');
  stableVersion(marker.version);
  const pkg = jsonAt(root, commit, 'package.json');
  const lock = jsonAt(root, commit, 'package-lock.json');
  const contract = jsonAt(root, commit, 'contracts/openapi-v1.json');
  if (
    pkg.version !== marker.version ||
    lock.version !== marker.version ||
    lock.packages?.['']?.version !== marker.version ||
    lock.packages[''].name !== pkg.name ||
    pkg.private !== true ||
    marker.apiContractVersion !== contract.info?.version
  )
    fail('RELEASE_METADATA_DISAGREES');
  for (const key of ['dependencies', 'devDependencies', 'engines'])
    if (
      canonical(pkg[key] ?? null) !== canonical(lock.packages[''][key] ?? null)
    )
      fail('DEPENDENCY_LOCK_DISAGREES');
  if (marker.publish && marker.version === '0.0.0')
    fail('BOOTSTRAP_VERSION_CANNOT_RELEASE');
  return marker;
}
function diffPaths(root, args) {
  const values = new TextDecoder('utf-8', { fatal: true })
    .decode(git(root, args))
    .split('\0')
    .filter(Boolean);
  const paths = [];
  for (let i = 0; i < values.length;) {
    const status = values[i++];
    if (!/^[ACDMRTUXB][0-9]*$/.test(status)) fail('UNEXPECTED_GIT_DIFF');
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let n = 0; n < count; n++) {
      if (!values[i]) fail('UNEXPECTED_GIT_DIFF');
      paths.push(values[i++]);
    }
  }
  return paths;
}
export function assertSourceTree(root, commit) {
  const tree = gitText(root, ['ls-tree', '-rz', commit])
    .split('\0')
    .filter(Boolean);
  if (tree.length > 20000) fail('SOURCE_TREE_LIMIT');
  const lower = new Set();
  for (const row of tree) {
    const split = row.indexOf('\t');
    const path = row.slice(split + 1);
    const mode = row.slice(0, split).split(' ')[0];
    if (!['100644', '100755'].includes(mode)) fail('UNSUPPORTED_SOURCE_ENTRY');
    if (isForbiddenSourcePath(path)) fail('FORBIDDEN_SOURCE_PATH');
    if (lower.has(path.toLowerCase())) fail('CASE_COLLIDING_PATH');
    lower.add(path.toLowerCase());
  }
}
export function changedPaths(root, base, head) {
  return [
    ...new Set(
      diffPaths(root, [
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        sha(base),
        sha(head),
      ]),
    ),
  ].sort();
}
export function assertIntroducedHistory(root, base, head) {
  const commits = gitText(root, ['rev-list', sha(base) + '..' + sha(head)])
    .split('\n')
    .filter(Boolean);
  if (commits.length > 1000) fail('CHANGE_HISTORY_LIMIT');
  for (const commit of commits) {
    assertSourceTree(root, commit);
    for (const path of diffPaths(root, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '--root',
      '-r',
      '-m',
      '-z',
      sha(commit),
    ]))
      if (isForbiddenSourcePath(path)) fail('FORBIDDEN_PATH_IN_HISTORY');
  }
  return commits.length;
}
function publishOnly(root, base, head) {
  const before = jsonAt(root, base, '.release/release.json');
  const after = jsonAt(root, head, '.release/release.json');
  const omit = ({ publish, ...rest }) =>
    JSON.stringify(Object.fromEntries(Object.entries(rest).sort()));
  return after.publish === false && omit(before) === omit(after);
}
export function classify(root, base, head) {
  const paths = changedPaths(root, base, head);
  const docsOnly =
    paths.length > 0 &&
    paths.every(
      (path) =>
        isNonexecutingDocumentation(path) ||
        (path === '.release/release.json' && publishOnly(root, base, head)),
    );
  return { paths, docsOnly, classification: docsOnly ? 'docs' : 'code' };
}
function beforeMarker(root, base, config) {
  const marker = jsonAt(root, base, '.release/release.json');
  if (base === config.bootstrapSha) {
    if (marker.version !== '0.0.0' || marker.publish !== false)
      fail('INVALID_BOOTSTRAP_STATE');
    return marker;
  }
  return metadata(root, base);
}
export function assertPromotion(root, base, head, merge, details, config) {
  const marker = metadata(root, merge);
  const previous = beforeMarker(root, base, config);
  if (
    gitText(root, ['rev-parse', head + '^{tree}']) !==
    gitText(root, ['rev-parse', merge + '^{tree}'])
  )
    fail('PROMOTION_TREE_DISAGREES');
  if (details.docsOnly) {
    if (
      marker.publish ||
      marker.version !== previous.version ||
      marker.apiContractVersion !== previous.apiContractVersion
    )
      fail('INVALID_DOCS_PROMOTION');
  } else {
    if (
      !marker.publish ||
      !greater(stableVersion(marker.version), stableVersion(previous.version))
    )
      fail('CODE_PROMOTION_REQUIRES_NEW_RELEASE');
    if (previous.version === '0.0.0' && marker.version !== '0.1.0')
      fail('FIRST_RELEASE_MUST_BE_0_1_0');
  }
}
export function validateRun(root, env, event, config) {
  if (
    !['push', 'pull_request'].includes(env.GITHUB_EVENT_NAME) ||
    env.GITHUB_ACTIONS !== 'true'
  )
    fail('UNAPPROVED_EVENT');
  const sourceSha = sha(env.GITHUB_SHA);
  if (gitText(root, ['rev-parse', 'HEAD']) !== sourceSha)
    fail('CHECKOUT_SHA_DISAGREES');
  if (
    event.repository?.full_name !== env.GITHUB_REPOSITORY ||
    String(event.repository?.id) !== env.GITHUB_REPOSITORY_ID
  )
    fail('REPOSITORY_DISAGREES');
  let baseSha;
  let promotion = false;
  let draft = false;
  let route = 'work';
  let headSha = sourceSha;
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    if (
      ![
        'opened',
        'synchronize',
        'reopened',
        'ready_for_review',
        'edited',
      ].includes(event.action) ||
      !/^refs\/pull\/[1-9][0-9]*\/merge$/.test(safeRef(env.GITHUB_REF)) ||
      env.GITHUB_REF !== 'refs/pull/' + event.number + '/merge'
    )
      fail('UNAPPROVED_PR_EVENT');
    ({ promotion, route } = prRoute(event.pull_request, event.repository));
    baseSha = sha(event.pull_request.base.sha);
    headSha = sha(event.pull_request.head.sha);
    draft = event.pull_request.draft;
    if (typeof draft !== 'boolean') fail('INVALID_DRAFT_STATE');
    const parents = gitText(root, [
      'show',
      '-s',
      '--format=%P',
      sourceSha,
    ]).split(' ');
    if (
      parents.length !== 2 ||
      parents[0] !== baseSha ||
      parents[1] !== headSha
    )
      fail('PR_MERGE_ANCESTRY_DISAGREES');
  } else {
    if (
      event.deleted ||
      event.after !== sourceSha ||
      event.ref !== env.GITHUB_REF
    )
      fail('PUSH_SOURCE_DISAGREES');
    const ref = safeRef(env.GITHUB_REF);
    if (!ref.startsWith('refs/heads/')) fail('BRANCH_PUSH_REQUIRED');
    const branch = ref.slice(11);
    if (!work.test(branch) && !['main', 'rc'].includes(branch))
      fail('UNAPPROVED_BRANCH');
    if (
      ['main', 'rc'].includes(branch) &&
      (env.GITHUB_REPOSITORY !== config.fullName ||
        env.GITHUB_REPOSITORY_ID !== config.repositoryId ||
        String(event.repository.owner?.id) !== config.ownerId)
    )
      fail('UNTRUSTED_DELIVERY_REPOSITORY');
    if (event.before === '0'.repeat(40)) {
      if (['main', 'rc'].includes(branch))
        fail('DELIVERY_BRANCH_CREATION_REQUIRES_BOOTSTRAP');
      let baseRef;
      for (const candidate of [
        'refs/remotes/origin/rc',
        'refs/remotes/origin/main',
      ]) {
        try {
          baseRef = gitText(root, ['rev-parse', '--verify', candidate]);
          break;
        } catch {}
      }
      if (!baseRef) fail('PERMANENT_BASE_UNAVAILABLE');
      baseSha = gitText(root, ['merge-base', sha(baseRef), sourceSha]);
    } else baseSha = sha(event.before);
  }
  metadata(root, sourceSha);
  assertSourceTree(root, sourceSha);
  const historyCommits = assertIntroducedHistory(root, baseSha, headSha);
  const details = classify(root, baseSha, sourceSha);
  if (promotion)
    assertPromotion(root, baseSha, headSha, sourceSha, details, config);
  return {
    schemaVersion: 1,
    sourceSha,
    headSha,
    baseSha,
    promotion,
    draft,
    route,
    historyCommits,
    ...details,
  };
}
