import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { recipeFixture, observed } from './cloudbuild-fixtures.mjs';
import { config, merged } from './fixtures.mjs';
import { seedDatabase } from './evidence-fixtures.mjs';
import { recoveryRecipe } from '../../scripts/cloudbuild/recipe.mjs';
import { crc32c } from '../../scripts/cloudbuild/provenance.mjs';
import {
  completedContext,
  registryPrefix,
  provenanceListUrl,
} from '../../scripts/cloudbuild/result-model.mjs';
import { recoveryResultInputs } from '../../scripts/cloudbuild/result-inputs.mjs';

// Ephemeral test keys and mock HTTP only; these are not Google provider evidence.
export const keyName =
  'projects/verified-builder/locations/global/keyRings/attestor/cryptoKeys/google-hosted-worker/cryptoKeyVersions/1';
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
export const publicKey = {
  name: keyName,
  algorithm: 'EC_SIGN_P256_SHA256',
  pem,
  pemCrc32c: String(crc32c(Buffer.from(pem))),
};
export function envelope(statement, text = JSON.stringify(statement)) {
  const bytes = Buffer.from(text),
    type = 'application/vnd.in-toto+json';
  const pae = Buffer.concat([
    Buffer.from(
      'DSSEv1 ' +
        Buffer.byteLength(type) +
        ' ' +
        type +
        ' ' +
        bytes.length +
        ' ',
    ),
    bytes,
  ]);
  return {
    payloadType: type,
    payload: bytes.toString('base64'),
    signatures: [
      {
        keyid: keyName,
        sig: sign('sha256', pae, pair.privateKey).toString('base64'),
      },
    ],
  };
}
export function resultFixture(
  environment = 'staging',
  sourceSha = 'a'.repeat(40),
) {
  const f = recipeFixture(environment, sourceSha);
  f.sourceSha = sourceSha;
  f.build.status = 'SUCCESS';
  f.build.finishTime = '2026-10-28T00:00:00Z';
  f.build.steps.forEach((step) =>
    Object.assign(step, { status: 'SUCCESS', exitCode: 0 }),
  );
  f.build.results = {
    images: recoveryRecipe(f.request).images.map((name, index) => ({
      name,
      digest: 'sha256:' + String(index + 1).repeat(64),
    })),
    buildStepImages: f.build.steps.map(
      (step, index) =>
        step.name.split('@')[1] ?? 'sha256:' + String(index + 3).repeat(64),
    ),
  };
  const prefix =
    'projects/' +
    f.request.projectId +
    '/locations/' +
    f.request.region +
    '/repositories/blogpost';
  f.registry = {
    name: prefix,
    format: 'DOCKER',
    mode: 'STANDARD_REPOSITORY',
    dockerConfig: { immutableTags: true },
  };
  f.images = f.build.results.images.map((image) => {
    const base = image.name.slice(0, image.name.lastIndexOf(':'));
    const name = base.split('/').at(-1);
    return {
      name: prefix + '/dockerImages/' + name + '@' + image.digest,
      uri: base + '@' + image.digest,
      imageSizeBytes: '125000000',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      uploadTime: f.build.finishTime,
      updateTime: f.build.finishTime,
    };
  });
  const context = completedContext(f);
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    predicateType: 'https://slsa.dev/provenance/v1',
    subject: context.images.map((image) => ({
      name: 'https://' + image.tag,
      digest: { sha256: image.digest.slice(7) },
    })),
    predicate: {
      buildDefinition: {
        buildType:
          'https://cloud.google.com/build/gcb-buildtypes/google-worker/v1',
        externalParameters: {
          buildConfigSource: {
            repository: 'git+https://github.com/fixture/backend.git',
            ref: 'refs/heads/' + context.plan.branch,
            path: 'cloudbuild.yaml',
          },
          substitutions: { _APP_ENV: environment },
        },
        internalParameters: {
          triggerUri: context.result.triggerName,
          systemSubstitutions: {
            BUILD_ID: context.plan.buildId,
            LOCATION: context.plan.region,
            PROJECT_NUMBER: context.plan.projectNumber,
          },
        },
        resolvedDependencies: [
          {
            uri:
              'git+https://github.com/fixture/backend.git@refs/heads/' +
              context.plan.branch,
            digest: { gitCommit: sourceSha },
          },
          ...f.build.steps.map((step, i) => ({
            uri: step.name,
            digest: { sha256: f.build.results.buildStepImages[i].slice(7) },
          })),
        ],
      },
      runDetails: {
        builder: { id: 'https://cloudbuild.googleapis.com/GoogleHostedWorker' },
        metadata: {
          invocationId:
            'https://cloudbuild.googleapis.com/v1/' + context.result.buildName,
          startedOn: f.build.startTime,
          finishedOn: f.build.finishTime,
        },
      },
    },
  };
  const observations = {
    ...Object.fromEntries(
      ['project', 'build', 'trigger', 'repository', 'registry', 'images'].map(
        (name) => [name, f[name]],
      ),
    ),
    occurrencePages: context.images.map((image, i) => ({
      occurrences: [
        {
          name:
            'projects/' +
            context.plan.projectId +
            '/occurrences/synthetic-' +
            i,
          kind: 'BUILD',
          resourceUri: 'https://' + image.uri,
          createTime: f.build.finishTime,
          updateTime: f.build.finishTime,
          envelope: envelope(statement),
        },
      ],
    })),
    keys: { [keyName]: structuredClone(publicKey) },
  };
  const build = {
    sourceSha,
    environment,
    dirty: false,
    applicationVersion: '0.0.0',
    contractVersion: '1.0.0',
    contractSha256: 'c'.repeat(64),
    sourceInputDigest: 'd'.repeat(64),
    runtimeInputDigest: 'e'.repeat(64),
    configuration: { projectId: context.plan.projectId },
  };
  return {
    ...f,
    context,
    observations,
    statement,
    inputs: {
      request: f.request,
      projects: f.projects,
      repositoryConfig: f.repositoryConfig,
      sourceSha,
      expected: { build },
    },
  };
}
export async function resultRepository(t, environment = 'staging') {
  const template = recipeFixture(environment),
    selected = template.projects[environment];
  const example = JSON.parse(
    await readFile(
      new URL(
        '../../config/environments/' + environment + '.example.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const profile = JSON.parse(
    JSON.stringify(example).replaceAll(example.projectId, selected.projectId),
  );
  profile.apiOrigin = selected.plannedOrigins.api;
  profile.webOrigin = selected.plannedOrigins.web;
  const repo = await merged(
    t,
    environment === 'staging' ? 'rc' : 'main',
    async (repo) => {
      await repo.write('config/cloud-projects.json', template.projects);
      await repo.write('config/repository.json', config);
      await repo.write('config/environments/' + environment + '.json', profile);
      await seedDatabase(repo);
    },
  );
  repo.run([
    'remote',
    'add',
    'origin',
    'https://github.com/fixture/backend.git',
  ]);
  const f = resultFixture(environment, repo.merge);
  const inputs = await recoveryResultInputs(repo.root, f.request, repo.merge);
  return { ...f, ...repo, inputs };
}
export function resultProvider(f, transform = (response) => response) {
  const { context, observations: o } = f;
  const plan = context.plan;
  const entries = [
    [
      'https://cloudresourcemanager.googleapis.com/v1/projects/' +
        plan.projectId,
      o.project,
    ],
    [
      'https://cloudbuild.googleapis.com/v1/' + context.result.buildName,
      o.build,
    ],
    [
      'https://cloudbuild.googleapis.com/v1/' + context.result.triggerName,
      o.trigger,
    ],
    [
      'https://cloudbuild.googleapis.com/v2/' +
        context.result.connectedRepository,
      o.repository,
    ],
    [
      'https://artifactregistry.googleapis.com/v1/' + registryPrefix(plan),
      o.registry,
    ],
    ...context.images.map((image, i) => [
      'https://artifactregistry.googleapis.com/v1/' +
        registryPrefix(plan) +
        '/dockerImages/' +
        encodeURIComponent(image.name + '@' + image.digest),
      o.images[i],
    ]),
    ...context.images.map((image, i) => [
      provenanceListUrl(plan, context.result.buildName, image),
      o.occurrencePages[i],
    ]),
    [
      'https://cloudkms.googleapis.com/v1/' + keyName + '/publicKey',
      o.keys[keyName],
    ],
  ];
  const resources = new Map(entries),
    calls = [],
    counts = new Map();
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (!resources.has(url)) throw new Error('Unexpected mock Google read');
    const count = (counts.get(url) ?? 0) + 1;
    counts.set(url, count);
    return transform(
      new Response(JSON.stringify(resources.get(url)), {
        headers: { 'Content-Type': 'application/json' },
      }),
      { url, options, count },
    );
  };
  const githubCalls = [];
  const githubTransport = async (url, options) => {
    githubCalls.push({ url, options });
    const suffix =
      new URL(url).pathname.slice('/repos/fixture/backend'.length) +
      new URL(url).search;
    const value = suffix.startsWith('/git/ref/')
      ? {
          ref: 'refs/heads/' + plan.branch,
          object: { type: 'commit', sha: f.run(['rev-parse', plan.branch]) },
        }
      : await f.read(suffix);
    return new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { transport, githubTransport, calls, githubCalls, resources };
}
export { observed };
