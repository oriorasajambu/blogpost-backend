import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { components } from '../contracts/generated/typescript/api-v1.js';
import { ApiError } from '../src/platform/errors/api-error.js';
import {
  normalizeDraft,
  validatePublicationContent,
  type DraftContent,
} from '../src/modules/posts/draft.js';
import { analyzeMarkdown } from '../src/modules/posts/markdown.js';
import {
  normalizeImage,
  type NormalizedImage,
} from '../src/modules/media/image-normalizer.js';
import type { Operation } from './contract.js';

type Mutable<T> = T extends readonly (infer V)[]
  ? Mutable<V>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
export type DTO<K extends keyof components['schemas']> = Mutable<
  components['schemas'][K]
>;
type Member = DTO<'AdminMember'>;
type Post = DTO<'WorkspacePost'>;
type Revision = DTO<'Revision'>;
type Taxon = DTO<'ManagedTaxon'>;
type Invitation = DTO<'Invitation'>;
interface StoredPost {
  dto: Post;
  creatorId: string;
  revisions: Revision[];
  events: DTO<'ReviewEvent'>[];
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
}
interface StoredAsset {
  dto: DTO<'MediaAsset'>;
  uploaderId: string;
  bytes: Map<string, Buffer>;
}
export interface Result {
  data: unknown;
  pagination?: DTO<'CursorPagination'> | DTO<'PagePagination'>;
  bytes?: Buffer;
  mimeType?: string;
  location?: string;
}
export interface SavedOperation {
  hash: string;
  expiresAt: number;
  result?: Result;
  status?: number;
  version?: number;
  location?: string;
}
export interface Upload {
  bytes: Buffer;
  mimeType: string;
}
export const fixtureIds = {
  post: '10000000-0000-4000-8000-000000000001',
  category: '30000000-0000-4000-8000-000000000001',
  tag: '30000000-0000-4000-8000-000000000002',
  author: '40000000-0000-4000-8000-000000000001',
  editor: '40000000-0000-4000-8000-000000000002',
  admin: '40000000-0000-4000-8000-000000000003',
  uninvited: '40000000-0000-4000-8000-000000000004',
  otherAuthor: '40000000-0000-4000-8000-000000000005',
};
const DAY = 86_400_000;
export function fail(
  status: number,
  code: string,
  context: Record<string, unknown> | null = null,
): never {
  throw new ApiError(
    status,
    code,
    'Request could not be completed',
    'Check the current resource state and the documented request requirements.',
    [],
    context,
  );
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, part]) => `${JSON.stringify(key)}:${canonical(part)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
const summary = (member: DTO<'AuthorSummary'>): DTO<'AuthorSummary'> => ({
  id: member.id,
  handle: member.handle,
  displayName: member.displayName,
});
const fixture = <T>(id: string): T =>
  (
    JSON.parse(
      readFileSync(
        new URL(
          `../contracts/fixtures/operations/${id}.response.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { data: T }
  ).data;

export class MockState {
  private clock: number;
  private readonly realtime: boolean;
  get now(): number {
    return this.realtime ? Date.now() + this.clock : this.clock;
  }
  private sequence = 1000;
  private cursorSecret = randomBytes(32);
  readonly members = new Map<string, Member>();
  readonly posts = new Map<string, StoredPost>();
  readonly assets = new Map<string, StoredAsset>();
  readonly categories = new Map<string, Taxon>();
  readonly tags = new Map<string, Taxon>();
  readonly invitations = new Map<string, Invitation>();
  private invitationHashes = new Map<string, string>();
  private slugOwners = new Map<string, string>();
  readonly operations = new Map<string, SavedOperation>();
  readonly audit: DTO<'AuditEvent'>[] = [];
  private sessions = new Map<string, { actorId: string; expiresAt: number }>();
  private rates = new Map<string, number[]>();

  constructor(
    now: number | undefined = undefined,
    private readonly webOrigin = 'http://localhost:3000',
  ) {
    this.realtime = now === undefined;
    this.clock = now ?? 0;
    const identities = [
      [fixtureIds.author, 'author', 'AUTHOR'],
      [fixtureIds.editor, 'editor', 'EDITOR'],
      [fixtureIds.admin, 'admin', 'ADMIN'],
      [fixtureIds.otherAuthor, 'other-author', 'AUTHOR'],
    ] as const;
    for (const [id, name, role] of identities)
      this.members.set(id, {
        id,
        handle: `synthetic-${name}`,
        displayName: `Synthetic ${name}`,
        bio: '',
        email: `${name}@example.test`,
        role,
        active: true,
        version: 1,
        createdAt: this.iso(),
        updatedAt: this.iso(),
      });
    for (const [map, id, name, slug] of [
      [this.categories, fixtureIds.category, 'Engineering', 'engineering'],
      [this.tags, fixtureIds.tag, 'Learning', 'learning'],
    ] as const)
      map.set(id, {
        id,
        name,
        slug,
        active: true,
        version: 1,
        usage: { publishedCount: 0, draftCount: 0 },
        createdAt: this.iso(),
        updatedAt: this.iso(),
      });
    const post = fixture<Post>('publishPostRevision');
    const reviseDates = (value: unknown): unknown => {
      if (
        typeof value === 'string' &&
        /^2026-10-25T08:20:30\.123Z$/.test(value)
      )
        return this.iso(-3_600_000);
      if (Array.isArray(value)) return value.map(reviseDates);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, part]) => [key, reviseDates(part)]),
        );
      return value;
    };
    const seeded = reviseDates(post) as Post;
    this.posts.set(seeded.id, {
      dto: seeded,
      creatorId: fixtureIds.author,
      revisions: [
        reviseDates(fixture<Post>('createPost').workingRevision!) as Revision,
        seeded.workingRevision!,
      ],
      events: [],
      firstPublishedAt: this.iso(-3_600_000),
      lastPublishedAt: this.iso(-3_600_000),
    });
    this.slugOwners.set(seeded.slug!, seeded.id);
    const media = fixture<DTO<'MediaAsset'>>('stagePostMedia');
    media.createdAt = this.iso(-3_600_000);
    media.unattachedExpiresAt = null;
    const pixel = readFileSync(
      new URL('../contracts/fixtures/media/pixel.png', import.meta.url),
    );
    this.assets.set(media.id, {
      dto: media,
      uploaderId: fixtureIds.author,
      bytes: new Map(
        media.variants.map((variant) => [variant.name, Buffer.from(pixel)]),
      ),
    });
  }
  iso(offset = 0): string {
    return new Date(this.now + offset).toISOString();
  }
  id(): string {
    return `90000000-0000-4000-8000-${(++this.sequence).toString(16).padStart(12, '0')}`;
  }
  advance(milliseconds: number): void {
    if (
      !Number.isSafeInteger(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 366 * DAY
    )
      fail(422, 'VALIDATION_FAILED');
    this.clock += milliseconds;
  }
  identify(token: string | undefined, session = false): string | undefined {
    if (token === undefined) return undefined;
    if (session) {
      const stored = this.sessions.get(token);
      if (!stored) fail(401, 'INVALID_CREDENTIAL');
      if (stored.expiresAt <= this.now) fail(401, 'AUTHENTICATION_EXPIRED');
      return stored.actorId;
    }
    if (token === 'mock-expired') fail(401, 'AUTHENTICATION_EXPIRED');
    const identities: Record<string, string> = {
      'mock-author': fixtureIds.author,
      'mock-editor': fixtureIds.editor,
      'mock-admin': fixtureIds.admin,
      'mock-uninvited': fixtureIds.uninvited,
      'mock-other-author': fixtureIds.otherAuthor,
    };
    return (
      identities[token.replace(/^mock-stale-/, 'mock-')] ??
      fail(401, 'INVALID_CREDENTIAL')
    );
  }
  member(id: string | undefined): Member {
    if (!id) fail(401, 'AUTHENTICATION_REQUIRED');
    const member = this.members.get(id);
    if (!member) fail(403, 'INSUFFICIENT_PERMISSION');
    if (!member.active) fail(403, 'ACCESS_REVOKED');
    return member;
  }
  authorize(
    operation: Operation,
    actorId: string | undefined,
    params: Record<string, string>,
  ): void {
    if (
      operation.access === 'ANONYMOUS' ||
      operation.access === 'RECENT_IDENTITY'
    )
      return;
    if (operation.access === 'VERIFIED_IDENTITY') {
      if (!actorId) fail(401, 'AUTHENTICATION_REQUIRED');
      if (this.members.get(actorId)?.active === false)
        fail(403, 'ACCESS_REVOKED');
      return;
    }
    const actor = this.member(actorId);
    if (operation.access === 'ADMIN' && actor.role !== 'ADMIN')
      fail(403, 'INSUFFICIENT_PERMISSION');
    if (operation.access === 'EDITOR' && actor.role === 'AUTHOR')
      fail(403, 'INSUFFICIENT_PERMISSION');
    if (params.postId && operation.access !== 'ANONYMOUS') {
      const post = this.post(params.postId);
      if (actor.role === 'AUTHOR' && post.dto.author.id !== actor.id)
        fail(404, 'RESOURCE_NOT_FOUND');
      if (
        operation.access === 'OWNER_NEVER_PUBLISHED_OR_EDITOR' &&
        actor.role === 'AUTHOR' &&
        post.firstPublishedAt !== null
      )
        fail(403, 'INSUFFICIENT_PERMISSION');
    }
  }
  post(id: string): StoredPost {
    const post = this.posts.get(id);
    if (
      !post ||
      (post.dto.purgeAfter && Date.parse(post.dto.purgeAfter) <= this.now)
    )
      fail(404, 'RESOURCE_NOT_FOUND');
    return post;
  }
  private asset(postId: string, mediaId: string): StoredAsset {
    const asset = this.assets.get(mediaId);
    if (
      !asset ||
      asset.dto.postId !== postId ||
      (asset.dto.unattachedExpiresAt &&
        Date.parse(asset.dto.unattachedExpiresAt) <= this.now)
    )
      fail(404, 'RESOURCE_NOT_FOUND');
    return asset;
  }
  resourceVersion(
    operation: Operation,
    actorId: string | undefined,
    params: Record<string, string>,
  ): number | undefined {
    if (!operation.expectedVersion) return;
    if (params.postId) return this.post(params.postId).dto.version;
    if (operation.operationId === 'updateMe')
      return this.member(actorId).version;
    if (params.memberId)
      return (
        this.members.get(params.memberId) ?? fail(404, 'RESOURCE_NOT_FOUND')
      ).version;
    if (params.invitationId)
      return this.invitation(params.invitationId).version;
    if (params.categoryId)
      return (
        this.categories.get(params.categoryId) ??
        fail(404, 'RESOURCE_NOT_FOUND')
      ).version;
    if (params.tagId)
      return (this.tags.get(params.tagId) ?? fail(404, 'RESOURCE_NOT_FOUND'))
        .version;
  }
  throttle(actorId: string, operationId: string): void {
    const group =
      operationId === 'stagePostMedia'
        ? 'upload'
        : /Invitation|WebSession/.test(operationId)
          ? 'identity'
          : 'write';
    const key = `${actorId}:${group}`;
    const entries = (this.rates.get(key) ?? []).filter(
      (at) => this.now - at < 60_000,
    );
    const limit = group === 'upload' ? 10 : group === 'identity' ? 5 : 30;
    if (entries.length >= limit) fail(429, 'RATE_LIMITED');
    this.rates.set(key, [...entries, this.now]);
  }
  private workspace(post: StoredPost, actorId: string): Post {
    const result = structuredClone(post.dto);
    const actor = this.member(actorId);
    result.allowedActions = [];
    if (result.trashedAt) {
      if (actor.role !== 'AUTHOR' || post.firstPublishedAt === null)
        result.allowedActions.push('RESTORE');
      return result;
    }
    if (result.workflowState === 'IN_REVIEW') {
      result.allowedActions.push('WITHDRAW_REVIEW');
      if (actor.role !== 'AUTHOR')
        result.allowedActions.push('PUBLISH', 'REJECT');
    } else
      result.allowedActions.push('EDIT_DRAFT', 'SUBMIT', 'RESTORE_REVISION');
    if (actor.role !== 'AUTHOR' || post.firstPublishedAt === null)
      result.allowedActions.push('TRASH');
    if (actor.role !== 'AUTHOR') {
      result.allowedActions.push('CHANGE_SLUG');
      if (result.publicationState === 'PUBLISHED')
        result.allowedActions.push('UNPUBLISH');
    }
    if (actor.role === 'ADMIN') result.allowedActions.push('REASSIGN_AUTHOR');
    return result;
  }
  private mediaFor(
    postId: string,
    content: DraftContent,
  ): DTO<'MediaDescriptor'>[] {
    const ids = [
      ...new Set(
        [
          content.coverMediaId,
          ...analyzeMarkdown(content.markdown).mediaReferences.map(
            (ref) => ref.mediaId,
          ),
        ].filter((id): id is string => id !== null),
      ),
    ];
    return ids.map((id) => {
      const asset = this.asset(postId, id).dto;
      return {
        mediaId: id,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
        variants: structuredClone(asset.variants),
      };
    });
  }
  private revision(
    post: StoredPost,
    actor: Member,
    content: DraftContent,
    restoredFromRevisionId: string | null = null,
  ): Revision {
    return {
      id: this.id(),
      postId: post.dto.id,
      number: post.revisions.length + 1,
      createdBy: summary(actor),
      createdAt: this.iso(),
      creditedAuthor: summary(post.dto.author),
      content: structuredClone(content),
      media: this.mediaFor(post.dto.id, content),
      restoredFromRevisionId,
    };
  }
  private attach(revision: Revision): void {
    for (const media of revision.media)
      this.assets.get(media.mediaId)!.dto.unattachedExpiresAt = null;
  }
  private touch(post: StoredPost): void {
    post.dto.version++;
    post.dto.updatedAt = this.iso();
  }
  private event(
    post: StoredPost,
    actor: Member,
    action: string,
    revisionId: string,
    feedback: string | null = null,
  ): void {
    post.events.push({
      id: this.id(),
      postId: post.dto.id,
      revisionId,
      action,
      actor: summary(actor),
      createdAt: this.iso(),
      feedback,
    });
  }
  private publicPost(post: StoredPost): DTO<'PublicPost'> {
    const dto = post.dto;
    if (
      dto.trashedAt ||
      dto.publicationState !== 'PUBLISHED' ||
      !dto.publishedRevision
    )
      fail(404, 'RESOURCE_NOT_FOUND');
    const revision = dto.publishedRevision;
    const content = revision.content;
    const category =
      this.categories.get(content.categoryId!) ??
      fail(404, 'RESOURCE_NOT_FOUND');
    const taxon = (entry: Taxon): DTO<'Taxon'> => ({
      id: entry.id,
      name: entry.name,
      slug: entry.slug,
      active: entry.active,
    });
    const media = revision.media.map((item) => ({
      ...structuredClone(item),
      variants: item.variants.map((variant) => ({
        ...variant,
        apiPath: variant.apiPath.replace('/v1/posts/', '/v1/public/posts/'),
      })),
    }));
    const cover = content.coverMediaId
      ? media.find((item) => item.mediaId === content.coverMediaId)!
      : null;
    return {
      id: dto.id,
      slug: dto.slug!,
      title: content.title,
      summary: content.summary,
      author: summary(revision.creditedAuthor),
      category: taxon(category),
      tags: content.tagIds.map((id) => taxon(this.tags.get(id)!)),
      cover: cover
        ? {
            ...cover,
            altText: content.coverAltText ?? '',
            decorative: content.coverDecorative,
          }
        : null,
      publishedRevisionId: revision.id,
      firstPublishedAt: post.firstPublishedAt!,
      updatedAt: post.lastPublishedAt!,
      markdown: content.markdown,
      markdownContractVersion: 1,
      media,
    };
  }
  private publicationReady(post: StoredPost, revision: Revision): void {
    const content = revision.content;
    validatePublicationContent(content);
    if (
      !this.categories.get(content.categoryId!)?.active ||
      content.tagIds.some((id) => !this.tags.get(id)?.active)
    )
      fail(409, 'WORKFLOW_CONFLICT');
    this.mediaFor(post.dto.id, content);
  }
  private invitation(id: string): Invitation {
    const invitation =
      this.invitations.get(id) ?? fail(404, 'RESOURCE_NOT_FOUND');
    const result = structuredClone(invitation);
    if (result.status === 'PENDING' && Date.parse(result.expiresAt) <= this.now)
      result.status = 'EXPIRED';
    return result;
  }
  private issueInvitation(
    email: string,
    role: Invitation['role'],
    actor: Member,
    replacedId?: string,
  ): DTO<'InvitationIssueResult'> {
    email = email.trim().toLowerCase();
    if (
      [...this.members.values()].some(
        (member) => member.email.toLowerCase() === email,
      )
    )
      fail(409, 'MEMBER_ALREADY_EXISTS');
    if (
      [...this.invitations.values()].some(
        (invitation) =>
          invitation.id !== replacedId &&
          invitation.email === email &&
          invitation.status === 'PENDING',
      )
    )
      fail(409, 'WORKFLOW_CONFLICT');
    const invitation: Invitation = {
      id: this.id(),
      email,
      role,
      status: 'PENDING',
      version: 1,
      issuedBy: summary(actor),
      createdAt: this.iso(),
      expiresAt: this.iso(7 * DAY),
      acceptedAt: null,
      revokedAt: null,
    };
    const token = randomBytes(32).toString('base64url');
    this.invitationHashes.set(
      createHash('sha256').update(token).digest('hex'),
      invitation.id,
    );
    this.invitations.set(invitation.id, invitation);
    return {
      invitation: structuredClone(invitation),
      inviteUrl: `${this.webOrigin}/invitations/accept?token=${token}`,
      linkAvailable: true,
    };
  }
  private paginate<T extends { id: string }>(
    items: T[],
    query: Record<string, unknown>,
    binding: string,
    key: (item: T) => string,
  ): Result {
    const pageSize = (query.pageSize as number | undefined) ?? 20;
    const filters: Record<string, unknown> = { ...query, pageSize };
    delete filters.cursor;
    const bound = digest({ binding, filters });
    const sorted = [...items].sort(
      (a, b) => key(b).localeCompare(key(a)) || a.id.localeCompare(b.id),
    );
    let remaining = sorted;
    if (query.cursor) {
      try {
        const [payload, mac, extra] = (query.cursor as string).split('.');
        if (!payload || !mac || extra || !/^[a-f0-9]{64}$/.test(mac))
          throw new Error();
        const signature = createHmac('sha256', this.cursorSecret)
          .update(payload)
          .digest();
        if (!timingSafeEqual(signature, Buffer.from(mac, 'hex')))
          throw new Error();
        const cursor = JSON.parse(
          Buffer.from(payload, 'base64url').toString('utf8'),
        ) as { binding: string; expiresAt: number; key: string; id: string };
        if (cursor.binding !== bound || cursor.expiresAt <= this.now)
          throw new Error();
        remaining = sorted.filter(
          (item) =>
            key(item) < cursor.key ||
            (key(item) === cursor.key && item.id > cursor.id),
        );
      } catch {
        fail(400, 'INVALID_CURSOR');
      }
    }
    const data = remaining.slice(0, pageSize);
    const hasMore = remaining.length > pageSize;
    let nextCursor: string | null = null;
    if (hasMore) {
      const last = data.at(-1)!;
      const payload = Buffer.from(
        JSON.stringify({
          binding: bound,
          expiresAt: this.now + DAY,
          key: key(last),
          id: last.id,
        }),
      ).toString('base64url');
      nextCursor = `${payload}.${createHmac('sha256', this.cursorSecret).update(payload).digest('hex')}`;
    }
    return {
      data,
      pagination: { kind: 'CURSOR', pageSize, hasMore, nextCursor },
    };
  }
  private page<T>(
    items: T[],
    query: Record<string, unknown>,
    defaultSize = 50,
    search = false,
  ): Result {
    const page = (query.page as number | undefined) ?? 1;
    const pageSize = (query.pageSize as number | undefined) ?? defaultSize;
    const accessible = search ? items.slice(0, 1000) : items;
    return {
      data: accessible.slice((page - 1) * pageSize, page * pageSize),
      pagination: {
        kind: 'PAGE',
        page,
        pageSize,
        totalItems: accessible.length,
        totalPages: Math.ceil(accessible.length / pageSize),
        hasMore: page * pageSize < accessible.length,
        truncated: items.length > accessible.length,
      },
    };
  }

  async run(
    operation: Operation,
    actorId: string | undefined,
    params: Record<string, string>,
    query: Record<string, unknown>,
    body: Record<string, unknown>,
    upload?: Upload,
  ): Promise<Result> {
    const id = operation.operationId;
    const actor =
      operation.access === 'ANONYMOUS' ||
      operation.access === 'RECENT_IDENTITY' ||
      operation.access === 'VERIFIED_IDENTITY'
        ? undefined
        : this.member(actorId);
    if (id === 'getApiMeta') return { data: fixture('getApiMeta') };
    if (id === 'createWebSession') {
      if (actorId !== undefined) fail(400, 'AMBIGUOUS_CREDENTIALS');
      if ((body.idToken as string).startsWith('mock-stale-'))
        fail(401, 'AUTHENTICATION_EXPIRED');
      const member = this.member(this.identify(body.idToken as string));
      this.throttle(member.id, id);
      const sessionCookie = `mock-session-${randomBytes(24).toString('base64url')}`;
      this.sessions.set(sessionCookie, {
        actorId: member.id,
        expiresAt: this.now + 5 * DAY,
      });
      return {
        data: {
          sessionCookie,
          expiresAt: this.iso(5 * DAY),
          member: this.me(member),
        },
      };
    }
    if (id === 'getMe') return { data: this.me(actor!) };
    if (id === 'updateMe') {
      const displayName =
        body.displayName === undefined
          ? actor!.displayName
          : (body.displayName as string);
      const bio =
        body.bio === undefined
          ? actor!.bio
          : ((body.bio as string | null) ?? '');
      if (displayName !== actor!.displayName || bio !== actor!.bio) {
        actor!.displayName = displayName;
        actor!.bio = bio;
        actor!.version++;
        actor!.updatedAt = this.iso();
      }
      return { data: this.me(actor!) };
    }
    if (id === 'acceptInvitation') {
      const invitationId = this.invitationHashes.get(
        createHash('sha256')
          .update(body.token as string)
          .digest('hex'),
      );
      if (!invitationId) fail(404, 'INVITATION_INVALID');
      const invitation = this.invitation(invitationId);
      const email =
        actorId === fixtureIds.uninvited
          ? 'invited@example.test'
          : this.members.get(actorId!)?.email;
      if (email !== invitation.email) fail(403, 'INVITATION_ACCOUNT_MISMATCH');
      if (invitation.status === 'EXPIRED') fail(410, 'INVITATION_EXPIRED');
      if (invitation.status === 'REVOKED') fail(410, 'INVITATION_REVOKED');
      if (invitation.status === 'ACCEPTED') fail(410, 'INVITATION_USED');
      if (this.members.has(actorId!)) fail(409, 'MEMBER_ALREADY_EXISTS');
      invitation.status = 'ACCEPTED';
      invitation.acceptedAt = this.iso();
      invitation.version++;
      this.invitations.set(invitation.id, invitation);
      const member: Member = {
        id: actorId!,
        handle: 'synthetic-invited',
        displayName: 'Synthetic invited',
        bio: '',
        email: invitation.email,
        role: invitation.role,
        active: true,
        version: 1,
        createdAt: this.iso(),
        updatedAt: this.iso(),
      };
      this.members.set(member.id, member);
      return { data: this.me(member) };
    }
    if (id === 'getPublicAuthor') {
      const member =
        [...this.members.values()].find(
          (item) => item.handle === params.handle,
        ) ?? fail(404, 'RESOURCE_NOT_FOUND');
      return { data: { ...summary(member), bio: member.bio } };
    }
    if (id === 'checkPublicPostAvailability')
      return {
        data: (body.postIds as string[]).map((postId) => {
          const post = this.posts.get(postId)?.dto;
          const available =
            !!post && !post.trashedAt && post.publicationState === 'PUBLISHED';
          return {
            postId,
            available,
            publishedRevisionId: available ? post.publishedRevisionId : null,
          };
        }),
      };
    if (id === 'resolvePublicPostSlug') {
      const post = this.post(
        this.slugOwners.get(params.slug!) ?? fail(404, 'RESOURCE_NOT_FOUND'),
      );
      const article = this.publicPost(post);
      const canonical = article.slug === params.slug;
      return {
        data: {
          resolution: canonical ? 'CANONICAL' : 'REDIRECT',
          canonicalSlug: article.slug,
          canonicalPath: `/posts/${article.slug}`,
          post: canonical ? article : null,
        },
      };
    }
    if (id === 'getPublicPost')
      return { data: this.publicPost(this.post(params.postId!)) };
    if (id === 'listPublicPosts' || id === 'searchPublicPosts') {
      let articles = [...this.posts.values()]
        .filter(
          (post) =>
            !post.dto.trashedAt && post.dto.publicationState === 'PUBLISHED',
        )
        .map((post) => this.publicPost(post));
      articles = articles.filter(
        (article) =>
          (!query.categoryId || article.category.id === query.categoryId) &&
          (!query.authorId || article.author.id === query.authorId) &&
          (!query.tagIds ||
            (query.tagIds as string[]).every((tagId) =>
              article.tags.some((tag) => tag.id === tagId),
            )),
      );
      if (id === 'searchPublicPosts') {
        const terms =
          (query.q as string)
            .toLowerCase()
            .match(/[\p{L}\p{N}]+/gu)
            ?.filter(
              (term) =>
                ![
                  'a',
                  'an',
                  'and',
                  'the',
                  'or',
                  'of',
                  'to',
                  'is',
                  'in',
                  'on',
                  'for',
                ].includes(term),
            ) ?? [];
        if (!terms.length) fail(422, 'SEARCH_QUERY_NOT_SEARCHABLE');
        articles = articles.filter((article) =>
          terms.every((term) =>
            `${article.title} ${article.summary} ${analyzeMarkdown(article.markdown).plainText}`
              .toLowerCase()
              .includes(term),
          ),
        );
        return this.page(
          articles.map((article) => this.publicSummary(article)),
          query,
          20,
          true,
        );
      }
      return this.paginate(
        articles.map((article) => this.publicSummary(article)),
        query,
        id,
        (article) => article.firstPublishedAt,
      );
    }
    if (id === 'getPostByClientDraftId') {
      const post =
        [...this.posts.values()].find(
          (post) =>
            post.creatorId === actor!.id &&
            post.dto.clientDraftId === params.clientDraftId,
        ) ?? fail(404, 'RESOURCE_NOT_FOUND');
      if (actor!.role === 'AUTHOR' && post.dto.author.id !== actor!.id)
        fail(404, 'RESOURCE_NOT_FOUND');
      return { data: this.workspace(this.post(post.dto.id), actor!.id) };
    }
    if (id === 'listWorkspacePosts') {
      if (query.scope === 'ALL' && actor!.role === 'AUTHOR')
        fail(403, 'INSUFFICIENT_PERMISSION');
      const posts = [...this.posts.values()].filter(
        (post) =>
          (query.scope === 'ALL' || post.dto.author.id === actor!.id) &&
          !!post.dto.trashedAt === (query.trashed ?? false) &&
          (!post.dto.purgeAfter ||
            Date.parse(post.dto.purgeAfter) > this.now) &&
          (!query.workflowState ||
            post.dto.workflowState === query.workflowState) &&
          (!query.publicationState ||
            post.dto.publicationState === query.publicationState),
      );
      return this.paginate(
        posts.map((post) => {
          const { workingRevision, publishedRevision, review, ...dto } =
            this.workspace(post, actor!.id);
          return dto;
        }),
        query,
        `${id}:${actor!.id}`,
        (post) => post.updatedAt,
      );
    }
    if (id === 'createPost') {
      const existing = [...this.posts.values()].find(
        (post) =>
          post.creatorId === actor!.id &&
          post.dto.clientDraftId === body.clientDraftId,
      );
      if (existing) {
        this.authorize(operation, actorId, { postId: existing.dto.id });
        fail(409, 'CLIENT_DRAFT_ALREADY_EXISTS', {
          resourceId: existing.dto.id,
          currentVersion: existing.dto.version,
        });
      }
      if (
        [...this.posts.values()].filter(
          (post) => post.dto.author.id === actor!.id && !post.dto.trashedAt,
        ).length >= 100
      )
        fail(409, 'RESOURCE_QUOTA_EXCEEDED');
      const content = normalizeDraft(body.draft);
      const postId = this.id();
      const dto: Post = {
        id: postId,
        clientDraftId: body.clientDraftId as string,
        author: summary(actor!),
        slug: null,
        publicationState: 'NEVER_PUBLISHED',
        workflowState: 'DRAFT',
        version: 1,
        workingRevisionId: null,
        publishedRevisionId: null,
        createdAt: this.iso(),
        updatedAt: this.iso(),
        trashedAt: null,
        purgeAfter: null,
        allowedActions: [],
        workingRevision: null,
        publishedRevision: null,
        review: {
          submittedRevisionId: null,
          submittedAt: null,
          lastFeedback: null,
        },
      };
      const post: StoredPost = {
        dto,
        creatorId: actor!.id,
        revisions: [],
        events: [],
        firstPublishedAt: null,
        lastPublishedAt: null,
      };
      const revision = this.revision(post, actor!, content);
      dto.workingRevision = revision;
      dto.workingRevisionId = revision.id;
      post.revisions.push(revision);
      this.attach(revision);
      this.posts.set(postId, post);
      return {
        data: this.workspace(post, actor!.id),
        location: `/v1/posts/${postId}`,
      };
    }
    if (id === 'getPublicPostMedia' || id === 'getPrivatePostMedia') {
      const post = this.post(params.postId!);
      if (
        id === 'getPublicPostMedia' &&
        !this.publicPost(post).media.some(
          (media) => media.mediaId === params.mediaId,
        )
      )
        fail(404, 'RESOURCE_NOT_FOUND');
      const asset = this.asset(post.dto.id, params.mediaId!);
      const bytes =
        asset.bytes.get(params.variant!) ?? fail(404, 'RESOURCE_NOT_FOUND');
      return { data: null, bytes, mimeType: asset.dto.mimeType };
    }
    if (id === 'stagePostMedia') {
      if (!upload) fail(422, 'VALIDATION_FAILED');
      const post = this.post(params.postId!);
      if (post.dto.trashedAt) fail(409, 'WORKFLOW_CONFLICT');
      const pending = () =>
        [...this.assets.values()]
          .filter(
            (asset) =>
              asset.uploaderId === actor!.id &&
              asset.dto.unattachedExpiresAt &&
              Date.parse(asset.dto.unattachedExpiresAt) > this.now,
          )
          .reduce(
            (sum, asset) =>
              sum +
              [...asset.bytes.values()].reduce(
                (n, bytes) => n + bytes.length,
                0,
              ),
            0,
          );
      const normalized = await normalizeImage(upload.bytes, upload.mimeType);
      this.authorize(operation, actorId, params);
      if (this.post(post.dto.id).dto.trashedAt) fail(409, 'WORKFLOW_CONFLICT');
      if (
        pending() +
          normalized.variants.reduce(
            (sum, variant) => sum + variant.bytes.length,
            0,
          ) >
        100 * 1024 * 1024
      )
        fail(409, 'RESOURCE_QUOTA_EXCEEDED');
      const mediaId = this.id();
      const dto = this.assetDto(post.dto.id, mediaId, normalized);
      this.assets.set(mediaId, {
        dto,
        uploaderId: actor!.id,
        bytes: new Map(
          normalized.variants.map((variant) => [variant.name, variant.bytes]),
        ),
      });
      return {
        data: structuredClone(dto),
        location: `/v1/posts/${post.dto.id}/media/${mediaId}`,
      };
    }
    if (id === 'getPostMediaMetadata')
      return {
        data: structuredClone(this.asset(params.postId!, params.mediaId!).dto),
      };
    if (/Categor|Category|Tag/.test(id))
      return this.taxonomy(id, params, query, body);
    if (id === 'listMembers')
      return this.paginate(
        [...this.members.values()].filter(
          (member) =>
            (!query.role || member.role === query.role) &&
            (query.active === undefined || member.active === query.active),
        ),
        query,
        id,
        (member) => member.createdAt,
      );
    if (id === 'getMember')
      return {
        data: structuredClone(
          this.members.get(params.memberId!) ?? fail(404, 'RESOURCE_NOT_FOUND'),
        ),
      };
    if (id === 'updateMember') {
      const member =
        this.members.get(params.memberId!) ?? fail(404, 'RESOURCE_NOT_FOUND');
      const role = (body.role as Member['role'] | undefined) ?? member.role;
      const active = (body.active as boolean | undefined) ?? member.active;
      if (
        member.active &&
        member.role === 'ADMIN' &&
        (!active || role !== 'ADMIN') &&
        [...this.members.values()].filter(
          (member) => member.active && member.role === 'ADMIN',
        ).length === 1
      )
        fail(409, 'LAST_ADMIN_REQUIRED');
      if (role !== member.role || active !== member.active) {
        member.role = role;
        member.active = active;
        member.version++;
        member.updatedAt = this.iso();
      }
      return { data: structuredClone(member) };
    }
    if (id === 'listInvitations')
      return this.paginate(
        [...this.invitations.keys()]
          .map((id) => this.invitation(id))
          .filter(
            (invitation) => !query.status || invitation.status === query.status,
          ),
        query,
        id,
        (invitation) => invitation.createdAt,
      );
    if (id === 'getInvitation')
      return { data: this.invitation(params.invitationId!) };
    if (id === 'createInvitation') {
      const data = this.issueInvitation(
        body.email as string,
        body.role as Invitation['role'],
        actor!,
      );
      return { data, location: `/v1/admin/invitations/${data.invitation.id}` };
    }
    if (id === 'revokeInvitation' || id === 'reissueInvitation') {
      const old = this.invitation(params.invitationId!);
      if (old.status === 'ACCEPTED') fail(410, 'INVITATION_USED');
      if (id === 'reissueInvitation') {
        const data = this.issueInvitation(old.email, old.role, actor!, old.id);
        old.status = 'REVOKED';
        old.revokedAt = this.iso();
        old.version++;
        this.invitations.set(old.id, old);
        return {
          data,
          location: `/v1/admin/invitations/${data.invitation.id}`,
        };
      }
      if (old.status !== 'REVOKED') {
        old.status = 'REVOKED';
        old.revokedAt = this.iso();
        old.version++;
        this.invitations.set(old.id, old);
      }
      return { data: old };
    }
    if (id === 'listAuditEvents')
      return this.paginate(
        this.audit.filter(
          (event) =>
            (!query.action || event.action === query.action) &&
            (!query.subjectType || event.subjectType === query.subjectType) &&
            (!query.subjectId || event.subjectId === query.subjectId),
        ),
        query,
        id,
        (event) => event.createdAt,
      );
    return this.editorial(id, actor!, params, query, body);
  }

  private me(member: Member): DTO<'Me'> {
    const { createdAt, updatedAt, ...result } = member;
    return structuredClone(result);
  }
  private publicSummary(article: DTO<'PublicPost'>): DTO<'PublicPostSummary'> {
    const { markdown, markdownContractVersion, media, ...result } = article;
    return result;
  }
  private assetDto(
    postId: string,
    id: string,
    image: NormalizedImage,
  ): DTO<'MediaAsset'> {
    return {
      id,
      postId,
      ready: true,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      createdAt: this.iso(),
      unattachedExpiresAt: this.iso(DAY),
      variants: image.variants.map((variant) => ({
        name: variant.name,
        width: variant.width,
        height: variant.height,
        mimeType: image.mimeType,
        apiPath: `/v1/posts/${postId}/media/${id}/${variant.name}`,
        byteSize: variant.bytes.length,
      })),
    };
  }
  recordAudit(
    actorId: string | undefined,
    operation: Operation,
    params: Record<string, string>,
    result: Result,
  ): void {
    const actor = this.members.get(actorId!);
    if (!actor || !operation.idempotent) return;
    const data = result.data as { id?: string; invitation?: Invitation };
    const subjectId =
      params.postId ??
      params.memberId ??
      params.categoryId ??
      params.tagId ??
      params.invitationId ??
      data?.id ??
      data?.invitation?.id ??
      actor.id;
    this.audit.push({
      id: this.id(),
      actor: summary(actor),
      action: operation.operationId,
      subjectType: /Invitation/.test(operation.operationId)
        ? 'INVITATION'
        : /Member|Me/.test(operation.operationId)
          ? 'MEMBER'
          : /Category|Tag/.test(operation.operationId)
            ? 'TAXON'
            : 'POST',
      subjectId,
      createdAt: this.iso(),
      changes: {},
    });
  }
  private taxonomy(
    id: string,
    params: Record<string, string>,
    query: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Result {
    const map = /Categor|Category/.test(id) ? this.categories : this.tags;
    const resourceId = params.categoryId ?? params.tagId;
    const publicDto = (taxon: Taxon): DTO<'Taxon'> => ({
      id: taxon.id,
      name: taxon.name,
      slug: taxon.slug,
      active: taxon.active,
    });
    const managedDto = (taxon: Taxon): Taxon => {
      const publishedCount = [...this.posts.values()].filter(
        (post) =>
          post.dto.publicationState === 'PUBLISHED' &&
          !post.dto.trashedAt &&
          post.dto.publishedRevision &&
          (post.dto.publishedRevision.content.categoryId === taxon.id ||
            post.dto.publishedRevision.content.tagIds.includes(taxon.id)),
      ).length;
      const draftCount = [...this.posts.values()].filter(
        (post) =>
          !post.dto.trashedAt &&
          post.dto.workingRevision &&
          (post.dto.workingRevision.content.categoryId === taxon.id ||
            post.dto.workingRevision.content.tagIds.includes(taxon.id)),
      ).length;
      return {
        ...structuredClone(taxon),
        usage: { publishedCount, draftCount },
      };
    };
    if (id.startsWith('list')) {
      const entries = [...map.values()]
        .filter(
          (entry) =>
            query.active === undefined || entry.active === query.active,
        )
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
      return this.page(
        entries.map((entry) =>
          id.includes('Public') ? publicDto(entry) : managedDto(entry),
        ),
        query,
      );
    }
    if (id.startsWith('get'))
      return {
        data: managedDto(
          map.get(resourceId!) ?? fail(404, 'RESOURCE_NOT_FOUND'),
        ),
      };
    const name = (body.name as string | undefined)?.trim().normalize('NFC');
    if (
      name &&
      [...map.values()].some(
        (entry) =>
          entry.id !== resourceId &&
          entry.name.toLocaleLowerCase('en') === name.toLocaleLowerCase('en'),
      )
    )
      fail(409, 'WORKFLOW_CONFLICT');
    if (id.startsWith('create')) {
      if ([...map.values()].some((entry) => entry.slug === body.slug))
        fail(409, 'SLUG_CONFLICT');
      const taxon: Taxon = {
        id: this.id(),
        name: name!,
        slug: body.slug as string,
        active: true,
        version: 1,
        createdAt: this.iso(),
        updatedAt: this.iso(),
        usage: { publishedCount: 0, draftCount: 0 },
      };
      map.set(taxon.id, taxon);
      return {
        data: managedDto(taxon),
        location: `/v1/${map === this.categories ? 'categories' : 'tags'}/${taxon.id}`,
      };
    }
    const taxon = map.get(resourceId!) ?? fail(404, 'RESOURCE_NOT_FOUND');
    if (
      (name !== undefined && name !== taxon.name) ||
      (body.active !== undefined && body.active !== taxon.active)
    ) {
      if (name !== undefined) taxon.name = name;
      if (body.active !== undefined) taxon.active = body.active as boolean;
      taxon.version++;
      taxon.updatedAt = this.iso();
    }
    return { data: managedDto(taxon) };
  }
  private editorial(
    id: string,
    actor: Member,
    params: Record<string, string>,
    query: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Result {
    const post = this.post(params.postId!);
    const dto = post.dto;
    if (id === 'getWorkspacePost')
      return { data: this.workspace(post, actor.id) };
    if (id === 'listPostRevisions')
      return this.paginate(
        post.revisions.map((revision) => ({
          id: revision.id,
          postId: dto.id,
          number: revision.number,
          title: revision.content.title,
          createdBy: summary(revision.createdBy),
          createdAt: revision.createdAt,
        })),
        query,
        `${id}:${dto.id}:${actor.id}`,
        (revision) => revision.number.toString().padStart(10, '0'),
      );
    if (id === 'getPostRevision')
      return {
        data: structuredClone(
          post.revisions.find(
            (revision) => revision.id === params.revisionId,
          ) ?? fail(404, 'RESOURCE_NOT_FOUND'),
        ),
      };
    if (id === 'listPostReviewEvents')
      return this.paginate(
        post.events,
        query,
        `${id}:${dto.id}:${actor.id}`,
        (event) => event.createdAt,
      );
    if (dto.trashedAt && id !== 'restoreTrashedPost' && id !== 'trashPost')
      fail(409, 'WORKFLOW_CONFLICT');
    if (
      id === 'savePostDraft' ||
      id === 'restorePostRevision' ||
      id === 'reassignPostAuthor'
    ) {
      if (dto.workflowState === 'IN_REVIEW') fail(409, 'WORKFLOW_CONFLICT');
      let content: DraftContent;
      let restored: string | null = null;
      let newAuthor: Member | undefined;
      if (id === 'savePostDraft')
        content = normalizeDraft(body, dto.workingRevision?.content);
      else if (id === 'restorePostRevision') {
        const old =
          post.revisions.find((revision) => revision.id === body.revisionId) ??
          fail(404, 'RESOURCE_NOT_FOUND');
        content = structuredClone(old.content);
        restored = old.id;
      } else {
        newAuthor =
          this.members.get(body.authorId as string) ??
          fail(404, 'RESOURCE_NOT_FOUND');
        if (!newAuthor.active) fail(409, 'WORKFLOW_CONFLICT');
        if (
          newAuthor.id !== dto.author.id &&
          [...this.posts.values()].filter(
            (item) =>
              item.dto.author.id === newAuthor!.id && !item.dto.trashedAt,
          ).length >= 100
        )
          fail(409, 'RESOURCE_QUOTA_EXCEEDED');
        content = structuredClone(dto.workingRevision!.content);
      }
      if (
        id === 'savePostDraft' &&
        digest(content) === digest(dto.workingRevision!.content)
      )
        return { data: this.workspace(post, actor.id) };
      if (newAuthor?.id === dto.author.id)
        return { data: this.workspace(post, actor.id) };
      const revision = this.revision(post, actor, content, restored);
      if (newAuthor) {
        dto.author = summary(newAuthor);
        revision.creditedAuthor = summary(newAuthor);
      }
      dto.workingRevision = revision;
      dto.workingRevisionId = revision.id;
      post.revisions.push(revision);
      this.attach(revision);
      dto.workflowState = 'DRAFT';
      this.touch(post);
    } else if (id === 'submitPostForReview') {
      if (
        dto.workflowState === 'IN_REVIEW' ||
        dto.workflowState === 'CLEAN' ||
        body.revisionId !== dto.workingRevisionId
      )
        fail(409, 'WORKFLOW_CONFLICT');
      this.publicationReady(post, dto.workingRevision!);
      dto.workflowState = 'IN_REVIEW';
      dto.review.submittedRevisionId = dto.workingRevisionId;
      dto.review.submittedAt = this.iso();
      this.event(post, actor, 'SUBMITTED', dto.workingRevisionId!);
      this.touch(post);
    } else if (
      [
        'withdrawPostReview',
        'rejectPostRevision',
        'publishPostRevision',
      ].includes(id)
    ) {
      if (
        dto.workflowState !== 'IN_REVIEW' ||
        !dto.review.submittedRevisionId ||
        (id !== 'withdrawPostReview' &&
          body.revisionId !== dto.review.submittedRevisionId)
      )
        fail(409, 'WORKFLOW_CONFLICT');
      const submitted = post.revisions.find(
        (revision) => revision.id === dto.review.submittedRevisionId,
      )!;
      if (id === 'publishPostRevision') {
        this.publicationReady(post, submitted);
        let slug = dto.slug;
        if (!slug) {
          const base =
            submitted.content.title
              .normalize('NFKD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 100)
              .replace(/-$/g, '') || 'article';
          slug = base;
          let suffix = 1;
          while (
            this.slugOwners.has(slug) &&
            this.slugOwners.get(slug) !== dto.id
          )
            slug = `${base}-${++suffix}`;
        }
        dto.slug = slug;
        this.slugOwners.set(slug, dto.id);
        dto.publishedRevision = submitted;
        dto.publishedRevisionId = submitted.id;
        dto.publicationState = 'PUBLISHED';
        dto.workflowState = 'CLEAN';
        post.firstPublishedAt ??= this.iso();
        post.lastPublishedAt = this.iso();
        this.event(post, actor, 'PUBLISHED', submitted.id);
      } else if (id === 'rejectPostRevision') {
        dto.workflowState = 'CHANGES_REQUESTED';
        dto.review.lastFeedback = {
          revisionId: submitted.id,
          actor: summary(actor),
          text: body.feedback as string,
          createdAt: this.iso(),
        };
        this.event(
          post,
          actor,
          'REJECTED',
          submitted.id,
          body.feedback as string,
        );
      } else {
        dto.workflowState = 'DRAFT';
        this.event(post, actor, 'WITHDRAWN', submitted.id);
      }
      dto.review.submittedRevisionId = null;
      dto.review.submittedAt = null;
      this.touch(post);
    } else if (id === 'unpublishPost') {
      if (dto.publicationState !== 'PUBLISHED') fail(409, 'WORKFLOW_CONFLICT');
      dto.publicationState = 'WITHDRAWN';
      this.event(post, actor, 'UNPUBLISHED', dto.publishedRevisionId!);
      this.touch(post);
    } else if (id === 'trashPost') {
      if (!dto.trashedAt) {
        dto.trashedAt = this.iso();
        dto.purgeAfter = this.iso(30 * DAY);
        if (dto.publicationState === 'PUBLISHED')
          dto.publicationState = 'WITHDRAWN';
        dto.workflowState = 'DRAFT';
        dto.review.submittedRevisionId = null;
        dto.review.submittedAt = null;
        this.touch(post);
      }
    } else if (id === 'restoreTrashedPost') {
      if (!dto.trashedAt) fail(409, 'WORKFLOW_CONFLICT');
      dto.trashedAt = null;
      dto.purgeAfter = null;
      dto.publicationState = post.firstPublishedAt
        ? 'WITHDRAWN'
        : 'NEVER_PUBLISHED';
      dto.workflowState = 'DRAFT';
      this.touch(post);
    } else if (id === 'changePostSlug') {
      const slug = body.slug as string;
      if (this.slugOwners.has(slug) && this.slugOwners.get(slug) !== dto.id)
        fail(409, 'SLUG_CONFLICT');
      if (dto.slug !== slug) {
        this.slugOwners.set(slug, dto.id);
        dto.slug = slug;
        this.touch(post);
      }
    } else throw new Error(`Unimplemented mock operation: ${id}`);
    return { data: this.workspace(post, actor.id) };
  }
}
