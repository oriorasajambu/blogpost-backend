import { fail } from '../policy.mjs';

export function uniqueJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('INVALID_EVIDENCE_JSON');
  }
  const frames = [];
  // Syntax was already validated; this pass retains object keys before JSON.parse can discard duplicates.
  const tokens =
    text.match(
      /"(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g,
    ) ?? [];
  for (const token of tokens) {
    if (token === '{')
      frames.push({ object: true, keys: new Set(), key: true });
    else if (token === '[') frames.push({ object: false });
    else if (token === '}' || token === ']') frames.pop();
    else if (token === ',' && frames.at(-1)?.object) frames.at(-1).key = true;
    else if (
      token.startsWith('"') &&
      frames.at(-1)?.object &&
      frames.at(-1).key
    ) {
      const frame = frames.at(-1);
      const key = JSON.parse(token);
      if (frame.keys.has(key)) fail('DUPLICATE_EVIDENCE_JSON_KEY');
      frame.keys.add(key);
      frame.key = false;
    }
  }
  return value;
}
