// Build-stage test data only. This file and its validation metadata are not copied into runtime images.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  validateProvenance,
  canonical,
} from '../../src/platform/config/build-model.ts';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const bytes = await readFile('contracts/openapi-v1.json');
const contract = JSON.parse(bytes.toString('utf8'));
const provenance = validateProvenance(
  {
    schemaVersion: 1,
    application: 'backend',
    kind: 'VALIDATION',
    environment: 'development',
    sourceSha: null,
    sourceRef: 'unborn:main',
    dirty: true,
    applicationVersion: pkg.version,
    contractVersion: contract.info.version,
    contractSha256: createHash('sha256').update(bytes).digest('hex'),
    runtimeInputDigest: '0'.repeat(64),
    sourceInputDigest: '0'.repeat(64),
    inputManifestVersion: 1,
    targetPlatform: 'linux/amd64',
    configuration: null,
  },
  true,
);
await mkdir('.build', { recursive: true });
await writeFile('.build/provenance.json', canonical(provenance) + '\n');
