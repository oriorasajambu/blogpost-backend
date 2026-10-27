import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertConforms,
  catalog,
  ConformanceError,
  coverage,
} from './verify.js';
import { metadata } from '../helpers.js';
import { backendScenarios } from './backend-scenarios.js';

const options = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]!;
  const value = process.argv[index + 1];
  if (
    !['--base-url', '--scope'].includes(key) ||
    value === undefined ||
    options.has(key)
  )
    throw new Error(
      'Usage: npm run contract:conformance -- --base-url URL [--scope full|implemented]',
    );
  options.set(key, value);
}
const base = new URL(options.get('--base-url') ?? 'http://127.0.0.1:8080');
if (
  !['http:', 'https:'].includes(base.protocol) ||
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash
)
  throw new Error('Use an HTTP(S) origin without credentials, query or path.');
const scope = options.get('--scope') ?? 'full';
if (!['full', 'implemented'].includes(scope))
  throw new Error('Unknown conformance scope');
const executed = new Set<string>();
const cases: { operationId: string; result: string; status?: number }[] = [];
let servedBuildSha: string | undefined;
for (const operation of catalog) {
  if (!backendScenarios.has(operation.operationId)) continue;
  // Read-only public fixtures can run without seeding, credentials or remote mutation.
  // Protected/resource/mutation cases require an explicit real fixture adapter before enabling.
  if (
    backendScenarios.get(operation.operationId) !== 'ANONYMOUS_READ_FIXTURE' ||
    operation.method !== 'GET' ||
    operation.access !== 'ANONYMOUS'
  ) {
    cases.push({
      operationId: operation.operationId,
      result: 'REAL_FIXTURE_ADAPTER_REQUIRED',
    });
    continue;
  }
  const request = JSON.parse(
    await readFile(
      new URL(
        `../../contracts/fixtures/operations/${operation.operationId}.request.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const url = new URL(request.path, base);
  if (url.origin !== base.origin)
    throw new Error('Fixture path escaped the requested API origin.');
  for (const [key, value] of Object.entries(request.query ?? {}))
    for (const part of Array.isArray(value) ? value : [value])
      url.searchParams.append(key, String(part));
  try {
    const response = await fetch(url, {
      headers: metadata,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > 16 * 1024 * 1024)
      throw new ConformanceError(operation.operationId, 'JSON_BODY_LIMIT');
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    try {
      while (reader) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 16 * 1024 * 1024)
          throw new ConformanceError(operation.operationId, 'JSON_BODY_LIMIT');
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      await reader?.cancel();
    }
    const body = assertConforms(operation.operationId, {
      method: operation.method,
      path: url.pathname,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.concat(chunks),
    });
    if (!response.ok)
      throw new ConformanceError(operation.operationId, 'SUCCESS_NOT_OBSERVED');
    if (operation.operationId === 'getApiMeta')
      servedBuildSha = body.data.buildSha;
    executed.add(operation.operationId);
    cases.push({
      operationId: operation.operationId,
      result: 'VERIFIED_SUCCESS',
      status: response.status,
    });
  } catch (error) {
    cases.push({
      operationId: operation.operationId,
      result:
        error instanceof ConformanceError ? error.rule : 'TRANSPORT_FAILURE',
    });
  }
}
const report = coverage('backend', executed);
const implementedPass =
  report.configuredBackendOperations.length > 0 &&
  report.configuredBackendOperations.every((id) => executed.has(id));
const accepted = scope === 'full' ? report.complete : implementedPass;
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, '.local/conformance');
await mkdir(directory, { recursive: true });
await writeFile(
  resolve(directory, `backend-${scope}.json`),
  JSON.stringify(
    {
      ...report,
      scope,
      scopeAccepted: accepted,
      baseOrigin: base.origin,
      observedAt: new Date().toISOString(),
      servedBuildSha,
      cases,
      evidenceKind: 'wire-operation-successes-only',
      limitations: [
        'Does not establish domain, SQL transaction, provider, client or release gates.',
      ],
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(
  `Backend wire coverage: ${report.executed}/${report.total}; ${scope} scope ${accepted ? 'accepted' : 'incomplete'}.\n`,
);
if (!accepted) process.exitCode = 1;
