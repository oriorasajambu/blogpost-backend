import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
const project = process.env.IDENTITY_PROJECT_ID;
if (!project?.startsWith('demo-'))
  throw new Error('Auth emulator requires a demo project.');
const args = [
  'emulators:start',
  '--only',
  'auth',
  '--config',
  'firebase.json',
  '--project',
  project,
  '--export-on-exit',
  '/emulator/data',
];
if (existsSync('/emulator/data/firebase-export-metadata.json'))
  args.push('--import', '/emulator/data');
const child = spawn('./node_modules/.bin/firebase', args, { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => child.kill(signal));
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
