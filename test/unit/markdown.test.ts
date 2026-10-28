import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMarkdown,
  assertSupportedMarkdown,
  safeArticleLink,
  isUnicodeScalarText,
  type MarkdownMediaReference,
} from '../../src/modules/posts/markdown.js';
import { ApiError } from '../../src/platform/errors/api-error.js';

interface Fixture {
  name: string;
  markdown: string;
  valid: boolean;
  media?: MarkdownMediaReference[];
  codes?: string[];
  plainIncludes?: string[];
  noHtmlNodes?: boolean;
}
const fixtures = JSON.parse(
  readFileSync('contracts/fixtures/markdown/cases.json', 'utf8'),
) as Fixture[];
for (const fixture of fixtures)
  test(`Markdown contract 1: ${fixture.name}`, () => {
    const result = analyzeMarkdown(fixture.markdown);
    assert.equal(
      result.issues.length === 0,
      fixture.valid,
      JSON.stringify(result.issues),
    );
    if (fixture.media) assert.deepEqual(result.mediaReferences, fixture.media);
    for (const code of fixture.codes ?? [])
      assert.ok(result.issues.some((issue) => issue.code === code));
    for (const value of fixture.plainIncludes ?? [])
      assert.ok(result.plainText.includes(value));
    if (fixture.noHtmlNodes)
      assert.equal(
        JSON.stringify(result.tree).includes('"type":"html"'),
        false,
      );
    if (!fixture.valid)
      assert.throws(
        () => assertSupportedMarkdown(fixture.markdown),
        (error: ApiError) => error.code === 'MARKDOWN_UNSUPPORTED',
      );
  });
test('UTF-8 byte bounds count astral characters correctly and reject oversized input', () => {
  assert.doesNotThrow(() => analyzeMarkdown('😀'.repeat(32768)));
  assert.throws(
    () => analyzeMarkdown('😀'.repeat(32769)),
    (error: ApiError) => error.fieldErrors[0]?.code === 'MAX_UTF8_BYTES',
  );
});
test('shared Unicode counting fixtures agree on scalar validity, code points and UTF-8 bytes', () => {
  const cases = JSON.parse(
    readFileSync('contracts/fixtures/markdown/unicode-counting.json', 'utf8'),
  ) as {
    sample: string;
    repeat: number;
    wellFormed: boolean;
    codePoints?: number;
    utf8Bytes?: number;
  }[];
  for (const fixture of cases) {
    const value = fixture.sample.repeat(fixture.repeat);
    assert.equal(isUnicodeScalarText(value), fixture.wellFormed);
    if (fixture.wellFormed) {
      assert.equal([...value].length, fixture.codePoints);
      assert.equal(Buffer.byteLength(value, 'utf8'), fixture.utf8Bytes);
    } else
      assert.throws(
        () => analyzeMarkdown(value),
        (error: ApiError) => error.fieldErrors[0]?.code === 'INVALID_UNICODE',
      );
  }
});
test('media extraction preserves each use and rejects arbitrary image titles', () => {
  const id = '50000000-0000-4000-8000-000000000001';
  assert.equal(
    analyzeMarkdown(`![One](media://${id})\n\n![Two](media://${id})`)
      .mediaReferences.length,
    2,
  );
  assert.ok(
    analyzeMarkdown(`![One](media://${id} "unexpected")`).issues.some(
      (issue) => issue.code === 'IMAGE_TITLE_UNSUPPORTED',
    ),
  );
});
test('unsafe link schemes, credentials, controls and backslashes never become accepted links', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'vbscript:x',
    '//evil.example',
    '/\\evil.example',
    'https://user:pass@example.com',
    'https://example.com/\nsecret',
  ])
    assert.equal(safeArticleLink(value), false, value);
});
test('large invalid documents cap returned issues without echoing the body', () => {
  const result = analyzeMarkdown(
    Array.from({ length: 60 }, () => '[Bad](javascript:alert%281%29)').join(
      '\n\n',
    ),
  );
  assert.equal(result.issues.length, 50);
  assert.equal(result.truncated, true);
  assert.equal(JSON.stringify(result.issues).includes('javascript'), false);
});
