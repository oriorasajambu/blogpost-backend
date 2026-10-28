import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDraft,
  validatePublicationContent,
} from '../../src/modules/posts/draft.js';
import { ApiError } from '../../src/platform/errors/api-error.js';

const input = {
  title: '',
  summary: '',
  markdown: '',
  categoryId: null,
  tagIds: [],
  coverMediaId: null,
};
const cover = '50000000-0000-4000-8000-000000000001';
test('incomplete drafts are durable and publication has stricter validation', () => {
  const value = normalizeDraft(input);
  assert.equal(value.markdownContractVersion, 1);
  assert.throws(
    () => validatePublicationContent(value),
    (error: ApiError) =>
      error.code === 'VALIDATION_FAILED' && error.fieldErrors.length === 4,
  );
});
test('drafts reject unknown fields, invalid UUIDs, duplicate tags and non-v1 Markdown', () => {
  for (const patch of [
    { secret: 'never echo me' },
    { categoryId: 'invalid' },
    { tagIds: [cover, cover] },
    { markdownContractVersion: 2 },
    { title: '😀'.repeat(161) },
    { markdown: '😀'.repeat(32769) },
  ])
    assert.throws(
      () => normalizeDraft({ ...input, ...patch }),
      (error: ApiError) =>
        error.code === 'VALIDATION_FAILED' &&
        !JSON.stringify(error).includes('never echo me'),
    );
});
test('Unicode code-point title limits are independent of UTF-16 length', () => {
  assert.equal(
    normalizeDraft({ ...input, title: '😀'.repeat(160) }).title.length,
    320,
  );
});
test('unpaired surrogates are rejected before SQL or UTF-8 encoding can silently replace content', () => {
  for (const patch of [
    { title: '\ud800' },
    { summary: '\udc00' },
    { markdown: '\ud800' },
    { coverAltText: '\ud800', coverMediaId: cover },
  ])
    assert.throws(
      () => normalizeDraft({ ...input, ...patch }),
      (error: ApiError) =>
        error.fieldErrors.some((issue) => issue.code === 'INVALID_UNICODE'),
    );
});
test('old clients preserving the same cover cannot silently erase its presentation', () => {
  const previous = normalizeDraft({
    ...input,
    coverMediaId: cover,
    coverAltText: 'A useful diagram',
    coverDecorative: false,
  });
  assert.equal(
    normalizeDraft(
      { ...input, coverMediaId: cover, title: 'New title' },
      previous,
    ).coverAltText,
    previous.coverAltText,
  );
  assert.equal(
    normalizeDraft(
      { ...input, coverMediaId: cover, coverDecorative: true },
      previous,
    ).coverAltText,
    '',
  );
});
test('changing a cover requires explicit presentation and clearing it resets presentation', () => {
  const previous = normalizeDraft({
    ...input,
    coverMediaId: cover,
    coverAltText: 'A diagram',
  });
  assert.throws(
    () =>
      normalizeDraft(
        { ...input, coverMediaId: '50000000-0000-4000-8000-000000000002' },
        previous,
      ),
    ApiError,
  );
  assert.equal(normalizeDraft(input, previous).coverAltText, null);
  assert.throws(
    () => normalizeDraft({ ...input, coverAltText: 'Orphaned presentation' }),
    ApiError,
  );
});
