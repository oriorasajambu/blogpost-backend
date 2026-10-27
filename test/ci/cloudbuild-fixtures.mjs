import { readFile } from 'node:fs/promises';
import { config } from './fixtures.mjs';
import { recoveryRecipe } from '../../scripts/cloudbuild/recipe.mjs';

export const observed = Date.parse('2026-10-28T00:00:00Z');
export const syntheticToken = 'synthetic-cloud-build-test-token';
const projects = JSON.parse(
  await readFile(new URL('../../config/cloud-projects.json', import.meta.url)),
);
export function cloudFixture(
  environment = 'staging',
  sourceSha = 'a'.repeat(40),
) {
  const projectId = projects[environment].projectId;
  const branch = environment === 'staging' ? 'rc' : 'main';
  const prefix = 'projects/' + projectId + '/locations/' + projects.region;
  const buildId = '11111111-1111-4111-8111-111111111111';
  const triggerId = '22222222-2222-4222-8222-222222222222';
  const repositoryName = prefix + '/connections/github/repositories/backend';
  const metadataEmail =
    'blogpost-build@' + projectId + '.iam.gserviceaccount.com';
  const serviceAccount =
    'projects/' + projectId + '/serviceAccounts/' + metadataEmail;
  return {
    request: { buildId, environment, projectId, region: projects.region },
    projects: structuredClone(projects),
    repositoryConfig: { ...config },
    now: observed,
    metadataEmail,
    project: {
      projectId,
      projectNumber: projects[environment].projectNumber,
      lifecycleState: 'ACTIVE',
    },
    build: {
      name: prefix + '/builds/' + buildId,
      id: buildId,
      projectId,
      status: 'WORKING',
      createTime: '2026-10-27T23:58:00Z',
      startTime: '2026-10-27T23:59:00Z',
      serviceAccount,
      buildTriggerId: triggerId,
      source: {
        connectedRepository: {
          repository: repositoryName,
          revision: 'refs/heads/' + branch,
        },
      },
      sourceProvenance: {
        resolvedConnectedRepository: {
          repository: repositoryName,
          revision: sourceSha,
        },
      },
      options: { logging: 'CLOUD_LOGGING_ONLY' },
      steps: [{ name: 'synthetic-builder' }],
      substitutions: {
        _APP_ENV: environment,
        COMMIT_SHA: sourceSha,
        REVISION_ID: sourceSha,
        BRANCH_NAME: branch,
      },
    },
    trigger: {
      resourceName: prefix + '/triggers/' + triggerId,
      id: triggerId,
      name: 'blogpost-backend-manual',
      eventType: 'MANUAL',
      createTime: '2026-10-27T23:00:00Z',
      serviceAccount,
      sourceToBuild: {
        repository: repositoryName,
        ref: 'refs/heads/' + branch,
        repoType: 'GITHUB',
      },
      filename: 'cloudbuild.yaml',
    },
    repository: {
      name: repositoryName,
      remoteUri: 'https://github.com/fixture/backend.git',
      etag: 'synthetic-etag',
    },
  };
}

// Mock transport only: no request is forwarded to metadata, Google or GitHub.
export function provider(fixture, transform = (response) => response) {
  const calls = [],
    counts = new Map();
  const metadata =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/';
  const resources = new Map([
    [metadata + 'email', () => fixture.metadataEmail],
    [
      metadata + 'token',
      () => ({
        access_token: syntheticToken,
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    ],
    [
      'https://cloudresourcemanager.googleapis.com/v1/projects/' +
        fixture.request.projectId,
      () => fixture.project,
    ],
    [
      'https://cloudbuild.googleapis.com/v1/' + fixture.build.name,
      () => fixture.build,
    ],
    [
      'https://cloudbuild.googleapis.com/v1/' + fixture.trigger.resourceName,
      () => fixture.trigger,
    ],
    [
      'https://cloudbuild.googleapis.com/v2/' + fixture.repository.name,
      () => fixture.repository,
    ],
  ]);
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (!resources.has(url)) throw new Error('Unexpected synthetic read');
    const count = (counts.get(url) ?? 0) + 1;
    counts.set(url, count);
    const email = url === metadata + 'email';
    const headers = {
      'Content-Type': email ? 'text/plain' : 'application/json',
      ...(url.startsWith(metadata) ? { 'Metadata-Flavor': 'Google' } : {}),
    };
    const value = resources.get(url)();
    const response = new Response(email ? value : JSON.stringify(value), {
      headers,
    });
    return transform(response, { url, options, count, fixture });
  };
  return { calls, transport };
}
export function recipeFixture(environment = 'staging', sha) {
  const f = cloudFixture(environment, sha);
  const recipe = recoveryRecipe(f.request);
  Object.assign(f.build, recipe, {
    substitutions: { ...f.build.substitutions, _APP_ENV: environment },
  });
  return f;
}
