import { readFileSync } from 'node:fs';
import { validateProvenance, type BuildProvenance } from './build-model.js';

/** The path is fixed in source. Runtime environment variables cannot select another provenance file. */
export function readProvenance(): BuildProvenance {
  try {
    const bytes = readFileSync(
      new URL('../../../.build/provenance.json', import.meta.url),
    );
    if (bytes.length > 16384) throw new Error('Build metadata too large');
    return validateProvenance(
      JSON.parse(bytes.toString('utf8')),
      process.env.NODE_ENV === 'test',
    );
  } catch {
    throw new Error('Missing or invalid baked build metadata');
  }
}
