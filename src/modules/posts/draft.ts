import { ApiError, type FieldIssue } from '../../platform/errors/api-error.js';
import {
  assertSupportedMarkdown,
  isUnicodeScalarText,
  RESOURCE_UUID,
  type MarkdownAnalysis,
} from './markdown.js';

export interface DraftContent {
  title: string;
  summary: string;
  markdown: string;
  categoryId: string | null;
  tagIds: string[];
  coverMediaId: string | null;
  markdownContractVersion: 1;
  coverAltText: string | null;
  coverDecorative: boolean;
}
const required = [
  'title',
  'summary',
  'markdown',
  'categoryId',
  'tagIds',
  'coverMediaId',
];
const fields = new Set([
  ...required,
  'markdownContractVersion',
  'coverAltText',
  'coverDecorative',
]);
const owns = (value: object, field: string) => Object.hasOwn(value, field);
function reject(issues: FieldIssue[]): never {
  throw new ApiError(
    422,
    'VALIDATION_FAILED',
    'Validation failed',
    'Check the indicated draft fields.',
    issues.sort((a, b) => a.field.localeCompare(b.field)).slice(0, 50),
    issues.length > 50 ? { truncated: true } : null,
  );
}

export function normalizeDraft(
  value: unknown,
  previous?: DraftContent,
): DraftContent {
  const issues: FieldIssue[] = [];
  const issue = (
    field: string,
    code: string,
    params: Record<string, unknown> = {},
  ) => {
    if (issues.length < 51)
      issues.push({ location: 'body', field: `/${field}`, code, params });
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    reject([
      { location: 'body', field: '', code: 'OBJECT_REQUIRED', params: {} },
    ]);
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (!fields.has(key))
      issue(key.replace(/~/g, '~0').replace(/\//g, '~1'), 'UNKNOWN_FIELD');
  for (const key of required) if (!owns(input, key)) issue(key, 'REQUIRED');
  for (const [key, maximum] of [
    ['title', 160],
    ['summary', 320],
    ['markdown', null],
  ] as const) {
    if (!owns(input, key)) continue;
    if (typeof input[key] !== 'string') issue(key, 'STRING_REQUIRED');
    else if (input[key].includes('\0')) issue(key, 'INVALID_CHARACTER');
    else if (!isUnicodeScalarText(input[key])) issue(key, 'INVALID_UNICODE');
    else if (maximum !== null && [...input[key]].length > maximum)
      issue(key, 'MAX_CODE_POINTS', { maximum });
    else if (
      key === 'markdown' &&
      Buffer.byteLength(input[key], 'utf8') > 131072
    )
      issue(key, 'MAX_UTF8_BYTES', { maximum: 131072 });
  }
  for (const key of ['categoryId', 'coverMediaId'])
    if (
      owns(input, key) &&
      input[key] !== null &&
      (typeof input[key] !== 'string' || !RESOURCE_UUID.test(input[key]))
    )
      issue(key, 'INVALID_UUID');
  if (owns(input, 'tagIds')) {
    if (!Array.isArray(input.tagIds)) issue('tagIds', 'ARRAY_REQUIRED');
    else {
      if (input.tagIds.length > 5) issue('tagIds', 'MAX_ITEMS', { maximum: 5 });
      const seen = new Set<string>();
      input.tagIds.slice(0, 6).forEach((tag, index) => {
        if (typeof tag !== 'string' || !RESOURCE_UUID.test(tag))
          issue(`tagIds/${index}`, 'INVALID_UUID');
        else if (seen.has(tag.toLowerCase()))
          issue(`tagIds/${index}`, 'DUPLICATE_ITEM');
        else seen.add(tag.toLowerCase());
      });
    }
  }
  if (
    owns(input, 'markdownContractVersion') &&
    input.markdownContractVersion !== 1
  )
    issue('markdownContractVersion', 'UNSUPPORTED_MARKDOWN_CONTRACT');
  if (
    owns(input, 'coverAltText') &&
    input.coverAltText !== null &&
    (typeof input.coverAltText !== 'string' ||
      [...input.coverAltText].length > 300)
  )
    issue('coverAltText', 'INVALID_ALT_TEXT');
  if (
    typeof input.coverAltText === 'string' &&
    (!isUnicodeScalarText(input.coverAltText) ||
      input.coverAltText.includes('\0'))
  )
    issue('coverAltText', 'INVALID_UNICODE');
  if (
    owns(input, 'coverDecorative') &&
    typeof input.coverDecorative !== 'boolean'
  )
    issue('coverDecorative', 'BOOLEAN_REQUIRED');
  if (issues.length) reject(issues);
  const coverMediaId =
    input.coverMediaId === null
      ? null
      : (input.coverMediaId as string).toLowerCase();
  const unchangedCover =
    previous && coverMediaId !== null && previous.coverMediaId === coverMediaId;
  const coverDecorative = owns(input, 'coverDecorative')
    ? (input.coverDecorative as boolean)
    : unchangedCover
      ? previous.coverDecorative
      : false;
  let coverAltText = owns(input, 'coverAltText')
    ? (input.coverAltText as string | null)
    : unchangedCover
      ? previous.coverAltText
      : null;
  if (input.coverDecorative === true && !owns(input, 'coverAltText'))
    coverAltText = '';
  if (coverMediaId === null) {
    if (coverDecorative || coverAltText !== null)
      issue('coverMediaId', 'NO_COVER_PRESENTATION');
  } else {
    if (
      previous &&
      !unchangedCover &&
      !owns(input, 'coverAltText') &&
      input.coverDecorative !== true
    )
      issue('coverAltText', 'COVER_PRESENTATION_REQUIRED');
    if (coverDecorative) {
      if (coverAltText !== null && coverAltText !== '')
        issue('coverAltText', 'DECORATIVE_ALT_MUST_BE_EMPTY');
      coverAltText = '';
    }
  }
  if (issues.length) reject(issues);
  return {
    title: input.title as string,
    summary: input.summary as string,
    markdown: input.markdown as string,
    categoryId:
      input.categoryId === null
        ? null
        : (input.categoryId as string).toLowerCase(),
    tagIds: (input.tagIds as string[]).map((id) => id.toLowerCase()),
    coverMediaId,
    markdownContractVersion: 1,
    coverAltText,
    coverDecorative,
  };
}

export function validatePublicationContent(
  draft: DraftContent,
): MarkdownAnalysis {
  const issues: FieldIssue[] = [];
  for (const key of ['title', 'summary', 'markdown'] as const)
    if (!draft[key].trim())
      issues.push({
        location: 'body',
        field: `/${key}`,
        code: 'NONBLANK_REQUIRED',
        params: {},
      });
  if (draft.categoryId === null)
    issues.push({
      location: 'body',
      field: '/categoryId',
      code: 'REQUIRED_FOR_PUBLICATION',
      params: {},
    });
  if (
    draft.coverMediaId !== null &&
    !draft.coverDecorative &&
    !draft.coverAltText?.trim()
  )
    issues.push({
      location: 'body',
      field: '/coverAltText',
      code: 'ALT_TEXT_REQUIRED',
      params: {},
    });
  if (issues.length) reject(issues);
  return assertSupportedMarkdown(draft.markdown);
}
