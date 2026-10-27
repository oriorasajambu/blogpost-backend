import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, sep, posix } from 'node:path';
import {
  canonical,
  digest,
  normalizeCloudProfile,
  validateProvenance,
} from '../../src/platform/config/build-model.ts';
import {
  isNonexecutingDocumentation,
  isForbiddenSourcePath,
} from '../../src/platform/config/input-policy.ts';
function git(root, args, optional = false, input) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      input,
      maxBuffer: 220 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    if (optional) return null;
    throw new Error('Cannot inspect source Git state');
  }
}
const decode = (bytes) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const gitText = (root, args, optional = false) => {
  const bytes = git(root, args, optional);
  return bytes === null ? null : decode(bytes).trimEnd();
};
function checkedPath(path) {
  if (
    !path ||
    posix.normalize(path) !== path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes(':') ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.split('/').includes('..')
  )
    throw new Error('Invalid source path');
  if (/(^|\/)\.env(?:$|\.)/i.test(path) && path !== '.env.example')
    throw new Error('Real environment files cannot be source inputs');
  if (isForbiddenSourcePath(path)) throw new Error('Forbidden source path');
}
function bound(files) {
  if (
    files.length > 20000 ||
    files.some((file) => file.bytes && file.bytes.length > 20 * 1024 * 1024) ||
    files.reduce((total, file) => total + (file.bytes?.length ?? 0), 0) >
      200 * 1024 * 1024
  )
    throw new Error('Build input inventory exceeds its bound');
  return files;
}
export function sourceFacts(root, environment, event = process.env) {
  const sha = gitText(root, ['rev-parse', '--verify', 'HEAD'], true);
  const branch = gitText(
    root,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    true,
  );
  const dirty =
    !sha ||
    gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']) !== '';
  let ref = branch ? 'refs/heads/' + branch : null;
  if (event.GITHUB_ACTIONS === 'true') {
    if (
      !['push', 'pull_request'].includes(event.GITHUB_EVENT_NAME) ||
      !/^refs\/(heads|pull)\/[A-Za-z0-9_./-]+$/.test(event.GITHUB_REF ?? '') ||
      event.GITHUB_SHA !== sha
    )
      throw new Error('CI source does not match the checkout');
    ref = event.GITHUB_REF;
    if (environment !== 'development') {
      const wanted = environment === 'staging' ? 'rc' : 'main';
      const workflow =
        environment === 'staging' ? 'staging.yml' : 'release.yml';
      if (
        event.GITHUB_EVENT_NAME !== 'push' ||
        ref !== 'refs/heads/' + wanted ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
          event.GITHUB_REPOSITORY ?? '',
        ) ||
        event.GITHUB_WORKFLOW_REF !==
          event.GITHUB_REPOSITORY + '/.github/workflows/' + workflow + '@' + ref
      )
        throw new Error('Cloud build requires its authorized push workflow');
    }
  }
  if (!sha) {
    if (environment !== 'development' || !['main', 'master'].includes(branch))
      throw new Error('Unborn source is development bootstrap only');
    return { sourceSha: null, sourceRef: 'unborn:' + branch, dirty: true };
  }
  if (environment === 'development') {
    if (
      event.GITHUB_ACTIONS !== 'true' &&
      !/^refs\/heads\/(feature|bug|chore)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
        ref ?? '',
      )
    )
      throw new Error('Development requires an executable work branch');
  } else if (
    dirty ||
    ref !== 'refs/heads/' + (environment === 'staging' ? 'rc' : 'main')
  )
    throw new Error('Cloud builds require clean authorized source');
  return { sourceSha: sha, sourceRef: ref, dirty };
}
export async function workingFiles(root) {
  const paths = [
    ...new Set(
      decode(
        git(root, [
          'ls-files',
          '--cached',
          '--others',
          '--exclude-standard',
          '-z',
        ]),
      )
        .split('\0')
        .filter(Boolean),
    ),
  ].sort();
  if (paths.length > 20000)
    throw new Error('Build input inventory exceeds its bound');
  const files = [];
  for (const path of paths) {
    checkedPath(path);
    let parent = root;
    for (const part of path.split('/').slice(0, -1)) {
      parent = resolve(parent, part);
      let info;
      try {
        info = await lstat(parent);
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('Unsafe source directory');
    }
    const absolute = resolve(root, path);
    if (!absolute.startsWith(root + sep))
      throw new Error('Source path escaped the checkout');
    let stat;
    try {
      stat = await lstat(absolute);
    } catch (error) {
      if (error.code === 'ENOENT') {
        files.push({ path, mode: '100644', bytes: null });
        continue;
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024)
      throw new Error('Unsupported source file');
    files.push({
      path,
      mode: stat.mode & 0o111 ? '100755' : '100644',
      bytes: await readFile(absolute),
    });
    bound(files);
  }
  return files;
}
export function committedFiles(root, sha) {
  const tree = decode(git(root, ['ls-tree', '-rlz', sha]))
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf('\t');
      const [mode, type, oid, size] = record.slice(0, tab).trim().split(/\s+/);
      const path = record.slice(tab + 1);
      checkedPath(path);
      if (
        type !== 'blob' ||
        !['100644', '100755'].includes(mode) ||
        !/^[a-f0-9]{40}$/.test(oid) ||
        !/^\d+$/.test(size)
      )
        throw new Error('Unsupported committed source entry');
      return { path, mode, oid, size: Number(size) };
    });
  if (
    tree.length > 20000 ||
    tree.some((file) => file.size > 20 * 1024 * 1024) ||
    tree.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024
  )
    throw new Error('Committed inputs exceed their bound');
  const batch = git(
    root,
    ['cat-file', '--batch'],
    false,
    tree.map((file) => file.oid).join('\n') + '\n',
  );
  let offset = 0;
  return tree.map((file) => {
    const end = batch.indexOf(10, offset);
    const header = batch.subarray(offset, end).toString('ascii');
    if (end < offset || header !== file.oid + ' blob ' + file.size)
      throw new Error('Invalid committed source batch');
    const bytes = Buffer.from(batch.subarray(end + 1, end + 1 + file.size));
    offset = end + 2 + file.size;
    if (bytes.length !== file.size) throw new Error('Truncated source batch');
    return { path: file.path, mode: file.mode, bytes };
  });
}
export async function inputManifest(
  root,
  environment,
  configuration = null,
  files,
) {
  files ??= await workingFiles(resolve(root));
  const entries = [];
  for (const file of bound(files)) {
    const { path, mode } = file;
    if (isNonexecutingDocumentation(path)) continue;
    if (file.bytes === null) {
      entries.push({ path, missing: true });
      continue;
    }
    let bytes = file.bytes;
    if (path === '.release/release.json') {
      const marker = JSON.parse(bytes.toString('utf8'));
      if (
        typeof marker.publish !== 'boolean' ||
        typeof marker.version !== 'string'
      )
        throw new Error('Invalid release marker');
      const { publish: _publish, ...rest } = marker;
      bytes = Buffer.from(canonical(rest));
    }
    entries.push({
      path,
      mode,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    schemaVersion: 1,
    application: 'backend',
    environment,
    targetPlatform: 'linux/amd64',
    configuration,
    entries,
  };
}
export async function prepareProvenance(
  root,
  environment = 'development',
  profile = null,
  event = process.env,
) {
  root = resolve(root);
  if (!['development', 'staging', 'production'].includes(environment))
    throw new Error('Invalid build environment');
  const configuration =
    environment === 'development' ? null : normalizeCloudProfile(profile);
  if (
    (environment === 'development' && profile !== null) ||
    (configuration && configuration.environment !== environment)
  )
    throw new Error('Build/profile mismatch');
  const facts = sourceFacts(root, environment, event);
  const files =
    environment === 'development'
      ? await workingFiles(root)
      : committedFiles(root, facts.sourceSha);
  const manifest = await inputManifest(root, environment, configuration, files);
  const required = (path) => {
    const bytes = files.find((file) => file.path === path)?.bytes;
    if (!bytes) throw new Error('Required build input missing');
    return bytes;
  };
  const pkg = JSON.parse(required('package.json').toString('utf8'));
  const marker = JSON.parse(required('.release/release.json').toString('utf8'));
  const contractBytes = required('contracts/openapi-v1.json');
  const contract = JSON.parse(contractBytes.toString('utf8'));
  if (pkg.version !== marker.version)
    throw new Error('Application/release versions differ');
  if (
    marker.application !== 'backend' ||
    marker.apiContractVersion !== contract.info.version
  )
    throw new Error('Application/contract marker mismatch');
  const provenance = validateProvenance({
    schemaVersion: 1,
    application: 'backend',
    kind: 'ARTIFACT',
    environment,
    ...facts,
    applicationVersion: pkg.version,
    contractVersion: contract.info.version,
    contractSha256: createHash('sha256').update(contractBytes).digest('hex'),
    runtimeInputDigest: digest(manifest),
    sourceInputDigest: digest({
      schemaVersion: 1,
      targetPlatform: manifest.targetPlatform,
      entries: manifest.entries,
    }),
    inputManifestVersion: 1,
    targetPlatform: 'linux/amd64',
    configuration,
  });
  return { provenance, manifest, files };
}
