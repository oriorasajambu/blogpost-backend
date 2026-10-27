import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import openapiTS, { astToString } from 'openapi-typescript';

const path = 'contracts/generated/typescript/api-v1.d.ts';
const ast = await openapiTS(
  pathToFileURL(resolve('contracts/openapi-v1.json')),
  { alphabetize: true, immutable: true, defaultNonNullable: false },
);
const contents = await format(astToString(ast), {
  ...(await resolveConfig('package.json')),
  filepath: path,
});
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== contents)
    throw new Error(
      'Generated TypeScript types are stale. Run npm run contract:typescript.',
    );
} else {
  await mkdir('contracts/generated/typescript', { recursive: true });
  await writeFile(path, contents);
}
console.log('Generated TypeScript contract types verified.');
