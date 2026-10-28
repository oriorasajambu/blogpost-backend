import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  symlink,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  LocalMediaStorage,
  GcsMediaStorage,
  hashBytes,
  type ObjectPlan,
} from '../../src/modules/media/storage.js';

const bytes = Buffer.from('private normalized image bytes');
function plan(value = bytes): ObjectPlan {
  return {
    objectName:
      'blogpost/posts/' +
      randomUUID() +
      '/' +
      randomUUID() +
      '/' +
      randomUUID() +
      '/w480.png',
    mimeType: 'image/png',
    byteSize: value.length,
    sha256: hashBytes(value),
  };
}
async function collect(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
const unavailable = { status: 503, code: 'DEPENDENCY_UNAVAILABLE' };
test('local storage uses private immutable generations and idempotent exact deletion', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blogpost-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalMediaStorage(directory);
  const first = plan();
  const stored = await store.put(first, bytes);
  assert.deepEqual(await store.put(first, bytes), stored);
  assert.deepEqual(await collect(await store.open(stored)), bytes);
  const physical = join(
    directory,
    first.objectName.replaceAll('/', '_') + '.' + first.sha256 + '.blob',
  );
  assert.equal((await stat(physical)).mode & 0o777, 0o600);
  const changed = Buffer.from('a newer immutable object generation');
  const newer = await store.put(
    { ...first, sha256: hashBytes(changed), byteSize: changed.length },
    changed,
  );
  await store.remove({ ...first, generation: stored.generation });
  await store.remove({ ...first, generation: stored.generation });
  await assert.rejects(store.open(stored), unavailable);
  assert.deepEqual(await collect(await store.open(newer)), changed);
});
test('local storage rejects path traversal, wrong generations, bytes and corruption safely', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blogpost-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalMediaStorage(directory);
  const input = plan();
  await assert.rejects(
    store.put({ ...input, objectName: '../secret.png' }, bytes),
    unavailable,
  );
  await assert.rejects(store.put(input, Buffer.from('wrong')), unavailable);
  const object = await store.put(input, bytes);
  await assert.rejects(
    store.open({ ...object, generation: 'wrong' }),
    unavailable,
  );
  const physical = join(
    directory,
    input.objectName.replaceAll('/', '_') + '.' + input.sha256 + '.blob',
  );
  await writeFile(physical, Buffer.alloc(bytes.length));
  await assert.rejects(store.open(object), unavailable);
  await assert.rejects(store.put(input, bytes), unavailable);
  assert.deepEqual(await readFile(physical), Buffer.alloc(bytes.length));
});
test('a corrupted multi-chunk object cannot complete a successful stream', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blogpost-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalMediaStorage(directory);
  const bytes = randomBytes(200000);
  const input = plan(bytes);
  const object = await store.put(input, bytes);
  const corrupt = Buffer.from(bytes);
  corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
  await writeFile(
    join(
      directory,
      input.objectName.replaceAll('/', '_') + '.' + input.sha256 + '.blob',
    ),
    corrupt,
  );
  const stream = await store.open(object);
  let received = 0;
  await assert.rejects(
    (async () => {
      for await (const chunk of stream) received += (chunk as Buffer).length;
    })(),
    unavailable,
  );
  assert.ok(received > 0);
  assert.ok(received < bytes.length);
});
test('local storage refuses symlink objects and recovers after an unavailable root', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blogpost-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'private-original');
  await writeFile(target, bytes);
  const input = plan();
  const physical = join(
    directory,
    input.objectName.replaceAll('/', '_') + '.' + input.sha256 + '.blob',
  );
  await symlink(target, physical);
  const store = new LocalMediaStorage(directory);
  await assert.rejects(store.put(input, bytes), unavailable);
  await assert.rejects(
    store.open({ ...input, generation: input.sha256 }),
    unavailable,
  );
  await store.remove(input);
  assert.deepEqual(await readFile(target), bytes);
  const root = join(directory, 'temporarily-blocked');
  await writeFile(root, bytes);
  const recoverable = new LocalMediaStorage(root);
  await assert.rejects(recoverable.put(input, bytes), unavailable);
  await rm(root);
  assert.deepEqual(
    await collect(await recoverable.open(await recoverable.put(input, bytes))),
    bytes,
  );
});

function cloudFixture() {
  const input = plan();
  const generation = '9007199254740993123';
  let conflict = false;
  let payload = bytes;
  let metadata = {
    generation,
    size: String(bytes.length),
    contentType: input.mimeType,
    metadata: { blogpostSha256: input.sha256 },
    timeCreated: '2020-01-01T00:00:00.000Z',
  };
  const calls: {
    action: string;
    name: string;
    options?: unknown;
    args?: unknown;
  }[] = [];
  const bucket = {
    async getFiles(options: unknown) {
      calls.push({ action: 'list', name: 'blogpost/posts/', options });
      return [
        [
          { name: input.objectName, metadata },
          { name: 'unrelated/private.png', metadata },
        ],
        { pageToken: 'opaque-provider-page' },
      ];
    },
    file(name: string, options?: unknown) {
      calls.push({ action: 'file', name, options });
      return {
        createWriteStream(args: unknown) {
          calls.push({ action: 'write', name, options, args });
          return new Writable({
            write(_chunk, _encoding, next) {
              next(
                conflict
                  ? Object.assign(new Error('precondition'), { code: 412 })
                  : undefined,
              );
            },
          });
        },
        async getMetadata() {
          calls.push({ action: 'metadata', name, options });
          return [metadata];
        },
        createReadStream(args: unknown) {
          calls.push({ action: 'read', name, options, args });
          return Readable.from([payload]);
        },
        async delete(args: unknown) {
          calls.push({ action: 'delete', name, options, args });
        },
      };
    },
  };
  return {
    input,
    generation,
    calls,
    store: new GcsMediaStorage(
      'test-project',
      'private-bucket',
      bucket as unknown as ConstructorParameters<typeof GcsMediaStorage>[2],
    ),
    conflict() {
      conflict = true;
    },
    corrupt() {
      metadata = { ...metadata, metadata: { blogpostSha256: '0'.repeat(64) } };
    },
    corruptBytes() {
      payload = Buffer.alloc(bytes.length);
    },
  };
}
test('GCS adapter creates conditionally, pins exact string generations and never returns delivery URLs', async () => {
  const f = cloudFixture();
  const stored = await f.store.put(f.input, bytes);
  assert.equal(stored.generation, f.generation);
  assert.deepEqual(f.calls.find((c) => c.action === 'write')?.options, {
    preconditionOpts: { ifGenerationMatch: 0 },
  });
  assert.equal(
    f.calls.find((c) => c.action === 'metadata')?.options,
    undefined,
  );
  assert.deepEqual(await collect(await f.store.open(stored)), bytes);
  assert.deepEqual(f.calls.find((c) => c.action === 'read')?.options, {
    generation: f.generation,
  });
  await f.store.remove({ ...f.input, generation: stored.generation });
  assert.deepEqual(f.calls.find((c) => c.action === 'delete')?.options, {
    generation: f.generation,
    preconditionOpts: { ifGenerationMatch: f.generation },
  });
  assert.deepEqual(Object.keys(stored).sort(), [
    'byteSize',
    'generation',
    'objectName',
    'sha256',
  ]);
});
test('GCS adapter reconciles uncertain create outcomes only for matching metadata', async () => {
  const f = cloudFixture();
  f.conflict();
  const stored = await f.store.put(f.input, bytes);
  assert.equal(stored.generation, f.generation);
  f.corrupt();
  await assert.rejects(f.store.put(f.input, bytes), unavailable);
  await assert.rejects(f.store.remove(f.input), unavailable);
  assert.equal(
    f.calls.some((c) => c.action === 'delete'),
    false,
  );
});
test('GCS cleanup discovers uncertain generations and still uses an exact deletion precondition', async () => {
  const f = cloudFixture();
  await f.store.remove(f.input);
  assert.deepEqual(f.calls.find((c) => c.action === 'delete')?.options, {
    generation: f.generation,
    preconditionOpts: { ifGenerationMatch: f.generation },
  });
  f.corruptBytes();
  await assert.rejects(
    f.store.open({ ...f.input, generation: f.generation }),
    unavailable,
  );
});
test('GCS inventory is bounded, includes generations, and skips unrelated bucket objects', async () => {
  const f = cloudFixture();
  const page = await f.store.list('previous-page', 2);
  assert.equal(page.objects.length, 1);
  assert.equal(page.objects[0]!.generation, f.generation);
  assert.equal(
    page.objects[0]!.createdAt.toISOString(),
    '2020-01-01T00:00:00.000Z',
  );
  assert.equal(page.nextCursor, 'opaque-provider-page');
  assert.deepEqual(f.calls.find((call) => call.action === 'list')?.options, {
    prefix: 'blogpost/posts/',
    versions: true,
    autoPaginate: false,
    maxResults: 2,
    pageToken: 'previous-page',
  });
  await assert.rejects(f.store.list(null, 101), unavailable);
});
test('local inventory resumes after deleting the previous page anchor and excludes unrelated files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blogpost-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalMediaStorage(directory);
  for (let i = 0; i < 3; i++) await store.put(plan(), bytes);
  await writeFile(join(directory, 'foreign-secret.txt'), bytes);
  const first = await store.list(null, 1);
  assert.equal(first.objects.length, 1);
  assert.ok(first.nextCursor);
  await store.remove(first.objects[0]!);
  const second = await store.list(first.nextCursor, 1);
  assert.equal(second.objects.length, 1);
  assert.notEqual(second.objects[0]!.objectName, first.objects[0]!.objectName);
  const final = await store.list(second.nextCursor, 1);
  assert.equal(final.objects.length, 1);
  assert.equal(final.nextCursor, null);
  assert.deepEqual(
    await readFile(join(directory, 'foreign-secret.txt')),
    bytes,
  );
});
