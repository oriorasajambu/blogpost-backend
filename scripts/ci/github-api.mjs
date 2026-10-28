import { sha, fail } from './policy.mjs';
import { uniqueJson } from './evidence/unique-json.mjs';
import {
  abortable,
  cancelQuietly,
  discardResponse,
} from '../deploy/transport-deadline.mjs';

export function githubReader(config, token, transport = fetch) {
  if (
    typeof config.fullName !== 'string' ||
    config.fullName.length > 200 ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.fullName) ||
    config.fullName.split('/').some((part) => part === '.' || part === '..')
  )
    fail('INVALID_GITHUB_REPOSITORY');
  const prefix = '/repos/' + config.fullName;
  return async (suffix) => {
    if (
      typeof suffix !== 'string' ||
      /[\s\u0000-\u001f\u007f]/.test(suffix) ||
      !/^\/(?:commits\/[a-f0-9]{40}\/pulls\?per_page=100|pulls\/[1-9][0-9]*|git\/ref\/heads\/(?:main|rc)|actions\/workflows\/staging\.yml\/runs\?branch=rc&event=push&head_sha=[a-f0-9]{40}&per_page=100|actions\/runs\/[1-9][0-9]*(?:\/attempts\/[1-9][0-9]*\/jobs\?per_page=100|\/artifacts\?per_page=100)?|actions\/artifacts\/[1-9][0-9]*)$/.test(
        suffix,
      )
    )
      fail('UNAPPROVED_GITHUB_READ');
    let response;
    const signal = AbortSignal.timeout(15000);
    try {
      response = await abortable(
        transport('https://api.github.com' + prefix + suffix, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          signal,
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
          },
        }),
        signal,
        discardResponse,
      );
      if (!response.ok || response.redirected)
        fail('GITHUB_EVIDENCE_UNAVAILABLE');
      const reader = response.body?.getReader();
      if (!reader) fail('GITHUB_EVIDENCE_UNAVAILABLE');
      let size = 0;
      const chunks = [];
      const abort = () => cancelQuietly(reader);
      signal.addEventListener('abort', abort, { once: true });
      try {
        for (;;) {
          const { value, done } = await abortable(reader.read(), signal);
          if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) fail('GITHUB_EVIDENCE_LIMIT');
          chunks.push(Buffer.from(value));
        }
      } finally {
        signal.removeEventListener('abort', abort);
        cancelQuietly(reader);
        reader.releaseLock();
      }
      return uniqueJson(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      fail('GITHUB_EVIDENCE_UNAVAILABLE');
    } finally {
      discardResponse(response);
    }
  };
}
export async function currentBranchSha(read, branch) {
  if (!['main', 'rc'].includes(branch)) fail('INVALID_PERMANENT_BRANCH');
  const ref = await read('/git/ref/heads/' + branch);
  if (ref.ref !== 'refs/heads/' + branch || ref.object?.type !== 'commit')
    fail('INVALID_LIVE_BRANCH');
  return sha(ref.object.sha);
}
