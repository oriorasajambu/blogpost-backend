import { readFileSync } from 'node:fs';
import { canonical, digest } from '../../src/platform/config/build-model.ts';
import { fail } from '../ci/policy.mjs';
import { cloudBuildRequest } from './context.mjs';

export const toolchain = JSON.parse(
  readFileSync(
    new URL('../../config/cloudbuild-toolchain.json', import.meta.url),
    'utf8',
  ),
);
export function recoveryRecipe({
  projectId = '$PROJECT_ID',
  buildId = '$BUILD_ID',
  region = '$LOCATION',
  environment = '${_APP_ENV}',
} = {}) {
  const directory = '/workspace/.local/cloudbuild/' + buildId;
  const routing = [
    '--project-id',
    projectId,
    '--build-id',
    buildId,
    '--region',
    region,
    '--environment',
    environment,
  ];
  return {
    steps: [
      {
        id: 'capture',
        name: toolchain.node,
        entrypoint: 'node',
        dir: '/workspace',
        timeout: '600s',
        waitFor: ['-'],
        args: ['scripts/cloudbuild/recover.mjs', 'capture', ...routing],
      },
      {
        id: 'tools',
        name: toolchain.builder,
        entrypoint: 'docker',
        dir: '/workspace',
        timeout: '900s',
        waitFor: ['capture'],
        args: [
          'build',
          '--platform',
          toolchain.platform,
          '--file',
          directory + '/source/docker/cloudbuild/Dockerfile',
          '--tag',
          'blogpost-cloudbuild-tools:' + buildId,
          directory + '/source',
        ],
      },
      {
        id: 'check-build',
        name: 'blogpost-cloudbuild-tools:' + buildId,
        entrypoint: 'node',
        dir: '/workspace',
        timeout: '2700s',
        waitFor: ['tools'],
        args: [
          directory + '/source/scripts/cloudbuild/recover.mjs',
          'check-build',
          ...routing,
        ],
      },
    ],
    images: ['backend', 'backend-operations'].map(
      (image) =>
        'asia-southeast2-docker.pkg.dev/' +
        projectId +
        '/blogpost/' +
        image +
        ':build-' +
        buildId,
    ),
    serviceAccount:
      'projects/' +
      projectId +
      '/serviceAccounts/blogpost-build@' +
      projectId +
      '.iam.gserviceaccount.com',
    timeout: '3600s',
    queueTtl: '900s',
    options: {
      logging: 'CLOUD_LOGGING_ONLY',
      automapSubstitutions: false,
      sourceProvenanceHash: ['SHA256'],
      requestedVerifyOption: 'VERIFIED',
    },
    substitutions: { _APP_ENV: 'UNSELECTED' },
  };
}
export function verifyRecoveryRecipe(build, request, projects) {
  cloudBuildRequest(request, projects);
  const expected = recoveryRecipe(request);
  const invalid = () => fail('UNAPPROVED_CLOUD_BUILD_RECIPE');
  const empty = (value) =>
    value === undefined || (Array.isArray(value) && value.length === 0);
  if (
    !Array.isArray(build.steps) ||
    build.steps.length !== expected.steps.length
  )
    invalid();
  for (const [index, step] of build.steps.entries()) {
    const selected = Object.fromEntries(
      Object.keys(expected.steps[index]).map((key) => [key, step[key]]),
    );
    if (
      canonical(selected) !== canonical(expected.steps[index]) ||
      !empty(step.env) ||
      !empty(step.secretEnv) ||
      !empty(step.volumes) ||
      !empty(step.allowExitCodes) ||
      (step.allowFailure !== undefined && step.allowFailure !== false) ||
      (step.automapSubstitutions !== undefined &&
        step.automapSubstitutions !== false) ||
      step.script
    )
      invalid();
  }
  const options = build.options ?? {};
  if (
    canonical(build.images) !== canonical(expected.images) ||
    build.timeout !== expected.timeout ||
    build.queueTtl !== expected.queueTtl ||
    options.logging !== expected.options.logging ||
    options.requestedVerifyOption !== expected.options.requestedVerifyOption ||
    canonical(options.sourceProvenanceHash) !==
      canonical(expected.options.sourceProvenanceHash) ||
    (options.automapSubstitutions !== undefined &&
      options.automapSubstitutions !== false) ||
    !empty(options.env) ||
    !empty(options.volumes) ||
    !empty(build.dependencies) ||
    build.logsBucket ||
    Object.keys(build.substitutions ?? {}).some(
      (key) => key.startsWith('_') && key !== '_APP_ENV',
    )
  )
    invalid();
  if (build.artifacts !== undefined) {
    if (
      !build.artifacts ||
      Object.keys(build.artifacts).some((key) => key !== 'images') ||
      canonical(build.artifacts.images) !== canonical(expected.images)
    )
      invalid();
  }
  return {
    status: 'VERIFIED',
    scope: 'cloud-build-recipe',
    recipeDigest: digest(expected),
  };
}
