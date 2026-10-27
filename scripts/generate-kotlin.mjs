import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { format } from 'prettier';
import {
  execute,
  installGenerator,
  javaExecutable,
  root,
  toolchain,
} from './kotlin-tools.mjs';

const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check'))
  throw new Error('Usage: npm run contract:kotlin [-- --check]');
const sourceBytes = await readFile(join(root, 'contracts/openapi-v1.json'));
const canonical = JSON.parse(sourceBytes);
function bundledReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref && !value.$ref.startsWith('#/components/'))
    throw new Error(
      'Kotlin generation accepts bundled internal references only.',
    );
  Object.values(value).forEach(bundledReferences);
}
bundledReferences(canonical);
const inventory = JSON.parse(
  await readFile(join(root, 'contracts/operation-inventory.json'), 'utf8'),
);
const projection = structuredClone(canonical);
const requestSchemas = new Set();
function collectInput(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1);
    if (requestSchemas.has(name)) return;
    requestSchemas.add(name);
    collectInput(projection.components.schemas[name]);
  }
  for (const [key, value] of Object.entries(schema))
    if (key !== '$ref') {
      if (Array.isArray(value)) value.forEach(collectInput);
      else if (value && typeof value === 'object') collectInput(value);
    }
}
for (const item of inventory) {
  const operation = projection.paths[item.path][item.method.toLowerCase()];
  collectInput(operation.requestBody?.content?.['application/json']?.schema);
}
for (const name of requestSchemas) {
  const schema = projection.components.schemas[name];
  for (const [key, value] of Object.entries(schema.properties ?? {}))
    if (!(schema.required ?? []).includes(key)) delete value.default;
}
// This is a consumer representation, never a change to the canonical wire schema.
// The runtime validator below retains the original constraints and union semantics.
const pagination =
  projection.components.schemas.ResponseMeta.properties.pagination;
Object.keys(pagination).forEach((key) => delete pagination[key]);
Object.assign(pagination, {
  anyOf: [{ $ref: '#/components/schemas/WirePagination' }, { type: 'null' }],
});
projection.components.schemas.WirePagination = {
  type: 'object',
  required: ['kind', 'pageSize', 'hasMore'],
  properties: {
    kind: { type: 'string' },
    pageSize: { type: 'integer' },
    hasMore: { type: 'boolean' },
    nextCursor: { type: 'string', nullable: true },
    page: { type: 'integer', nullable: true },
    totalItems: { type: 'integer', nullable: true },
    totalPages: { type: 'integer', nullable: true },
    truncated: { type: 'boolean', nullable: true },
  },
};
function adapt(value) {
  if (Array.isArray(value)) return value.map(adapt);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, part]) => [
      key,
      ['anyOf', 'oneOf'].includes(key)
        ? part.map((choice) =>
            choice.type === 'null' ? choice : adapt(choice),
          )
        : adapt(part),
    ]),
  );
  if (result.type === 'null')
    return { type: ['object', 'null'], additionalProperties: true };
  delete result.const;
  if (result.allOf) {
    result.allOf = result.allOf.filter((part) => !part.if);
    if (!result.allOf.length) delete result.allOf;
  }
  return result;
}
for (const [path, methods] of Object.entries(projection.paths))
  if (!path.startsWith('/v1/')) delete projection.paths[path];
const modelInput = adapt(projection);
const validationKeys = new Set([
  '$ref',
  'type',
  'properties',
  'required',
  'items',
  'additionalProperties',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'contains',
  'minContains',
  'maxContains',
  'minProperties',
  'maxProperties',
  'uniqueItems',
  'allOf',
  'anyOf',
  'oneOf',
  'if',
  'then',
  'else',
  'not',
  'x-maxUtf8Bytes',
  'x-unicodeScalarText',
]);
const schemaAnnotations = new Set([
  'default',
  'description',
  'title',
  'example',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'x-server-proxy-only',
  '$id',
  '$schema',
]);
function wireRule(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(wireRule);
  for (const key of Object.keys(schema)) {
    if (!validationKeys.has(key) && !schemaAnnotations.has(key))
      throw new Error(`Unsupported Kotlin wire-validation keyword: ${key}`);
  }
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => validationKeys.has(key))
      .map(([key, value]) => [
        key,
        key === 'properties'
          ? Object.fromEntries(
              Object.entries(value).map(([name, property]) => [
                name,
                wireRule(property),
              ]),
            )
          : Array.isArray(value)
            ? value.map((part) =>
                typeof part === 'object' ? wireRule(part) : part,
              )
            : value && typeof value === 'object'
              ? wireRule(value)
              : value,
      ]),
  );
}
const rules = {
  contractVersion: canonical.info.version,
  schemas: Object.fromEntries(
    Object.entries(canonical.components.schemas).map(([name, schema]) => [
      name,
      wireRule(schema),
    ]),
  ),
  operations: Object.fromEntries(
    inventory.map((item) => {
      const operation = canonical.paths[item.path][item.method.toLowerCase()];
      const status = Object.keys(operation.responses).find((status) =>
        /^2[0-9][0-9]$/.test(status),
      );
      const success = operation.responses[status].content;
      return [
        item.operationId,
        {
          ...item,
          status: Number(status),
          binary: !success['application/json'],
          resourceVersion: Object.hasOwn(
            operation.responses[status].headers ?? {},
            'X-Resource-Version',
          ),
          request: operation.requestBody?.content?.['application/json']?.schema
            ? wireRule(operation.requestBody.content['application/json'].schema)
            : null,
          response: success['application/json']
            ? wireRule(success['application/json'].schema)
            : null,
        },
      ];
    }),
  ),
};
const configuration = {
  generatorName: 'kotlin',
  library: 'jvm-retrofit2',
  typeMappings: { UUID: 'kotlin.String' },
  additionalProperties: {
    serializationLibrary: 'gson',
    useCoroutines: true,
    useResponseAsReturnType: true,
    enumUnknownDefaultCase: true,
    enumPropertyNaming: 'UPPERCASE',
    modelMutable: false,
    dateLibrary: 'string',
    hideGenerationTimestamp: true,
    packageName: 'com.blogpost.contract.generated',
    apiPackage: 'com.blogpost.contract.generated.api',
    modelPackage: 'com.blogpost.contract.generated.model',
  },
};
const temporaryRoot = join(root, '.local/kotlin-generation');
const temporary = join(temporaryRoot, randomUUID());
const output = join(root, 'contracts/generated/kotlin');
async function files(directory) {
  try {
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error('Generated output must not contain symbolic links.');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw new Error('Generated output must not contain symbolic links.');
    const path = join(directory, entry.name);
    result.push(...(entry.isDirectory() ? await files(path) : [path]));
  }
  return result;
}
await mkdir(temporary, { recursive: true });
try {
  const input = join(temporary, 'input.json');
  const config = join(temporary, 'config.json');
  await writeFile(input, JSON.stringify(modelInput));
  await writeFile(config, JSON.stringify(configuration));
  const generated = join(temporary, 'generated');
  const java = await javaExecutable();
  const jar = await installGenerator();
  let result;
  try {
    result = await execute(
      java,
      [
        '-Xmx512m',
        '-jar',
        jar,
        'generate',
        '-i',
        relative(root, input).replaceAll('\\', '/'),
        '-c',
        config,
        '-t',
        join(root, 'tools/kotlin/templates'),
        '--global-property',
        'models,apis,supportingFiles=CollectionFormats.kt,modelDocs=false,apiDocs=false,modelTests=false,apiTests=false',
        '-o',
        generated,
      ],
      {
        cwd: root,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    );
  } catch (error) {
    const details = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    await writeFile(join(root, '.local/kotlin-generator.log'), details);
    throw new Error(
      `Kotlin generation failed; see .local/kotlin-generator.log.\n${details.slice(-1800)}`,
    );
  }
  await writeFile(
    join(root, '.local/kotlin-generator.log'),
    result.stdout + result.stderr,
  );
  const expected = new Map();
  for (const file of await files(join(generated, 'src/main/kotlin')))
    if (file.endsWith('.kt'))
      expected.set(
        relative(generated, file).replaceAll('\\', '/'),
        (await readFile(file, 'utf8')).replaceAll('\r\n', '\n'),
      );
  const rulesJson = await format(JSON.stringify(rules), { parser: 'json' });
  expected.set('src/main/resources/blogpost-wire-v1.json', rulesJson);
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  expected.set(
    'generation.json',
    await format(
      JSON.stringify({
        status: 'DRAFT',
        generatorVersion: toolchain.generator.version,
        generatorSha256: toolchain.generator.sha256,
        sourceOpenApiSha256: sha256(sourceBytes),
        projectionPolicy: 1,
        operationCount: inventory.length,
        configuration,
        validationRulesSha256: sha256(rulesJson),
        kotlinSourceFiles: expected.size - 1,
      }),
      { parser: 'json' },
    ),
  );
  const existing = await files(output);
  const expectedPaths = new Set(
    [...expected.keys()].map((path) => resolve(output, path)),
  );
  for (const path of existing) {
    if (!path.startsWith(output + sep))
      throw new Error('Generated path escaped the output directory.');
    if (!expectedPaths.has(path)) {
      if (check)
        throw new Error(
          `Unexpected generated Kotlin file: ${relative(output, path)}`,
        );
      await unlink(path);
    }
  }
  for (const [name, contents] of expected) {
    const target = resolve(output, name);
    if (!target.startsWith(output + sep))
      throw new Error('Generated path escaped the output directory.');
    if (check) {
      if ((await readFile(target, 'utf8')) !== contents)
        throw new Error(`Generated Kotlin is stale: ${name}`);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
  }
  process.stdout.write(
    `Generated Kotlin verified: ${inventory.length} operations, ${expected.size - 2} source files.\n`,
  );
} finally {
  const checked = resolve(temporary);
  if (!checked.startsWith(resolve(temporaryRoot) + sep))
    throw new Error('Refusing cleanup outside the generation workspace.');
  await rm(checked, { recursive: true, force: true });
}
