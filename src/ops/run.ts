export async function runJob(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
    process.stdout.write('{"event":"job_completed"}\n');
  } catch (error) {
    const candidate = error as { code?: unknown; stderr?: unknown };
    const code =
      typeof candidate.code === 'string' &&
      /^[A-Z0-9_]{1,40}$/.test(candidate.code)
        ? candidate.code
        : typeof candidate.stderr === 'string'
          ? (candidate.stderr.match(/\bP[0-9]{4}\b/)?.[0] ?? null)
          : null;
    process.stderr.write(`${JSON.stringify({ event: 'job_failed', code })}\n`);
    process.exitCode = 1;
  }
}
