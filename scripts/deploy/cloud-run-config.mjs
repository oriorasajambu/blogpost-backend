import {
  cloudRuntimeBinding,
  digest,
  RUNTIME_PURPOSES,
  validateProvenance,
} from '../../src/platform/config/build-model.ts';

export class ConfigurationCheckError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new ConfigurationCheckError(code);
};
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_SHAPE');
  if (
    keys &&
    (Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key)))
  )
    fail('INVALID_SHAPE');
  return value;
}
function text(value, pattern) {
  if (typeof value !== 'string' || pattern.exec(value)?.[0] !== value)
    fail('INVALID_IDENTIFIER');
  return value;
}
const equal = (a, b, code) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(code);
};
function inputs(provenance, target) {
  let build;
  try {
    build = validateProvenance(provenance);
  } catch {
    fail('INVALID_PROVENANCE');
  }
  if (build.environment === 'development') fail('CLOUD_ARTIFACT_REQUIRED');
  object(target, ['schemaVersion', 'purpose', 'region', 'resourceId', 'image']);
  if (target.schemaVersion !== 1 || !RUNTIME_PURPOSES.includes(target.purpose))
    fail('INVALID_TARGET');
  if (
    target.region !== 'asia-southeast2' ||
    build.configuration.sql.instanceConnectionName.split(':')[1] !==
      target.region
  )
    fail('REGION_MISMATCH');
  text(target.resourceId, /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
  const prefix =
    target.region + '-docker.pkg.dev/' + build.configuration.projectId + '/';
  if (typeof target.image !== 'string' || !target.image.startsWith(prefix))
    fail('IMAGE_MISMATCH');
  text(
    target.image.slice(prefix.length),
    /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+@sha256:[a-f0-9]{64}$/,
  );
  return {
    build,
    profile: build.configuration,
    binding: cloudRuntimeBinding(build, target.purpose),
    kind: target.purpose === 'api' ? 'services' : 'jobs',
  };
}
function projectIdentity(project, profile) {
  object(project);
  if (
    project.projectId !== profile.projectId ||
    project.lifecycleState !== 'ACTIVE'
  )
    fail('PROJECT_MISMATCH');
  return text(project.projectNumber, /^[1-9][0-9]{0,18}$/);
}
export function cloudRunExpectations(provenance, target) {
  return inputs(provenance, target);
}
function actualSecret(selector, profile, projectNumber) {
  object(selector, ['secret', 'version']);
  const version = text(selector.version, /^[1-9][0-9]{0,18}$/);
  const name = text(
    selector.secret,
    /^(?:projects\/[a-z0-9-]+\/secrets\/)?[A-Za-z0-9_-]{1,255}$/,
  );
  if (!name.includes('/'))
    return (
      'projects/' +
      profile.projectId +
      '/secrets/' +
      name +
      '/versions/' +
      version
    );
  const parts = name.split('/');
  if (![profile.projectId, projectNumber].includes(parts[1]))
    fail('SECRET_PROJECT_MISMATCH');
  return (
    'projects/' +
    profile.projectId +
    '/secrets/' +
    parts[3] +
    '/versions/' +
    version
  );
}
function environment(container, build, binding, purpose, projectNumber) {
  if (!Array.isArray(container.env) || container.env.length > 64)
    fail('ENVIRONMENT_MISMATCH');
  const values = new Map();
  const literals = {};
  const secrets = {};
  const optional = {
    SQL_PORT: '5432',
    SQL_SCHEMA: 'blogpost',
    BUILD_ENV: build.environment,
    BUILD_SHA: build.sourceSha,
    RUNTIME_INPUT_DIGEST: build.runtimeInputDigest,
  };
  if (purpose === 'bootstrap-db') optional.SQL_ROOT_USER = 'postgres';
  const administratorInputs = [
    'INITIAL_ADMIN_UID',
    'INITIAL_ADMIN_EMAIL',
    'INITIAL_ADMIN_DISPLAY_NAME',
    'INITIAL_ADMIN_HANDLE',
  ];
  let operatorInputs = false;
  for (const entry of container.env) {
    object(entry);
    const name = text(entry.name, /^[A-Z][A-Z0-9_]{0,63}$/);
    if (values.has(name)) fail('DUPLICATE_ENVIRONMENT');
    values.set(name, entry);
    if (Object.hasOwn(binding.secrets, name)) {
      object(entry, ['name', 'valueSource']);
      object(entry.valueSource, ['secretKeyRef']);
      const ref = actualSecret(
        entry.valueSource.secretKeyRef,
        build.configuration,
        projectNumber,
      );
      if (ref !== binding.secrets[name]) fail('SECRET_VERSION_MISMATCH');
      secrets[name] = ref;
    } else {
      object(entry, ['name', 'value']);
      if (Object.hasOwn(binding.literals, name)) {
        if (entry.value !== binding.literals[name])
          fail('ENVIRONMENT_MISMATCH');
        literals[name] = entry.value;
      } else if (Object.hasOwn(optional, name)) {
        if (entry.value !== optional[name]) fail('ENVIRONMENT_MISMATCH');
        literals[name] = entry.value;
      } else if (
        purpose === 'bootstrap-admin' &&
        administratorInputs.includes(name)
      ) {
        if (
          typeof entry.value !== 'string' ||
          !entry.value.trim() ||
          entry.value.length > 1024
        )
          fail('INVALID_OPERATOR_INPUT');
        // Private one-time identity inputs are never copied into receipts or digests.
        operatorInputs = true;
      } else fail('UNAPPROVED_ENVIRONMENT');
    }
  }
  for (const name of [
    ...Object.keys(binding.literals),
    ...Object.keys(binding.secrets),
  ])
    if (!values.has(name)) fail('MISSING_ENVIRONMENT');
  if (
    purpose === 'bootstrap-admin' &&
    administratorInputs.some((name) => !values.has(name))
  )
    fail('MISSING_OPERATOR_INPUT');
  return { literals, secrets, operatorInputs };
}
function taskProjection(
  build,
  target,
  projectNumber,
  kind,
  template,
  taskCounts,
) {
  const profile = build.configuration;
  const binding = cloudRuntimeBinding(build, target.purpose);
  if (kind === 'jobs') {
    if (taskCounts.taskCount !== 1 || taskCounts.parallelism !== 1)
      fail('JOB_PARALLELISM_MISMATCH');
    if (
      !Number.isInteger(template.maxRetries) ||
      template.maxRetries < 0 ||
      template.maxRetries > (target.purpose === 'maintenance' ? 1 : 0)
    )
      fail('JOB_RETRY_MISMATCH');
    if ((template.timeout ?? '600s') !== '600s') fail('TIMEOUT_MISMATCH');
  }
  if (template.serviceAccount !== binding.serviceAccount)
    fail('SERVICE_ACCOUNT_MISMATCH');
  if (!Array.isArray(template.containers) || template.containers.length !== 1)
    fail('CONTAINER_MISMATCH');
  const container = object(template.containers[0]);
  if (container.image !== target.image) fail('IMAGE_MISMATCH');
  if (container.workingDir || container.dependsOn?.length)
    fail('COMMAND_MISMATCH');
  for (const field of ['command', 'args', 'dependsOn']) {
    if (
      container[field] !== undefined &&
      (!Array.isArray(container[field]) ||
        container[field].some((item) => typeof item !== 'string'))
    )
      fail('COMMAND_MISMATCH');
  }
  const program =
    target.purpose === 'api'
      ? 'dist/main.js'
      : 'dist/ops/' +
        (['verify', 'inspect'].includes(target.purpose)
          ? target.purpose + '-db'
          : target.purpose) +
        '.js';
  if (
    target.purpose === 'api' &&
    !(container.command?.length || container.args?.length)
  ) {
    // The verified runtime image's default command starts the API.
  } else {
    equal(container.command, ['node'], 'COMMAND_MISMATCH');
    equal(container.args, [program], 'COMMAND_MISMATCH');
  }
  if (kind === 'services') {
    if (
      template.timeout !== '60s' ||
      template.maxInstanceRequestConcurrency !== 20
    )
      fail('SERVICE_REQUEST_LIMIT_MISMATCH');
    if (
      !Array.isArray(container.ports) ||
      container.ports.length !== 1 ||
      container.ports[0].containerPort !== 8080 ||
      ![undefined, '', 'http1'].includes(container.ports[0].name)
    )
      fail('PORT_MISMATCH');
  } else if (
    container.ports !== undefined &&
    (!Array.isArray(container.ports) || container.ports.length)
  )
    fail('PORT_MISMATCH');
  if (!Array.isArray(template.volumes) || template.volumes.length !== 1)
    fail('SQL_ATTACHMENT_MISMATCH');
  const volume = object(template.volumes[0], ['name', 'cloudSqlInstance']);
  text(volume.name, /^[a-z][a-z0-9-]{0,62}$/);
  object(volume.cloudSqlInstance, ['instances']);
  equal(
    volume.cloudSqlInstance.instances,
    [profile.sql.instanceConnectionName],
    'SQL_ATTACHMENT_MISMATCH',
  );
  if (
    !Array.isArray(container.volumeMounts) ||
    container.volumeMounts.length !== 1
  )
    fail('SQL_ATTACHMENT_MISMATCH');
  object(container.volumeMounts[0], ['name', 'mountPath']);
  if (
    container.volumeMounts[0].name !== volume.name ||
    container.volumeMounts[0].mountPath !== '/cloudsql'
  )
    fail('SQL_ATTACHMENT_MISMATCH');
  const env = environment(
    container,
    build,
    binding,
    target.purpose,
    projectNumber,
  );
  const projection = {
    schemaVersion: 1,
    purpose: target.purpose,
    image: target.image,
    serviceAccount: binding.serviceAccount,
    sqlInstance: profile.sql.instanceConnectionName,
    environment: env,
    program,
    port: kind === 'services' ? 8080 : null,
    requestLimits:
      kind === 'services'
        ? {
            timeout: template.timeout,
            concurrency: template.maxInstanceRequestConcurrency,
          }
        : {
            timeout: template.timeout ?? '600s',
            taskCount: taskCounts.taskCount,
            parallelism: taskCounts.parallelism,
            maxRetries: template.maxRetries,
          },
  };
  return projection;
}
export function verifyCloudRunTaskTemplate({
  provenance,
  target,
  project,
  template,
  taskCount = 1,
  parallelism = 1,
}) {
  const { build, profile, kind } = inputs(provenance, target);
  if (kind !== 'jobs') fail('JOB_TARGET_REQUIRED');
  const projection = taskProjection(
    build,
    target,
    projectIdentity(project, profile),
    kind,
    object(template),
    { taskCount, parallelism },
  );
  return {
    deploymentBindingDigest: digest(projection),
    configurationDigest: digest(profile),
    image: target.image,
  };
}
export function verifyCloudRunRevisionTemplate({
  provenance,
  target,
  project,
  template,
}) {
  const { build, profile, kind } = inputs(provenance, target);
  if (kind !== 'services') fail('SERVICE_TARGET_REQUIRED');
  const projection = taskProjection(
    build,
    target,
    projectIdentity(project, profile),
    kind,
    object(template),
    null,
  );
  return {
    deploymentBindingDigest: digest(projection),
    configurationDigest: digest(profile),
    image: target.image,
  };
}
export function verifyCloudRunConfiguration({
  provenance,
  target,
  project,
  resource,
}) {
  const { build, profile, binding, kind } = inputs(provenance, target);
  const projectNumber = projectIdentity(project, profile);
  object(resource);
  if (resource.apiVersion || resource.spec || resource.kind)
    fail('V2_RESOURCE_REQUIRED');
  const suffix =
    '/locations/' + target.region + '/' + kind + '/' + target.resourceId;
  if (
    ![profile.projectId, projectNumber].some(
      (id) => resource.name === 'projects/' + id + suffix,
    )
  )
    fail('RESOURCE_MISMATCH');
  text(
    resource.uid,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  text(resource.generation, /^[1-9][0-9]{0,18}$/);
  text(resource.etag, /^[\x21-\x7e]{1,256}$/);
  if (
    resource.observedGeneration !== resource.generation ||
    ![undefined, false].includes(resource.reconciling) ||
    resource.deleteTime ||
    resource.terminalCondition?.state !== 'CONDITION_SUCCEEDED'
  )
    fail('RESOURCE_NOT_SETTLED');
  const template = object(resource.template);
  const projection = taskProjection(
    build,
    target,
    projectNumber,
    kind,
    kind === 'jobs' ? object(template.template) : template,
    kind === 'jobs'
      ? {
          taskCount: template.taskCount ?? 1,
          parallelism: template.parallelism ?? 1,
        }
      : null,
  );
  return {
    schemaVersion: 1,
    status: 'PASSED',
    scope: 'cloud-run-runtime-binding',
    evidenceSource: 'provided-json',
    environment: build.environment,
    purpose: target.purpose,
    sourceSha: build.sourceSha,
    runtimeInputDigest: build.runtimeInputDigest,
    sourceInputDigest: build.sourceInputDigest,
    contractSha256: build.contractSha256,
    configurationDigest: digest(profile),
    deploymentBindingDigest: digest(projection),
    image: target.image,
    observation: {
      resourceName: resource.name,
      uid: resource.uid,
      generation: resource.generation,
      etag: resource.etag,
    },
    limitations: [
      'Does not attest image provenance, IAM, bucket ownership, DNS, resource budgets, traffic health or job execution overrides.',
      'Revalidate live UID, generation and etag before reusing evidence.',
    ],
  };
}
async function readCloudJson(url, accessToken, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: 'Bearer ' + accessToken,
        accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (
      response.status !== 200 ||
      response.redirected ||
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get('content-type') ?? '',
      )
    )
      fail('CLOUD_READ_FAILED');
    const chunks = [];
    let size = 0;
    if (!response.body) fail('CLOUD_READ_FAILED');
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 1048576) {
        await response.body.cancel().catch(() => {});
        fail('CLOUD_READ_FAILED');
      }
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    fail('CLOUD_READ_FAILED');
  }
}
export async function verifyLiveCloudRunConfiguration({
  provenance,
  target,
  accessToken,
  fetchImpl = fetch,
}) {
  const { profile, kind } = inputs(provenance, target);
  text(accessToken, /^[A-Za-z0-9._~+/=-]{1,4096}$/);
  const project = await readCloudJson(
    'https://cloudresourcemanager.googleapis.com/v1/projects/' +
      profile.projectId,
    accessToken,
    fetchImpl,
  );
  projectIdentity(project, profile);
  const name =
    'projects/' +
    profile.projectId +
    '/locations/' +
    target.region +
    '/' +
    kind +
    '/' +
    target.resourceId;
  const resource = await readCloudJson(
    'https://run.googleapis.com/v2/' + name,
    accessToken,
    fetchImpl,
  );
  const receipt = verifyCloudRunConfiguration({
    provenance,
    target,
    project,
    resource,
  });
  return {
    ...receipt,
    evidenceSource: 'live-api',
    observedAt: new Date().toISOString(),
  };
}
