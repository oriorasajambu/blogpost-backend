import { canonical, digest } from '../../src/platform/config/build-model.ts';
import { fail, sha } from '../ci/policy.mjs';

const record = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_CLOUD_BUILD_CONTEXT');
  return value;
};
const string = (value, pattern, maximum = 512) => {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    pattern.exec(value)?.[0] !== value
  )
    fail('INVALID_CLOUD_BUILD_CONTEXT');
  return value;
};
export function cloudBuildTime(value) {
  string(
    value,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(?:\d{3}|\d{6}|\d{9}))?Z$/,
    30,
  );
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    fail('INVALID_CLOUD_BUILD_TIME');
  return date.getTime();
}
export function cloudBuildRequest(request, projects) {
  record(request);
  record(projects);
  if (
    canonical(Object.keys(request).sort()) !==
    canonical(['buildId', 'environment', 'projectId', 'region'])
  )
    fail('INVALID_CLOUD_BUILD_REQUEST');
  if (
    !['staging', 'production'].includes(request.environment) ||
    projects.schemaVersion !== 1 ||
    request.region !== 'asia-southeast2' ||
    projects.region !== request.region
  )
    fail('WRONG_CLOUD_BUILD_ENVIRONMENT');
  const selected = record(projects[request.environment]);
  const other = record(
    projects[request.environment === 'staging' ? 'production' : 'staging'],
  );
  for (const value of [selected.projectId, other.projectId])
    string(value, /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 30);
  for (const value of [selected.projectNumber, other.projectNumber])
    string(value, /^[1-9][0-9]{0,18}$/, 19);
  if (
    request.projectId !== selected.projectId ||
    selected.projectId === other.projectId ||
    selected.projectNumber === other.projectNumber
  )
    fail('WRONG_CLOUD_BUILD_PROJECT');
  string(request.buildId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, 36);
  return {
    ...request,
    projectNumber: selected.projectNumber,
    branch: request.environment === 'staging' ? 'rc' : 'main',
    serviceAccount:
      'blogpost-build@' + selected.projectId + '.iam.gserviceaccount.com',
  };
}
function resourceName(value, plan, suffix) {
  string(value, /^[A-Za-z0-9/_.-]+$/, 1024);
  const parts = value.split('/');
  if (parts.some((part) => part === '.' || part === '..'))
    fail('WRONG_CLOUD_BUILD_RESOURCE');
  if (
    parts[0] !== 'projects' ||
    ![plan.projectId, plan.projectNumber].includes(parts[1]) ||
    parts[2] !== 'locations' ||
    parts[3] !== plan.region ||
    !suffix.test(parts.slice(4).join('/'))
  )
    fail('WRONG_CLOUD_BUILD_RESOURCE');
  parts[1] = plan.projectId;
  return parts.join('/');
}
function serviceAccount(value, plan) {
  const accepted = [plan.projectId, plan.projectNumber].map(
    (project) =>
      'projects/' + project + '/serviceAccounts/' + plan.serviceAccount,
  );
  if (!accepted.includes(value)) fail('WRONG_CLOUD_BUILD_ACCOUNT');
}
export function inspectCloudBuild(request, projects, build, now = Date.now()) {
  const plan = cloudBuildRequest(request, projects);
  record(build);
  if (
    build.projectId !== plan.projectId ||
    build.id !== plan.buildId ||
    build.status !== 'WORKING' ||
    build.finishTime ||
    resourceName(build.name, plan, /^builds\/[a-f0-9-]{36}$/) !==
      'projects/' +
        plan.projectId +
        '/locations/' +
        plan.region +
        '/builds/' +
        plan.buildId
  )
    fail('CLOUD_BUILD_NOT_CURRENTLY_RUNNING');
  serviceAccount(build.serviceAccount, plan);
  const created = cloudBuildTime(build.createTime),
    started = cloudBuildTime(build.startTime);
  if (
    created > started + 300000 ||
    started > now + 300000 ||
    started < now - 86400000
  )
    fail('CLOUD_BUILD_TIME_DISAGREES');
  if (
    build.options?.logging !== 'CLOUD_LOGGING_ONLY' ||
    build.options?.pool?.name ||
    build.options?.workerPool ||
    (build.options?.secretEnv !== undefined &&
      (!Array.isArray(build.options.secretEnv) ||
        build.options.secretEnv.length)) ||
    build.availableSecrets !== undefined ||
    (build.secrets !== undefined &&
      (!Array.isArray(build.secrets) || build.secrets.length)) ||
    !Array.isArray(build.steps) ||
    !build.steps.length ||
    build.steps.length > 20 ||
    build.steps.some(
      (step) =>
        !step ||
        typeof step !== 'object' ||
        Array.isArray(step) ||
        (step.secretEnv !== undefined &&
          (!Array.isArray(step.secretEnv) || step.secretEnv.length)),
    )
  )
    fail('UNAPPROVED_CLOUD_BUILD_CONFIGURATION');
  const source = record(build.source);
  if (canonical(Object.keys(source)) !== canonical(['connectedRepository']))
    fail('CONNECTED_BUILD_SOURCE_REQUIRED');
  const input = record(source.connectedRepository),
    resolved = record(build.sourceProvenance?.resolvedConnectedRepository);
  for (const value of [input, resolved]) {
    if (value.dir !== undefined && value.dir !== '')
      fail('ROOT_BUILD_SOURCE_REQUIRED');
    const extra = Object.keys(value).filter(
      (key) => !['repository', 'revision', 'dir'].includes(key),
    );
    if (extra.length) fail('INVALID_CONNECTED_BUILD_SOURCE');
  }
  for (const field of [
    'resolvedRepoSource',
    'resolvedGitSource',
    'resolvedStorageSource',
    'resolvedStorageSourceManifest',
  ])
    if (build.sourceProvenance[field] !== undefined)
      fail('AMBIGUOUS_CLOUD_BUILD_SOURCE');
  const connected = resourceName(
    resolved.repository,
    plan,
    /^connections\/[A-Za-z0-9._-]{1,128}\/repositories\/[A-Za-z0-9._-]{1,128}$/,
  );
  if (
    resourceName(
      input.repository,
      plan,
      /^connections\/[A-Za-z0-9._-]{1,128}\/repositories\/[A-Za-z0-9._-]{1,128}$/,
    ) !== connected
  )
    fail('CLOUD_BUILD_SOURCE_DISAGREES');
  const sourceSha = sha(resolved.revision);
  if (!['refs/heads/' + plan.branch, sourceSha].includes(input.revision))
    fail('WRONG_CLOUD_BUILD_REF');
  const substitutions = record(build.substitutions);
  if (substitutions._APP_ENV !== plan.environment || substitutions.TAG_NAME)
    fail('WRONG_CLOUD_BUILD_ENVIRONMENT');
  for (const key of ['COMMIT_SHA', 'REVISION_ID'])
    if (substitutions[key] && substitutions[key] !== sourceSha)
      fail('CLOUD_BUILD_SUBSTITUTION_DISAGREES');
  if (substitutions.BRANCH_NAME && substitutions.BRANCH_NAME !== plan.branch)
    fail('CLOUD_BUILD_SUBSTITUTION_DISAGREES');
  const triggerId = string(
    build.buildTriggerId,
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
    36,
  );
  return {
    plan,
    sourceSha,
    connectedRepository: connected,
    triggerId,
    buildName:
      'projects/' +
      plan.projectId +
      '/locations/' +
      plan.region +
      '/builds/' +
      plan.buildId,
    triggerName:
      'projects/' +
      plan.projectId +
      '/locations/' +
      plan.region +
      '/triggers/' +
      triggerId,
  };
}
export function verifyCloudBuildContext({
  request,
  projects,
  repositoryConfig,
  metadataEmail,
  project,
  build,
  trigger,
  repository,
  now = Date.now(),
}) {
  const inspected = inspectCloudBuild(request, projects, build, now),
    { plan } = inspected;
  record(repositoryConfig);
  record(project);
  record(trigger);
  record(repository);
  string(repositoryConfig.fullName, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 200);
  string(repositoryConfig.repositoryId, /^[1-9][0-9]{0,19}$/, 20);
  string(repositoryConfig.ownerId, /^[1-9][0-9]{0,19}$/, 20);
  if (
    project.projectId !== plan.projectId ||
    project.projectNumber !== plan.projectNumber ||
    project.lifecycleState !== 'ACTIVE'
  )
    fail('CLOUD_BUILD_PROJECT_IDENTITY_DISAGREES');
  if (metadataEmail !== plan.serviceAccount)
    fail('CLOUD_BUILD_METADATA_ACCOUNT_DISAGREES');
  if (
    trigger.id !== inspected.triggerId ||
    trigger.name !== 'blogpost-backend-manual' ||
    trigger.eventType !== 'MANUAL' ||
    (trigger.disabled !== undefined && trigger.disabled !== false) ||
    resourceName(trigger.resourceName, plan, /^triggers\/[a-f0-9-]{36}$/) !==
      inspected.triggerName
  )
    fail('MANUAL_CLOUD_BUILD_TRIGGER_REQUIRED');
  for (const key of [
    'triggerTemplate',
    'github',
    'pubsubConfig',
    'webhookConfig',
    'bitbucketServerTriggerConfig',
    'repositoryEventConfig',
    'developerConnectEventConfig',
    'build',
  ])
    if (trigger[key] !== undefined) fail('MANUAL_CLOUD_BUILD_TRIGGER_REQUIRED');
  if (
    trigger.autodetect ||
    trigger.filter ||
    ['ignoredFiles', 'includedFiles'].some(
      (key) =>
        trigger[key] !== undefined &&
        (!Array.isArray(trigger[key]) || trigger[key].length),
    )
  )
    fail('UNAPPROVED_CLOUD_BUILD_TRIGGER_FILTER');
  serviceAccount(trigger.serviceAccount, plan);
  const source = record(trigger.sourceToBuild);
  if (
    source.repoType !== 'GITHUB' ||
    source.ref !== 'refs/heads/' + plan.branch ||
    source.uri ||
    source.githubEnterpriseConfig ||
    source.bitbucketServerConfig ||
    resourceName(
      source.repository,
      plan,
      /^connections\/[A-Za-z0-9._-]{1,128}\/repositories\/[A-Za-z0-9._-]{1,128}$/,
    ) !== inspected.connectedRepository
  )
    fail('CLOUD_BUILD_TRIGGER_SOURCE_DISAGREES');
  if (
    trigger.filename !== 'cloudbuild.yaml' ||
    trigger.gitFileSource !== undefined
  )
    fail('CLOUD_BUILD_REPOSITORY_RECIPE_REQUIRED');
  const created = cloudBuildTime(trigger.createTime);
  if (created > cloudBuildTime(build.startTime) + 300000)
    fail('CLOUD_BUILD_TRIGGER_TIME_DISAGREES');
  if (
    resourceName(
      repository.name,
      plan,
      /^connections\/[A-Za-z0-9._-]{1,128}\/repositories\/[A-Za-z0-9._-]{1,128}$/,
    ) !== inspected.connectedRepository ||
    ![
      'https://github.com/' + repositoryConfig.fullName,
      'https://github.com/' + repositoryConfig.fullName + '.git',
    ].includes(repository.remoteUri)
  )
    fail('CLOUD_BUILD_REPOSITORY_DISAGREES');
  string(repository.etag, /^[\x21-\x7e]{1,256}$/, 256);
  return {
    schemaVersion: 1,
    status: 'VERIFIED',
    scope: 'cloud-build-context',
    evidenceSource: 'provided-json',
    environment: plan.environment,
    projectId: plan.projectId,
    projectNumber: plan.projectNumber,
    region: plan.region,
    sourceSha: inspected.sourceSha,
    sourceRef: 'refs/heads/' + plan.branch,
    repositoryFullName: repositoryConfig.fullName,
    repositoryId: repositoryConfig.repositoryId,
    ownerId: repositoryConfig.ownerId,
    serviceAccount: plan.serviceAccount,
    observation: {
      build: {
        name: inspected.buildName,
        id: plan.buildId,
        createTime: build.createTime,
        startTime: build.startTime,
      },
      trigger: {
        name: inspected.triggerName,
        id: inspected.triggerId,
        createTime: trigger.createTime,
      },
      repository: {
        name: inspected.connectedRepository,
        etag: repository.etag,
      },
    },
    configurationDigest: digest({
      projectId: plan.projectId,
      branch: plan.branch,
      serviceAccount: plan.serviceAccount,
      connectedRepository: inspected.connectedRepository,
      recipe: 'cloudbuild.yaml',
      triggerType: 'MANUAL',
    }),
    limitations: [
      'Verifies running build/source/trigger context, not human invocation, reviewed Git ancestry, recipe execution, image provenance, IAM or deployment.',
    ],
  };
}
