import { cloudRunExpectations } from './cloud-run-config.mjs';
import {
  abortable,
  cancelQuietly,
  discardResponse,
} from './transport-deadline.mjs';

export class RolloutError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export const refuse = (code) => {
  throw new RolloutError(code);
};

// This adapter has no create/delete, generic URL, job or Secret Manager method.
// Credentials are refreshed per request and never stored in the rollout record.
export function cloudRunRolloutClient({
  provenance,
  target,
  getAccessToken,
  fetchImpl = fetch,
}) {
  const { profile, kind } = cloudRunExpectations(provenance, target);
  if (kind !== 'services' || target.resourceId !== 'blogpost-api')
    refuse('API_SERVICE_REQUIRED');
  if (typeof getAccessToken !== 'function') refuse('TOKEN_PROVIDER_REQUIRED');
  const prefix =
    'projects/' + profile.projectId + '/locations/' + target.region;
  const serviceName = prefix + '/services/' + target.resourceId;
  let projectNumber;
  function scoped(name, suffix) {
    return [profile.projectId, projectNumber]
      .filter(Boolean)
      .some(
        (project) =>
          name ===
          'projects/' + project + '/locations/' + target.region + suffix,
      );
  }
  async function request(url, body) {
    const signal = AbortSignal.timeout(15000);
    let response;
    try {
      const payload = body ? JSON.stringify(body) : null;
      if (payload && Buffer.byteLength(payload) > 1048576)
        refuse('PROVIDER_REQUEST_TOO_LARGE');
      const token = await abortable(getAccessToken({ signal }), signal);
      if (
        typeof token !== 'string' ||
        !/^[A-Za-z0-9._~+/=-]{1,4096}$/.test(token)
      )
        refuse('TOKEN_UNAVAILABLE');
      response = await abortable(
        fetchImpl(url, {
          method: body ? 'PATCH' : 'GET',
          headers: {
            authorization: 'Bearer ' + token,
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: payload } : {}),
          redirect: 'error',
          credentials: 'omit',
          signal,
        }),
        signal,
        discardResponse,
      );
      if (
        response.status !== 200 ||
        response.redirected ||
        !response.body ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get('content-type') ?? '',
        )
      )
        refuse('PROVIDER_REQUEST_FAILED');
      const reader = response.body.getReader();
      const abort = () => cancelQuietly(reader);
      signal.addEventListener('abort', abort, { once: true });
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await abortable(reader.read(), signal);
          if (done) break;
          size += value.byteLength;
          if (size > 1048576) {
            refuse('PROVIDER_RESPONSE_TOO_LARGE');
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        signal.removeEventListener('abort', abort);
        cancelQuietly(reader);
        reader.releaseLock();
      }
      const value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
      if (!value || typeof value !== 'object' || Array.isArray(value))
        refuse('PROVIDER_RESPONSE_INVALID');
      return value;
    } catch {
      // Transport/provider diagnostics can contain credentials or private inputs.
      refuse(body ? 'PROVIDER_WRITE_UNCERTAIN' : 'PROVIDER_READ_FAILED');
    } finally {
      discardResponse(response);
    }
  }
  return Object.freeze({
    async project() {
      const value = await request(
        'https://cloudresourcemanager.googleapis.com/v1/projects/' +
          profile.projectId,
      );
      if (
        value.projectId !== profile.projectId ||
        value.lifecycleState !== 'ACTIVE' ||
        !/^[1-9][0-9]{0,18}$/.test(value.projectNumber)
      )
        refuse('PROJECT_MISMATCH');
      if (projectNumber && projectNumber !== value.projectNumber)
        refuse('PROJECT_MISMATCH');
      projectNumber = value.projectNumber;
      return value;
    },
    service() {
      return request('https://run.googleapis.com/v2/' + serviceName);
    },
    revision(name) {
      const id = name?.split('/').at(-1);
      if (
        !/^[a-z][a-z0-9-]{0,62}$/.test(id ?? '') ||
        !scoped(name, '/services/' + target.resourceId + '/revisions/' + id)
      )
        refuse('REVISION_SCOPE_MISMATCH');
      return request('https://run.googleapis.com/v2/' + name);
    },
    operation(name) {
      const id = name?.split('/').at(-1);
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(id ?? '') ||
        !scoped(name, '/operations/' + id)
      )
        refuse('OPERATION_SCOPE_MISMATCH');
      return request('https://run.googleapis.com/v2/' + name);
    },
    patch(body, mask) {
      body = structuredClone(body);
      const keys = Object.keys(body).sort().join(',');
      if (
        !projectNumber ||
        !scoped(body.name, '/services/' + target.resourceId) ||
        typeof body.etag !== 'string' ||
        !body.etag ||
        !(
          (mask === 'template,traffic' &&
            keys === 'etag,name,template,traffic') ||
          (mask === 'traffic' && keys === 'etag,name,traffic')
        )
      )
        refuse('PATCH_SCOPE_MISMATCH');
      if (
        !Array.isArray(body.traffic) ||
        !body.traffic.length ||
        body.traffic.length > 40 ||
        body.traffic.some(
          (item) =>
            !item ||
            item.type !== 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' ||
            typeof item.revision !== 'string' ||
            !/^[a-z][a-z0-9-]{0,62}$/.test(item.revision) ||
            !Number.isInteger(item.percent) ||
            item.percent < 0 ||
            item.percent > 100 ||
            Object.keys(item).some(
              (key) => !['type', 'revision', 'percent', 'tag'].includes(key),
            ) ||
            (item.tag !== undefined &&
              (typeof item.tag !== 'string' ||
                !/^[a-z][a-z0-9-]{0,62}$/.test(item.tag))),
        ) ||
        body.traffic.reduce((sum, item) => sum + item.percent, 0) !== 100
      )
        refuse('PATCH_EXPLICIT_TRAFFIC_REQUIRED');
      const url = new URL('https://run.googleapis.com/v2/' + body.name);
      url.searchParams.set('updateMask', mask);
      url.searchParams.set('allowMissing', 'false');
      return request(url.href, body);
    },
  });
}
