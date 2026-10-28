import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { isUnicodeScalarText } from '../../src/platform/text/unicode.ts';

// Shared independent wire checker. It does not import application serializers.
export class ConformanceError extends Error {
  operationId;
  rule;
  constructor(operationId, rule) {
    super(`Contract conformance failed: ${operationId} (${rule})`);
    this.operationId = operationId;
    this.rule = rule;
  }
}

export function createWireVerifier(bytes, catalog) {
  catalog = structuredClone(catalog);
  const document = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  const contractSha256 = createHash('sha256').update(bytes).digest('hex');
  if (
    !Array.isArray(catalog) ||
    new Set(catalog.map((item) => item.operationId)).size !== catalog.length ||
    catalog.some(
      (item) =>
        document.paths?.[item.path]?.[item.method.toLowerCase()]
          ?.operationId !== item.operationId,
    )
  )
    throw new Error('Invalid wire operation catalog');
  const operations = new Map(
    catalog.map((operation) => [operation.operationId, operation]),
  );
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormatsModule(ajv);
  ajv.addKeyword({
    keyword: 'x-maxUtf8Bytes',
    type: 'string',
    schemaType: 'number',
    validate: (maximum, value) => Buffer.byteLength(value, 'utf8') <= maximum,
  });
  ajv.addKeyword({
    keyword: 'x-unicodeScalarText',
    type: 'string',
    schemaType: 'boolean',
    validate: (enabled, value) => !enabled || isUnicodeScalarText(value),
  });
  const validators = new Map();
  function check(schema, value) {
    const key = JSON.stringify(schema);
    let validate = validators.get(key);
    if (!validate) {
      validate = ajv.compile({ components: document.components, ...schema });
      validators.set(key, validate);
    }
    return Boolean(validate(value));
  }

  function fail(id, rule) {
    throw new ConformanceError(id, rule);
  }
  function wireOperation(operationId) {
    const planned = operations.get(operationId);
    if (!planned) return fail(operationId, 'UNKNOWN_OPERATION');
    return document.paths[planned.path][planned.method.toLowerCase()];
  }
  function operationFor(method, path) {
    const pathname = path.split('?')[0];
    // Prefer literal routes over parameter routes, just as the HTTP routers do.
    return [...catalog]
      .sort((a, b) => a.path.split('{').length - b.path.split('{').length)
      .find(
        (operation) =>
          operation.method === method.toUpperCase() &&
          new RegExp(
            '^' +
              operation.path
                .split(/(\{[^}]+\})/)
                .map((part) =>
                  part.startsWith('{')
                    ? '[^/]+'
                    : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                )
                .join('') +
              '$',
          ).test(pathname),
      );
  }
  function responseRule(id, status) {
    const operation = wireOperation(id);
    let rule = operation.responses[String(status)];
    if (!rule) return fail(id, 'UNDOCUMENTED_STATUS');
    if (rule.$ref)
      rule = document.components.responses[rule.$ref.split('/').at(-1)];
    if (!rule) return fail(id, 'MISSING_RESPONSE_RULE');
    return rule;
  }
  function header(exchange, id, name, required = true) {
    const entries = Object.entries(exchange.headers).filter(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    if (entries.length === 0 && !required) return undefined;
    if (entries.length !== 1) return fail(id, 'MISSING_OR_DUPLICATE_HEADER');
    const value = entries[0][1];
    if (value === undefined || Array.isArray(value))
      return fail(id, 'MISSING_OR_DUPLICATE_HEADER');
    return String(value);
  }
  function json(id, body) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (bytes.length > 16 * 1024 * 1024) return fail(id, 'JSON_BODY_LIMIT');
    let text;
    let value;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      value = JSON.parse(text);
    } catch {
      return fail(id, 'INVALID_JSON_OR_UTF8');
    }
    // JSON.parse accepts duplicate keys. Check the already syntax-validated token stream too.
    const token =
      /"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:,]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/gy;
    const stack = [];
    let offset = 0;
    let nodes = 0;
    while (offset < text.length) {
      while (/[\t\r\n ]/.test(text[offset] ?? '') && offset < text.length)
        offset++;
      if (offset === text.length) break;
      token.lastIndex = offset;
      const part = token.exec(text)?.[0];
      if (!part || ++nodes > 1_000_000) return fail(id, 'JSON_STRUCTURE_LIMIT');
      offset = token.lastIndex;
      const parent = stack.at(-1);
      if (part === '{' || part === '[') {
        stack.push({
          object: part === '{',
          keys: new Set(),
          expectingKey: part === '{',
        });
        if (stack.length > 64) return fail(id, 'JSON_STRUCTURE_LIMIT');
      } else if (part === '}' || part === ']') stack.pop();
      else if (part === ',' && parent?.object) parent.expectingKey = true;
      else if (part.startsWith('"') && parent?.object && parent.expectingKey) {
        const key = JSON.parse(part);
        if (parent.keys.has(key)) return fail(id, 'DUPLICATE_JSON_KEY');
        parent.keys.add(key);
        parent.expectingKey = false;
      }
    }
    return value;
  }
  function image(bytes, mime) {
    if (mime === 'image/png')
      return bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mime === 'image/jpeg')
      return (
        bytes.length >= 4 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255
      );
    return (
      mime === 'image/webp' &&
      bytes.length >= 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  /** Current producers must declare fields explicitly; historical consumers remain additive. */
  function producerFields(id, schema, value) {
    function active(rule) {
      const result = [];
      if (typeof rule.$ref === 'string') {
        const referenced =
          document.components.schemas[rule.$ref.split('/').at(-1)];
        if (!referenced) return fail(id, 'UNKNOWN_SCHEMA_REFERENCE');
        result.push(...active(referenced));
      }
      result.push(rule);
      for (const child of rule.allOf ?? []) result.push(...active(child));
      for (const kind of ['anyOf', 'oneOf'])
        for (const child of rule[kind] ?? [])
          if (check(child, value)) result.push(...active(child));
      if (rule.if) {
        const branch = check(rule.if, value) ? rule.then : rule.else;
        if (branch) result.push(...active(branch));
      }
      return result;
    }
    const rules = active(schema);
    if (Array.isArray(value)) {
      const items = rules.flatMap((rule) => (rule.items ? [rule.items] : []));
      if (items.length)
        value.forEach((item) => producerFields(id, { allOf: items }, item));
    } else if (value && typeof value === 'object') {
      const properties = new Map();
      let declared = false;
      for (const rule of rules) {
        if (!rule.properties) continue;
        declared = true;
        for (const [key, child] of Object.entries(rule.properties))
          properties.set(key, [...(properties.get(key) ?? []), child]);
      }
      // A schema with no declared properties is an intentional extensible dictionary.
      if (!declared) return;
      for (const [key, child] of Object.entries(value)) {
        const definitions = properties.get(key);
        if (!definitions) return fail(id, 'UNDECLARED_PRODUCER_FIELD');
        producerFields(id, { allOf: definitions }, child);
      }
    }
  }
  /** Independent wire checker used by mocks, real HTTP tests and remote probes. */
  function assertConforms(operationId, exchange) {
    const planned = operations.get(operationId);
    const actual = operationFor(exchange.method, exchange.path);
    const rejectedUnsupportedMethod =
      planned &&
      exchange.status === 405 &&
      !actual &&
      operationFor(planned.method, exchange.path)?.operationId === operationId;
    if (
      !planned ||
      (actual?.operationId !== operationId && !rejectedUnsupportedMethod)
    )
      return fail(operationId, 'METHOD_OR_PATH');
    const rule = responseRule(operationId, exchange.status);
    for (const [name, definition] of Object.entries(rule.headers ?? {})) {
      // Retry hints are conditional; all other declared application response headers are required.
      const value = header(exchange, operationId, name, name !== 'Retry-After');
      if (value !== undefined && !check(definition.schema, value))
        return fail(operationId, 'HEADER_SCHEMA');
    }
    const mime = header(exchange, operationId, 'Content-Type')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const content = rule.content?.[mime];
    if (!content) return fail(operationId, 'CONTENT_TYPE');
    if (mime !== 'application/json') {
      const body = Buffer.isBuffer(exchange.body)
        ? exchange.body
        : Buffer.from(exchange.body, 'binary');
      if (!image(body, mime)) return fail(operationId, 'IMAGE_MAGIC');
      if (
        header(exchange, operationId, 'X-Resource-Version', false) !== undefined
      )
        return fail(operationId, 'PUBLIC_WORKSPACE_VERSION');
      return { binary: true, mime, length: body.length };
    }
    const body = json(operationId, exchange.body);
    if (!check(content.schema, body))
      return fail(operationId, 'RESPONSE_SCHEMA');
    if (
      (exchange.status === 429 ||
        body.error?.code === 'IDEMPOTENCY_IN_PROGRESS') &&
      !header(exchange, operationId, 'Retry-After', false)
    )
      return fail(operationId, 'MISSING_RETRY_AFTER');
    if (body.statusCode !== exchange.status)
      return fail(operationId, 'HTTP_BODY_STATUS');
    if (body.traceId !== header(exchange, operationId, 'X-Trace-ID'))
      return fail(operationId, 'TRACE_AGREEMENT');
    if (
      body.meta.contractVersion !==
      header(exchange, operationId, 'X-API-Contract-Version')
    )
      return fail(operationId, 'CONTRACT_VERSION_AGREEMENT');
    const version = header(exchange, operationId, 'X-Resource-Version', false);
    if (rule.headers?.['X-Resource-Version']) {
      if (
        Number(version) !==
        (body.data?.version ?? body.data?.invitation?.version)
      )
        return fail(operationId, 'RESOURCE_VERSION_AGREEMENT');
    } else if (version !== undefined)
      return fail(operationId, 'UNEXPECTED_WORKSPACE_VERSION');
    if (exchange.status < 300 && planned.idempotent) {
      if (
        !body.meta.idempotency ||
        typeof body.meta.idempotency.replayed !== 'boolean'
      )
        return fail(operationId, 'MISSING_REPLAY_METADATA');
    }
    if (exchange.status < 300 && planned.path.startsWith('/v1/public/')) {
      const privateFields = new Set([
        'email',
        'identityUid',
        'role',
        'clientDraftId',
        'creatorId',
        'createdBy',
        'workflowState',
        'lockVersion',
        'version',
        'workingRevision',
        'workingRevisionId',
        'review',
        'allowedActions',
        'trashedAt',
        'purgeAfter',
        'uploaderId',
        'objectName',
        'generation',
      ]);
      function visit(value) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object')
          for (const [key, part] of Object.entries(value)) {
            if (privateFields.has(key))
              fail(operationId, 'PRIVATE_FIELD_IN_PUBLIC_PROJECTION');
            visit(part);
          }
      }
      visit(body.data);
    }
    producerFields(operationId, content.schema, body);
    return body;
  }

  function assertHealth(exchange) {
    const id =
      exchange.path === '/health/live'
        ? 'getLiveness'
        : exchange.path === '/health/ready'
          ? 'getReadiness'
          : 'unknownHealth';
    const rule = document.paths?.[exchange.path]?.get?.responses?.['200'];
    if (
      exchange.method !== 'GET' ||
      exchange.status !== 200 ||
      !rule ||
      document.paths[exchange.path].get.operationId !== id ||
      !/^application\/json(?:\s*;|$)/i.test(
        header(exchange, id, 'Content-Type'),
      )
    )
      fail(id, 'HEALTH_RESPONSE');
    const body = json(id, exchange.body);
    const schema = rule.content?.['application/json']?.schema;
    if (!schema || !check(schema, body) || body.status !== 'ok')
      fail(id, 'HEALTH_RESPONSE');
    producerFields(id, schema, body);
    return body;
  }
  return Object.freeze({
    assertConforms,
    assertHealth,
    wireOperation,
    operationFor,
    catalog: structuredClone(catalog),
    contractSha256,
  });
}

const current = createWireVerifier(
  readFileSync(new URL('../../contracts/openapi-v1.json', import.meta.url)),
  JSON.parse(
    readFileSync(
      new URL('../../contracts/operation-inventory.json', import.meta.url),
      'utf8',
    ),
  ),
);
export const {
  assertConforms,
  wireOperation,
  operationFor,
  catalog,
  contractSha256,
} = current;
