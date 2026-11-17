/** Total attempts per email, including the first. */
export const MAX_ATTEMPTS = 6;
/** Delay before the next attempt, indexed by attempts already made (1-based). */
const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000] as const;

/** Returns the wait before the next attempt, or null when no attempt remains. */
export function nextAttemptDelay(attemptsMade: number): number | null {
  if (!Number.isInteger(attemptsMade) || attemptsMade < 1) return null;
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  return BACKOFF_MS[attemptsMade - 1]!;
}
