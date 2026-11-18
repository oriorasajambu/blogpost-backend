import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
export const toolchain = JSON.parse(
  await readFile(join(root, 'tools/kotlin/toolchain.json'), 'utf8'),
);
export const execute = promisify(execFile);
export async function javaExecutable() {
  const binary = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    process.env.BLOGPOST_JAVA_HOME &&
      join(process.env.BLOGPOST_JAVA_HOME, 'bin', binary),
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', binary),
    process.platform === 'win32'
      ? join(
          process.env.ProgramFiles ?? 'C:/Program Files',
          'Java/jdk-17/bin/java.exe',
        )
      : 'java',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = await execute(candidate, ['-version'], {
        timeout: 15_000,
        windowsHide: true,
      });
      const major = Number(
        (version.stderr + version.stdout).match(/version "(?:1\.)?(\d+)/)?.[1],
      );
      if (major >= toolchain.consumer.runtimeJavaMinimum) return candidate;
    } catch {
      /* Try the next explicit JDK, avoiding the Windows Oracle PATH shim. */
    }
  }
  throw new Error('Set BLOGPOST_JAVA_HOME to an installed JDK 17 or newer.');
}
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/**
 * Fetches a pinned artifact, retrying rate limits (Maven Central throttles shared CI runners)
 * and transient server errors with bounded backoff that honors a short Retry-After.
 */
export async function downloadWithRetry(
  url,
  { fetchImpl = fetch, wait = sleep, attempts = 5 } = {},
) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      if (attempt >= attempts) throw error;
      await wait(2 ** attempt * 1000);
      continue;
    }
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    await response.body?.cancel().catch(() => {});
    if (!RETRY_STATUSES.has(response.status) || attempt >= attempts)
      throw new Error(`Tool download failed: HTTP ${response.status}`);
    const retryAfter = Number(response.headers.get('retry-after'));
    await wait(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 60) * 1000
        : 2 ** attempt * 1000 + Math.floor(Math.random() * 1000),
    );
  }
}
async function verifiedDownload(asset, target) {
  try {
    const existing = await readFile(target);
    if (createHash('sha256').update(existing).digest('hex') === asset.sha256)
      return target;
  } catch {
    /* Download a missing or incomplete artifact. */
  }
  await mkdir(dirname(target), { recursive: true });
  const bytes = await downloadWithRetry(asset.url);
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error('Pinned tool checksum mismatch.');
  const temporary = target + '.download';
  await writeFile(temporary, bytes);
  await rename(temporary, target);
  return target;
}
export function installGenerator() {
  return verifiedDownload(
    toolchain.generator,
    join(
      root,
      '.local/tools/openapi-generator',
      toolchain.generator.version,
      'openapi-generator-cli.jar',
    ),
  );
}
export function configuredGradleHome(environment = process.env) {
  // Hosted runners may set GRADLE_HOME to an unrelated preinstalled version.
  // Only this project's explicit override may replace the pinned distribution.
  return environment.BLOGPOST_GRADLE_HOME
    ? resolve(environment.BLOGPOST_GRADLE_HOME)
    : null;
}
export async function gradleHome() {
  const configured = configuredGradleHome();
  if (configured) {
    const home = resolve(configured);
    await access(
      join(home, 'lib', `gradle-launcher-${toolchain.gradle.version}.jar`),
    );
    return home;
  }
  const directory = join(root, '.local/tools/gradle', toolchain.gradle.version);
  const home = join(directory, `gradle-${toolchain.gradle.version}`);
  try {
    await access(
      join(home, 'lib', `gradle-launcher-${toolchain.gradle.version}.jar`),
    );
    return home;
  } catch {}
  const archive = await verifiedDownload(
    toolchain.gradle,
    join(directory, 'distribution.zip'),
  );
  const java = await javaExecutable();
  const jar =
    java === 'java'
      ? 'jar'
      : join(dirname(java), process.platform === 'win32' ? 'jar.exe' : 'jar');
  // Only the checksum-pinned official distribution is extracted into the ignored tool directory.
  await execute(jar, ['xf', archive], {
    cwd: directory,
    timeout: 120_000,
    windowsHide: true,
  });
  await access(
    join(home, 'lib', `gradle-launcher-${toolchain.gradle.version}.jar`),
  );
  return home;
}
