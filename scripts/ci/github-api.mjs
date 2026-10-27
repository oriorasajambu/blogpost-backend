import { sha, fail } from './policy.mjs';

export function githubReader(config, token, transport = fetch) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.fullName))
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
    try {
      response = await transport('https://api.github.com' + prefix + suffix, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
      });
      if (!response.ok || response.redirected)
        fail('GITHUB_EVIDENCE_UNAVAILABLE');
      const reader = response.body?.getReader();
      if (!reader) fail('GITHUB_EVIDENCE_UNAVAILABLE');
      let size = 0;
      const chunks = [];
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) fail('GITHUB_EVIDENCE_LIMIT');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      fail('GITHUB_EVIDENCE_UNAVAILABLE');
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
