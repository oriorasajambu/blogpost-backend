import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readArtifactArchive,
  readOwnerPullRequest,
  readPublicStaging,
  OWNER_QUERY,
} from '../../scripts/ci/evidence/network.mjs';
import { uniqueJson } from '../../scripts/ci/evidence/unique-json.mjs';
import { githubReader } from '../../scripts/ci/github-api.mjs';
import {
  config,
  configuration,
  evidenceFixture,
  policy,
} from './evidence-fixtures.mjs';

test('artifact download authenticates only GitHub and bounds the signed storage response', async () => {
  const f = evidenceFixture();
  const calls = [];
  const value = await readArtifactArchive(
    config,
    '200',
    'synthetic-test-token',
    policy,
    async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: {
              location:
                'https://productionresultsfixture.blob.core.windows.net/artifacts/fixture.zip?sig=synthetic-only',
            },
          })
        : new Response(f.archive);
    },
  );
  assert.deepEqual(value, f.archive);
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/fixture/backend/actions/artifacts/200/zip',
  );
  assert.equal(
    calls[0].options.headers.Authorization,
    'Bearer synthetic-test-token',
  );
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.redirect, 'error');
  for (const location of [
    'http://productionresultsfixture.blob.core.windows.net/x',
    'https://evil.example.test/x',
    'https://user:password@github.com/x',
    'https://127.0.0.1/x',
  ])
    await assert.rejects(
      readArtifactArchive(
        config,
        '200',
        null,
        policy,
        async () => new Response(null, { status: 302, headers: { location } }),
      ),
    );
  let requests = 0;
  await assert.rejects(
    readArtifactArchive(config, '200', null, policy, async () =>
      ++requests === 1
        ? new Response(null, {
            status: 302,
            headers: {
              location:
                'https://productionresultsfixture.blob.core.windows.net/x',
            },
          })
        : new Response('x'.repeat(policy.maxArchiveBytes + 1)),
    ),
  );
});
test('owner attribution adapter runs only a fixed read-only query and rejects partial/private API failures', async () => {
  const f = evidenceFixture();
  const calls = [];
  const owner = await readOwnerPullRequest(
    config,
    9,
    'synthetic-test-token',
    async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              ...f.pr.repository,
              pullRequest: { ...f.pr, repository: undefined, number: 9 },
            },
          },
        }),
      );
    },
  );
  assert.equal(owner.repository.nameWithOwner, config.fullName);
  assert.equal(calls[0].url, 'https://api.github.com/graphql');
  assert.ok(OWNER_QUERY.startsWith('query '));
  assert.deepEqual(JSON.parse(calls[0].options.body).variables, {
    owner: 'fixture',
    name: 'backend',
    number: 9,
  });
  await assert.rejects(
    readOwnerPullRequest(
      config,
      9,
      null,
      async () =>
        new Response(
          JSON.stringify({
            errors: [{ message: 'private provider failure details' }],
            data: { repository: { pullRequest: { number: 9 } } },
          }),
        ),
    ),
    (error) => !error.message.includes('private provider failure details'),
  );
  await assert.rejects(
    readOwnerPullRequest(config, 0, null, async () => {
      throw Error('Must not call');
    }),
  );
});
test('public staging adapter uses only fixed read-only paths and synthetic metadata, never tokens/cookies', async () => {
  const f = evidenceFixture();
  const calls = [];
  const result = await readPublicStaging(
    configuration,
    async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify(
          url.endsWith('/v1/meta')
            ? { responseKey: 'SUCCESS', statusCode: 200, data: f.live.metadata }
            : { status: 'ok' },
        ),
        { headers: { 'cache-control': 'no-store' } },
      );
    },
  );
  assert.equal(result.metadata.buildSha, f.receipt.builtFromSha);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/health/live', '/health/ready', '/v1/meta'].map(
      (path) => configuration.apiOrigin + path,
    ),
  );
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(call.options.headers.Cookie, undefined);
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'error');
  }
  await assert.rejects(
    readPublicStaging(
      configuration,
      async () => new Response('{}', { status: 503 }),
    ),
  );
  let count = 0;
  await assert.rejects(
    readPublicStaging(
      configuration,
      async () =>
        new Response(
          JSON.stringify(
            ++count === 3
              ? { responseKey: 'FAILURE', statusCode: 200, data: {} }
              : {},
          ),
          { headers: { 'cache-control': 'no-store' } },
        ),
    ),
  );
  await assert.rejects(
    readPublicStaging(
      configuration,
      async () => new Response('x'.repeat(65537)),
    ),
  );
});
test('GitHub run/artifact evidence endpoints are fixed reads and cannot mutate or select arbitrary workflows', async () => {
  const read = githubReader(config, null, async () => new Response('{}'));
  for (const path of [
    '/actions/runs/100',
    '/actions/runs/100/attempts/1/jobs?per_page=100',
    '/actions/runs/100/artifacts?per_page=100',
    '/actions/artifacts/200',
    '/actions/workflows/staging.yml/runs?branch=rc&event=push&head_sha=' +
      'a'.repeat(40) +
      '&per_page=100',
  ])
    await read(path);
  for (const path of [
    '/actions/runs/100/rerun',
    '/actions/workflows/ci.yml/runs',
    '/actions/artifacts/200/zip',
    '/actions/runs/100/artifacts?per_page=100&page=2',
  ])
    await assert.rejects(read(path));
});
test('manual JSON rejects duplicate and escaped duplicate fields before values are discarded', () => {
  assert.deepEqual(uniqueJson('{"a":{"b":1},"b":[{"a":2}]}'), {
    a: { b: 1 },
    b: [{ a: 2 }],
  });
  assert.throws(() => uniqueJson('{"a":1,"a":2}'), /DUPLICATE/);
  assert.throws(() => uniqueJson('{"a":1,"\\u0061":2}'), /DUPLICATE/);
  assert.throws(() => uniqueJson('{"a":{"b":1,"b":2}}'), /DUPLICATE/);
});
