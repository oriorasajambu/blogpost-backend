import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stringify } from 'yaml';
import { format, resolveConfig } from 'prettier';
import { buildSpec } from '../contracts/src/spec.mjs';
import { operations } from '../contracts/src/operations.mjs';
import {
  errorCodes,
  errorExample,
  pngBase64,
  requestExample,
  successExample,
} from '../contracts/src/examples.mjs';

const outputs = new Map();
const json = (path, value) =>
  outputs.set(path, JSON.stringify(value, null, 2) + '\n');
const spec = buildSpec();
json('contracts/openapi-v1.json', spec);
outputs.set('contracts/openapi-v1.yaml', stringify(spec, { lineWidth: 0 }));
json(
  'contracts/operation-inventory.json',
  operations.map(
    ({
      method,
      path,
      operationId,
      access,
      expectedVersion = false,
      idempotent = false,
    }) => ({
      method: method.toUpperCase(),
      path,
      operationId,
      access,
      expectedVersion,
      idempotent,
    }),
  ),
);
for (const operation of operations) {
  json(
    `contracts/fixtures/operations/${operation.operationId}.request.json`,
    requestExample(operation),
  );
  if (!operation.binary)
    json(
      `contracts/fixtures/operations/${operation.operationId}.response.json`,
      successExample(operation),
    );
}
for (const [status, codes] of Object.entries(errorCodes))
  for (const code of codes)
    json(
      `contracts/fixtures/errors/${code.toLowerCase().replaceAll('_', '-')}.json`,
      errorExample(status, code),
    );
outputs.set(
  'contracts/fixtures/media/pixel.png',
  Buffer.from(pngBase64, 'base64'),
);
const formatConfig = await resolveConfig('package.json');
for (const [path, raw] of outputs) {
  const contents =
    typeof raw === 'string'
      ? await format(raw, { ...formatConfig, filepath: path })
      : raw;
  if (process.argv.includes('--check')) {
    if (!Buffer.from(contents).equals(await readFile(path)))
      throw new Error(`Generated contract artifact is stale: ${path}`);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}
console.log(
  `Contract draft: ${operations.length} application operations, ${Object.keys(spec.components.schemas).length} schemas; ${outputs.size} authored artifacts ${process.argv.includes('--check') ? 'verified' : 'written'}.`,
);
