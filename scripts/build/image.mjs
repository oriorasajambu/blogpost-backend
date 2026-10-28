import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { prepareBuild } from './prepare.mjs';
try {
  const options = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    const value = process.argv[i + 1];
    if (
      !['--environment', '--profile', '--target', '--tag'].includes(key) ||
      value === undefined ||
      options.has(key)
    )
      throw new Error('Invalid build arguments');
    options.set(key, value);
  }
  const target = options.get('--target') ?? 'development';
  const environment = options.get('--environment') ?? 'development';
  const tag = options.get('--tag');
  if (
    !['development', 'runtime', 'operations'].includes(target) ||
    !/^[a-z0-9][a-z0-9./:_-]{0,200}$/.test(tag ?? '') ||
    (target === 'development' && environment !== 'development')
  )
    throw new Error('Invalid image target');
  const profile = options.has('--profile')
    ? JSON.parse(await readFile(options.get('--profile'), 'utf8'))
    : null;
  const build = await prepareBuild(process.cwd(), environment, profile);
  const result = spawnSync(
    'docker',
    [
      'build',
      '--load',
      '--platform',
      'linux/amd64',
      '--target',
      target,
      '--tag',
      tag,
      '--build-context',
      'blogpost_metadata=' + build.metadataDirectory,
      build.sourceDirectory,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.error || result.status !== 0)
    throw new Error('Image build failed');
  process.stdout.write(
    JSON.stringify({
      event: 'image_built',
      environment,
      target,
      sourceSha: build.provenance.sourceSha,
      runtimeInputDigest: build.provenance.runtimeInputDigest,
      sourceInputDigest: build.provenance.sourceInputDigest,
    }) + '\n',
  );
} catch {
  process.stderr.write('{"event":"image_build_failed"}\n');
  process.exitCode = 1;
}
