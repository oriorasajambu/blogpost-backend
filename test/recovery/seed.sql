-- Synthetic rows for the four-migration prefix only. Never run against a saved database.
BEGIN;
SET LOCAL search_path=blogpost,public;
INSERT INTO "Member" (id,"identityUid",email,"displayName",handle,role,"updatedAt") VALUES
 ('10000000-0000-4000-8000-000000000001','recovery-admin','admin@recovery.example.test','Recovery Admin','recovery-admin','ADMIN','2026-10-01T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000002','recovery-author','author@recovery.example.test','Recovery Author','recovery-author','AUTHOR','2026-10-01T00:00:00Z');
INSERT INTO "Category" (id,name,"normalizedName",slug,"updatedAt") VALUES
 ('20000000-0000-4000-8000-000000000001','Recovery','recovery','recovery','2026-10-01T00:00:00Z');
INSERT INTO "Tag" (id,name,"normalizedName",slug,"updatedAt") VALUES
 ('20000000-0000-4000-8000-000000000002','Reliable','reliable','reliable','2026-10-01T00:00:00Z');
INSERT INTO "Post" (id,"authorId","creatorId","clientDraftId","updatedAt") VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','2026-10-01T00:00:00Z'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000004','2026-10-01T00:00:00Z');
INSERT INTO "Revision" (id,"postId",number,title,summary,markdown,"plainBody","creditedAuthorId","creatorId","categoryId",checksum) VALUES
 ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Reliable recovery','Published recovery snapshot','Published recovery content — café 😀','Published recovery content','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',repeat('a',64)),
 ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',2,'Private newer draft','Private summary','PRIVATE_RECOVERY_DRAFT','PRIVATE_RECOVERY_DRAFT','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',repeat('b',64)),
 ('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002',1,'Trashed recovery draft','Trashed summary','Trashed content','Trashed content','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',NULL,repeat('c',64));
INSERT INTO "RevisionTag" ("revisionId","tagId",position) VALUES
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',0);
INSERT INTO "SlugHistory" (slug,"postId",canonical) VALUES
 ('reliable-recovery','30000000-0000-4000-8000-000000000001',true),
 ('recovery-old-url','30000000-0000-4000-8000-000000000001',false);
UPDATE "Post" SET "publicationState"='PUBLISHED',"workflowState"='DRAFT',"canonicalSlug"='reliable-recovery',
 "publishedRevisionId"='40000000-0000-4000-8000-000000000001',"workingRevisionId"='40000000-0000-4000-8000-000000000002',
 "firstPublishedAt"='2026-10-02T00:00:00Z',"lastPublishedAt"='2026-10-02T00:00:00Z',"lockVersion"=7
 WHERE id='30000000-0000-4000-8000-000000000001';
UPDATE "Post" SET "workingRevisionId"='40000000-0000-4000-8000-000000000003',"trashedAt"='2026-10-03T00:00:00Z',"purgeAfter"='2026-11-02T00:00:00Z'
 WHERE id='30000000-0000-4000-8000-000000000002';
INSERT INTO "ReviewEvent" (id,"postId","revisionId","actorId",action,feedback) VALUES
 ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','PUBLISH',NULL);
INSERT INTO "PublishedSearch" ("postId","revisionId",document) VALUES
 ('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',setweight(to_tsvector('english','Reliable recovery'),'A') || setweight(to_tsvector('english','Published recovery snapshot'),'B') || setweight(to_tsvector('english','Published recovery content'),'C'));
INSERT INTO "Invitation" (id,email,role,"tokenHash","issuerId","expiresAt") VALUES
 ('60000000-0000-4000-8000-000000000002','pending@recovery.example.test','AUTHOR',repeat('d',64),'10000000-0000-4000-8000-000000000001','2099-01-01T00:00:00Z');
INSERT INTO "AuditEvent" (id,"actorId",action,"subjectType","subjectId",changes,"traceId") VALUES
 ('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','recovery_fixture','Post','30000000-0000-4000-8000-000000000001','{"published":true}',repeat('e',32));
INSERT INTO "IdempotencyRecord" (id,"identityUid",method,route,key,"requestHash",result,"statusCode","expiresAt") VALUES
 ('60000000-0000-4000-8000-000000000004','recovery-author','POST','/v1/posts','60000000-0000-4000-8000-000000000005',repeat('f',64),'{"receipt":"recovery"}',201,'2099-01-01T00:00:00Z');
INSERT INTO "RateLimitBucket" ("memberId",action,"windowStart",count,"expiresAt") VALUES
 ('10000000-0000-4000-8000-000000000002','write','2026-10-01T00:00:00Z',2,'2099-01-01T00:00:00Z');
COMMIT;
