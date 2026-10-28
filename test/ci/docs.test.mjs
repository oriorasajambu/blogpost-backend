import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localTarget, validateDocs } from '../../scripts/ci/docs.mjs';

test('local links resolve inside the repository and never read an external target', () => {
  assert.deepEqual(localTarget('docs/guide.md', '../README.md#readme'), {
    path: 'README.md',
    fragment: 'readme',
  });
  assert.deepEqual(localTarget('docs/guide.md', '/README.md'), {
    path: 'README.md',
    fragment: null,
  });
  assert.equal(localTarget('README.md', 'https://example.test/#a'), null);
  for (const url of [
    '../outside.md',
    '%2e%2e/outside.md',
    'file:///private',
    'javascript:alert(1)',
    '//private/secret',
    'docs%5cprivate.md',
    'docs/%00.md',
  ])
    assert.throws(() => localTarget('README.md', url));
});
test('Markdown parsing ignores code examples, resolves references and duplicate heading fragments', async () => {
  const files = [
    {
      path: 'README.md',
      bytes: Buffer.from(
        '# Readme\n\n[Guide][g]\n\n[g]: docs/guide.md#same-1\n\n```md\n[Not a link](missing.md)\n```\n',
      ),
    },
    {
      path: 'docs/guide.md',
      bytes: Buffer.from('# Same\n\n## Same\n\n[Home](../README.md#readme)\n'),
    },
  ];
  assert.equal((await validateDocs(files)).documents.length, 2);
  await assert.rejects(
    validateDocs([
      {
        ...files[0],
        bytes: Buffer.from('# Readme\n\n[Missing](missing.md)\n'),
      },
      files[1],
    ]),
    /Missing local/,
  );
  await assert.rejects(
    validateDocs([
      {
        ...files[0],
        bytes: Buffer.from('# Readme\n\n[Missing](docs/guide.md#unknown)\n'),
      },
      files[1],
    ]),
    /Missing documentation heading/,
  );
  await assert.rejects(
    validateDocs([
      {
        path: 'README.md',
        bytes: Buffer.from('# Readme\n\n[Outside](../outside.md)\n'),
      },
    ]),
    /escaped repository/,
  );
});
