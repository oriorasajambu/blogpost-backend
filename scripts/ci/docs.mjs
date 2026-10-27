import { readFile, writeFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import * as prettier from 'prettier';
import { workingFiles } from '../build/inputs.mjs';
import { safeDirectory } from './install-gitleaks.mjs';

const parser = unified().use(remarkParse).use(remarkGfm);
const walk = (node, fn) => {
  fn(node);
  for (const child of node.children ?? []) walk(child, fn);
};
const textOf = (node) =>
  node.value ?? node.alt ?? (node.children ?? []).map(textOf).join('');
export function headingIds(tree) {
  const counts = new Map();
  const ids = new Set();
  walk(tree, (node) => {
    if (node.type !== 'heading') return;
    const slug = textOf(node)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '')
      .replaceAll(' ', '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    ids.add(slug + (count ? '-' + count : ''));
  });
  return ids;
}
export function localTarget(source, url) {
  if (/^(?:https?:|mailto:)/i.test(url)) return null;
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) ||
    url.startsWith('//') ||
    url.includes('\\') ||
    url.includes('?')
  )
    throw new Error('Unapproved documentation link.');
  const hash = url.indexOf('#');
  let path;
  let fragment;
  try {
    path = decodeURIComponent(hash < 0 ? url : url.slice(0, hash));
    fragment = hash < 0 ? null : decodeURIComponent(url.slice(hash + 1));
  } catch {
    throw new Error('Invalid documentation link encoding.');
  }
  if (
    /[\u0000-\u001f\u007f\\:]/.test(path) ||
    /[\u0000-\u001f\u007f]/.test(fragment ?? '')
  )
    throw new Error('Unsafe documentation link.');
  const target = path
    ? posix.normalize(
        path.startsWith('/')
          ? path.slice(1)
          : posix.join(posix.dirname(source), path),
      )
    : source;
  if (target === '..' || target.startsWith('../') || target.startsWith('/'))
    throw new Error('Documentation link escaped repository.');
  return { path: target, fragment };
}
export async function validateDocs(files, selected) {
  const inventory = new Map(
    files.filter((file) => file.bytes).map((file) => [file.path, file.bytes]),
  );
  const trees = new Map();
  const parse = (path) => {
    if (!trees.has(path))
      trees.set(
        path,
        parser.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(inventory.get(path)),
        ),
      );
    return trees.get(path);
  };
  const results = [];
  const targets =
    selected ?? [...inventory.keys()].filter((path) => path.endsWith('.md'));
  for (const source of targets) {
    if (!source.endsWith('.md') || !inventory.has(source)) continue;
    const text = inventory.get(source).toString('utf8');
    if (
      !(await prettier.check(text, {
        ...(await prettier.resolveConfig(resolve('.prettierrc.json'))),
        filepath: source,
      }))
    )
      throw new Error('Documentation formatting failed: ' + source);
    const tree = parse(source);
    const definitions = new Map();
    walk(tree, (node) => {
      if (node.type === 'definition')
        definitions.set(node.identifier.toLowerCase(), node.url);
    });
    let links = 0;
    walk(tree, (node) => {
      if (
        !['link', 'image', 'linkReference', 'imageReference'].includes(
          node.type,
        )
      )
        return;
      const url = node.url ?? definitions.get(node.identifier?.toLowerCase());
      if (typeof url !== 'string')
        throw new Error('Missing documentation reference: ' + source);
      const target = localTarget(source, url);
      if (!target) return;
      if (!inventory.has(target.path))
        throw new Error('Missing local documentation target: ' + source);
      if (
        target.fragment &&
        target.path.endsWith('.md') &&
        !headingIds(parse(target.path)).has(target.fragment)
      )
        throw new Error('Missing documentation heading: ' + source);
      links++;
    });
    results.push({ path: source, localLinks: links });
  }
  return { schemaVersion: 1, status: 'PASSED', documents: results };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const selected = process.argv.includes('--all')
      ? undefined
      : JSON.parse(await readFile('.local/ci/policy.json', 'utf8')).paths;
    const result = await validateDocs(
      await workingFiles(process.cwd()),
      selected,
    );
    await safeDirectory(process.cwd(), '.local/ci');
    await writeFile(
      '.local/ci/docs.json',
      JSON.stringify(result, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        status: result.status,
        documents: result.documents.length,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
