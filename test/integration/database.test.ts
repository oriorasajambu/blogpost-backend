import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { connection } from '../../src/platform/database/connection.js';

const pool = new pg.Pool(connection('app'));
const memberId = randomUUID();
const postId = randomUUID();
const otherPostId = randomUUID();
const revisionId = randomUUID();
before(async () => {
  await pool.query(
    `INSERT INTO "Member" (id,"identityUid",email,"displayName",handle,role,"updatedAt")
    VALUES ($1,$2,'synthetic@example.test','Synthetic author',$3,'AUTHOR',now())`,
    [memberId, randomUUID(), `test-${randomUUID()}`],
  );
  for (const id of [postId, otherPostId])
    await pool.query(
      `INSERT INTO "Post" (id,"authorId","creatorId","clientDraftId","updatedAt") VALUES ($1,$2,$2,$3,now())`,
      [id, memberId, randomUUID()],
    );
  await pool.query(
    `INSERT INTO "Revision" (id,"postId",number,title,summary,markdown,"plainBody","creditedAuthorId","creatorId",checksum)
    VALUES ($1,$2,1,'Draft','','','',$3,$3,$4)`,
    [revisionId, postId, memberId, 'a'.repeat(64)],
  );
});
after(async () => {
  await pool.query('DELETE FROM "Post" WHERE id = ANY($1::uuid[])', [
    [postId, otherPostId],
  ]);
  await pool.query('DELETE FROM "Member" WHERE id = $1', [memberId]);
  await pool.end();
});
const code = (expected: string) => (error: unknown) =>
  (error as { code: string }).code === expected;
test('runtime cannot mutate immutable snapshots or schema metadata', async () => {
  await assert.rejects(
    pool.query('UPDATE "Revision" SET title = $1 WHERE id = $2', [
      'overwrite',
      revisionId,
    ]),
    code('42501'),
  );
  await assert.rejects(
    pool.query('UPDATE "SchemaMeta" SET version = 2'),
    code('42501'),
  );
  await assert.rejects(
    pool.query('SELECT * FROM _prisma_migrations'),
    code('42501'),
  );
});
test('a post cannot point at a revision belonging to another post', async () => {
  await assert.rejects(
    pool.query('UPDATE "Post" SET "workingRevisionId" = $1 WHERE id = $2', [
      revisionId,
      otherPostId,
    ]),
    code('23503'),
  );
});
test('review requires a frozen exact working revision and submission timestamp', async () => {
  await assert.rejects(
    pool.query(
      `UPDATE "Post" SET "workflowState" = 'IN_REVIEW' WHERE id = $1`,
      [postId],
    ),
    code('23514'),
  );
});
test('published state cannot exist without a snapshot and reserved slug', async () => {
  await assert.rejects(
    pool.query(
      `UPDATE "Post" SET "publicationState" = 'PUBLISHED' WHERE id = $1`,
      [postId],
    ),
    code('23514'),
  );
});
test('media from another owning post cannot enter a revision', async () => {
  const mediaId = randomUUID();
  await pool.query(
    'INSERT INTO "MediaAsset" (id,"postId","uploaderId") VALUES ($1,$2,$3)',
    [mediaId, otherPostId, memberId],
  );
  await assert.rejects(
    pool.query(
      'INSERT INTO "RevisionMedia" ("postId","revisionId","mediaId") VALUES ($1,$2,$3)',
      [postId, revisionId, mediaId],
    ),
    code('23503'),
  );
});
test('concurrent offline creation cannot duplicate creator/clientDraftId', async () => {
  const draftId = randomUUID();
  const insert = () =>
    pool.query(
      'INSERT INTO "Post" (id,"authorId","creatorId","clientDraftId","updatedAt") VALUES ($1,$2,$2,$3,now())',
      [randomUUID(), memberId, draftId],
    );
  const results = await Promise.allSettled([insert(), insert()]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const rejected = results.find(
    (result) => result.status === 'rejected',
  ) as PromiseRejectedResult;
  assert.equal(rejected.reason.code, '23505');
  await pool.query(
    'DELETE FROM "Post" WHERE "creatorId" = $1 AND "clientDraftId" = $2',
    [memberId, draftId],
  );
});
test('oversize UTF-8 content is rejected by PostgreSQL independently of DTO validation', async () => {
  await assert.rejects(
    pool.query(
      `INSERT INTO "Revision" (id,"postId",number,title,summary,markdown,"plainBody","creditedAuthorId","creatorId",checksum)
    VALUES ($1,$2,2,'Draft','',$3,'',$4,$4,$5)`,
      [randomUUID(), postId, '😀'.repeat(32769), memberId, 'a'.repeat(64)],
    ),
    code('23514'),
  );
});
