import { normalizeCloudProfile } from '../../src/platform/config/build-model.ts';
import { expectedArtifactInputs } from '../ci/evidence/inputs.mjs';
import { fail, gitText, jsonAt, sha } from '../ci/policy.mjs';
import { cloudBuildRequest } from './context.mjs';

// Provider observations never choose the repository, project or expected image inputs.
export async function recoveryResultInputs(root, request, sourceSha) {
  sha(sourceSha);
  if (gitText(root, ['status', '--porcelain', '--untracked-files=all']))
    fail('CLEAN_RESULT_VERIFIER_CHECKOUT_REQUIRED');
  const head = sha(gitText(root, ['rev-parse', 'HEAD']));
  const projects = jsonAt(root, head, 'config/cloud-projects.json');
  const repositoryConfig = jsonAt(root, head, 'config/repository.json');
  const plan = cloudBuildRequest(request, projects);
  const builtProjects = jsonAt(root, sourceSha, 'config/cloud-projects.json');
  const builtRepository = jsonAt(root, sourceSha, 'config/repository.json');
  if (
    builtProjects.region !== projects.region ||
    ['projectId', 'projectNumber'].some(
      (key) => builtProjects[plan.environment]?.[key] !== plan[key],
    ) ||
    ['fullName', 'repositoryId', 'ownerId'].some(
      (key) => builtRepository[key] !== repositoryConfig[key],
    )
  )
    fail('RESULT_SOURCE_PROJECT_OR_REPOSITORY_DISAGREES');
  const profile = normalizeCloudProfile(
    jsonAt(
      root,
      sourceSha,
      'config/environments/' + plan.environment + '.json',
    ),
  );
  const selected = projects[plan.environment];
  if (
    profile.environment !== plan.environment ||
    profile.projectId !== plan.projectId ||
    profile.sql.instanceConnectionName.split(':')[1] !== plan.region ||
    profile.apiOrigin !== selected.plannedOrigins.api ||
    profile.webOrigin !== selected.plannedOrigins.web
  )
    fail('RESULT_ACTUAL_PROFILE_DISAGREES');
  const expected = await expectedArtifactInputs(
    root,
    sourceSha,
    plan.environment,
    profile,
  );
  return {
    root,
    head,
    request,
    projects,
    repositoryConfig,
    plan,
    sourceSha,
    expected,
  };
}
