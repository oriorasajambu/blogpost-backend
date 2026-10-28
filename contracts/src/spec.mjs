import {
  array,
  bool,
  enumeration,
  integer,
  ref,
  responseEnvelope,
  schemas,
  slug,
  text,
  uuid,
} from './schemas.mjs';
import { operations } from './operations.mjs';
import metadataRules from '../../src/platform/http/metadata-rules.json' with { type: 'json' };
import {
  errorCodes,
  errorExample,
  requestExample,
  successExample,
} from './examples.mjs';

const metadata = [
  'X-Device-ID',
  'X-Device-OS',
  'X-Device-Version',
  'X-App-Version',
  'X-App-Language',
];
const parameters = Object.fromEntries(
  metadata.map((name) => [
    name,
    {
      in: 'header',
      name,
      required: true,
      description:
        'Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt.',
      schema: {
        ...text(
          name === 'X-Device-ID' ? 36 : name === 'X-Device-OS' ? 32 : 64,
          1,
        ),
      },
    },
  ]),
);
parameters['X-Device-ID'].schema.pattern =
  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
parameters['X-Device-OS'].schema.pattern = '^[A-Z][A-Z0-9_]{0,31}$';
parameters['X-Device-Version'].schema.pattern = metadataRules.printableHeader;
parameters['X-Device-Version'].schema.allOf = [{ pattern: '\\S' }];
parameters['X-App-Version'].schema.pattern = metadataRules.semver;
parameters['X-App-Language'].schema.pattern = metadataRules.language;
parameters['X-App-Version'].description +=
  ' Strict SemVer with optional build metadata.';
parameters['X-App-Language'].description +=
  ' One well-formed BCP 47 language tag, including valid unsupported languages.';
parameters.ExpectedVersion = {
  in: 'header',
  name: 'X-Expected-Version',
  required: true,
  description:
    'Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks.',
  schema: {
    type: 'string',
    pattern: '^[1-9][0-9]{0,9}$',
    'x-maximumInteger': 2147483647,
  },
};
parameters.IdempotencyKey = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  description:
    'UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours.',
  schema: parameters['X-Device-ID'].schema,
};
parameters.Traceparent = {
  in: 'header',
  name: 'traceparent',
  required: false,
  description:
    'W3C trace context. Invalid/all-zero context is replaced, never used for authorization.',
  schema: text(512),
};

const responseHeaders = {
  'X-Trace-ID': {
    schema: { ...text(32, 32), pattern: '^[a-f0-9]{32}$' },
    description: 'Matches the envelope traceId.',
  },
  'X-API-Contract-Version': { schema: { type: 'string', const: '1.0.0' } },
  'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
  'X-Content-Type-Options': { schema: { type: 'string', const: 'nosniff' } },
};
const query = (name, schema, required = false, extra = {}) => ({
  name,
  in: 'query',
  required,
  schema,
  ...extra,
});
export function operationParameters(operation) {
  const result = metadata.map((name) => ({
    $ref: `#/components/parameters/${name}`,
  }));
  result.push({ $ref: '#/components/parameters/Traceparent' });
  for (const [, name] of operation.path.matchAll(/\{([^}]+)\}/g))
    result.push({
      name,
      in: 'path',
      required: true,
      schema:
        name === 'variant'
          ? ref('VariantName')
          : name === 'slug' || name === 'handle'
            ? slug
            : uuid,
    });
  if (operation.expectedVersion)
    result.push({ $ref: '#/components/parameters/ExpectedVersion' });
  if (operation.idempotent)
    result.push({ $ref: '#/components/parameters/IdempotencyKey' });
  if (operation.collection === 'cursor')
    result.push(
      query('cursor', text(2048, 1)),
      query('pageSize', { ...integer(1, 50), default: 20 }),
    );
  if (operation.collection === 'page')
    result.push(
      query('page', { ...integer(1), default: 1 }),
      query('pageSize', {
        ...integer(1, 50),
        default: operation.taxonomy ? 50 : 20,
      }),
    );
  if (operation.publicFilters)
    result.push(
      query('categoryId', uuid),
      query('authorId', uuid),
      query('tagIds', { ...array(uuid, 5), uniqueItems: true }, false, {
        style: 'form',
        explode: true,
        description: 'Repeated tagIds values use AND semantics.',
      }),
    );
  if (operation.search)
    result.push(query('q', { ...text(200, 1), pattern: '\\S' }, true));
  if (operation.workspace)
    result.push(
      query('scope', { ...enumeration('OWN', 'ALL'), default: 'OWN' }),
      query('publicationState', ref('PublicationState')),
      query('workflowState', ref('WorkflowState')),
      query('trashed', { ...bool, default: false }),
    );
  if (operation.managed) result.push(query('active', bool));
  if (operation.members)
    result.push(query('role', ref('Role')), query('active', bool));
  if (operation.invitations)
    result.push(query('status', ref('InvitationStatus')));
  if (operation.audit)
    result.push(
      query('subjectType', text(40, 1)),
      query('subjectId', uuid),
      query('action', text(80, 1)),
    );
  return result;
}

const health = (id, ready = false) => ({
  operationId: id,
  security: [],
  'x-runtime-implemented': true,
  responses: Object.fromEntries(
    (ready ? [200, 503] : [200]).map((status) => [
      status,
      {
        description:
          status === 200 ? 'Healthy' : 'SQL unavailable or incompatible schema',
        content: {
          'application/json': {
            schema: ref('Health'),
            example: { status: status === 200 ? 'ok' : 'unavailable' },
          },
        },
      },
    ]),
  ),
});

export function buildSpec() {
  const document = {
    openapi: '3.1.2',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Blogpost REST API',
      version: '1.0.0',
      description:
        'Unreleased design-first contract for the full v1 catalog. DRAFT: schema coverage does not imply backend implementation, frozen client kickoff or release readiness. Public/media responses are no-store. Unknown request body/query fields are rejected; responses allow additive fields.',
    },
    'x-contract-status': 'DRAFT',
    'x-contract-source': 'contracts/src/spec.mjs',
    'x-transport-rules': {
      ambiguousCredentials: 'REJECT',
      expectedVersion: 'POSITIVE_INT32',
      idempotencyTtlSeconds: 86400,
      invitationReplay: 'RECEIPT_WITHOUT_SECRET',
      unavailablePrivateResource: 404,
      unknownRequestFields: 'REJECT',
      unknownResponseFields: 'IGNORE',
      maxJsonBodyBytes: 1048576,
      maxValidationIssues: 50,
    },
    servers: [
      {
        url: 'http://localhost:8080',
        description:
          'Local real API; only implemented operations are available.',
      },
      {
        url: 'http://localhost:4010',
        description:
          'Separate local stateful mock behind Prism; synthetic credentials only.',
      },
    ],
    paths: {
      '/health/live': { get: health('getLiveness') },
      '/health/ready': { get: health('getReadiness', true) },
    },
    components: {
      schemas: structuredClone(schemas),
      responses: {},
      parameters,
      securitySchemes: {
        IdentityPlatformToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Identity Platform ID token',
          description:
            'Verified Google provider, email, signature, issuer/audience, expiry/revocation. Raw Google OAuth ID tokens are invalid. Current SQL membership/visibility is checked on protected operations.',
        },
        WebSession: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Blogpost-Web-Session',
          description:
            'Verified five-day Identity Platform session cookie forwarded by the server proxy only. Never combine with Authorization. Current SQL membership is authoritative.',
        },
      },
    },
  };
  for (const operation of operations) {
    const successStatus = operation.status ?? 200;
    const envelopeName =
      operation.operationId === 'getApiMeta'
        ? 'MetaEnvelope'
        : `${operation.operationId[0].toUpperCase()}${operation.operationId.slice(1)}Envelope`;
    if (!operation.binary)
      document.components.schemas[envelopeName] = responseEnvelope(
        operation.collection || operation.array
          ? array(ref(operation.data), 50)
          : ref(operation.data),
        successStatus,
        operation.collection,
        operation.idempotent,
      );
    const headers = structuredClone(responseHeaders);
    if (operation.resourceVersion)
      headers['X-Resource-Version'] = {
        schema: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
        description:
          'Committed version, including the original version on replay. No workspace version on public snapshots.',
      };
    if (operation.location)
      headers.Location = {
        schema: { type: 'string', pattern: '^/v1/' },
        description: 'Backend-relative path of the created resource.',
      };
    const responses = {
      [successStatus]: {
        description: operation.binary
          ? 'Validated image bytes; access checked on every request.'
          : `${operation.collection || operation.array ? 'Array of ' : ''}${operation.data}`,
        headers,
        content: operation.binary
          ? Object.fromEntries(
              ['image/jpeg', 'image/png', 'image/webp'].map((mime) => [
                mime,
                {
                  schema: { type: 'string', format: 'binary' },
                  ...(mime === 'image/png'
                    ? { 'x-fixture-path': 'contracts/fixtures/media/pixel.png' }
                    : {}),
                },
              ]),
            )
          : {
              'application/json': {
                schema: ref(envelopeName),
                examples: {
                  success: { value: successExample(operation) },
                  ...(operation.collection
                    ? { empty: { value: successExample(operation, []) } }
                    : {}),
                  ...(operation.idempotent
                    ? {
                        replay: {
                          value: (() => {
                            const value = successExample(operation);
                            value.meta.idempotency.replayed = true;
                            if (operation.data === 'InvitationIssueResult') {
                              value.data.inviteUrl = null;
                              value.data.linkAvailable = false;
                            }
                            return value;
                          })(),
                        },
                      }
                    : {}),
                },
              },
            },
      },
    };
    const statuses = new Set([
      400, 401, 404, 405, 413, 415, 422, 429, 500, 503, 504, 410,
    ]);
    if (operation.access !== 'ANONYMOUS') {
      statuses.add(401);
      statuses.add(403);
      // Refreshed verified email reconciliation can exhaust the member version,
      // including on protected reads and session exchange.
      statuses.add(409);
    }
    if (operation.idempotent) statuses.add(409);
    if (operation.expectedVersion) {
      statuses.add(412);
      statuses.add(428);
    }
    for (const status of [...statuses].sort((a, b) => a - b)) {
      const errorHeaders = structuredClone(responseHeaders);
      if ([409, 429, 503].includes(status))
        errorHeaders['Retry-After'] = {
          schema: { type: 'string', pattern: '^[0-9]+$' },
          description:
            'Delay in seconds when retry is appropriate; in-progress writes preserve key/input.',
        };
      if (status === 405) errorHeaders.Allow = { schema: text(120, 1) };
      const codes = errorCodes[status].filter(
        (code) =>
          status !== 410 ||
          operation.invitation ||
          code === 'API_VERSION_RETIRED',
      );
      const responseName = `Error${status}${status === 410 && operation.invitation ? 'Invitation' : ''}`;
      document.components.responses[responseName] ??= {
        description: codes.join(', '),
        headers: errorHeaders,
        content: {
          'application/json': {
            schema: ref('ErrorEnvelope'),
            examples: Object.fromEntries(
              codes.map((code) => [
                code,
                { value: errorExample(status, code) },
              ]),
            ),
          },
        },
      };
      responses[status] = { $ref: `#/components/responses/${responseName}` };
    }
    const value = {
      operationId: operation.operationId,
      tags: [operation.path.split('/')[2] ?? 'meta'],
      parameters: operationParameters(operation),
      security: ['ANONYMOUS', 'RECENT_IDENTITY'].includes(operation.access)
        ? []
        : [{ IdentityPlatformToken: [] }, { WebSession: [] }],
      'x-access': operation.access,
      'x-runtime-implemented': operation.implemented ?? false,
      'x-idempotency-required': operation.idempotent ?? false,
      'x-expected-version-required': operation.expectedVersion ?? false,
      'x-success-schema': operation.binary ? null : envelopeName,
      'x-request-example': requestExample(operation),
      ...(operation.serverProxyOnly ? { 'x-server-proxy-only': true } : {}),
      ...(operation.body
        ? {
            requestBody: {
              required: true,
              content: {
                [operation.upload ? 'multipart/form-data' : 'application/json']:
                  {
                    schema: ref(operation.body),
                    examples: {
                      valid: { value: requestExample(operation).body },
                    },
                  },
              },
            },
          }
        : {}),
      responses,
    };
    (document.paths[operation.path] ??= {})[operation.method] = value;
  }
  return document;
}
