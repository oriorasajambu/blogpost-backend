import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical } from '../../src/platform/config/build-model.ts';
import { fail, git, gitText, metadata, sha } from '../ci/policy.mjs';

export function compatibilityCatalog(
  catalog,
  { environment, version, publish, contractStatus },
) {
  if (
    !catalog ||
    canonical(Object.keys(catalog).sort()) !==
      canonical(['baselines', 'mode', 'schemaVersion']) ||
    catalog.schemaVersion !== 1 ||
    !Array.isArray(catalog.baselines) ||
    catalog.baselines.length > 20
  )
    fail('INVALID_COMPATIBILITY_CATALOG');
  if (catalog.mode === 'INITIAL_DRAFT') {
    if (
      environment !== 'staging' ||
      version !== '0.0.0' ||
      publish !== false ||
      contractStatus !== 'DRAFT' ||
      catalog.baselines.length
    )
      fail('INITIAL_DRAFT_COMPATIBILITY_NOT_ALLOWED');
  } else if (
    catalog.mode !== 'REVIEWED_HASHED_BASELINES' ||
    !catalog.baselines.length
  )
    fail('SUPPORTED_COMPATIBILITY_BASELINES_REQUIRED');
  const files = new Set(),
    hashes = new Set();
  for (const baseline of catalog.baselines) {
    if (
      !baseline ||
      canonical(Object.keys(baseline).sort()) !==
        canonical(['contractVersion', 'file', 'sha256']) ||
      typeof baseline.file !== 'string' ||
      baseline.file.length > 160 ||
      /^config\/contract-baselines\/[a-z0-9][a-z0-9.-]*\.json$/.exec(
        baseline.file,
      )?.[0] !== baseline.file ||
      typeof baseline.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(baseline.sha256) ||
      baseline.sha256.length !== 64 ||
      typeof baseline.contractVersion !== 'string' ||
      /^1\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.exec(
        baseline.contractVersion,
      )?.[0] !== baseline.contractVersion ||
      baseline.contractVersion.length > 50 ||
      files.has(baseline.file) ||
      hashes.has(baseline.sha256)
    )
      fail('INVALID_COMPATIBILITY_BASELINE');
    files.add(baseline.file);
    hashes.add(baseline.sha256);
  }
  return catalog;
}
export async function verifyRecoveryCompatibility(
  root,
  environment,
  baseSha,
  compare,
) {
  if (!['staging', 'production'].includes(environment))
    fail('WRONG_CLOUD_BUILD_ENVIRONMENT');
  sha(baseSha);
  const head = gitText(root, ['rev-parse', 'HEAD']);
  const release = metadata(root, head);
  const revisionBytes = git(root, [
    'show',
    head + ':contracts/openapi-v1.json',
  ]);
  if (revisionBytes.length > 4 * 1024 * 1024)
    fail('INVALID_COMPATIBILITY_INPUT');
  const current = JSON.parse(revisionBytes);
  const catalog = compatibilityCatalog(
    JSON.parse(
      gitText(root, ['show', head + ':config/contract-baselines.json']),
    ),
    {
      environment,
      version: release.version,
      publish: release.publish,
      contractStatus: current['x-contract-status'],
    },
  );
  const directory = resolve(root, '.local/cloudbuild-compatibility');
  await mkdir(directory, { recursive: true });
  const revision = resolve(directory, 'candidate.json');
  await writeFile(revision, revisionBytes);
  const results = [];
  for (const baseline of catalog.baselines) {
    const bytes = git(root, ['show', head + ':' + baseline.file]);
    if (
      bytes.length > 4 * 1024 * 1024 ||
      createHash('sha256').update(bytes).digest('hex') !== baseline.sha256
    )
      fail('COMPATIBILITY_BASELINE_BYTES_DISAGREE');
    const spec = JSON.parse(bytes);
    if (
      spec.info?.version !== baseline.contractVersion ||
      spec['x-contract-status'] === 'DRAFT'
    )
      fail('COMPATIBILITY_BASELINE_METADATA_DISAGREES');
    const path = resolve(directory, 'baseline-' + results.length + '.json');
    await writeFile(path, bytes);
    const result = await compare(path, revision);
    if (!result.compatible) fail('SUPPORTED_CONTRACT_BREAKING_CHANGE');
    results.push({ ...baseline, status: 'STRUCTURALLY_COMPATIBLE' });
  }
  // Parent comparison is useful in addition to supported baselines; it never replaces them.
  const tree = gitText(root, [
    'ls-tree',
    baseSha,
    '--',
    'contracts/openapi-v1.json',
  ]);
  let parent = { status: 'NOT_RUN_NO_PARENT_CONTRACT', sourceSha: baseSha };
  if (tree) {
    const bytes = git(root, ['show', baseSha + ':contracts/openapi-v1.json']);
    const path = resolve(directory, 'parent.json');
    await writeFile(path, bytes);
    if (!(await compare(path, revision)).compatible)
      fail('PARENT_CONTRACT_BREAKING_CHANGE');
    parent = {
      status: 'STRUCTURALLY_COMPATIBLE',
      sourceSha: baseSha,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  const report = {
    schemaVersion: 1,
    scope: 'STRUCTURAL_COMPARISON_ONLY',
    inputScope: 'COMMITTED_HEAD',
    sourceSha: head,
    contractSha256: createHash('sha256').update(revisionBytes).digest('hex'),
    supportedBaselineComparison:
      catalog.mode === 'INITIAL_DRAFT'
        ? 'NOT_RUN_INITIAL_DRAFT'
        : 'CHECKED_IN_HASHED_BASELINES',
    baselines: results,
    parent,
    semanticAndClientAcceptance: 'REQUIRED',
    limitations: [
      'Checked-in hashes do not authenticate release publication or establish semantic/client acceptance.',
    ],
  };
  await writeFile(resolve(directory, 'result.json'), canonical(report) + '\n');
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length !== 4 ||
      args[0] !== '--environment' ||
      args[2] !== '--base-sha'
    )
      fail('INVALID_COMPATIBILITY_ARGUMENTS');
    const { compareContracts } = await import('../contract-compatibility.mjs');
    const report = await verifyRecoveryCompatibility(
      process.cwd(),
      args[1],
      args[3],
      compareContracts,
    );
    console.log(
      JSON.stringify({
        event: 'recovery_compatibility_checked',
        supportedBaselineComparison: report.supportedBaselineComparison,
        baselines: report.baselines.length,
        parent: report.parent.status,
        semanticAndClientAcceptance: 'REQUIRED',
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'recovery_compatibility_failed',
        code:
          typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code)
            ? error.code
            : 'INVALID_COMPATIBILITY_EVIDENCE',
      }),
    );
    process.exitCode = 1;
  }
}
