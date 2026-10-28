// Cancellation is best effort: a transport's cancel hook can itself stall.
export function cancelQuietly(target) {
  try {
    Promise.resolve(target?.cancel()).catch(() => {});
  } catch {
    // Cleanup must not mask the bounded operation's result.
  }
}

export async function abortable(promise, signal, onLateResult) {
  if (signal.aborted) {
    Promise.resolve(promise).then(onLateResult, () => {});
    signal.throwIfAborted();
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise)
      .then((value) => {
        if (signal.aborted) {
          onLateResult?.(value);
          return;
        }
        resolve(value);
      }, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export const discardResponse = (response) => cancelQuietly(response?.body);
