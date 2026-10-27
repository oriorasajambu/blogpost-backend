import { access, mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
  gradleHome,
  javaExecutable,
  root,
  toolchain,
} from './kotlin-tools.mjs';

const update = process.argv.includes('--update-locks');
if (process.argv.slice(2).some((argument) => argument !== '--update-locks'))
  throw new Error('Usage: npm run contract:kotlin:test [-- --update-locks]');
const project = join(root, 'tools/kotlin/consumer');
if (!update) {
  await access(join(project, 'gradle.lockfile'));
  await access(join(project, 'gradle/verification-metadata.xml'));
}
const java = await javaExecutable();
const home = await gradleHome();
const cache = join(root, '.local/kotlin-gradle-home');
await mkdir(cache, { recursive: true });
const args = [
  '-cp',
  join(home, 'lib', `gradle-launcher-${toolchain.gradle.version}.jar`),
  'org.gradle.launcher.GradleMain',
  '--no-daemon',
  '--max-workers=2',
  '--console=plain',
  '--project-dir',
  project,
  '--project-cache-dir',
  join(root, '.local/kotlin-gradle-project-cache'),
  `-Pkotlin.project.persistent.dir=${join(root, '.local/kotlin-project-data')}`,
  '-Pkotlin.project.persistent.dir.gradle.disableWrite=true',
  'test',
  ...(update
    ? ['--write-locks', '--write-verification-metadata', 'sha256']
    : ['--dependency-verification', 'strict']),
];
const child = spawn(java, args, {
  cwd: root,
  windowsHide: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(java === 'java' ? {} : { JAVA_HOME: dirname(dirname(java)) }),
    GRADLE_USER_HOME: cache,
  },
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => child.kill(signal));
await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
    resolveExit();
  });
});
if (process.exitCode === 0) {
  let total = 0;
  for (const name of ['WireConsumerTest', 'WireHttpTest']) {
    const result = await readFile(
      join(
        root,
        '.local/kotlin-consumer-build/test-results/test',
        `TEST-com.blogpost.contract.wire.${name}.xml`,
      ),
      'utf8',
    );
    const suite = result.match(/<testsuite\s[^>]+>/)?.[0] ?? '';
    const attribute = (name) =>
      Number(suite.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1] ?? NaN);
    if (
      !(attribute('tests') > 0) ||
      attribute('failures') !== 0 ||
      attribute('errors') !== 0 ||
      attribute('skipped') !== 0
    )
      throw new Error(`Kotlin tests did not complete successfully: ${name}`);
    total += attribute('tests');
  }
  process.stdout.write(
    `Verified Kotlin test reports: ${total} tests passed, none skipped.\n`,
  );
}
