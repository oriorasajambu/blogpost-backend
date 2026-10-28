import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloudBuildTime,
  verifyCloudBuildContext,
} from '../../scripts/cloudbuild/context.mjs';
import {
  requireLiveCloudBuildContext,
  verifyLiveCloudBuildContext,
} from '../../scripts/cloudbuild/reader.mjs';
import {
  cloudFixture,
  observed,
  provider,
  syntheticToken,
  useGitSource,
} from './cloudbuild-fixtures.mjs';

for (const environment of ['staging', 'production']) {
  test(
    'Cloud Build ' +
      environment +
      ' context uses observed source/project and manual trigger',
    async () => {
      const f = cloudFixture(environment);
      const proof = verifyCloudBuildContext(f);
      assert.equal(
        proof.sourceSha,
        f.build.sourceProvenance.resolvedConnectedRepository.revision,
      );
      assert.equal(proof.evidenceSource, 'provided-json');
      assert.throws(() => requireLiveCloudBuildContext(proof, observed));
      // Project-number aliases in resource names are normalized using an independent project read.
      const numeric = structuredClone(f);
      for (const key of ['build', 'trigger', 'repository'])
        numeric[key] = JSON.parse(
          JSON.stringify(numeric[key]).replaceAll(
            'projects/' + f.request.projectId + '/',
            'projects/' + f.project.projectNumber + '/',
          ),
        );
      assert.deepEqual(verifyCloudBuildContext(numeric), proof);
      f.build.source.connectedRepository.revision = proof.sourceSha;
      const p = provider(f);
      const live = await verifyLiveCloudBuildContext({
        ...f,
        transport: p.transport,
      });
      assert.equal(live.evidenceSource, 'live-api');
      assert.equal(requireLiveCloudBuildContext(live, observed), live);
      assert.equal(p.calls.length, 10);
      for (const { url, options } of p.calls) {
        assert.equal(options.method, 'GET');
        assert.equal(options.redirect, 'error');
        assert.equal(options.credentials, 'omit');
        assert.ok(options.signal instanceof AbortSignal);
        if (url.startsWith('http://metadata.google.internal/')) {
          assert.equal(options.headers['Metadata-Flavor'], 'Google');
          assert.equal(options.headers.Authorization, undefined);
        } else {
          assert.ok(
            [
              'cloudresourcemanager.googleapis.com',
              'cloudbuild.googleapis.com',
            ].includes(new URL(url).hostname),
          );
          assert.equal(
            options.headers.Authorization,
            'Bearer ' + syntheticToken,
          );
          assert.equal(options.headers['Metadata-Flavor'], undefined);
        }
      }
      assert.ok(!JSON.stringify(live).includes(syntheticToken));
      assert.throws(() =>
        requireLiveCloudBuildContext(structuredClone(live), observed),
      );
      assert.throws(
        () => requireLiveCloudBuildContext(live, observed + 60001),
        { code: 'CLOUD_BUILD_CONTEXT_EXPIRED' },
      );
      assert.throws(
        () => requireLiveCloudBuildContext(live, observed - 300001),
        { code: 'CLOUD_BUILD_CONTEXT_EXPIRED' },
      );
      live.sourceSha = 'b'.repeat(40);
      assert.throws(() => requireLiveCloudBuildContext(live, observed), {
        code: 'AUTHENTICATED_CLOUD_BUILD_CONTEXT_REQUIRED',
      });
    },
  );
}

test('Cloud Build rejects routing substitutions as identity and rejects unsafe source/trigger context', () => {
  const mutations = [
    (f) => {
      f.request.extra = true;
    },
    (f) => {
      f.request.projectId = f.projects.production.projectId;
    },
    (f) => {
      f.request.buildId += '/../../token';
    },
    (f) => {
      f.request.region = 'global';
    },
    (f) => {
      f.projects.production.projectNumber = f.project.projectNumber;
    },
    (f) => {
      f.project.projectNumber = '123';
    },
    (f) => {
      f.project.lifecycleState = 'DELETE_REQUESTED';
    },
    (f) => {
      f.metadataEmail = 'unexpected@example.test';
    },
    (f) => {
      f.build.serviceAccount = f.build.serviceAccount.replace(
        'blogpost-build@',
        'default@',
      );
    },
    (f) => {
      f.build.status = 'SUCCESS';
    },
    (f) => {
      f.build.finishTime = '2026-10-28T00:00:00Z';
    },
    (f) => {
      f.build.id = f.trigger.id;
    },
    (f) => {
      f.build.name = f.build.name.replace('/builds/', '/triggers/');
    },
    (f) => {
      f.build.startTime = '2026-10-26T00:00:00Z';
    },
    (f) => {
      f.build.startTime = '2026-10-28T00:06:00Z';
    },
    (f) => {
      f.build.createTime = '2026-10-28T00:06:00Z';
    },
    (f) => {
      f.build.options.logging = 'LEGACY';
    },
    (f) => {
      f.build.options.pool = { name: 'private-pool' };
    },
    (f) => {
      f.build.options.workerPool = 'deprecated-private-pool';
    },
    (f) => {
      f.build.options.secretEnv = ['PRIVATE'];
    },
    (f) => {
      f.build.options.secretEnv = {};
    },
    (f) => {
      f.build.availableSecrets = {};
    },
    (f) => {
      f.build.secrets = [{}];
    },
    (f) => {
      f.build.steps = [];
    },
    (f) => {
      f.build.steps = [null];
    },
    (f) => {
      f.build.steps[0].secretEnv = ['PRIVATE'];
    },
    (f) => {
      f.build.source.storageSource = {};
    },
    (f) => {
      f.build.source = { repoSource: {} };
    },
    (f) => {
      f.build.source.connectedRepository.dir = 'nested';
    },
    (f) => {
      f.build.source.connectedRepository.extra = true;
    },
    (f) => {
      f.build.source.connectedRepository.revision = 'refs/heads/main';
    },
    (f) => {
      f.build.sourceProvenance.resolvedConnectedRepository.revision =
        'refs/heads/rc';
    },
    (f) => {
      f.build.sourceProvenance.resolvedRepoSource = {};
    },
    (f) => {
      f.build.sourceProvenance.resolvedConnectedRepository.repository +=
        '/../other';
    },
    (f) => {
      f.build.source.connectedRepository.repository = f.repository.name.replace(
        '/github/',
        '/../',
      );
    },
    (f) => {
      f.build.substitutions.COMMIT_SHA = 'b'.repeat(40);
    },
    (f) => {
      f.build.substitutions.REVISION_ID = 'b'.repeat(40);
    },
    (f) => {
      f.build.substitutions.BRANCH_NAME = 'main';
    },
    (f) => {
      f.build.substitutions._APP_ENV = 'production';
    },
    (f) => {
      f.build.substitutions.TAG_NAME = 'v1.0.0';
    },
    (f) => {
      f.build.buildTriggerId = undefined;
    },
    (f) => {
      f.trigger.id = f.build.id;
    },
    (f) => {
      f.trigger.eventType = 'REPO';
    },
    (f) => {
      f.trigger.name = 'other-manual-trigger';
    },
    (f) => {
      f.trigger.disabled = true;
    },
    (f) => {
      f.trigger.github = {};
    },
    (f) => {
      f.trigger.pubsubConfig = {};
    },
    (f) => {
      f.trigger.webhookConfig = {};
    },
    (f) => {
      f.trigger.build = {};
    },
    (f) => {
      f.trigger.filter = 'true';
    },
    (f) => {
      f.trigger.ignoredFiles = ['docs/**'];
    },
    (f) => {
      f.trigger.includedFiles = {};
    },
    (f) => {
      f.trigger.autodetect = true;
    },
    (f) => {
      f.trigger.serviceAccount = f.trigger.serviceAccount.replace(
        'blogpost-build@',
        'other@',
      );
    },
    (f) => {
      f.trigger.sourceToBuild.ref = 'refs/tags/v1.0.0';
    },
    (f) => {
      f.trigger.sourceToBuild.repository += '.other';
    },
    (f) => {
      f.trigger.sourceToBuild.repoType = 'BITBUCKET';
    },
    (f) => {
      f.trigger.sourceToBuild.uri = f.repository.remoteUri;
    },
    (f) => {
      f.trigger.filename = 'other.yaml';
    },
    (f) => {
      f.trigger.gitFileSource = {};
    },
    (f) => {
      f.trigger.createTime = '2026-10-28T00:06:00Z';
    },
    (f) => {
      f.repository.remoteUri = 'https://github.com/other/backend.git';
    },
    (f) => {
      f.repository.remoteUri += '?token=synthetic';
    },
    (f) => {
      f.repository.etag = '';
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = cloudFixture();
    mutate(f);
    assert.throws(
      () => verifyCloudBuildContext(f),
      undefined,
      'mutation ' + index,
    );
  }
});

test('Cloud Build timestamps reject calendar normalization and accept provider fractional seconds', () => {
  for (const value of [
    '2026-02-30T00:00:00Z',
    '2026-10-28T24:00:00Z',
    '2026-10-28T00:00:00+00:00',
    '2026-10-28T00:00:00.1Z',
    '2026-10-28T00:00:00Z\n',
    null,
  ])
    assert.throws(() => cloudBuildTime(value));
  for (const fraction of ['', '.000', '.000000', '.000000000'])
    assert.equal(
      cloudBuildTime('2026-10-28T00:00:00' + fraction + 'Z'),
      observed,
    );
});

test('invalid Cloud Build request is rejected before reading metadata and mismatched account before token', async () => {
  const f = cloudFixture(),
    p = provider(f);
  await assert.rejects(
    verifyLiveCloudBuildContext({
      ...f,
      request: { ...f.request, projectId: 'untrusted-project' },
      transport: p.transport,
    }),
  );
  assert.equal(p.calls.length, 0);
  f.metadataEmail = 'unexpected@example.test';
  await assert.rejects(
    verifyLiveCloudBuildContext({ ...f, transport: p.transport }),
    { code: 'CLOUD_BUILD_METADATA_ACCOUNT_DISAGREES' },
  );
  assert.equal(p.calls.length, 1);
});

test('Cloud Build reader rejects malformed, excessive, redirected and private failure responses safely', async () => {
  const transforms = [
    () => {
      throw new Error('private provider diagnostic');
    },
    () => new Response('private provider diagnostic', { status: 403 }),
    () =>
      Object.defineProperty(new Response('{}'), 'redirected', { value: true }),
    () => new Response('{}', { headers: { 'Metadata-Flavor': 'not-Google' } }),
    () =>
      new Response('x'.repeat(257), {
        headers: { 'Metadata-Flavor': 'Google' },
      }),
    () =>
      new Response(new Uint8Array([0xff]), {
        headers: { 'Metadata-Flavor': 'Google' },
      }),
    (r, { url }) =>
      url.endsWith('/token')
        ? new Response('{}', {
            headers: {
              'Metadata-Flavor': 'Google',
              'Content-Type': 'text/html',
            },
          })
        : r,
    (r, { url }) =>
      url.endsWith('/token')
        ? new Response('{', {
            headers: {
              'Metadata-Flavor': 'Google',
              'Content-Type': 'application/json',
            },
          })
        : r,
    (r, { url }) =>
      url.endsWith('/token')
        ? new Response(' '.repeat(16385), {
            headers: {
              'Metadata-Flavor': 'Google',
              'Content-Type': 'application/json',
            },
          })
        : r,
    (r, { url }) =>
      url.startsWith('https://')
        ? new Response(' '.repeat(1048577), {
            headers: { 'Content-Type': 'application/json' },
          })
        : r,
  ];
  for (const transform of transforms) {
    const f = cloudFixture(),
      p = provider(f, transform);
    await assert.rejects(
      verifyLiveCloudBuildContext({ ...f, transport: p.transport }),
      (e) =>
        e.code === 'CLOUD_BUILD_READ_FAILED' &&
        !e.message.includes('private') &&
        !e.message.includes(syntheticToken),
    );
  }
});

test('Cloud Build metadata credentials have a strict shape and never reach evidence', async () => {
  for (const patch of [
    { access_token: '' },
    { access_token: 'private\nheader' },
    { access_token: 'a'.repeat(4097) },
    { token_type: 'Basic' },
    { expires_in: 59 },
    { expires_in: '3600' },
  ]) {
    const f = cloudFixture(),
      p = provider(f, (r, { url }) =>
        url.endsWith('/token')
          ? new Response(
              JSON.stringify({
                access_token: syntheticToken,
                token_type: 'Bearer',
                expires_in: 3600,
                ...patch,
              }),
              {
                headers: {
                  'Metadata-Flavor': 'Google',
                  'Content-Type': 'application/json',
                },
              },
            )
          : r,
      );
    await assert.rejects(
      verifyLiveCloudBuildContext({ ...f, transport: p.transport }),
      { code: 'INVALID_CLOUD_BUILD_CREDENTIAL' },
    );
    assert.equal(p.calls.length, 2);
  }
});

test('Cloud Build re-observation detects source, trigger, connection and metadata identity changes', async () => {
  for (const change of ['build', 'trigger', 'repository', 'email']) {
    const f = cloudFixture(),
      p = provider(f, (r, { url, count }) => {
        if (count !== 2) return r;
        let value;
        if (change === 'build' && url.includes('/builds/')) {
          value = structuredClone(f.build);
          value.sourceProvenance.resolvedConnectedRepository.revision =
            'b'.repeat(40);
          value.substitutions.COMMIT_SHA = value.substitutions.REVISION_ID =
            'b'.repeat(40);
        } else if (change === 'trigger' && url.includes('/triggers/'))
          value = { ...f.trigger, createTime: '2026-10-27T22:00:00Z' };
        else if (change === 'repository' && url.includes('/repositories/'))
          value = { ...f.repository, etag: 'changed' };
        else if (change === 'email' && url.endsWith('/email'))
          return new Response('other@example.test', {
            headers: { 'Metadata-Flavor': 'Google' },
          });
        return value
          ? new Response(JSON.stringify(value), {
              headers: { 'Content-Type': 'application/json' },
            })
          : r;
      });
    await assert.rejects(
      verifyLiveCloudBuildContext({ ...f, transport: p.transport }),
      {
        code:
          change === 'email'
            ? 'CLOUD_BUILD_METADATA_ACCOUNT_DISAGREES'
            : 'CLOUD_BUILD_CONTEXT_CHANGED',
      },
    );
  }
});

for (const environment of ['staging', 'production']) {
  test(
    'Cloud Build ' +
      environment +
      ' accepts the gitSource shape of a manual connected trigger',
    async () => {
      const connected = verifyCloudBuildContext(cloudFixture(environment));
      const f = useGitSource(cloudFixture(environment));
      const proof = verifyCloudBuildContext(f);
      assert.equal(proof.sourceSha, f.build.source.gitSource.revision);
      assert.equal(proof.observation.repository.name, f.repository.name);
      // The trigger binding yields the same configuration as connectedRepository.
      assert.equal(proof.configurationDigest, connected.configurationDigest);
      const p = provider(f);
      const live = await verifyLiveCloudBuildContext({
        ...f,
        transport: p.transport,
      });
      assert.equal(live.sourceSha, proof.sourceSha);
      assert.equal(p.calls.length, 10);
      assert.ok(
        p.calls.some(
          ({ url }) =>
            url === 'https://cloudbuild.googleapis.com/v2/' + f.repository.name,
        ),
      );
    },
  );
}

test('Cloud Build gitSource must match the linked repository and exact revision', () => {
  const other = 'https://github.com/other/backend.git';
  const mutations = [
    [
      (f) => {
        f.build.source.gitSource.url = other;
        f.build.sourceProvenance.resolvedGitSource.url = other;
      },
      'CLOUD_BUILD_REPOSITORY_DISAGREES',
    ],
    [
      (f) => {
        f.build.sourceProvenance.resolvedGitSource.url = other;
      },
      'CLOUD_BUILD_SOURCE_DISAGREES',
    ],
    [
      (f) => {
        f.build.source.gitSource.url = 'https://gitlab.com/fixture/backend.git';
        f.build.sourceProvenance.resolvedGitSource.url =
          f.build.source.gitSource.url;
      },
      'INVALID_CLOUD_BUILD_CONTEXT',
    ],
    [
      (f) => {
        f.build.source.gitSource.url = f.build.source.gitSource.url.replace(
          'https://',
          'https://token@',
        );
      },
      'INVALID_CLOUD_BUILD_CONTEXT',
    ],
    [
      (f) => {
        f.build.source.gitSource.revision = 'refs/heads/rc';
      },
      'WRONG_CLOUD_BUILD_REF',
    ],
    [
      (f) => {
        f.build.sourceProvenance.resolvedGitSource.revision = 'b'.repeat(40);
      },
      'WRONG_CLOUD_BUILD_REF',
    ],
    [
      (f) => {
        f.build.source.gitSource.dir = 'nested';
      },
      'ROOT_BUILD_SOURCE_REQUIRED',
    ],
    [
      (f) => {
        f.build.source.gitSource.extra = true;
      },
      'INVALID_CONNECTED_BUILD_SOURCE',
    ],
    [
      (f) => {
        f.build.source.connectedRepository = {
          repository: f.repository.name,
          revision: f.build.source.gitSource.revision,
        };
      },
      'CONNECTED_BUILD_SOURCE_REQUIRED',
    ],
    [
      (f) => {
        f.build.sourceProvenance.resolvedConnectedRepository = {
          repository: f.repository.name,
          revision: f.build.source.gitSource.revision,
        };
      },
      'AMBIGUOUS_CLOUD_BUILD_SOURCE',
    ],
    [
      (f) => {
        f.trigger.sourceToBuild.repository = f.repository.name.replace(
          '/repositories/backend',
          '/repositories/other',
        );
      },
      'CLOUD_BUILD_REPOSITORY_DISAGREES',
    ],
    [
      (f) => {
        f.trigger.eventType = 'PUSH';
      },
      'MANUAL_CLOUD_BUILD_TRIGGER_REQUIRED',
    ],
    [
      (f) => {
        f.trigger.sourceToBuild.repoType = 'BITBUCKET';
      },
      'CLOUD_BUILD_TRIGGER_SOURCE_DISAGREES',
    ],
    [
      (f) => {
        delete f.trigger.filename;
        f.trigger.gitFileSource = {
          repository: f.repository.name,
          repoType: 'BITBUCKET',
          path: 'cloudbuild.yaml',
        };
      },
      'CLOUD_BUILD_REPOSITORY_RECIPE_REQUIRED',
    ],
  ];
  for (const [index, [mutate, code]] of mutations.entries()) {
    const f = useGitSource(cloudFixture());
    mutate(f);
    assert.throws(
      () => verifyCloudBuildContext(f),
      { code },
      'mutation ' + index,
    );
  }
});
