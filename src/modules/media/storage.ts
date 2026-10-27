import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  open,
  unlink,
  realpath,
  lstat,
  opendir,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { ApiError } from '../../platform/errors/api-error.js';

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
export const hashBytes = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
export interface StoredObject {
  objectName: string;
  generation: string;
  sha256: string;
  byteSize: number;
}
export interface ObjectPlan {
  objectName: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
}
export interface MediaStorage {
  put(plan: ObjectPlan, bytes: Buffer): Promise<StoredObject>;
  open(object: StoredObject): Promise<Readable>;
  remove(plan: ObjectPlan & { generation?: string }): Promise<void>;
  list(cursor: string | null, limit: number): Promise<ObjectPage>;
}
export interface ListedObject extends ObjectPlan {
  generation: string;
  createdAt: Date;
}
export interface ObjectPage {
  objects: ListedObject[];
  nextCursor: string | null;
}
export function storageFailure(): ApiError {
  return new ApiError(
    503,
    'DEPENDENCY_UNAVAILABLE',
    'Media unavailable',
    'Retry after the storage dependency recovers.',
    [],
    null,
    1,
  );
}
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const key = new RegExp(
  `^blogpost/posts/${uuid}/${uuid}/${uuid}/(?:w480|w960|w1600)\\.(?:jpeg|png|webp)$`,
);
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(storageFailure()), 10000);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function checkedPlan(plan: ObjectPlan, allowEmpty = false): void {
  if (
    !key.test(plan.objectName) ||
    !/^[a-f0-9]{64}$/.test(plan.sha256) ||
    !Number.isSafeInteger(plan.byteSize) ||
    plan.byteSize < (allowEmpty ? 0 : 1) ||
    plan.byteSize > 100 * 1024 * 1024 ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(plan.mimeType)
  )
    throw storageFailure();
}

// Withhold one chunk until size/hash validation succeeds so corruption cannot finish a successful response.
async function verifiedStream(
  raw: Readable,
  object: StoredObject,
): Promise<Readable> {
  const iterator = raw[Symbol.asyncIterator]();
  const hash = createHash('sha256');
  let count = 0;
  const timer = setTimeout(() => raw.destroy(storageFailure()), 120000);
  timer.unref();
  async function* chunks() {
    let pending: Buffer | undefined;
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        const bytes = Buffer.from(next.value as Buffer);
        count += bytes.length;
        hash.update(bytes);
        if (count > object.byteSize) throw storageFailure();
        if (pending) yield pending;
        pending = bytes;
      }
      if (
        count !== object.byteSize ||
        hash.digest('hex') !== object.sha256 ||
        !pending
      )
        throw storageFailure();
      yield pending;
    } catch {
      throw storageFailure();
    } finally {
      clearTimeout(timer);
      raw.destroy();
      await iterator.return?.();
    }
  }
  const source = chunks();
  let first: IteratorResult<Buffer>;
  try {
    first = await source.next();
    if (first.done) throw storageFailure();
  } catch {
    clearTimeout(timer);
    raw.destroy();
    await source.return(undefined);
    throw storageFailure();
  }
  const result = Readable.from(
    (async function* () {
      try {
        yield first.value;
        yield* source;
      } finally {
        await source.return(undefined);
      }
    })(),
  );
  result.once('close', () => {
    clearTimeout(timer);
    raw.destroy();
    void source.return(undefined).catch(() => {});
  });
  return result;
}

export class LocalMediaStorage implements MediaStorage {
  private root: Promise<string> | undefined;
  constructor(private readonly directory: string) {}
  private base(): Promise<string> {
    return (this.root ??= (async () => {
      const path = resolve(this.directory);
      await mkdir(path, { recursive: true });
      if ((await lstat(path)).isSymbolicLink()) throw storageFailure();
      return realpath(path);
    })().catch(() => {
      this.root = undefined;
      throw storageFailure();
    }));
  }
  private async path(plan: ObjectPlan, generation: string, deleting = false) {
    checkedPlan(plan, deleting);
    if (generation !== plan.sha256) throw storageFailure();
    return join(
      await this.base(),
      plan.objectName.replaceAll('/', '_') + '.' + generation + '.blob',
    );
  }
  async put(plan: ObjectPlan, bytes: Buffer): Promise<StoredObject> {
    try {
      return await this.write(plan, bytes);
    } catch {
      throw storageFailure();
    }
  }
  private async write(plan: ObjectPlan, bytes: Buffer): Promise<StoredObject> {
    checkedPlan(plan);
    if (bytes.length !== plan.byteSize || hashBytes(bytes) !== plan.sha256)
      throw storageFailure();
    const path = await this.path(plan, plan.sha256);
    try {
      const file = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST')
        throw storageFailure();
      const file = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const stat = await file.stat();
        if (
          !stat.isFile() ||
          stat.size !== plan.byteSize ||
          hashBytes(await file.readFile()) !== plan.sha256
        )
          throw storageFailure();
      } finally {
        await file.close();
      }
    }
    return {
      objectName: plan.objectName,
      generation: plan.sha256,
      sha256: plan.sha256,
      byteSize: plan.byteSize,
    };
  }
  async open(object: StoredObject): Promise<Readable> {
    try {
      const path = await this.path(
        { ...object, mimeType: 'image/' + object.objectName.split('.').at(-1) },
        object.generation,
      );
      const file = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== object.byteSize) {
        await file.close();
        throw storageFailure();
      }
      return await verifiedStream(
        file.createReadStream({ highWaterMark: 65536, autoClose: true }),
        object,
      );
    } catch {
      throw storageFailure();
    }
  }
  async remove(plan: ObjectPlan & { generation?: string }): Promise<void> {
    const generation = plan.generation ?? plan.sha256;
    const path = await this.path(plan, generation, true);
    try {
      await unlink(path);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT')
        throw storageFailure();
    }
  }
  async list(cursor: string | null, limit: number): Promise<ObjectPage> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor !== null && (cursor.length > 2048 || cursor.includes('/')))
    )
      throw storageFailure();
    try {
      const root = await this.base();
      const directory = await opendir(root);
      const candidates: { name: string; objectName: string; sha256: string }[] =
        [];
      const deadline = Date.now() + 10000;
      // Keep only a bounded page in memory. The cursor is lexical, so deleting its old file cannot lose progress.
      for await (const entry of directory) {
        if (Date.now() > deadline) throw storageFailure();
        if (!entry.isFile() || (cursor !== null && entry.name <= cursor))
          continue;
        const match = /^(.+)\.([a-f0-9]{64})\.blob$/.exec(entry.name);
        if (!match) continue;
        const objectName = match[1]!.replaceAll('_', '/');
        if (!key.test(objectName)) continue;
        candidates.push({ name: entry.name, objectName, sha256: match[2]! });
        candidates.sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        if (candidates.length > limit + 1) candidates.pop();
      }
      const selected = candidates.slice(0, limit);
      const objects: ListedObject[] = [];
      for (const entry of selected) {
        let info;
        try {
          info = await lstat(join(root, entry.name));
        } catch (error) {
          if ((error as { code?: string }).code === 'ENOENT') continue;
          throw error;
        }
        if (!info.isFile()) continue;
        const object: ListedObject = {
          objectName: entry.objectName,
          sha256: entry.sha256,
          generation: entry.sha256,
          mimeType: 'image/' + entry.objectName.split('.').at(-1),
          byteSize: info.size,
          createdAt: info.birthtimeMs > 0 ? info.birthtime : info.mtime,
        };
        checkedPlan(object, true);
        objects.push(object);
      }
      return {
        objects,
        nextCursor: candidates.length > limit ? selected.at(-1)!.name : null,
      };
    } catch {
      throw storageFailure();
    }
  }
}

type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;
export class GcsMediaStorage implements MediaStorage, OnModuleDestroy {
  private app: App | undefined;
  private bucket_: Bucket | undefined;
  constructor(
    private readonly project: string,
    private readonly name: string,
    bucket?: Bucket,
  ) {
    this.bucket_ = bucket;
  }
  private bucket(): Bucket {
    if (!this.bucket_) {
      this.app = initializeApp(
        { projectId: this.project, storageBucket: this.name },
        `blogpost-media-${randomUUID()}`,
      );
      this.bucket_ = getStorage(this.app).bucket(this.name);
    }
    return this.bucket_;
  }
  async put(plan: ObjectPlan, bytes: Buffer): Promise<StoredObject> {
    checkedPlan(plan);
    if (bytes.length !== plan.byteSize || hashBytes(bytes) !== plan.sha256)
      throw storageFailure();
    try {
      const file = this.bucket().file(plan.objectName, {
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      try {
        await pipeline(
          Readable.from([bytes]),
          file.createWriteStream({
            resumable: false,
            validation: 'crc32c',
            timeout: 10000,
            metadata: {
              contentType: plan.mimeType,
              cacheControl: 'no-store',
              metadata: { blogpostSha256: plan.sha256 },
            },
          }),
          { signal: AbortSignal.timeout(12000) },
        );
      } catch (error) {
        if ((error as { code?: number }).code !== 412) throw error;
      }
      const [metadata] = await bounded(
        this.bucket().file(plan.objectName).getMetadata(),
      );
      if (
        !metadata.generation ||
        !/^[0-9]+$/.test(String(metadata.generation)) ||
        metadata.metadata?.blogpostSha256 !== plan.sha256 ||
        Number(metadata.size) !== plan.byteSize ||
        metadata.contentType !== plan.mimeType
      )
        throw storageFailure();
      return {
        objectName: plan.objectName,
        generation: String(metadata.generation),
        sha256: plan.sha256,
        byteSize: plan.byteSize,
      };
    } catch {
      throw storageFailure();
    }
  }
  async open(object: StoredObject): Promise<Readable> {
    checkedPlan({
      ...object,
      mimeType: 'image/' + object.objectName.split('.').at(-1),
    });
    if (!/^[0-9]+$/.test(object.generation)) throw storageFailure();
    try {
      return await verifiedStream(
        this.bucket()
          .file(object.objectName, { generation: object.generation })
          .createReadStream({ validation: 'crc32c', decompress: false }),
        object,
      );
    } catch {
      throw storageFailure();
    }
  }
  async remove(plan: ObjectPlan & { generation?: string }): Promise<void> {
    checkedPlan(plan, true);
    try {
      let generation = plan.generation;
      if (!generation) {
        const [metadata] = await bounded(
          this.bucket().file(plan.objectName).getMetadata(),
        );
        if (
          metadata.metadata?.blogpostSha256 !== plan.sha256 ||
          Number(metadata.size) !== plan.byteSize
        )
          throw storageFailure();
        generation = String(metadata.generation);
      }
      if (!/^[0-9]+$/.test(generation)) throw storageFailure();
      await bounded(
        this.bucket()
          .file(plan.objectName, {
            generation,
            preconditionOpts: { ifGenerationMatch: generation },
          })
          .delete({ ignoreNotFound: true }),
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 404) throw storageFailure();
    }
  }
  async list(cursor: string | null, limit: number): Promise<ObjectPage> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor !== null && cursor.length > 2048)
    )
      throw storageFailure();
    try {
      const [files, next] = await bounded(
        this.bucket().getFiles({
          prefix: 'blogpost/posts/',
          versions: true,
          autoPaginate: false,
          maxResults: limit,
          ...(cursor !== null ? { pageToken: cursor } : {}),
        }),
      );
      if (files.length > limit) throw storageFailure();
      const objects: ListedObject[] = [];
      for (const file of files) {
        const metadata = file.metadata;
        const object: ListedObject = {
          objectName: file.name,
          generation: String(metadata.generation),
          sha256: String(metadata.metadata?.blogpostSha256 ?? ''),
          byteSize: Number(metadata.size),
          mimeType: metadata.contentType ?? '',
          createdAt: new Date(metadata.timeCreated ?? ''),
        };
        // Do not adopt or delete unrelated bucket objects, even if they share the broad prefix.
        try {
          checkedPlan(object, true);
        } catch {
          continue;
        }
        if (
          !/^[0-9]+$/.test(object.generation) ||
          !Number.isFinite(object.createdAt.getTime())
        )
          continue;
        objects.push(object);
      }
      const nextCursor =
        typeof next?.pageToken === 'string' ? next.pageToken : null;
      if (nextCursor !== null && nextCursor.length > 2048)
        throw storageFailure();
      return { objects, nextCursor };
    } catch {
      throw storageFailure();
    }
  }
  async onModuleDestroy() {
    const app = this.app;
    this.app = undefined;
    this.bucket_ = undefined;
    if (app) await deleteApp(app);
  }
}

@Injectable()
export class StorageAdapter implements MediaStorage, OnModuleDestroy {
  private readonly adapter: LocalMediaStorage | GcsMediaStorage;
  private streams = 0;
  private writes = 0;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.adapter =
      config.media.adapter === 'local'
        ? new LocalMediaStorage(config.media.localRoot!)
        : new GcsMediaStorage(config.identityProject, config.media.bucket!);
  }
  async put(plan: ObjectPlan, bytes: Buffer) {
    if (this.writes >= 4)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Media writer busy',
        'Retry the upload shortly.',
        [],
        null,
        1,
      );
    this.writes++;
    try {
      return await this.adapter.put(plan, bytes);
    } finally {
      this.writes--;
    }
  }
  remove(plan: ObjectPlan & { generation?: string }) {
    return this.adapter.remove(plan);
  }
  list(cursor: string | null, limit: number) {
    return this.adapter.list(cursor, limit);
  }
  async open(object: StoredObject) {
    if (this.streams >= 16)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Media reader busy',
        'Retry the read shortly.',
        [],
        null,
        1,
      );
    this.streams++;
    try {
      const stream = await this.adapter.open(object);
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          this.streams--;
        }
      };
      stream.once('close', release);
      stream.once('end', release);
      stream.once('error', release);
      return stream;
    } catch (error) {
      this.streams--;
      throw error;
    }
  }
  async onModuleDestroy() {
    if (this.adapter instanceof GcsMediaStorage)
      await this.adapter.onModuleDestroy();
  }
}
