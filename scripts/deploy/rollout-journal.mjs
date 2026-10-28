import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../../src/platform/config/build-model.ts';
import { refuse } from './rollout-client.mjs';

// Private local persistence, not an authenticated release/deployment archive.
// A crashed filesystem critical section leaves a lock for operator inspection;
// it is never stolen on a timer. Provider writes still require a fresh etag.
export async function fileRolloutJournal(workspace, id) {
  if (!/^[1-9][0-9]{0,19}-[1-9][0-9]{0,3}$/.test(id)) refuse('INVALID_ATTEMPT');
  const root = await realpath(resolve(workspace));
  let directory = root;
  for (const part of ['.local', 'deploy', 'rollouts']) {
    directory = join(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      refuse('UNSAFE_JOURNAL_DIRECTORY');
    if ((await realpath(directory)) !== directory)
      refuse('UNSAFE_JOURNAL_DIRECTORY');
  }
  const path = join(directory, id + '.json');
  const lockPath = join(directory, id + '.lock');
  async function load() {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576)
        refuse('INVALID_JOURNAL');
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (
        value.sha256 !== digest(value.record) ||
        value.record.id !== id ||
        !Number.isSafeInteger(value.record.version) ||
        value.record.version < 1
      )
        refuse('INVALID_JOURNAL');
      return value.record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      refuse('INVALID_JOURNAL');
    }
  }
  return Object.freeze({
    load,
    async save(record, expectedVersion) {
      if (record.id !== id || record.version !== expectedVersion + 1)
        refuse('JOURNAL_VERSION_CONFLICT');
      let lock;
      try {
        lock = await open(lockPath, 'wx', 0o600);
      } catch {
        refuse('JOURNAL_LOCKED');
      }
      const temporary = join(directory, id + '.' + randomUUID() + '.tmp');
      try {
        const previous = await load();
        if ((previous?.version ?? 0) !== expectedVersion)
          refuse('JOURNAL_VERSION_CONFLICT');
        const bytes = JSON.stringify({ sha256: digest(record), record }) + '\n';
        if (Buffer.byteLength(bytes) > 1048576) refuse('JOURNAL_TOO_LARGE');
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(bytes, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, path);
        return structuredClone(record);
      } finally {
        try {
          await unlink(temporary).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        } finally {
          try {
            await lock.close();
          } finally {
            await unlink(lockPath);
          }
        }
      }
    },
  });
}
