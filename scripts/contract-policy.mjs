const stable = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);
const pointer = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1');

// oasdiff handles structural request/response compatibility. These rules protect
// Blogpost semantics that JSON Schema extensions and defaults otherwise omit.
export function schemaPolicyChanges(base, revision) {
  const findings = [];
  const seen = new Set();
  const flag = (id, path) => {
    const key = id + ':' + path;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      id,
      level: 'ERR',
      text: 'Blogpost v1 requires stable defaults and declared input semantics.',
      path,
    });
  };
  const resolve = (spec, schema, visited = new Set()) => {
    if (!object(schema) || !schema.$ref) return schema;
    if (
      !/^#\/components\/schemas\/[^/]+$/.test(schema.$ref) ||
      visited.has(schema.$ref)
    )
      return schema;
    visited.add(schema.$ref);
    const name = schema.$ref
      .split('/')
      .at(-1)
      .replaceAll('~1', '/')
      .replaceAll('~0', '~');
    const target = resolve(spec, spec.components?.schemas?.[name], visited);
    return object(target)
      ? {
          ...target,
          ...Object.fromEntries(
            Object.entries(schema).filter(([key]) => key !== '$ref'),
          ),
        }
      : schema;
  };
  function walk(before, after, path, request = false, refs = new Set()) {
    if (!object(before) || !object(after)) return;
    const pair = [before.$ref, after.$ref].join('|');
    if ((before.$ref || after.$ref) && refs.has(pair)) return;
    const nextRefs = new Set(refs);
    if (before.$ref || after.$ref) nextRefs.add(pair);
    before = resolve(base, before);
    after = resolve(revision, after);
    if (!object(before) || !object(after)) return;
    for (const key of [
      'type',
      'enum',
      'default',
      'format',
      'contentEncoding',
      'contentMediaType',
      'x-unicodeScalarText',
      'x-maxUtf8Bytes',
      'x-maximumInteger',
    ]) {
      if (
        (Object.hasOwn(before, key) || Object.hasOwn(after, key)) &&
        stable(
          Array.isArray(before[key]) && ['enum', 'type'].includes(key)
            ? [...before[key]].sort()
            : before[key],
        ) !==
          stable(
            Array.isArray(after[key]) && ['enum', 'type'].includes(key)
              ? [...after[key]].sort()
              : after[key],
          )
      )
        flag(
          key === 'default'
            ? 'DEFAULT_SEMANTICS_CHANGED'
            : 'SCHEMA_SEMANTICS_CHANGED',
          path + '/' + key,
        );
    }
    for (const [name, property] of Object.entries(before.properties ?? {}))
      walk(
        property,
        after.properties?.[name],
        path + '/properties/' + pointer(name),
        request,
        nextRefs,
      );
    if (request) {
      const required = new Set(after.required ?? []);
      for (const [name, property] of Object.entries(after.properties ?? {}))
        if (
          !Object.hasOwn(before.properties ?? {}, name) &&
          !required.has(name) &&
          !Object.hasOwn(resolve(revision, property) ?? {}, 'default')
        )
          flag(
            'OPTIONAL_INPUT_DEFAULT_REQUIRED',
            path + '/properties/' + pointer(name),
          );
    }
    for (const key of [
      'items',
      'additionalProperties',
      'contains',
      'not',
      'if',
      'then',
      'else',
    ])
      walk(before[key], after[key], path + '/' + key, request, nextRefs);
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems'])
      if (Array.isArray(before[key]) && Array.isArray(after[key]))
        for (
          let i = 0;
          i < Math.min(before[key].length, after[key].length);
          i++
        )
          walk(
            before[key][i],
            after[key][i],
            path + '/' + key + '/' + i,
            request,
            nextRefs,
          );
  }
  for (const [name, schema] of Object.entries(base.components?.schemas ?? {}))
    walk(
      schema,
      revision.components?.schemas?.[name],
      '/components/schemas/' + pointer(name),
    );
  const parameter = (spec, value) =>
    value?.$ref?.startsWith('#/components/parameters/')
      ? spec.components?.parameters?.[value.$ref.split('/').at(-1)]
      : value;
  for (const [path, item] of Object.entries(base.paths ?? {})) {
    for (const method of [
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'head',
      'options',
    ]) {
      const before = item[method],
        after = revision.paths?.[path]?.[method];
      if (!before || !after) continue;
      const location = method.toUpperCase() + ' ' + path;
      const oldParams = [
        ...(item.parameters ?? []),
        ...(before.parameters ?? []),
      ].map((entry) => parameter(base, entry));
      const newParams = [
        ...(revision.paths[path].parameters ?? []),
        ...(after.parameters ?? []),
      ].map((entry) => parameter(revision, entry));
      const sameParameter = (a, b) =>
        a?.in === b?.in &&
        (a?.in === 'header'
          ? a?.name?.toLowerCase() === b?.name?.toLowerCase()
          : a?.name === b?.name);
      for (const old of oldParams) {
        const current = newParams.find((entry) => sameParameter(old, entry));
        if (current)
          walk(
            old.schema,
            current.schema,
            location + '/parameters/' + old.name,
            true,
          );
      }
      for (const entry of newParams)
        if (
          entry?.in === 'query' &&
          !entry.required &&
          !oldParams.some((old) => sameParameter(old, entry)) &&
          !Object.hasOwn(resolve(revision, entry.schema) ?? {}, 'default')
        )
          flag(
            'OPTIONAL_INPUT_DEFAULT_REQUIRED',
            location + '/parameters/' + entry.name,
          );
      for (const [mime, media] of Object.entries(
        before.requestBody?.content ?? {},
      ))
        walk(
          media.schema,
          after.requestBody?.content?.[mime]?.schema,
          location + '/requestBody/' + mime,
          true,
        );
      for (const [status, response] of Object.entries(before.responses ?? {}))
        for (const [mime, media] of Object.entries(response.content ?? {}))
          walk(
            media.schema,
            after.responses?.[status]?.content?.[mime]?.schema,
            location + '/responses/' + status + '/' + mime,
          );
    }
  }
  return findings;
}
