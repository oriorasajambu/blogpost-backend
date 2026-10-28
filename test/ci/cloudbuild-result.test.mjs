import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  crc32c,
  provenanceKeyNames,
  verifyProvenanceEnvelope,
} from '../../scripts/cloudbuild/provenance.mjs';
import {
  verifyRecoveryResult,
  verifyLiveRecoveryResult,
  requireLiveRecoveryResult,
} from '../../scripts/cloudbuild/result.mjs';
import { recoveryResultInputs } from '../../scripts/cloudbuild/result-inputs.mjs';
import {
  resultArguments,
  verifyResultCli,
} from '../../scripts/cloudbuild/verify-result.mjs';
import {
  envelope,
  publicKey,
  keyName,
  resultFixture,
  resultRepository,
  resultProvider,
  observed,
  legacyEnvelope,
  legacyKeyNames,
  legacyStatement,
  useLegacyProvenance,
} from './cloudbuild-result-fixtures.mjs';
import { useGitSource } from './cloudbuild-fixtures.mjs';

for (const environment of ['staging', 'production']) {
  test(
    environment +
      ' completed recovery binds both registry digests and signed provenance',
    () => {
      const f = resultFixture(environment);
      const proof = verifyRecoveryResult(f.inputs, f.observations, observed);
      assert.equal(proof.status, 'VERIFIED');
      assert.equal(proof.evidenceSource, 'provided-json');
      assert.equal(proof.images.length, 2);
      assert.equal(proof.build.finishTime, f.build.finishTime);
      for (const image of proof.images) {
        assert.equal(image.provenance.sourceSha, f.sourceSha);
        assert.equal(image.provenance.subject, image.uri);
        assert.equal(image.provenance.keyAuthority, 'provided-public-key');
        assert.match(
          image.provenance.signatures[0].publicKeySha256,
          /^[a-f0-9]{64}$/,
        );
      }
      assert.throws(() => requireLiveRecoveryResult(proof, observed));
      // Old completed builds keep their original times; observation age is separate.
      assert.equal(
        verifyRecoveryResult(f.inputs, f.observations, observed + 30 * 86400000)
          .build.finishTime,
        f.build.finishTime,
      );
      // Numeric project aliases and explicit Git config source are supported.
      const alternate = structuredClone(f.observations);
      for (const name of ['build', 'trigger', 'repository'])
        alternate[name] = JSON.parse(
          JSON.stringify(alternate[name]).replaceAll(
            'projects/' + f.request.projectId + '/',
            'projects/' + f.project.projectNumber + '/',
          ),
        );
      delete alternate.trigger.filename;
      alternate.trigger.sourceToBuild.ref = f.sourceSha;
      alternate.trigger.gitFileSource = {
        repository: f.repository.name,
        repoType: 'GITHUB',
        path: '/cloudbuild.yaml',
        revision: f.sourceSha,
      };
      assert.equal(
        verifyRecoveryResult(f.inputs, alternate, observed).trigger
          .configurationSource.kind,
        'git-file',
      );
    },
  );
}

test('completed build rejects missing outputs, altered recipe, registry routing and imported authority', () => {
  const mutations = [
    (o) => {
      o.build.status = 'WORKING';
    },
    (o) => {
      delete o.build.finishTime;
    },
    (o) => {
      o.build.finishTime = '2026-10-27T23:58:00Z';
    },
    (o) => {
      o.build.finishTime = '2026-10-28T01:05:01Z';
    },
    (o) => {
      o.build.steps[1].status = 'FAILURE';
    },
    (o) => {
      o.build.steps[1].exitCode = 1;
    },
    (o) => {
      o.build.steps[1].allowFailure = true;
    },
    (o) => {
      o.build.results.images.pop();
    },
    (o) => {
      o.build.results.images[0].name += '-foreign';
    },
    (o) => {
      o.build.results.images[0].digest = o.build.results.images[1].digest;
    },
    (o) => {
      o.build.results.buildStepImages.pop();
    },
    (o) => {
      o.registry.dockerConfig.immutableTags = false;
    },
    (o) => {
      o.registry.mode = 'REMOTE_REPOSITORY';
    },
    (o) => {
      o.images.reverse();
    },
    (o) => {
      o.images[0].name += '%2F..';
    },
    (o) => {
      o.images[0].uri = 'https://' + o.images[0].uri;
    },
    (o) => {
      o.images[0].imageSizeBytes = '9223372036854775808';
    },
    (o) => {
      o.images[0].mediaType = 'application/json';
    },
    (o) => {
      o.images[0].uploadTime = '2026-11-01T00:00:00Z';
    },
    (o) => {
      o.project.projectNumber = '1';
    },
    (o) => {
      o.trigger.eventType = 'PUSH';
    },
    (o) => {
      o.trigger.gitFileSource = {
        uri: 'https://attacker.invalid/x',
        path: 'cloudbuild.yaml',
      };
    },
    (o) => {
      o.trigger.sourceToBuild.ref = 'refs/tags/v1.0.0';
    },
    (o) => {
      delete o.trigger.filename;
      o.trigger.gitFileSource = {
        repository: o.repository.name,
        repoType: 'GITHUB',
        path: 'cloudbuild.yaml',
        revision: 0,
      };
    },
    (o) => {
      o.occurrencePages[0].nextPageToken = 'more';
    },
    (o) => {
      o.occurrencePages[0].occurrences.push(
        o.occurrencePages[0].occurrences[0],
      );
    },
    (o) => {
      o.occurrencePages.pop();
    },
    (o) => {
      o.occurrencePages[0].occurrences[0].resourceUri += ':foreign';
    },
    (o) => {
      o.occurrencePages[0].occurrences[0].name =
        'projects/foreign-project/occurrences/x';
    },
    (o) => {
      o.occurrencePages[0].occurrences[0].createTime = '2026-10-20T00:00:00Z';
    },
    (o) => {
      o.request = {};
    },
    (o) => {
      o.evidenceSource = 'live-api';
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = resultFixture(),
      observations = structuredClone(f.observations);
    mutate(observations);
    assert.throws(
      () => verifyRecoveryResult(f.inputs, observations, observed),
      undefined,
      'mutation ' + index,
    );
  }
});

test('DSSE verifies exact UTF-8 bytes with P-256 SHA-256 and Google-key namespace', () => {
  assert.equal(crc32c(Buffer.from('123456789')), 0xe3069283);
  const statement = { unicode: 'こんにちは café 😀' },
    signed = envelope(statement),
    keys = { [keyName]: publicKey };
  assert.deepEqual(verifyProvenanceEnvelope(signed, keys).statement, statement);
  const urlEncoded = structuredClone(signed);
  urlEncoded.payload = Buffer.from(urlEncoded.payload, 'base64').toString(
    'base64url',
  );
  urlEncoded.signatures[0].sig = Buffer.from(
    urlEncoded.signatures[0].sig,
    'base64',
  ).toString('base64url');
  assert.deepEqual(
    verifyProvenanceEnvelope(urlEncoded, keys).statement,
    statement,
  );
  for (const mutate of [
    (e, k) => {
      e.payload = Buffer.from('{}').toString('base64');
    },
    (e, k) => {
      e.signatures[0].sig = Buffer.alloc(70).toString('base64');
    },
    (e, k) => {
      e.payloadType = 'application/json';
    },
    (e, k) => {
      e.signatures[0].keyid =
        'projects/attacker/locations/global/keyRings/attestor/cryptoKeys/google-hosted-worker/cryptoKeyVersions/1';
    },
    (e, k) => {
      e.signatures.push(e.signatures[0]);
    },
    (e, k) => {
      k[keyName].pemCrc32c = '0';
    },
    (e, k) => {
      k[keyName].algorithm = 'RSA_SIGN_PKCS1_2048_SHA256';
    },
    (e, k) => {
      k[keyName].name += '2';
    },
    (e, k) => {
      e.payload += '$';
    },
  ]) {
    const e = structuredClone(signed),
      k = structuredClone(keys);
    mutate(e, k);
    assert.throws(() => verifyProvenanceEnvelope(e, k));
  }
  assert.throws(
    () => verifyProvenanceEnvelope(envelope({}, '{"x":1,"x":2}'), keys),
    { code: 'INVALID_SIGNED_PROVENANCE_JSON' },
  );
  assert.throws(() => provenanceKeyNames({ ...signed, signatures: [] }));
  const wrongPem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .publicKey.export({ type: 'spki', format: 'pem' })
    .toString();
  assert.throws(
    () =>
      verifyProvenanceEnvelope(signed, {
        [keyName]: {
          ...publicKey,
          pem: wrongPem,
          pemCrc32c: String(crc32c(Buffer.from(wrongPem))),
        },
      }),
    { code: 'INVALID_BUILD_PROVENANCE_SIGNATURE' },
  );
});

test('signed statement, not unsigned mirrors, must bind recipe, Git source, environment and image', () => {
  const mutations = [
    (s) => {
      s._type = 'https://in-toto.io/Statement/v0.1';
    },
    (s) => {
      s.predicateType = 'https://slsa.dev/provenance/v0.2';
    },
    (s) => {
      s.predicate.runDetails.builder.id += '/foreign';
    },
    (s) => {
      s.predicate.runDetails.metadata.invocationId += '-foreign';
    },
    (s) => {
      s.predicate.runDetails.metadata.startedOn = '2026-10-27T23:00:00Z';
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.buildConfigSource.repository =
        'git+https://github.com/other/backend';
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.buildConfigSource.ref =
        'refs/heads/main';
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.buildConfigSource.path =
        'other.yaml';
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.buildConfigSource.pathAutoDetect = true;
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.buildConfig = 'inline';
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.sourceToBuild = {
        repository: 'git+https://github.com/other/backend',
        ref: 'refs/heads/rc',
      };
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.substitutions._APP_ENV =
        'production';
    },
    (s) => {
      s.predicate.buildDefinition.internalParameters.systemSubstitutions.BUILD_ID =
        'forged';
    },
    (s) => {
      s.predicate.buildDefinition.internalParameters.triggerUri += '-foreign';
    },
    (s) => {
      s.subject[0].digest.sha256 = 'f'.repeat(64);
    },
    (s) => {
      s.subject.shift();
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
        'b'.repeat(40);
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies[1].digest.sha256 =
        'f'.repeat(64);
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies.push({
        uri: 'https://attacker.invalid/key',
        digest: { sha256: 'f'.repeat(64) },
      });
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies.splice(0, 1);
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = resultFixture(),
      statement = structuredClone(f.statement);
    mutate(statement);
    f.observations.occurrencePages.forEach((page) => {
      page.occurrences[0].envelope = envelope(statement);
      page.occurrences[0].build = { inTotoSlsaProvenanceV1: f.statement };
    });
    assert.throws(
      () => verifyRecoveryResult(f.inputs, f.observations, observed),
      undefined,
      'signed mutation ' + index,
    );
  }
  const f = resultFixture();
  f.statement.predicate.buildDefinition.resolvedDependencies[0] = {
    uri: 'git+https://github.com/fixture/backend',
    digest: { sha1: f.sourceSha },
  };
  f.statement.predicate.buildDefinition.externalParameters.buildConfigSource.ref =
    f.sourceSha;
  f.statement.predicate.buildDefinition.internalParameters.triggerUri =
    f.statement.predicate.buildDefinition.internalParameters.triggerUri.replace(
      f.request.projectId,
      f.project.projectNumber,
    );
  f.observations.occurrencePages.forEach((page) => {
    page.occurrences[0].envelope = envelope(f.statement);
  });
  assert.equal(
    verifyRecoveryResult(f.inputs, f.observations, observed).status,
    'VERIFIED',
  );
});

for (const environment of ['staging', 'production'])
  test(
    environment +
      ' live result is sealed, read-only and isolates the Google token',
    async (t) => {
      const f = await resultRepository(t, environment),
        p = resultProvider(f);
      const proof = await verifyLiveRecoveryResult({
        root: f.root,
        request: f.request,
        sourceSha: f.merge,
        accessToken: 'synthetic-test-token',
        transport: p.transport,
        githubTransport: p.githubTransport,
        now: observed,
      });
      assert.equal(proof.evidenceSource, 'live-api');
      assert.equal(proof.reviewedSource.sourceSha, f.merge);
      assert.equal(requireLiveRecoveryResult(proof, observed), proof);
      assert.equal(p.calls.length, 20);
      assert.equal(p.githubCalls.length, 4);
      assert.equal(proof.images[0].provenance.keyAuthority, 'live-google-kms');
      for (const { url, options } of p.calls) {
        assert.equal(new URL(url).protocol, 'https:');
        assert.ok(
          [
            'cloudresourcemanager.googleapis.com',
            'cloudbuild.googleapis.com',
            'artifactregistry.googleapis.com',
            'containeranalysis.googleapis.com',
            'cloudkms.googleapis.com',
          ].includes(new URL(url).hostname),
        );
        assert.equal(options.method, 'GET');
        assert.equal(options.redirect, 'error');
        assert.equal(options.credentials, 'omit');
        assert.equal(
          options.headers.Authorization,
          'Bearer synthetic-test-token',
        );
      }
      for (const { options } of p.githubCalls)
        assert.equal(options.headers.Authorization, undefined);
      assert.ok(!JSON.stringify(proof).includes('synthetic-test-token'));
      assert.ok(!JSON.stringify(proof).includes(publicKey.pem));
      assert.throws(() =>
        requireLiveRecoveryResult(structuredClone(proof), observed),
      );
      assert.throws(() => requireLiveRecoveryResult(proof, observed + 60001), {
        code: 'RECOVERY_RESULT_PROOF_EXPIRED',
      });
      proof.images[0].digest = 'sha256:' + 'f'.repeat(64);
      assert.throws(() => requireLiveRecoveryResult(proof, observed));
    },
  );

test('live result refuses changed records, unsafe HTTP and source/credential bypasses', async (t) => {
  const f = await resultRepository(t);
  for (const selector of [
    '/builds/',
    '/triggers/',
    '/repositories/backend',
    '/repositories/blogpost',
    '/dockerImages/',
    '/occurrences?',
    '/publicKey',
  ]) {
    const p = resultProvider(f, async (response, { url, count }) => {
      if (count === 2 && url.includes(selector)) {
        const body = await response.json();
        body.changedDuringObservation = true;
        return Response.json(body);
      }
      return response;
    });
    await assert.rejects(
      verifyLiveRecoveryResult({
        root: f.root,
        request: f.request,
        sourceSha: f.merge,
        accessToken: 'synthetic-test-token',
        ...p,
        now: observed,
      }),
      { code: 'RECOVERY_RESULT_OBSERVATIONS_CHANGED' },
    );
  }
  for (const transform of [
    () => new Response('secret provider error', { status: 403 }),
    () => new Response('{}', { headers: { 'Content-Type': 'text/plain' } }),
    () => Response.json({ unexpected: true }, { status: 302 }),
    () =>
      new Response('{"x":1,"x":2}', {
        headers: { 'Content-Type': 'application/json' },
      }),
    () =>
      new Response('x'.repeat(2097153), {
        headers: { 'Content-Type': 'application/json' },
      }),
  ]) {
    const p = resultProvider(f, transform);
    await assert.rejects(
      verifyLiveRecoveryResult({
        root: f.root,
        request: f.request,
        sourceSha: f.merge,
        accessToken: 'synthetic-test-token',
        ...p,
        now: observed,
      }),
      { code: 'RECOVERY_RESULT_READ_FAILED' },
    );
  }
  const p = resultProvider(f),
    args = {
      root: f.root,
      request: f.request,
      sourceSha: f.merge,
      accessToken: 'synthetic-test-token',
      ...p,
      now: observed,
    };
  await assert.rejects(
    verifyLiveRecoveryResult({
      ...args,
      accessToken: 'bad\nAuthorization: value',
    }),
    { code: 'INVALID_RECOVERY_RESULT_CREDENTIAL' },
  );
  assert.equal(p.calls.length, 0);
  await assert.rejects(
    verifyLiveRecoveryResult({
      ...args,
      githubTransport: async () =>
        Response.json({
          ref: 'refs/heads/rc',
          object: { type: 'commit', sha: f.base },
        }),
    }),
    { code: 'RESULT_SOURCE_NOT_ON_AUTHORIZED_BRANCH' },
  );
  await f.write('src/main.ts', 'export const dirty = true;\n');
  await assert.rejects(recoveryResultInputs(f.root, f.request, f.merge), {
    code: 'CLEAN_RESULT_VERIFIER_CHECKOUT_REQUIRED',
  });
});

test('CLI imports remain provided JSON and reject ambiguous arguments', async (t) => {
  const f = await resultRepository(t);
  const dir = resolve(f.root, '.local');
  await mkdir(dir, { recursive: true });
  const request = resolve(dir, 'request.json'),
    observations = resolve(dir, 'observations.json');
  await writeFile(request, JSON.stringify(f.request));
  await writeFile(observations, JSON.stringify(f.observations));
  const proof = await verifyResultCli(
    [
      '--request',
      request,
      '--source-sha',
      f.merge,
      '--observations',
      observations,
    ],
    { root: f.root, env: {}, now: observed },
  );
  assert.equal(proof.evidenceSource, 'provided-json');
  assert.throws(() => requireLiveRecoveryResult(proof));
  await assert.rejects(
    verifyResultCli(['--request', request, '--live'], {
      root: f.root,
      env: {},
    }),
    { code: 'INVALID_RECOVERY_RESULT_CREDENTIAL' },
  );
  for (const args of [
    [],
    ['--request', 'x'],
    ['--request', 'x', '--live', '--observations', 'y'],
    ['--request', 'x', '--live', '--live'],
    ['--request', '--live'],
    ['--request', 'x', '--live', '--unknown', 'y'],
    ['--request', 'x', '--live', '--source-sha', 'main'],
  ])
    assert.throws(() => resultArguments(args));
  await writeFile(observations, '{"build":{},"build":{}}');
  await assert.rejects(
    verifyResultCli(['--request', request, '--observations', observations], {
      root: f.root,
    }),
    { code: 'DUPLICATE_EVIDENCE_JSON_KEY' },
  );
  await writeFile(observations, ' '.repeat(2097153));
  await assert.rejects(
    verifyResultCli(['--request', request, '--observations', observations], {
      root: f.root,
    }),
    { code: 'INVALID_RECOVERY_RESULT_INPUT_FILE' },
  );
});

test('newer verifier can check a reviewed recovery ancestor and detects a moving authorized branch', async (t) => {
  const f = await resultRepository(t);
  await f.write('docs/later.md', 'Synthetic newer verifier commit\n');
  const newer = f.commit();
  f.run(['checkout', '-b', 'chore/result-verifier']);
  const p = resultProvider(f);
  const args = {
    root: f.root,
    request: f.request,
    sourceSha: f.merge,
    accessToken: 'synthetic-test-token',
    ...p,
    now: observed,
  };
  assert.equal((await verifyLiveRecoveryResult(args)).sourceSha, f.merge);
  let refs = 0;
  await assert.rejects(
    verifyLiveRecoveryResult({
      ...args,
      githubTransport: async (url, options) => {
        if (url.endsWith('/git/ref/heads/rc'))
          return Response.json({
            ref: 'refs/heads/rc',
            object: { type: 'commit', sha: ++refs === 1 ? f.merge : newer },
          });
        return p.githubTransport(url, options);
      },
    }),
    { code: 'RECOVERY_RESULT_AUTHORIZED_BRANCH_ADVANCED' },
  );
});

test('completed gitSource build binds its repository through the trigger', () => {
  const f = resultFixture();
  const connected = verifyRecoveryResult(f.inputs, f.observations, observed);
  useGitSource(f);
  const proof = verifyRecoveryResult(f.inputs, f.observations, observed);
  assert.equal(proof.status, 'VERIFIED');
  assert.deepEqual(
    proof.images.map((image) => image.digest),
    connected.images.map((image) => image.digest),
  );
  f.build.sourceProvenance.resolvedGitSource.url =
    'https://github.com/other/backend.git';
  assert.throws(
    () => verifyRecoveryResult(f.inputs, f.observations, observed),
    {
      code: 'CLOUD_BUILD_SOURCE_DISAGREES',
    },
  );
});

for (const environment of ['staging', 'production'])
  test(
    environment +
      ' SLSA v0.1 provenance from the real Cloud Build shape verifies provided and live',
    async (t) => {
      const f = useLegacyProvenance(resultFixture(environment));
      const proof = verifyRecoveryResult(f.inputs, f.observations, observed);
      assert.equal(proof.status, 'VERIFIED');
      for (const image of proof.images) {
        assert.equal(
          image.provenance.predicateType,
          'https://slsa.dev/provenance/v0.1',
        );
        // The unverifiable post-quantum signature is never trusted.
        assert.deepEqual(
          image.provenance.signatures.map((signature) => signature.keyName),
          [legacyKeyNames.envelope, legacyKeyNames.payload],
        );
      }
      const live = useLegacyProvenance(await resultRepository(t, environment)),
        p = resultProvider(live);
      const liveProof = await verifyLiveRecoveryResult({
        root: live.root,
        request: live.request,
        sourceSha: live.merge,
        accessToken: 'synthetic-test-token',
        transport: p.transport,
        githubTransport: p.githubTransport,
        now: observed,
      });
      assert.equal(liveProof.evidenceSource, 'live-api');
      assert.equal(
        liveProof.images[0].provenance.keyAuthority,
        'live-google-kms',
      );
      assert.ok(!p.calls.some(({ url }) => url.includes(legacyKeyNames.pqc)));
    },
  );

test('SLSA v0.1 statement must bind the exact recipe, source, trigger and images', () => {
  const both = (change) => (statement) => {
    change(statement.predicate);
    change(statement.slsaProvenance);
  };
  const otherBuild = '99999999-9999-4999-8999-999999999999';
  const mutations = [
    [
      (statement) => {
        statement.subject[0].digest.sha256 = 'f'.repeat(64);
      },
      'SIGNED_IMAGE_SUBJECT_DISAGREES',
    ],
    [
      both((p) => {
        p.metadata.buildInvocationId = otherBuild;
      }),
      'SIGNED_BUILD_INVOCATION_DISAGREES',
    ],
    [
      both((p) => {
        p.recipe.arguments.name = p.recipe.arguments.name.replace(
          /builds\/.*/,
          'builds/' + otherBuild,
        );
      }),
      'SIGNED_BUILD_INVOCATION_DISAGREES',
    ],
    [
      both((p) => {
        p.metadata.buildFinishedOn = '2026-10-29T00:00:00Z';
      }),
      'SIGNED_BUILD_TIME_DISAGREES',
    ],
    [
      both((p) => {
        p.recipe.arguments.steps[1].args.push('--no-cache');
      }),
      'UNAPPROVED_SIGNED_BUILD_DEPENDENCY',
    ],
    [
      both((p) => {
        p.recipe.arguments.steps[0].name = 'node:24.22.1-bookworm';
      }),
      'UNAPPROVED_SIGNED_BUILD_DEPENDENCY',
    ],
    [
      both((p) => {
        p.recipe.arguments.steps[2].env = ['EXTRA=1'];
      }),
      'UNAPPROVED_SIGNED_BUILD_DEPENDENCY',
    ],
    [
      both((p) => {
        p.recipe.arguments.steps[2].status = 'FAILURE';
      }),
      'UNAPPROVED_SIGNED_BUILD_DEPENDENCY',
    ],
    [
      both((p) => {
        p.recipe.arguments.steps.pop();
      }),
      'UNAPPROVED_SIGNED_BUILD_DEPENDENCY',
    ],
    [
      both((p) => {
        p.recipe.arguments.sourceProvenance.resolvedGitSource.revision =
          'b'.repeat(40);
      }),
      'SIGNED_APPLICATION_SOURCE_DISAGREES',
    ],
    [
      both((p) => {
        p.recipe.arguments.sourceProvenance.resolvedGitSource.url =
          'https://github.com/other/backend.git';
      }),
      'SIGNED_APPLICATION_SOURCE_DISAGREES',
    ],
    [
      both((p) => {
        p.materials[0].digest.sha1 = 'b'.repeat(40);
      }),
      'SIGNED_SOURCE_DEPENDENCY_DISAGREES',
    ],
    [
      both((p) => {
        p.recipe.arguments.tags = ['trigger-' + otherBuild];
      }),
      'SIGNED_TRIGGER_DISAGREES',
    ],
    [
      both((p) => {
        p.recipe.arguments.substitutions._EXTRA = 'value';
      }),
      'SIGNED_BUILD_SUBSTITUTIONS_DISAGREE',
    ],
    [
      both((p) => {
        p.recipe.arguments.substitutions._APP_ENV = 'production';
      }),
      'SIGNED_BUILD_SUBSTITUTIONS_DISAGREE',
    ],
    [
      both((p) => {
        p.recipe.arguments.options.pool = { name: 'private' };
      }),
      'UNAPPROVED_SIGNED_BUILD_PARAMETERS',
    ],
    [
      both((p) => {
        p.recipe.arguments.options.requestedVerifyOption = 'NOT_VERIFIED';
      }),
      'UNAPPROVED_SIGNED_BUILD_PARAMETERS',
    ],
    [
      both((p) => {
        p.recipe.arguments.availableSecrets = {};
      }),
      'UNAPPROVED_SIGNED_BUILD_PARAMETERS',
    ],
    [
      (statement) => {
        statement.slsaProvenance.recipe.arguments.substitutions._EXTRA =
          'value';
      },
      'SIGNED_PROVENANCE_MIRROR_DISAGREES',
    ],
    [
      both((p) => {
        p.builder.id = 'https://example.test/builder';
      }),
      'UNAPPROVED_SIGNED_BUILD_TYPE',
    ],
  ];
  for (const [index, [mutate, code]] of mutations.entries()) {
    const f = resultFixture();
    const statement = legacyStatement(f);
    mutate(statement);
    useLegacyProvenance(f, statement);
    assert.throws(
      () => verifyRecoveryResult(f.inputs, f.observations, observed),
      { code },
      'mutation ' + index,
    );
  }
});

test('SLSA v0.1 signatures need Google keys over their exact signing input', () => {
  const signed = (change) => {
    const f = useLegacyProvenance(resultFixture());
    for (const page of f.observations.occurrencePages)
      change(page.occurrences[1].envelope);
    return f;
  };
  // builtByGCB signs the raw payload; its signature over other bytes is invalid.
  const wrongInput = signed((envelope) => {
    const other = legacyEnvelope(legacyStatement(resultFixture()), '{}');
    envelope.signatures[2].sig = other.signatures[2].sig;
  });
  // Only the unverifiable post-quantum signature is not Google evidence.
  const pqcOnly = signed((envelope) => {
    envelope.signatures = [envelope.signatures[1]];
  });
  // A lookalike key outside the verified-builder project is ignored.
  const foreign = signed((envelope) => {
    envelope.signatures = [
      {
        ...envelope.signatures[0],
        keyid: legacyKeyNames.envelope.replace('verified-builder', 'attacker'),
      },
    ];
  });
  for (const [f, code] of [
    [wrongInput, 'INVALID_BUILD_PROVENANCE_SIGNATURE'],
    [pqcOnly, 'SIGNED_GOOGLE_BUILD_PROVENANCE_REQUIRED'],
    [foreign, 'SIGNED_GOOGLE_BUILD_PROVENANCE_REQUIRED'],
  ])
    assert.throws(
      () => verifyRecoveryResult(f.inputs, f.observations, observed),
      {
        code,
      },
    );
});

test('only one signed occurrence per image is accepted; unsigned records are ignored', () => {
  const f = useLegacyProvenance(resultFixture());
  const twice = structuredClone(f.observations);
  twice.occurrencePages[0].occurrences.push(
    structuredClone(twice.occurrencePages[0].occurrences[1]),
  );
  const unsignedOnly = structuredClone(f.observations);
  unsignedOnly.occurrencePages[0].occurrences.pop();
  for (const observations of [twice, unsignedOnly])
    assert.throws(
      () => verifyRecoveryResult(f.inputs, observations, observed),
      {
        code: 'UNAMBIGUOUS_BUILD_PROVENANCE_REQUIRED',
      },
    );
  // Only the check-build step's local tools image may lack a registry digest.
  const digestRequired = useLegacyProvenance(resultFixture());
  digestRequired.build.results.buildStepImages[0] = '';
  assert.throws(
    () =>
      verifyRecoveryResult(
        digestRequired.inputs,
        digestRequired.observations,
        observed,
      ),
    { code: 'COMPLETED_BUILD_RESULTS_REQUIRED' },
  );
});
