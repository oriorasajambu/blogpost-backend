import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import { ApiError, type FieldIssue } from '../../platform/errors/api-error.js';

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false });
const supported = new Set([
  'root',
  'paragraph',
  'text',
  'heading',
  'emphasis',
  'strong',
  'blockquote',
  'list',
  'listItem',
  'link',
  'linkReference',
  'definition',
  'image',
  'imageReference',
  'code',
  'inlineCode',
  'break',
  'table',
  'tableRow',
  'tableCell',
]);
export const RESOURCE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Node {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
  identifier?: string;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  children?: Node[];
  position?: { start: { offset?: number; line: number; column: number } };
}
export interface MarkdownMediaReference {
  mediaId: string;
  altText: string;
  decorative: boolean;
}
export interface MarkdownAnalysis {
  tree: Root;
  plainText: string;
  mediaReferences: MarkdownMediaReference[];
  issues: FieldIssue[];
  truncated: boolean;
}

export { isUnicodeScalarText } from '../../platform/text/unicode.js';
import { isUnicodeScalarText } from '../../platform/text/unicode.js';

export function safeArticleLink(value: string): boolean {
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (value.startsWith('#')) return true;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function analyzeMarkdown(markdown: string): MarkdownAnalysis {
  if (!isUnicodeScalarText(markdown))
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid Unicode',
      'Provide well-formed Unicode text.',
      [
        {
          location: 'body',
          field: '/markdown',
          code: 'INVALID_UNICODE',
          params: {},
        },
      ],
    );
  if (Buffer.byteLength(markdown, 'utf8') > 131072)
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Markdown is too large',
      'Reduce the UTF-8 size of the Markdown.',
      [
        {
          location: 'body',
          field: '/markdown',
          code: 'MAX_UTF8_BYTES',
          params: { maximum: 131072 },
        },
      ],
    );
  const tree = parser.parse(markdown);
  const definitions = new Map<string, Node>();
  const pending = [...tree.children].reverse() as unknown as Node[];
  while (pending.length) {
    const node = pending.pop()!;
    if (
      node.type === 'definition' &&
      node.identifier &&
      !definitions.has(node.identifier.toLowerCase())
    )
      definitions.set(node.identifier.toLowerCase(), node);
    if (node.children) pending.push(...node.children.slice().reverse());
  }
  const issues: FieldIssue[] = [];
  const references: MarkdownMediaReference[] = [];
  const plain: string[] = [];
  let issueCount = 0;
  const issue = (node: Node, code: string) => {
    issueCount++;
    if (issues.length < 50)
      issues.push({
        location: 'body',
        field: '/markdown',
        code,
        params: {
          line: node.position?.start.line ?? 1,
          column: node.position?.start.column ?? 1,
        },
      });
  };
  const stack = [{ node: tree as unknown as Node, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++count > 20000 || depth > 128) {
      issue(node, 'MARKDOWN_COMPLEXITY_LIMIT');
      break;
    }
    if (node.type === 'html') {
      // HTML-like source has literal text semantics in contract 1, never executable HTML.
      const value = node.value ?? '';
      Object.assign(node, { type: 'text', value });
    }
    if (!supported.has(node.type)) {
      issue(node, 'UNSUPPORTED_MARKDOWN_NODE');
      continue;
    }
    if (
      node.type === 'listItem' &&
      node.checked !== null &&
      node.checked !== undefined
    )
      issue(node, 'TASK_LIST_UNSUPPORTED');
    if (node.type === 'code') {
      const source = markdown.slice(node.position?.start.offset ?? 0);
      if (!/^ {0,3}(?:`{3,}|~{3,})/.test(source))
        issue(node, 'FENCED_CODE_REQUIRED');
      if (
        node.meta ||
        (node.lang && !/^[A-Za-z0-9_+.#-]{1,64}$/.test(node.lang))
      )
        issue(node, 'CODE_METADATA_UNSUPPORTED');
    }
    if (
      ['link', 'linkReference', 'image', 'imageReference'].includes(node.type)
    ) {
      const target = node.type.endsWith('Reference')
        ? definitions.get(node.identifier?.toLowerCase() ?? '')
        : node;
      if (!target?.url) {
        issue(node, 'UNRESOLVED_REFERENCE');
        continue;
      }
      if (node.type.startsWith('image')) {
        const match = /^media:\/\/([^/?#]+)$/.exec(target.url);
        if (!match || !RESOURCE_UUID.test(match[1]!))
          issue(node, 'INVALID_MEDIA_REFERENCE');
        const altText = node.alt ?? '';
        const decorative = target.title === 'decorative';
        if (target.title && !decorative) issue(node, 'IMAGE_TITLE_UNSUPPORTED');
        if (decorative ? altText !== '' : !altText.trim())
          issue(
            node,
            decorative ? 'DECORATIVE_ALT_MUST_BE_EMPTY' : 'ALT_TEXT_REQUIRED',
          );
        if ([...altText].length > 300) issue(node, 'ALT_TEXT_TOO_LONG');
        if (match && RESOURCE_UUID.test(match[1]!))
          references.push({
            mediaId: match[1]!.toLowerCase(),
            altText,
            decorative,
          });
        if (altText) plain.push(altText);
      } else if (!safeArticleLink(target.url)) issue(node, 'UNSAFE_LINK_URL');
    }
    if (node.type === 'definition') continue;
    if (typeof node.value === 'string') plain.push(node.value);
    if (node.children)
      for (let index = node.children.length - 1; index >= 0; index--)
        stack.push({ node: node.children[index]!, depth: depth + 1 });
  }
  return {
    tree,
    plainText: plain.join(' ').replace(/\s+/g, ' ').trim(),
    mediaReferences: references,
    issues,
    truncated: issueCount > issues.length,
  };
}

export function assertSupportedMarkdown(markdown: string): MarkdownAnalysis {
  const result = analyzeMarkdown(markdown);
  if (result.issues.length)
    throw new ApiError(
      422,
      'MARKDOWN_UNSUPPORTED',
      'Unsupported Markdown',
      'Check the indicated Markdown constructs before publication.',
      result.issues,
      result.truncated ? { truncated: true } : null,
    );
  return result;
}
