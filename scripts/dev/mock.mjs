import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfies } from 'semver';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tooling = resolve(root, 'tools/mock');
const toolchain = JSON.parse(
  await readFile(resolve(tooling, 'package.json'), 'utf8'),
);
if (!satisfies(process.versions.node, toolchain.engines.node))
  throw new Error(
    `Use Node ${toolchain.engines.node}; the pinned development Docker image has the required runtime.`,
  );
for (const key of ['NODE_ENV', 'APP_ENV', 'BUILD_ENV'])
  if (['staging', 'production'].includes(process.env[key] ?? ''))
    throw new Error('Fixture scenarios cannot run in Staging or Production.');
const smoke = process.argv.includes('--smoke');
if (process.argv.slice(2).some((value) => value !== '--smoke'))
  throw new Error('Usage: npm run mock [-- --smoke]');
const proxyPort = Number(process.env.MOCK_PORT ?? 4010);
const scenarioPort = Number(process.env.MOCK_SCENARIO_PORT ?? 4020);
const proxyHost = process.env.MOCK_PROXY_HOST ?? '127.0.0.1';
if (!['127.0.0.1', '0.0.0.0'].includes(proxyHost))
  throw new Error('Use the loopback host, or the Compose container host.');
for (const port of [proxyPort, scenarioPort])
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Use valid unprivileged local mock ports.');
if (proxyPort === scenarioPort)
  throw new Error('The proxy and scenario ports must differ.');
const children = [];
let stopping = false;
let failed = false;
const environment = {
  ...process.env,
  NODE_ENV: 'development',
  APP_ENV: 'development',
  BUILD_ENV: 'development',
  SCARF_ANALYTICS: 'false',
  DO_NOT_TRACK: '1',
};
function child(script, args, extra = {}) {
  const processHandle = spawn(process.execPath, [script, ...args], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
    ...extra,
  });
  children.push(processHandle);
  processHandle.once('error', () => {
    failed = true;
    void stop(1);
  });
  processHandle.once('exit', () => {
    if (!stopping) {
      failed = true;
      void stop(1);
    }
  });
  return processHandle;
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const processHandle of children)
    if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
  await Promise.all(
    children.map((processHandle) =>
      processHandle.exitCode !== null || processHandle.signalCode !== null
        ? undefined
        : new Promise((resolveExit) => {
            const timeout = setTimeout(() => {
              processHandle.kill('SIGKILL');
              resolveExit();
            }, 3000);
            processHandle.once('exit', () => {
              clearTimeout(timeout);
              resolveExit();
            });
          }),
    ),
  );
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void stop();
  });
async function ensureFree(port) {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  await new Promise((resolveClose) => server.close(resolveClose));
}
async function waitReady(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (failed || stopping)
      throw new Error('A mock process exited during startup.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch {
      /* The child may still be binding its listener. */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('Mock startup timed out.');
}
async function installTooling() {
  const lock = await readFile(resolve(tooling, 'package-lock.json'));
  const hash = createHash('sha256').update(lock).digest('hex');
  const marker = resolve(tooling, 'node_modules/.blogpost-lock-sha256');
  try {
    await access(
      resolve(tooling, 'node_modules/@stoplight/prism-cli/dist/index.js'),
    );
    if ((await readFile(marker, 'utf8')).trim() === hash) return;
  } catch {
    /* Install the isolated, exactly locked toolchain. */
  }
  const npmCandidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(
      dirname(process.execPath),
      '../lib/node_modules/npm/bin/npm-cli.js',
    ),
  ].filter(Boolean);
  let npm;
  for (const candidate of npmCandidates) {
    try {
      await access(candidate);
      npm = candidate;
      break;
    } catch {
      /* Try the next installed npm location. */
    }
  }
  if (!npm)
    throw new Error(
      'Install the pinned Node/npm toolchain before starting the mock.',
    );
  await new Promise((resolveInstall, reject) => {
    const installer = spawn(
      process.execPath,
      [
        npm,
        'ci',
        '--prefix',
        tooling,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      { cwd: root, env: environment, stdio: 'inherit', windowsHide: true },
    );
    installer.once('error', reject);
    installer.once('exit', (code) =>
      code === 0
        ? resolveInstall()
        : reject(new Error('Prism tooling install failed.')),
    );
  });
  await mkdir(dirname(marker), { recursive: true });
  await writeFile(marker, hash + '\n');
}
try {
  await Promise.all([ensureFree(proxyPort), ensureFree(scenarioPort)]);
  await installTooling();
  child('--import', ['tsx', 'mock/main.ts'], {
    env: { ...environment, MOCK_SCENARIO_PORT: String(scenarioPort) },
  });
  await waitReady(scenarioPort);
  // Fastify validates inputs using the identical OpenAPI schemas and returns
  // canonical errors. Prism enforces response validation without replacing those
  // negative-case responses with Prism's own request-validation problem format.
  child(resolve(tooling, 'node_modules/@stoplight/prism-cli/dist/index.js'), [
    'proxy',
    resolve(root, 'contracts/openapi-v1.json'),
    `http://127.0.0.1:${scenarioPort}`,
    '--host',
    proxyHost,
    '--port',
    String(proxyPort),
    '--multiprocess',
    'false',
    '--validate-request',
    'false',
    '--errors',
    'true',
    '--verboseLevel',
    'error',
    '--cors',
    'false',
  ]);
  await waitReady(proxyPort);
  process.stdout.write(
    `Blogpost mock ready: http://127.0.0.1:${proxyPort}\nLocal scenario controls: http://127.0.0.1:${scenarioPort}/__mock/\n`,
  );
  if (smoke) {
    const headers = JSON.parse(
      await readFile(
        resolve(root, 'contracts/fixtures/operations/getApiMeta.request.json'),
        'utf8',
      ),
    ).headers;
    const base = `http://127.0.0.1:${proxyPort}`;
    const call = async (path, init, expected = 200) => {
      const response = await fetch(base + path, {
        headers,
        ...init,
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.json();
      if (
        response.status !== expected ||
        body.statusCode !== expected ||
        body.traceId !== response.headers.get('x-trace-id')
      )
        throw new Error(`Proxy smoke failed for ${path}: ${response.status}`);
      return body;
    };
    await call('/v1/meta');
    await call('/v1/meta', { headers: {} }, 400);
    const input = JSON.parse(
      await readFile(
        resolve(root, 'contracts/fixtures/operations/createPost.request.json'),
        'utf8',
      ),
    ).body;
    input.clientDraftId = '90000000-0000-4000-8000-000000000999';
    const created = await call(
      '/v1/posts',
      {
        method: 'POST',
        headers: {
          ...headers,
          authorization: 'Bearer mock-author',
          'idempotency-key': '90000000-0000-4000-8000-000000000998',
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      },
      201,
    );
    const submitted = await call(`/v1/posts/${created.data.id}/submit`, {
      method: 'POST',
      headers: {
        ...headers,
        authorization: 'Bearer mock-author',
        'idempotency-key': '90000000-0000-4000-8000-000000000997',
        'x-expected-version': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ revisionId: created.data.workingRevisionId }),
    });
    await call(`/v1/posts/${created.data.id}/publish`, {
      method: 'POST',
      headers: {
        ...headers,
        authorization: 'Bearer mock-editor',
        'idempotency-key': '90000000-0000-4000-8000-000000000996',
        'x-expected-version': String(submitted.data.version),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ revisionId: submitted.data.workingRevisionId }),
    });
    await call(`/v1/public/posts/${created.data.id}`);
    const media = await fetch(
      `${base}/v1/public/posts/10000000-0000-4000-8000-000000000001/media/50000000-0000-4000-8000-000000000001/w480`,
      { headers, signal: AbortSignal.timeout(5000) },
    );
    if (
      !media.ok ||
      !media.headers.get('content-type')?.startsWith('image/png') ||
      !(await media.arrayBuffer()).byteLength
    )
      throw new Error('Binary proxy smoke failed.');
    process.stdout.write(
      'Prism proxy checks passed: metadata, canonical errors, create/review/publish/public read and binary media.\n',
    );
    await stop();
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  await stop(1);
}
