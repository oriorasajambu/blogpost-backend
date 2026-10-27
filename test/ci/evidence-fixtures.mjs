import { readFile } from 'node:fs/promises';
import { canonical, digest } from '../../src/platform/config/build-model.ts';
import {
  ALWAYS_JOBS,
  CODE_JOBS,
  SCENARIOS,
  artifactDescriptor,
  sha256,
} from '../../scripts/ci/evidence/model.mjs';
import { bundleFiles, jsonBytes } from '../../scripts/ci/evidence/bundle.mjs';
import {
  OWNER_START,
  OWNER_END,
} from '../../scripts/ci/evidence/owner-validation.mjs';
import { evidenceArtifactName } from '../../scripts/ci/evidence/github-proof.mjs';
import { crc32, deflateRawSync } from 'node:zlib';

export const policy = JSON.parse(
  await readFile('config/ci/evidence-policy.json', 'utf8'),
);
export const now = Date.parse('2026-10-27T09:00:00.000Z');
export const configuration = JSON.parse(
  await readFile('config/environments/staging.example.json', 'utf8'),
);
export const config = {
  fullName: 'fixture/backend',
  repositoryId: '42',
  ownerId: '7',
};
export function evidenceFixture() {
  const build = {
    schemaVersion: 1,
    application: 'backend',
    kind: 'ARTIFACT',
    environment: 'staging',
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/heads/rc',
    dirty: false,
    applicationVersion: '0.1.0',
    contractVersion: '1.0.0',
    contractSha256: 'b'.repeat(64),
    runtimeInputDigest: 'c'.repeat(64),
    sourceInputDigest: 'd'.repeat(64),
    inputManifestVersion: 1,
    targetPlatform: 'linux/amd64',
    configuration,
  };
  const descriptor = artifactDescriptor(
    build,
    'asia-southeast2-docker.pkg.dev/' +
      configuration.projectId +
      '/images/backend-api@sha256:' +
      'e'.repeat(64),
    'asia-southeast2-docker.pkg.dev/' +
      configuration.projectId +
      '/images/backend-operations@sha256:' +
      'f'.repeat(64),
  );
  const receipt = {
    schemaVersion: 1,
    application: 'backend',
    environment: 'staging',
    candidateSha: build.sourceSha,
    builtFromSha: build.sourceSha,
    mode: 'DEPLOYED',
    applicationVersion: build.applicationVersion,
    contractVersion: build.contractVersion,
    contractSha256: build.contractSha256,
    runtimeInputDigest: build.runtimeInputDigest,
    sourceInputDigest: build.sourceInputDigest,
    configurationDigest: digest(configuration),
    apiOrigin: configuration.apiOrigin,
    servingRevision: 'backend-api-00001-abc',
    workflowRunId: '100',
    workflowRunAttempt: 1,
    deployedAt: '2026-10-27T08:00:00.000Z',
    verifiedAt: '2026-10-27T08:30:00.000Z',
    result: 'PASSED',
    artifact: {
      filename: 'backend-staging-artifact.json',
      size: jsonBytes(descriptor).length,
      sha256: sha256(jsonBytes(descriptor)),
    },
    schemaVerification: {
      execution:
        'projects/' +
        configuration.projectId +
        '/locations/asia-southeast2/jobs/blogpost-verify/executions/blogpost-verify-abc',
      verifiedAt: '2026-10-27T08:20:00.000Z',
      migrationDigest: '1'.repeat(64),
      permissionDigest: '2'.repeat(64),
      evidenceSha256: '3'.repeat(64),
    },
    counterparts: ['web', 'android'].map((application) => ({
      application,
      applicationVersion: '0.1.0',
      apiMajor: 1,
      contractVersion: build.contractVersion,
      contractSha256: build.contractSha256,
      capabilityDigest: '4'.repeat(64),
      verificationSha256: '5'.repeat(64),
    })),
    supersedes: null,
  };
  const repo = { id: 42, full_name: config.fullName, owner: { id: 7 } };
  const run = {
    id: 100,
    run_attempt: 1,
    repository: repo,
    head_repository: repo,
    event: 'push',
    head_branch: 'rc',
    head_sha: build.sourceSha,
    path: '.github/workflows/staging.yml',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-10-27T07:50:00Z',
    run_started_at: '2026-10-27T07:50:01Z',
    updated_at: '2026-10-27T08:31:00Z',
    html_url: 'https://github.com/fixture/backend/actions/runs/100',
  };
  const names = [...ALWAYS_JOBS, ...CODE_JOBS];
  const jobs = {
    total_count: names.length,
    jobs: names.map((name) => ({
      name,
      run_id: 100,
      run_attempt: 1,
      head_sha: build.sourceSha,
      status: 'completed',
      conclusion: 'success',
    })),
  };
  const archive = zip(bundleFiles(receipt, descriptor));
  const artifact = {
    id: 200,
    name: evidenceArtifactName(build.sourceSha, '100', 1),
    expired: false,
    size_in_bytes: archive.length,
    digest: 'sha256:' + sha256(archive),
    created_at: '2026-10-27T08:30:30Z',
    expires_at: '2026-11-03T08:30:30Z',
    workflow_run: {
      id: 100,
      repository_id: 42,
      head_repository_id: 42,
      head_branch: 'rc',
      head_sha: build.sourceSha,
    },
  };
  const validation = {
    schemaVersion: 1,
    application: 'backend',
    candidateSha: build.sourceSha,
    testedCandidateSha: build.sourceSha,
    runtimeInputDigest: build.runtimeInputDigest,
    configurationDigest: receipt.configurationDigest,
    artifactDigest: 'e'.repeat(64),
    servingRevision: receipt.servingRevision,
    contractVersion: receipt.contractVersion,
    contractSha256: receipt.contractSha256,
    testedAt: '2026-10-27T08:40:00.000Z',
    counterparts: receipt.counterparts,
    scenarios: Object.fromEntries(
      SCENARIOS.map((name) => [
        name,
        {
          result: 'PASSED',
          observation: 'Observed synthetic staging scenario: ' + name + '.',
        },
      ]),
    ),
    carriedForward: null,
  };
  const ownerBody = (value = validation) =>
    OWNER_START +
    '\n```json\n' +
    JSON.stringify(value, null, 2) +
    '\n```\n' +
    OWNER_END;
  const pr = {
    repository: {
      databaseId: 42,
      nameWithOwner: config.fullName,
      owner: { databaseId: 7 },
    },
    headRepository: { databaseId: 42 },
    baseRefName: 'main',
    headRefName: 'rc',
    headRefOid: build.sourceSha,
    state: 'OPEN',
    lastEditedAt: null,
    editor: null,
    author: { __typename: 'User', databaseId: 7 },
    createdAt: '2026-10-27T08:41:00Z',
    body: ownerBody(),
  };
  const live = {
    observedAt: '2026-10-27T09:00:00.000Z',
    origin: configuration.apiOrigin,
    liveStatus: 200,
    readyStatus: 200,
    metadataStatus: 200,
    metadata: {
      apiMajor: 1,
      contractVersion: receipt.contractVersion,
      buildSha: receipt.builtFromSha,
      deployment: {
        environment: 'staging',
        revision: receipt.servingRevision,
        runtimeInputDigest: receipt.runtimeInputDigest,
        configurationDigest: receipt.configurationDigest,
      },
    },
  };
  return {
    build,
    descriptor,
    receipt,
    run,
    jobs,
    archive,
    artifact,
    validation,
    ownerBody,
    pr,
    live,
  };
}
export function zip(files, { descriptors = false, compressed = true } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, bytes] of files) {
    const nameBytes = Buffer.from(name);
    const packed = compressed ? deflateRawSync(bytes) : bytes;
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(descriptors ? 8 : 0, 6);
    header.writeUInt16LE(compressed ? 8 : 0, 8);
    if (!descriptors) {
      header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(packed.length, 18);
      header.writeUInt32LE(bytes.length, 22);
    }
    header.writeUInt16LE(nameBytes.length, 26);
    const dataDescriptor = Buffer.alloc(descriptors ? 16 : 0);
    if (descriptors) {
      dataDescriptor.writeUInt32LE(0x08074b50);
      dataDescriptor.writeUInt32LE(crc, 4);
      dataDescriptor.writeUInt32LE(packed.length, 8);
      dataDescriptor.writeUInt32LE(bytes.length, 12);
    }
    locals.push(header, nameBytes, packed, dataDescriptor);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(descriptors ? 8 : 0, 8);
    entry.writeUInt16LE(compressed ? 8 : 0, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset +=
      header.length + nameBytes.length + packed.length + dataDescriptor.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
