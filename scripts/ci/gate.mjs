import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertGate(needs, kind) {
  const fail = () => {
    throw new Error('Required CI validation did not succeed.');
  };
  if (
    !['pull_request', 'push', 'staging', 'release'].includes(kind) ||
    needs?.policy?.result !== 'success' ||
    needs.docs?.result !== 'success'
  )
    fail();
  const outputs = needs.policy.outputs;
  if (
    !outputs ||
    !['true', 'false'].includes(outputs.docs_only) ||
    outputs.classification !==
      (outputs.docs_only === 'true' ? 'docs' : 'code') ||
    !['true', 'false'].includes(outputs.promotion)
  )
    fail();
  for (const job of ['foundation', 'identity-sql', 'kotlin-contract']) {
    if (
      !needs[job] ||
      !(
        needs[job].result === 'success' ||
        (outputs.docs_only === 'true' && needs[job].result === 'skipped')
      )
    )
      fail();
  }
  if (kind === 'pull_request') {
    if (!['true', 'false'].includes(outputs.draft) || outputs.draft === 'true')
      fail();
    if (
      !needs['promotion-evidence'] ||
      !(
        needs['promotion-evidence'].result === 'success' ||
        (outputs.promotion === 'false' &&
          needs['promotion-evidence'].result === 'skipped')
      )
    )
      fail();
  }
  if (
    ['staging', 'release'].includes(kind) &&
    (needs['source-proof']?.result !== 'success' ||
      needs.delivery?.result !== 'success')
  )
    fail();
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    assertGate(JSON.parse(process.env.CI_NEEDS_JSON), process.env.CI_GATE_KIND);
    console.log('Required selected validations passed.');
  } catch {
    console.error(
      'Required CI validations failed, were cancelled, were missing, or were unexpectedly skipped.',
    );
    process.exitCode = 1;
  }
}
