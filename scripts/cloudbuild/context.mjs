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
function inspectBuild(request, projects, build, now, completed) {
  if (!Number.isFinite(now)) fail('INVALID_CLOUD_BUILD_TIME');
  const plan = cloudBuildRequest(request, projects);
  record(build);
  if (
    build.projectId !== plan.projectId ||
    build.id !== plan.buildId ||
    build.status !== (completed ? 'SUCCESS' : 'WORKING') ||
    (!completed && build.finishTime) ||
    resourceName(build.name, plan, /^builds\/[a-f0-9-]{36}$/) !==
      'projects/' +
        plan.projectId +
        '/locations/' +
        plan.region +
        '/builds/' +
        plan.buildId
  )
    fail(
      completed
        ? 'CLOUD_BUILD_NOT_SUCCESSFUL'
        : 'CLOUD_BUILD_NOT_CURRENTLY_RUNNING',
    );
  serviceAccount(build.serviceAccount, plan);
  const created = cloudBuildTime(build.createTime),
    started = cloudBuildTime(build.startTime);
  if (
    created > started + 300000 ||
    started > now + 300000 ||
    (!completed && started < now - 86400000)
  )
    fail('CLOUD_BUILD_TIME_DISAGREES');
  if (completed) {
    const finished = cloudBuildTime(build.finishTime);
    if (
      finished < started ||
      finished > now + 300000 ||
      finished - started > 3900000
    )
      fail('CLOUD_BUILD_TIME_DISAGREES');
  }
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
  // Manual 2nd gen triggers on a public repository are recorded by Cloud Build
  // as a resolved gitSource rather than connectedRepository. That form names
  // no connected repository, so callers bind it through the trigger instead.
  const kind = canonical(Object.keys(source));
  const sourceField =
    kind === canonical(['connectedRepository'])
      ? 'connectedRepository'
      : kind === canonical(['gitSource'])
        ? 'gitSource'
        : fail('CONNECTED_BUILD_SOURCE_REQUIRED');
  const resolvedField =
    sourceField === 'gitSource'
      ? 'resolvedGitSource'
      : 'resolvedConnectedRepository';
  const location = sourceField === 'gitSource' ? 'url' : 'repository';
  const input = record(source[sourceField]),
    resolved = record(build.sourceProvenance?.[resolvedField]);
  for (const value of [input, resolved]) {
    if (value.dir !== undefined && value.dir !== '')
      fail('ROOT_BUILD_SOURCE_REQUIRED');
    const extra = Object.keys(value).filter(
      (key) => ![location, 'revision', 'dir'].includes(key),
    );
    if (extra.length) fail('INVALID_CONNECTED_BUILD_SOURCE');
  }
  for (const field of [
    'resolvedRepoSource',
    'resolvedGitSource',
    'resolvedConnectedRepository',
    'resolvedStorageSource',
    'resolvedStorageSourceManifest',
  ])
    if (field !== resolvedField && build.sourceProvenance[field] !== undefined)
      fail('AMBIGUOUS_CLOUD_BUILD_SOURCE');
  const sourceSha = sha(resolved.revision);
  let connected = null,
    gitSourceUrl = null;
  if (sourceField === 'gitSource') {
    gitSourceUrl = string(
      input.url,
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
      300,
    );
    if (resolved.url !== gitSourceUrl) fail('CLOUD_BUILD_SOURCE_DISAGREES');
    if (input.revision !== sourceSha) fail('WRONG_CLOUD_BUILD_REF');
  } else {
    connected = resourceName(
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
    if (!['refs/heads/' + plan.branch, sourceSha].includes(input.revision))
      fail('WRONG_CLOUD_BUILD_REF');
  }
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
    gitSourceUrl,
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
export function cloudBuildRepositoryName(inspected, trigger) {
  return (
    inspected.connectedRepository ??
    resourceName(
      record(record(trigger).sourceToBuild).repository,
      inspected.plan,
      /^connections\/[A-Za-z0-9._-]{1,128}\/repositories\/[A-Za-z0-9._-]{1,128}$/,
    )
  );
}
export function inspectCloudBuild(request, projects, build, now = Date.now()) {
  return inspectBuild(request, projects, build, now, false);
}
export function inspectCompletedCloudBuild(
  request,
  projects,
  build,
  now = Date.now(),
) {
  return inspectBuild(request, projects, build, now, true);
}
function verifyBuildResources(
  {
    request,
    projects,
    repositoryConfig,
    project,
    build,
    trigger,
    repository,
    now = Date.now(),
  },
  completed,
) {
  const inspected = inspectBuild(request, projects, build, now, completed),
    { plan } = inspected;
  record(repositoryConfig);
  record(project);
  record(trigger);
  record(repository);
  const connected = cloudBuildRepositoryName(inspected, trigger);
  string(repositoryConfig.fullName, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 200);
  string(repositoryConfig.repositoryId, /^[1-9][0-9]{0,19}$/, 20);
  string(repositoryConfig.ownerId, /^[1-9][0-9]{0,19}$/, 20);
  if (
    project.projectId !== plan.projectId ||
    project.projectNumber !== plan.projectNumber ||
    project.lifecycleState !== 'ACTIVE'
  )
    fail('CLOUD_BUILD_PROJECT_IDENTITY_DISAGREES');
  if (
    trigger.id !== inspected.triggerId ||
    trigger.name !== 'blogpost-backend-manual' ||
    // The v1 API omits eventType for manual triggers; the absent event
    // sources below are what establish manual invocation.
    (trigger.eventType !== undefined && trigger.eventType !== 'MANUAL') ||
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
  // 2nd gen connected-repository sources omit repoType; the resource name pins
  // the repository instead.
  if (
    (source.repoType !== undefined && source.repoType !== 'GITHUB') ||
    !['refs/heads/' + plan.branch, inspected.sourceSha].includes(source.ref) ||
    source.uri ||
    source.githubEnterpriseConfig ||
    source.bitbucketServerConfig ||
    resourceName(
      source.repository,
      plan,
      /^connections\/[A-Za-z0-9._-]{1,128}\/repositories\/[A-Za-z0-9._-]{1,128}$/,
    ) !== connected
  )
    fail('CLOUD_BUILD_TRIGGER_SOURCE_DISAGREES');
  const configurationSource = {
    kind: 'source-root',
    repository: connected,
    ref: source.ref,
    path: 'cloudbuild.yaml',
  };
  if (trigger.gitFileSource !== undefined) {
    const file = record(trigger.gitFileSource);
    if (
      trigger.filename !== undefined ||
      (file.repoType !== undefined && file.repoType !== 'GITHUB') ||
      !['cloudbuild.yaml', '/cloudbuild.yaml'].includes(file.path) ||
      (file.revision !== undefined &&
        file.revision !== '' &&
        !['refs/heads/' + plan.branch, inspected.sourceSha].includes(
          file.revision,
        )) ||
      file.uri ||
      file.githubEnterpriseConfig ||
      file.bitbucketServerConfig ||
      Object.keys(file).some(
        (key) =>
          ![
            'path',
            'repository',
            'repoType',
            'revision',
            'uri',
            'githubEnterpriseConfig',
            'bitbucketServerConfig',
          ].includes(key),
      ) ||
      resourceName(
        file.repository,
        plan,
        /^connections\/[A-Za-z0-9._-]{1,128}\/repositories\/[A-Za-z0-9._-]{1,128}$/,
      ) !== connected
    )
      fail('CLOUD_BUILD_REPOSITORY_RECIPE_REQUIRED');
    configurationSource.kind = 'git-file';
    configurationSource.ref = file.revision || source.ref;
  } else if (trigger.filename !== 'cloudbuild.yaml')
    fail('CLOUD_BUILD_REPOSITORY_RECIPE_REQUIRED');
  const created = cloudBuildTime(trigger.createTime);
  if (created > cloudBuildTime(build.startTime) + 300000)
    fail('CLOUD_BUILD_TRIGGER_TIME_DISAGREES');
  if (
    resourceName(
      repository.name,
      plan,
      /^connections\/[A-Za-z0-9._-]{1,128}\/repositories\/[A-Za-z0-9._-]{1,128}$/,
    ) !== connected ||
    ![
      'https://github.com/' + repositoryConfig.fullName,
      'https://github.com/' + repositoryConfig.fullName + '.git',
    ].includes(repository.remoteUri) ||
    (inspected.gitSourceUrl !== null &&
      inspected.gitSourceUrl !== repository.remoteUri)
  )
    fail('CLOUD_BUILD_REPOSITORY_DISAGREES');
  string(repository.etag, /^[\x21-\x7e]{1,256}$/, 256);
  return {
    schemaVersion: 1,
    status: 'VERIFIED',
    scope: completed ? 'cloud-build-completed-context' : 'cloud-build-context',
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
        ...(completed ? { finishTime: build.finishTime } : {}),
      },
      trigger: {
        name: inspected.triggerName,
        id: inspected.triggerId,
        createTime: trigger.createTime,
        sourceRef: source.ref,
        configurationSource,
      },
      repository: {
        name: connected,
        etag: repository.etag,
      },
    },
    configurationDigest: digest({
      projectId: plan.projectId,
      branch: plan.branch,
      serviceAccount: plan.serviceAccount,
      connectedRepository: connected,
      recipe: 'cloudbuild.yaml',
      triggerType: 'MANUAL',
      configurationSource,
    }),
    limitations: [
      completed
        ? 'Verifies completed build/source and current trigger context, not human invocation, reviewed Git ancestry, registry outputs, signed provenance, IAM or deployment.'
        : 'Verifies running build/source/trigger context, not human invocation, reviewed Git ancestry, recipe execution, image provenance, IAM or deployment.',
    ],
  };
}
export function verifyCloudBuildContext(input) {
  const plan = cloudBuildRequest(input.request, input.projects);
  if (input.metadataEmail !== plan.serviceAccount)
    fail('CLOUD_BUILD_METADATA_ACCOUNT_DISAGREES');
  return verifyBuildResources(input, false);
}
export function verifyCompletedCloudBuildContext(input) {
  return verifyBuildResources(input, true);
}
