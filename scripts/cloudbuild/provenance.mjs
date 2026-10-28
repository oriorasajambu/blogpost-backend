import { createHash, createPublicKey, verify } from 'node:crypto';
import { digest } from '../../src/platform/config/build-model.ts';
import { fail } from '../ci/policy.mjs';
import { uniqueJson } from '../ci/evidence/unique-json.mjs';
import { cloudBuildTime } from './context.mjs';
import { recoveryRecipe } from './recipe.mjs';

const payloadType = 'application/vnd.in-toto+json';
const keyPattern =
  /^projects\/verified-builder\/locations\/global\/keyRings\/attestor\/cryptoKeys\/google-hosted-worker\/cryptoKeyVersions\/[1-9][0-9]{0,5}$/;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const object = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_BUILD_PROVENANCE');
  return value;
};
const exact = (value, pattern, maximum = 1024) =>
  typeof value === 'string' &&
  value.length <= maximum &&
  pattern.exec(value)?.[0] === value;
export function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0x82f63b78 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function base64(value, maximum) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > maximum ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)
  )
    fail('INVALID_PROVENANCE_ENCODING');
  const encoding = /[-_]/.test(value) ? 'base64url' : 'base64';
  if (encoding === 'base64url' && /[+/]/.test(value))
    fail('INVALID_PROVENANCE_ENCODING');
  const bytes = Buffer.from(value, encoding);
  if (bytes.toString(encoding).replace(/=+$/, '') !== value.replace(/=+$/, ''))
    fail('INVALID_PROVENANCE_ENCODING');
  return bytes;
}
export function provenanceKeyNames(envelope) {
  object(envelope);
  if (
    envelope.payloadType !== payloadType ||
    !Array.isArray(envelope.signatures) ||
    !envelope.signatures.length ||
    envelope.signatures.length > 4
  )
    fail('SIGNED_GOOGLE_BUILD_PROVENANCE_REQUIRED');
  const seen = new Set(),
    names = [];
  for (const signature of envelope.signatures) {
    object(signature);
    if (
      !exact(signature.keyid, /^[\x21-\x7e]{1,512}$/, 512) ||
      seen.has(signature.keyid)
    )
      fail('INVALID_PROVENANCE_SIGNATURE_ID');
    seen.add(signature.keyid);
    base64(signature.sig, 2048);
    if (exact(signature.keyid, keyPattern, 512)) names.push(signature.keyid);
  }
  if (!names.length) fail('SIGNED_GOOGLE_BUILD_PROVENANCE_REQUIRED');
  return names;
}
function keyObject(name, response) {
  object(response);
  if (
    response.name !== name ||
    response.algorithm !== 'EC_SIGN_P256_SHA256' ||
    !exact(
      response.pem,
      /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/,
      4096,
    ) ||
    !exact(response.pemCrc32c, /^(?:0|[1-9][0-9]{0,9})$/, 10) ||
    Number(response.pemCrc32c) !== crc32c(Buffer.from(response.pem))
  )
    fail('INVALID_GOOGLE_BUILD_PUBLIC_KEY');
  try {
    const key = createPublicKey(response.pem);
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    )
      fail('INVALID_GOOGLE_BUILD_PUBLIC_KEY');
    return {
      key,
      fingerprint: hash(key.export({ type: 'spki', format: 'der' })),
    };
  } catch {
    fail('INVALID_GOOGLE_BUILD_PUBLIC_KEY');
  }
}
export function verifyProvenanceEnvelope(envelope, keys) {
  const names = provenanceKeyNames(envelope);
  const bytes = base64(envelope.payload, 2796204);
  if (bytes.length > 2097152) fail('BUILD_PROVENANCE_SIZE_LIMIT');
  const pae = Buffer.concat([
    Buffer.from(
      'DSSEv1 ' +
        Buffer.byteLength(payloadType) +
        ' ' +
        payloadType +
        ' ' +
        bytes.length +
        ' ',
    ),
    bytes,
  ]);
  const signatures = [];
  for (const name of names) {
    const key = keyObject(name, object(keys)[name]);
    let valid = false;
    try {
      valid = verify(
        'sha256',
        pae,
        key.key,
        base64(
          envelope.signatures.find((item) => item.keyid === name).sig,
          2048,
        ),
      );
    } catch {
      fail('INVALID_BUILD_PROVENANCE_SIGNATURE');
    }
    if (!valid) fail('INVALID_BUILD_PROVENANCE_SIGNATURE');
    signatures.push({ keyName: name, publicKeySha256: key.fingerprint });
  }
  let statement;
  try {
    statement = uniqueJson(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    fail('INVALID_SIGNED_PROVENANCE_JSON');
  }
  return {
    statement,
    signatures,
    payloadSha256: hash(bytes),
    envelopeSha256: digest(envelope),
  };
}
function repositoryUris(fullName) {
  return [
    'git+https://github.com/' + fullName,
    'git+https://github.com/' + fullName + '.git',
  ];
}
function checkSubstitutions(values, context, external) {
  object(values);
  const { plan, result } = context,
    repo = context.context.repositoryFullName;
  const branchRef = 'refs/heads/' + plan.branch;
  const refValues = ['', plan.branch, branchRef, result.sourceSha];
  const accepted = {
    BUILD_ID: [plan.buildId],
    LOCATION: [plan.region],
    PROJECT_ID: [plan.projectId],
    PROJECT_NUMBER: [plan.projectNumber],
    COMMIT_SHA: ['', result.sourceSha],
    REVISION_ID: ['', result.sourceSha],
    SHORT_SHA: ['', result.sourceSha.slice(0, 7)],
    BRANCH_NAME: ['', plan.branch],
    REF_NAME: refValues,
    REPO_FULL_NAME: ['', repo],
    REPO_OWNER: ['', repo.split('/')[0]],
    REPO_NAME: [
      '',
      repo,
      repo.split('/')[1],
      result.connectedRepository,
      result.connectedRepository.split('/').at(-1),
    ],
    TRIGGER_NAME: ['', 'blogpost-backend-manual'],
    TRIGGER_BUILD_CONFIG_PATH: ['', 'cloudbuild.yaml', '/cloudbuild.yaml'],
    TAG_NAME: [''],
    SERVICE_ACCOUNT_EMAIL: ['', plan.serviceAccount],
    SERVICE_ACCOUNT: [
      '',
      ...[plan.projectId, plan.projectNumber].map(
        (project) =>
          'projects/' + project + '/serviceAccounts/' + plan.serviceAccount,
      ),
    ],
    ...(external ? { _APP_ENV: [plan.environment] } : {}),
  };
  if (
    Object.keys(values).some(
      (key) =>
        !Object.hasOwn(accepted, key) || !accepted[key].includes(values[key]),
    )
  )
    fail('SIGNED_BUILD_SUBSTITUTIONS_DISAGREE');
  if (external && values._APP_ENV !== plan.environment)
    fail('SIGNED_BUILD_ENVIRONMENT_REQUIRED');
  if (
    !external &&
    ['BUILD_ID', 'LOCATION', 'PROJECT_NUMBER'].some(
      (key) => !Object.hasOwn(values, key),
    )
  )
    fail('SIGNED_BUILD_IDENTITY_REQUIRED');
}
function imageReference(value) {
  if (!exact(value, /^[\x21-\x7e]+$/, 1024) || /[?#]/.test(value))
    fail('UNAPPROVED_SIGNED_BUILD_DEPENDENCY');
  let ref = value.replace(/^(?:docker:\/\/|https:\/\/)/, '');
  const parts = ref.split('@');
  if (parts.length > 2 || (parts[1] && !/^sha256:[a-f0-9]{64}$/.test(parts[1])))
    fail('UNAPPROVED_SIGNED_BUILD_DEPENDENCY');
  ref = parts[0];
  if (!ref.includes('/')) ref = 'docker.io/library/' + ref;
  ref = ref.replace(/^index\.docker\.io\//, 'docker.io/');
  return { name: ref, pin: parts[1] };
}
export function verifySignedBuildOccurrence({
  occurrence,
  keys,
  context,
  image,
  build,
  now = Date.now(),
}) {
  object(occurrence);
  const { plan, result } = context;
  const prefix = 'projects/' + plan.projectId + '/occurrences/';
  if (
    !exact(
      occurrence.name,
      /^projects\/[a-z][a-z0-9-]+\/occurrences\/[A-Za-z0-9_-]{1,128}$/,
      300,
    ) ||
    !occurrence.name.startsWith(prefix) ||
    occurrence.kind !== 'BUILD' ||
    occurrence.resourceUri !== 'https://' + image.uri
  )
    fail('PROVENANCE_OCCURRENCE_DISAGREES');
  const created = cloudBuildTime(occurrence.createTime),
    updated = cloudBuildTime(occurrence.updateTime);
  if (
    created < cloudBuildTime(build.startTime) - 300000 ||
    created > now + 300000 ||
    updated < created ||
    updated > now + 300000
  )
    fail('PROVENANCE_OCCURRENCE_TIME_DISAGREES');
  const verified = verifyProvenanceEnvelope(occurrence.envelope, keys),
    statement = object(verified.statement);
  const definition = object(statement.predicate?.buildDefinition),
    details = object(statement.predicate?.runDetails);
  if (
    statement._type !== 'https://in-toto.io/Statement/v1' ||
    statement.predicateType !== 'https://slsa.dev/provenance/v1' ||
    definition.buildType !==
      'https://cloud.google.com/build/gcb-buildtypes/google-worker/v1' ||
    details.builder?.id !==
      'https://cloudbuild.googleapis.com/GoogleHostedWorker'
  )
    fail('UNAPPROVED_SIGNED_BUILD_TYPE');
  const invocation = 'https://cloudbuild.googleapis.com/v1/' + result.buildName;
  const metadata = object(details.metadata);
  if (metadata.invocationId !== invocation)
    fail('SIGNED_BUILD_INVOCATION_DISAGREES');
  const start = cloudBuildTime(metadata.startedOn),
    finish = cloudBuildTime(metadata.finishedOn);
  if (
    Math.abs(start - cloudBuildTime(build.startTime)) > 300000 ||
    finish < start ||
    Math.abs(finish - cloudBuildTime(build.finishTime)) > 300000
  )
    fail('SIGNED_BUILD_TIME_DISAGREES');
  const external = object(definition.externalParameters),
    internal = object(definition.internalParameters);
  if (
    Object.keys(external).some(
      (key) =>
        !['buildConfigSource', 'sourceToBuild', 'substitutions'].includes(key),
    ) ||
    Object.keys(internal).some(
      (key) => !['systemSubstitutions', 'triggerUri'].includes(key),
    )
  )
    fail('UNAPPROVED_SIGNED_BUILD_PARAMETERS');
  const sourceUris = repositoryUris(context.context.repositoryFullName),
    refs = ['refs/heads/' + plan.branch, result.sourceSha];
  const source = object(external.buildConfigSource);
  if (
    !sourceUris.includes(source.repository) ||
    !refs.includes(source.ref) ||
    !['cloudbuild.yaml', '/cloudbuild.yaml'].includes(source.path) ||
    source.pathAutoDetect ||
    Object.keys(source).some(
      (key) => !['repository', 'ref', 'path', 'pathAutoDetect'].includes(key),
    )
  )
    fail('SIGNED_RECIPE_SOURCE_DISAGREES');
  if (external.sourceToBuild !== undefined) {
    const source = object(external.sourceToBuild);
    if (
      !sourceUris.includes(source.repository) ||
      !refs.includes(source.ref) ||
      source.dir ||
      Object.keys(source).some(
        (key) => !['repository', 'ref', 'dir'].includes(key),
      )
    )
      fail('SIGNED_APPLICATION_SOURCE_DISAGREES');
  }
  if (
    ![plan.projectId, plan.projectNumber].some(
      (project) =>
        internal.triggerUri ===
        result.triggerName.replace(
          'projects/' + plan.projectId + '/',
          'projects/' + project + '/',
        ),
    )
  )
    fail('SIGNED_TRIGGER_DISAGREES');
  checkSubstitutions(external.substitutions, context, true);
  checkSubstitutions(internal.systemSubstitutions, context, false);
  if (
    !Array.isArray(statement.subject) ||
    !statement.subject.length ||
    statement.subject.length > 4
  )
    fail('SIGNED_IMAGE_SUBJECT_REQUIRED');
  let found = false;
  for (const subject of statement.subject) {
    object(subject);
    const names = context.images.filter((expected) =>
      [expected.uri.split('@')[0], expected.tag].some(
        (name) => subject.name === 'https://' + name,
      ),
    );
    if (
      names.length !== 1 ||
      !subject.digest ||
      Object.keys(subject.digest).join(',') !== 'sha256' ||
      subject.digest.sha256 !== names[0].digest.slice(7)
    )
      fail('SIGNED_IMAGE_SUBJECT_DISAGREES');
    if (names[0].name === image.name) found = true;
  }
  if (!found) fail('SIGNED_IMAGE_SUBJECT_REQUIRED');
  if (
    !Array.isArray(definition.resolvedDependencies) ||
    !definition.resolvedDependencies.length ||
    definition.resolvedDependencies.length > 8
  )
    fail('SIGNED_SOURCE_DEPENDENCY_REQUIRED');
  const stepRefs = recoveryRecipe(plan).steps.map((step) =>
    imageReference(step.name),
  );
  const steps = new Set();
  let repositoryCount = 0;
  for (const dependency of definition.resolvedDependencies) {
    object(dependency);
    object(dependency.digest);
    if (
      typeof dependency.uri === 'string' &&
      dependency.uri.startsWith('git+')
    ) {
      const allowed = sourceUris.flatMap((uri) => [
        uri,
        ...refs.map((ref) => uri + '@' + ref),
      ]);
      const names = Object.keys(dependency.digest);
      if (
        !allowed.includes(dependency.uri) ||
        !names.length ||
        names.some(
          (name) =>
            !['gitCommit', 'sha1'].includes(name) ||
            dependency.digest[name] !== result.sourceSha,
        )
      )
        fail('SIGNED_SOURCE_DEPENDENCY_DISAGREES');
      repositoryCount++;
    } else {
      const actual = imageReference(dependency.uri);
      const matches = stepRefs
        .map((expected, index) => ({ expected, index }))
        .filter(({ expected, index }) => {
          const acceptable = new Set(
            [expected.pin, build.results.buildStepImages[index]].filter(
              Boolean,
            ),
          );
          const nameMatches =
            actual.name === expected.name ||
            (expected.pin &&
              actual.name === expected.name.replace(/:[^/:]+$/, ''));
          return (
            nameMatches &&
            Object.keys(dependency.digest).join(',') === 'sha256' &&
            acceptable.has('sha256:' + dependency.digest.sha256) &&
            (!actual.pin || acceptable.has(actual.pin))
          );
        });
      if (matches.length !== 1) fail('UNAPPROVED_SIGNED_BUILD_DEPENDENCY');
      steps.add(matches[0].index);
    }
  }
  if (!repositoryCount || !steps.has(0) || !steps.has(1))
    fail('SIGNED_SOURCE_DEPENDENCY_REQUIRED');
  return {
    occurrence: occurrence.name,
    predicateType: statement.predicateType,
    builder: details.builder.id,
    invocationId: invocation,
    sourceSha: result.sourceSha,
    recipePath: 'cloudbuild.yaml',
    subject: image.uri,
    payloadSha256: verified.payloadSha256,
    envelopeSha256: verified.envelopeSha256,
    signatures: verified.signatures,
    keyAuthority: 'provided-public-key',
    startedOn: metadata.startedOn,
    finishedOn: metadata.finishedOn,
  };
}
