import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { installOasdiff } from './install-oasdiff.mjs';

function policyChanges(base, revision) {
  const changes = [];
  const flag = (id, path) =>
    changes.push({
      id,
      level: 'ERR',
      text: 'Blogpost v1 policy requires this wire behavior to remain stable.',
      path,
    });
  const resolveParameter = (spec, value) =>
    value.$ref
      ? spec.components.parameters[value.$ref.split('/').at(-1)]
      : value;
  for (const name of ['Role', 'PublicationState', 'WorkflowState']) {
    const before = base.components?.schemas?.[name]?.enum;
    if (
      before &&
      JSON.stringify([...before].sort()) !==
        JSON.stringify(
          [...(revision.components?.schemas?.[name]?.enum ?? [])].sort(),
        )
    )
      flag('CRITICAL_ENUM_CHANGED', `/components/schemas/${name}`);
  }
  for (const [key, value] of Object.entries(base['x-transport-rules'] ?? {}))
    if (
      JSON.stringify(value) !==
      JSON.stringify(revision['x-transport-rules']?.[key])
    )
      flag('TRANSPORT_POLICY_CHANGED', `/x-transport-rules/${key}`);
  for (const [path, pathItem] of Object.entries(base.paths ?? {}))
    for (const method of [
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'head',
      'options',
    ]) {
      const before = pathItem[method];
      const after = revision.paths?.[path]?.[method];
      if (!before || !after) continue; // Standard removed-operation detection is supplied by oasdiff.
      if (before.operationId !== after.operationId)
        flag('OPERATION_ID_CHANGED', `${method.toUpperCase()} ${path}`);
      for (const key of [
        'x-access',
        'x-idempotency-required',
        'x-expected-version-required',
        'x-server-proxy-only',
      ])
        if (
          Object.hasOwn(before, key) &&
          JSON.stringify(before[key]) !== JSON.stringify(after[key])
        )
          flag(
            'OPERATION_POLICY_CHANGED',
            `${method.toUpperCase()} ${path}: ${key}`,
          );
      if (
        JSON.stringify(before.security ?? base.security ?? []) !==
        JSON.stringify(after.security ?? revision.security ?? [])
      )
        flag(
          'AUTHENTICATION_POLICY_CHANGED',
          `${method.toUpperCase()} ${path}`,
        );
      const beforeHeaders = [
        ...(pathItem.parameters ?? []),
        ...(before.parameters ?? []),
      ]
        .map((value) => resolveParameter(base, value))
        .filter((value) => value.in === 'header');
      const afterHeaders = [
        ...(revision.paths[path].parameters ?? []),
        ...(after.parameters ?? []),
      ]
        .map((value) => resolveParameter(revision, value))
        .filter((value) => value.in === 'header');
      for (const header of beforeHeaders)
        if (
          !afterHeaders.some(
            (candidate) =>
              candidate.name.toLowerCase() === header.name.toLowerCase() &&
              !!candidate.required === !!header.required,
          )
        )
          flag(
            'EXISTING_HEADER_CONTRACT_CHANGED',
            `${method.toUpperCase()} ${path}: ${header.name}`,
          );
    }
  return changes;
}

export async function compareContracts(base, revision) {
  const executable = await installOasdiff();
  const result = spawnSync(
    executable,
    [
      'breaking',
      resolve(base),
      resolve(revision),
      '--format',
      'json',
      '--fail-on',
      'WARN',
      '--allow-external-refs=false',
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 },
  );
  if (result.error || ![0, 1].includes(result.status))
    throw new Error(
      `oasdiff failed: ${result.stderr || result.error?.message || result.status}`,
    );
  const findings = [
    ...JSON.parse(result.stdout || '[]'),
    ...policyChanges(
      parse(await readFile(base, 'utf8')),
      parse(await readFile(revision, 'utf8')),
    ),
  ];
  return { compatible: result.status === 0 && findings.length === 0, findings };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const index = process.argv.indexOf('--base');
  if (index < 0 || !process.argv[index + 1])
    throw new Error(
      'Supply --base with a verified supported contract. No published baseline exists yet; never report a comparison against missing evidence as passed.',
    );
  const base = process.argv[index + 1];
  const revision = 'contracts/openapi-v1.json';
  const result = await compareContracts(base, revision);
  const baseBytes = await readFile(base);
  const revisionBytes = await readFile(revision);
  const baseline = JSON.parse(baseBytes);
  const report = {
    tool: 'oasdiff',
    toolVersion: '1.34.1',
    scope: 'STRUCTURAL_COMPARISON_ONLY',
    baseline: relative(process.cwd(), resolve(base)).replaceAll('\\', '/'),
    baselineSha256: createHash('sha256').update(baseBytes).digest('hex'),
    baselineContractVersion: baseline.info.version,
    baselineStatus: baseline['x-contract-status'] ?? 'UNSPECIFIED',
    revisionSha256: createHash('sha256').update(revisionBytes).digest('hex'),
    status: result.compatible ? 'PASS' : 'BREAKING_CHANGES',
    semanticReview: 'REQUIRED',
    findings: result.findings,
  };
  await writeFile(
    'contracts/compatibility-report.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  if (!result.compatible) process.exitCode = 1;
  console.log(
    `Structural compatibility: ${report.status}. Semantic and old-client review remains required.`,
  );
}
