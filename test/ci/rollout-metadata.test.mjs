import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './fixtures.mjs';
import { committedFiles, inputManifest } from '../../scripts/build/inputs.mjs';
import { digest } from '../../src/platform/config/build-model.ts';
import { gitMetadataPolicyReader } from '../../scripts/deploy/metadata-policy.mjs';
import { createReadOnlyRolloutProbe } from '../../scripts/deploy/rollout-probe.mjs';
import { probeFixture, contractBytes } from '../deploy/probe-fixtures.mjs';

const CONTROLLER = 'src/modules/meta/meta.controller.ts';
async function sourceFixture(t, recommended = '0.0.0') {
  const f = await fixture(t);
  const controller = (await readFile(CONTROLLER, 'utf8')).replace(
    "recommendedVersion: '0.0.0'",
    "recommendedVersion: '" + recommended + "'",
  );
  await f.write(CONTROLLER, controller);
  await f.write(
    'src/platform/http/envelope.ts',
    await readFile('src/platform/http/envelope.ts', 'utf8'),
  );
  await f.write('contracts/openapi-v1.json', contractBytes.toString('utf8'));
  const sha = f.commit();
  const h = probeFixture();
  const build = h.f.provenance;
  const manifest = await inputManifest(
    f.root,
    'staging',
    build.configuration,
    committedFiles(f.root, sha),
  );
  build.sourceSha = sha;
  build.runtimeInputDigest = digest(manifest);
  build.sourceInputDigest = digest({
    schemaVersion: 1,
    targetPlatform: manifest.targetPlatform,
    entries: manifest.entries,
  });
  h.state.input.record.sourceSha = sha;
  h.state.input.record.candidateRevision =
    'blogpost-api-r12345-1-' + sha.slice(0, 12);
  h.state.input.artifacts[0].revision = h.state.input.record.candidateRevision;
  return { f, h, build, controller };
}

test('metadata policy uses exact immutable Git inputs and ignores modified working source', async (t) => {
  const { f, h, build, controller } = await sourceFixture(t);
  const reader = gitMetadataPolicyReader(f.root);
  const policy = await reader(build);
  assert.equal(policy.clients.web.recommendedVersion, '0.0.0');
  await f.write(
    CONTROLLER,
    controller.replace(
      "recommendedVersion: '0.0.0'",
      "recommendedVersion: '99.0.0'",
    ),
  );
  const newReader = gitMetadataPolicyReader(f.root);
  assert.deepEqual(await newReader(build), policy);
  const probe = createReadOnlyRolloutProbe({
    root: f.root,
    fetchImpl: h.fetchImpl,
  });
  const result = await probe(h.state.input);
  assert.equal(result.ok, true);
  assert.equal(result.expectationSource, 'immutable-git-inputs');
  assert.equal(result.evidenceSource, 'injected-transport');
});

test('metadata source/runtime fingerprints fail before any HTTP collection', async (t) => {
  const { f, h, build } = await sourceFixture(t);
  for (const field of [
    'sourceInputDigest',
    'runtimeInputDigest',
    'contractSha256',
  ]) {
    const changed = { ...build, [field]: '0'.repeat(64) };
    await assert.rejects(gitMetadataPolicyReader(f.root)(changed), {
      code: 'METADATA_POLICY_INPUTS_MISMATCH',
    });
  }
  const probe = createReadOnlyRolloutProbe({
    root: f.root,
    fetchImpl: h.fetchImpl,
  });
  h.state.input.artifacts[0].provenance.runtimeInputDigest = '0'.repeat(64);
  await assert.rejects(probe(h.state.input), {
    code: 'METADATA_POLICY_INPUTS_MISMATCH',
  });
  assert.equal(h.state.calls.length, 0);
});

test('a source-bound client recommendation can change without a contract checksum change', async (t) => {
  const { f, h, build } = await sourceFixture(t, '0.2.0');
  const originalContract = build.contractSha256;
  h.state.mutation = (response) => {
    if (response.path === '/v1/meta')
      response.body.data.clients.web.recommendedVersion = '0.2.0';
  };
  const probe = createReadOnlyRolloutProbe({
    root: f.root,
    fetchImpl: h.fetchImpl,
  });
  const result = await probe(h.state.input);
  assert.equal(result.ok, true);
  assert.equal(result.contractSha256, originalContract);
  assert.equal(result.expectationSource, 'immutable-git-inputs');
});
