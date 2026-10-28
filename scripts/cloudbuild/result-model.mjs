import { digest } from '../../src/platform/config/build-model.ts';
import { fail, sha } from '../ci/policy.mjs';
import {
  cloudBuildRequest,
  cloudBuildTime,
  inspectCompletedCloudBuild,
  verifyCompletedCloudBuildContext,
} from './context.mjs';
import { recoveryRecipe, verifyRecoveryRecipe } from './recipe.mjs';

export const cloudBuildImageNames = ['backend', 'backend-operations'];
export function completedBuildImages(
  request,
  projects,
  build,
  sourceSha,
  now = Date.now(),
) {
  sha(sourceSha);
  const inspected = inspectCompletedCloudBuild(request, projects, build, now);
  if (inspected.sourceSha !== sourceSha)
    fail('COMPLETED_BUILD_SOURCE_DISAGREES');
  const recipe = verifyRecoveryRecipe(build, request, projects);
  if (
    build.steps.some(
      (step) =>
        step.status !== 'SUCCESS' ||
        (step.exitCode !== undefined && step.exitCode !== 0),
    ) ||
    !Array.isArray(build.results?.images) ||
    build.results.images.length !== 2 ||
    !Array.isArray(build.results.buildStepImages) ||
    build.results.buildStepImages.length !== 3 ||
    build.results.buildStepImages.some(
      (value) =>
        typeof value !== 'string' ||
        /^sha256:[a-f0-9]{64}$/.exec(value)?.[0] !== value,
    )
  )
    fail('COMPLETED_BUILD_RESULTS_REQUIRED');
  const expectedTags = recoveryRecipe(request).images;
  const images = cloudBuildImageNames.map((name, index) => {
    const found = build.results.images.filter(
      (image) => image.name === expectedTags[index],
    );
    if (
      found.length !== 1 ||
      typeof found[0].digest !== 'string' ||
      /^sha256:[a-f0-9]{64}$/.exec(found[0].digest)?.[0] !== found[0].digest
    )
      fail('COMPLETED_BUILD_IMAGE_DISAGREES');
    const base = expectedTags[index].slice(
      0,
      expectedTags[index].lastIndexOf(':'),
    );
    return {
      target: index === 0 ? 'runtime' : 'operations',
      name,
      tag: expectedTags[index],
      digest: found[0].digest,
      uri: base + '@' + found[0].digest,
    };
  });
  if (images[0].digest === images[1].digest)
    fail('DISTINCT_RUNTIME_OPERATIONS_IMAGES_REQUIRED');
  return { ...inspected, recipeDigest: recipe.recipeDigest, images };
}
export function registryPrefix(plan) {
  return (
    'projects/' +
    plan.projectId +
    '/locations/' +
    plan.region +
    '/repositories/blogpost'
  );
}
export function verifyRegistryRepository(plan, repository) {
  if (
    !repository ||
    repository.name !== registryPrefix(plan) ||
    repository.format !== 'DOCKER' ||
    repository.mode !== 'STANDARD_REPOSITORY' ||
    repository.dockerConfig?.immutableTags !== true
  )
    fail('IMMUTABLE_REGIONAL_REGISTRY_REQUIRED');
  return {
    name: repository.name,
    format: 'DOCKER',
    mode: 'STANDARD_REPOSITORY',
    immutableTags: true,
  };
}
export function verifyRegistryImage(plan, expected, image, now = Date.now()) {
  const prefix = registryPrefix(plan) + '/dockerImages/';
  let suffix;
  try {
    if (typeof image?.name === 'string' && image.name.startsWith(prefix))
      suffix = decodeURIComponent(image.name.slice(prefix.length));
  } catch {
    fail('REGISTRY_IMAGE_DISAGREES');
  }
  if (
    suffix !== expected.name + '@' + expected.digest ||
    image.uri !== expected.uri ||
    typeof image.imageSizeBytes !== 'string' ||
    /^[1-9][0-9]{0,18}$/.exec(image.imageSizeBytes)?.[0] !==
      image.imageSizeBytes ||
    BigInt(image.imageSizeBytes) > 9223372036854775807n ||
    ![
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.oci.image.index.v1+json',
      'application/vnd.docker.distribution.manifest.v2+json',
      'application/vnd.docker.distribution.manifest.list.v2+json',
    ].includes(image.mediaType)
  )
    fail('REGISTRY_IMAGE_DISAGREES');
  const uploaded = cloudBuildTime(image.uploadTime),
    updated = cloudBuildTime(image.updateTime);
  if (uploaded > now + 300000 || updated < uploaded || updated > now + 300000)
    fail('REGISTRY_IMAGE_TIME_DISAGREES');
  return {
    ...expected,
    resource: prefix + suffix,
    imageSizeBytes: image.imageSizeBytes,
    mediaType: image.mediaType,
    uploadTime: image.uploadTime,
  };
}
export function provenanceListUrl(plan, buildName, image) {
  const invocation = 'https://cloudbuild.googleapis.com/v1/' + buildName;
  const filter =
    'kind="BUILD" AND resourceUri="https://' +
    image.uri +
    '" AND build.inTotoSlsaProvenanceV1.predicate.runDetails.metadata.invocationId="' +
    invocation +
    '"';
  return (
    'https://containeranalysis.googleapis.com/v1/projects/' +
    plan.projectId +
    '/occurrences?filter=' +
    encodeURIComponent(filter) +
    '&pageSize=20'
  );
}
export function completedContext(input) {
  const plan = cloudBuildRequest(input.request, input.projects);
  const context = verifyCompletedCloudBuildContext(input);
  const result = completedBuildImages(
    input.request,
    input.projects,
    input.build,
    input.sourceSha,
    input.now,
  );
  const registry = verifyRegistryRepository(plan, input.registry);
  if (!Array.isArray(input.images) || input.images.length !== 2)
    fail('REGISTRY_IMAGE_INVENTORY_DISAGREES');
  const images = result.images.map((image, index) =>
    verifyRegistryImage(plan, image, input.images[index], input.now),
  );
  return { plan, context, result, registry, images };
}
export function completedResultProof(
  context,
  provenance,
  expectedBuild,
  observedAt,
) {
  if (
    expectedBuild.sourceSha !== context.result.sourceSha ||
    expectedBuild.environment !== context.plan.environment ||
    expectedBuild.configuration?.projectId !== context.plan.projectId ||
    expectedBuild.dirty !== false
  )
    fail('RECOVERY_EXPECTED_INPUTS_DISAGREE');
  return {
    schemaVersion: 1,
    status: 'VERIFIED',
    scope: 'completed-cloud-build-artifacts',
    evidenceSource: 'provided-json',
    environment: context.plan.environment,
    sourceSha: context.result.sourceSha,
    projectId: context.plan.projectId,
    projectNumber: context.plan.projectNumber,
    region: context.plan.region,
    build: context.context.observation.build,
    trigger: context.context.observation.trigger,
    registry: context.registry,
    recipeDigest: context.result.recipeDigest,
    expectedArtifact: {
      applicationVersion: expectedBuild.applicationVersion,
      contractVersion: expectedBuild.contractVersion,
      contractSha256: expectedBuild.contractSha256,
      sourceInputDigest: expectedBuild.sourceInputDigest,
      runtimeInputDigest: expectedBuild.runtimeInputDigest,
      configurationDigest: digest(expectedBuild.configuration),
    },
    images: context.images.map((image, i) => ({
      ...image,
      provenance: provenance[i],
    })),
    ...(observedAt ? { observedAt } : {}),
    limitations: [
      'Provided observations/public keys do not establish live Google authority or reviewed-source acceptance. Expected baked metadata is recomputed from Git, not read from the image filesystem. No human invocation, effective IAM, scanning/SBOM, schema compatibility, rollout or release/client acceptance is established.',
    ],
  };
}
