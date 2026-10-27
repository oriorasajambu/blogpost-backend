import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { prepareBuild } from '../build/prepare.mjs';

const [action, label = 'default'] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]{0,35}$/.test(label))
  throw new Error('Use a lowercase stack name, up to 36 characters.');
const root = resolve(import.meta.dirname, '../..');
const hash = createHash('sha256')
  .update(root.toLowerCase())
  .digest('hex')
  .slice(0, 8);
const project = `blogpost-dev-${label}-${hash}`;
const dir = resolve(root, '.local/stacks', `${label}-${hash}`);
const envFile = resolve(dir, '.env');
const contextFile = resolve(dir, 'context.json');
const backendImage = `blogpost-dev-${hash}-backend:development`;
const authImage = `blogpost-dev-${hash}-auth:development`;
async function ensureImageInputs() {
  let contents = await readFile(envFile, 'utf8');
  for (const [key, value] of [
    ['BACKEND_IMAGE', backendImage],
    ['AUTH_IMAGE', authImage],
    ['CURSOR_SIGNING_KEY', randomBytes(32).toString('hex')],
  ]) {
    if (!new RegExp(`^${key}=`, 'm').test(contents))
      contents += `\n${key}=${value}\n`;
  }
  await writeFile(envFile, contents, { mode: 0o600 });
}
async function prepareImage() {
  const build = await prepareBuild(root);
  let contents = await readFile(envFile, 'utf8');
  for (const [key, value] of [
    ['BACKEND_BUILD_CONTEXT', build.metadataDirectory],
    ['BACKEND_SOURCE_CONTEXT', build.sourceDirectory],
  ]) {
    contents = contents.replace(
      new RegExp('^' + key + '=.*(?:\\r?\\n|$)', 'gm'),
      '',
    );
    contents += '\n' + key + '=' + value.replaceAll('\\', '/') + '\n';
  }
  await writeFile(envFile, contents, { mode: 0o600 });
}
const freePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
function docker(args) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-name', project, '--env-file', envFile, ...args],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error || result.status !== 0)
    throw new Error('Stack command failed');
}
if (action === 'create') {
  await mkdir(dir, { recursive: true });
  try {
    const context = JSON.parse(await readFile(contextFile, 'utf8'));
    if (context.project !== project || context.workspace !== root)
      throw new Error('Stack belongs to another workspace');
    await ensureImageInputs();
    console.log(`Stack already exists: ${project}`);
    process.exit(0);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const ports = new Set();
  while (ports.size < 3) ports.add(await freePort());
  const [api, auth, web] = ports;
  const identityProject = `demo-blogpost-${hash}-${label}`.slice(0, 60);
  const secret = () => randomBytes(32).toString('hex');
  await writeFile(
    envFile,
    `STACK_PROJECT=${project}\nBACKEND_IMAGE=${backendImage}\nAUTH_IMAGE=${authImage}\nAPI_PORT=${api}\nAUTH_PORT=${auth}\nWEB_PORT=${web}\nIDENTITY_PROJECT_ID=${identityProject}\nSQL_ROOT_PASSWORD=${secret()}\nSQL_APP_PASSWORD=${secret()}\nSQL_MIGRATOR_PASSWORD=${secret()}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await ensureImageInputs();
  await writeFile(
    contextFile,
    JSON.stringify(
      {
        project,
        workspace: root,
        identityProject,
        apiPort: api,
        authPort: auth,
        webPort: web,
        contractVersion: '1.0.0',
        contractStatus: 'DRAFT',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    `Created ${project}\nAPI http://localhost:${api}\nAuth http://localhost:${auth}\nWeb reservation http://localhost:${web}`,
  );
} else {
  const context = JSON.parse(await readFile(contextFile, 'utf8'));
  if (context.project !== project || context.workspace !== root)
    throw new Error('Stack belongs to another workspace');
  await ensureImageInputs();
  if (action === 'start') {
    await prepareImage();
    // Job services reuse the API image; building each alias adds no useful image.
    docker(['build', 'api', 'auth']);
    docker(['up', '-d', '--wait', 'db', 'auth']);
    docker(['run', '--rm', 'bootstrap']);
    docker(['run', '--rm', 'migrate']);
    docker(['run', '--rm', 'verify']);
    docker(['up', '-d', '--wait', 'api']);
    console.log(
      `API http://localhost:${context.apiPort} — Auth http://localhost:${context.authPort}`,
    );
  } else if (action === 'status') docker(['ps']);
  else if (action === 'mock') {
    await prepareImage();
    docker(['up', '-d', '--no-deps', '--build', '--wait', 'mock']);
  } else if (action === 'stop') docker(['down']);
  else if (action === 'test') docker(['run', '--rm', 'test']);
  else if (action === 'maintenance')
    docker(['run', '--rm', '--no-deps', 'maintenance']);
  else if (action === 'bootstrap-admin') {
    for (const key of [
      'INITIAL_ADMIN_UID',
      'INITIAL_ADMIN_EMAIL',
      'INITIAL_ADMIN_DISPLAY_NAME',
      'INITIAL_ADMIN_HANDLE',
    ])
      if (!process.env[key]?.trim())
        throw new Error(`Supply the operator-only ${key} input for this job.`);
    docker(['run', '--rm', '--no-deps', 'bootstrap-admin']);
  } else
    throw new Error(
      'Usage: npm run dev:stack -- create|start|mock|status|stop|test|bootstrap-admin|maintenance [name]',
    );
}
