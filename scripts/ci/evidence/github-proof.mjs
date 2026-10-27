import { fail } from '../policy.mjs';
import {
  ALWAYS_JOBS,
  CODE_JOBS,
  evidencePolicy,
  id,
  instant,
  text,
  validateReceipt,
} from './model.mjs';

export function evidenceArtifactName(candidateSha, runId, attempt) {
  return 'backend-staging-' + candidateSha + '-' + runId + '-' + attempt;
}
export function assertTrustedGithubEvidence(
  config,
  receipt,
  run,
  jobsPage,
  artifact,
  now,
  policy,
) {
  receipt = validateReceipt(receipt);
  policy = evidencePolicy(policy);
  const matchesRepository = (repository) =>
    repository &&
    String(repository.id) === config.repositoryId &&
    repository.full_name === config.fullName &&
    String(repository.owner?.id) === config.ownerId;
  if (
    !matchesRepository(run.repository) ||
    !matchesRepository(run.head_repository) ||
    id(run.id) !== receipt.workflowRunId ||
    run.run_attempt !== receipt.workflowRunAttempt ||
    run.event !== 'push' ||
    run.head_branch !== 'rc' ||
    run.head_sha !== receipt.candidateSha ||
    run.path !== '.github/workflows/staging.yml' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    fail('UNTRUSTED_STAGING_RUN');
  const created = instant(run.created_at);
  const updated = instant(run.updated_at);
  const verified = instant(receipt.verifiedAt);
  const started = instant(run.run_started_at);
  if (
    created > verified ||
    verified > updated + policy.clockSkewSeconds * 1000 ||
    updated > now + policy.clockSkewSeconds * 1000 ||
    created > updated ||
    started < created ||
    started > verified ||
    verified > now + policy.clockSkewSeconds * 1000 ||
    instant(receipt.schemaVerification.verifiedAt) < started
  )
    fail('STAGING_RUN_TIME_DISAGREES');
  if (
    !jobsPage ||
    !Number.isInteger(jobsPage.total_count) ||
    jobsPage.total_count < 1 ||
    jobsPage.total_count > 100 ||
    !Array.isArray(jobsPage.jobs) ||
    jobsPage.jobs.length !== jobsPage.total_count
  )
    fail('STAGING_JOBS_INCOMPLETE');
  for (const name of [...ALWAYS_JOBS, ...CODE_JOBS]) {
    const jobs = jobsPage.jobs.filter((job) => job.name === name);
    if (jobs.length !== 1) fail('STAGING_JOB_MISSING_OR_AMBIGUOUS');
    const job = jobs[0];
    if (
      id(job.run_id) !== receipt.workflowRunId ||
      job.run_attempt !== receipt.workflowRunAttempt ||
      job.head_sha !== receipt.candidateSha ||
      job.status !== 'completed' ||
      !(
        job.conclusion === 'success' ||
        (receipt.mode === 'EQUIVALENT_REUSE' &&
          CODE_JOBS.includes(name) &&
          job.conclusion === 'skipped')
      )
    )
      fail('STAGING_JOB_NOT_SUCCESSFUL');
  }
  id(artifact.id);
  if (
    artifact.name !==
      evidenceArtifactName(
        receipt.candidateSha,
        receipt.workflowRunId,
        receipt.workflowRunAttempt,
      ) ||
    artifact.expired !== false ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes < 1 ||
    artifact.size_in_bytes > policy.maxArchiveBytes ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '') ||
    artifact.digest?.length !== 71 ||
    instant(artifact.expires_at) <= now ||
    instant(artifact.created_at) < created ||
    instant(artifact.created_at) > updated + policy.clockSkewSeconds * 1000
  )
    fail('STAGING_ARTIFACT_UNAVAILABLE');
  const source = artifact.workflow_run;
  if (
    !source ||
    id(source.id) !== receipt.workflowRunId ||
    String(source.repository_id) !== config.repositoryId ||
    String(source.head_repository_id) !== config.repositoryId ||
    source.head_branch !== 'rc' ||
    source.head_sha !== receipt.candidateSha
  )
    fail('STAGING_ARTIFACT_RUN_DISAGREES');
  text(run.html_url, /^https:\/\/github\.com\//, 256);
  if (
    run.html_url !==
    'https://github.com/' +
      config.fullName +
      '/actions/runs/' +
      receipt.workflowRunId
  )
    fail('STAGING_RUN_URL_DISAGREES');
  return {
    candidateSha: receipt.candidateSha,
    runId: receipt.workflowRunId,
    runAttempt: receipt.workflowRunAttempt,
    artifactId: id(artifact.id),
    archiveSha256: artifact.digest.slice(7),
  };
}
