import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MemberGuard, principal } from '../identity/member.guard.js';
import { AdminGuard } from '../members/admin.guard.js';
import { operationResponse } from '../members/admin.controller.js';
import { cursorQuery } from '../../platform/http/cursor.js';
import { uuidInput } from '../../platform/http/input.js';
import { noQuery } from '../../platform/http/query.js';
import {
  idempotencyKey,
  writePreconditions,
} from '../../platform/http/preconditions.js';
import {
  createPostInput,
  postActionInput,
  PostsService,
  type PostAction,
} from './posts.service.js';

@ApiTags('posts')
@Controller('v1/posts')
@UseGuards(MemberGuard)
export class PostsController {
  constructor(@Inject(PostsService) private readonly posts: PostsService) {}
  @Get()
  @ApiOperation({ operationId: 'listWorkspacePosts' })
  async list(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.posts.list(
      principal(request).identity,
      cursorQuery(request, [
        'scope',
        'publicationState',
        'workflowState',
        'trashed',
      ]),
    );
    response.locals.pagination = result.pagination;
    return result.data;
  }
  @Post()
  @ApiOperation({ operationId: 'createPost' })
  async create(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    return operationResponse(
      response,
      await this.posts.create(
        principal(request).identity,
        createPostInput(body),
        idempotencyKey(request),
        response.locals.traceId as string,
      ),
    );
  }
  @Get('by-client-draft-id/:clientDraftId')
  @ApiOperation({ operationId: 'getPostByClientDraftId' })
  async byClient(
    @Param('clientDraftId') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const result = await this.posts.get(
      principal(request).identity,
      uuidInput(id, 'clientDraftId'),
      true,
    );
    response.setHeader('X-Resource-Version', String(result.version));
    return result;
  }
  @Get(':postId')
  @ApiOperation({ operationId: 'getWorkspacePost' })
  async get(
    @Param('postId') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const result = await this.posts.get(
      principal(request).identity,
      uuidInput(id, 'postId'),
    );
    response.setHeader('X-Resource-Version', String(result.version));
    return result;
  }
  @Get(':postId/revisions')
  @ApiOperation({ operationId: 'listPostRevisions' })
  revisions(
    @Param('postId') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.history(id, request, response, 'revisions');
  }
  @Get(':postId/review-events')
  @ApiOperation({ operationId: 'listPostReviewEvents' })
  events(
    @Param('postId') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.history(id, request, response, 'review-events');
  }
  private async history(
    id: string,
    request: Request,
    response: Response,
    kind: 'revisions' | 'review-events',
  ) {
    const result = await this.posts.history(
      principal(request).identity,
      uuidInput(id, 'postId'),
      cursorQuery(request, []),
      kind,
    );
    response.locals.pagination = result.pagination;
    return result.data;
  }
  @Get(':postId/revisions/:revisionId')
  @ApiOperation({ operationId: 'getPostRevision' })
  revision(
    @Param('postId') id: string,
    @Param('revisionId') revisionId: string,
    @Req() request: Request,
  ) {
    noQuery(request);
    return this.posts.revision(
      principal(request).identity,
      uuidInput(id, 'postId'),
      uuidInput(revisionId, 'revisionId'),
    );
  }
  private async mutate(
    action: PostAction,
    id: string,
    body: unknown,
    request: Request,
    response: Response,
  ) {
    noQuery(request);
    const postId = uuidInput(id, 'postId');
    const { expectedVersion, key } = writePreconditions(request);
    return operationResponse(
      response,
      await this.posts.mutate(
        principal(request).identity,
        postId,
        action,
        postActionInput(action, body),
        expectedVersion,
        key,
        response.locals.traceId as string,
      ),
    );
  }
  @Put(':postId/draft')
  @ApiOperation({ operationId: 'savePostDraft' })
  save(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('savePostDraft', id, body, request, response);
  }
  @Post(':postId/submit')
  @ApiOperation({ operationId: 'submitPostForReview' })
  submit(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('submitPostForReview', id, body, request, response);
  }
  @Post(':postId/withdraw-review')
  @ApiOperation({ operationId: 'withdrawPostReview' })
  withdraw(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('withdrawPostReview', id, body, request, response);
  }
  @Post(':postId/reject')
  @ApiOperation({ operationId: 'rejectPostRevision' })
  reject(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('rejectPostRevision', id, body, request, response);
  }
  @Post(':postId/publish')
  @ApiOperation({ operationId: 'publishPostRevision' })
  publish(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('publishPostRevision', id, body, request, response);
  }
  @Post(':postId/unpublish')
  @ApiOperation({ operationId: 'unpublishPost' })
  unpublish(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('unpublishPost', id, body, request, response);
  }
  @Post(':postId/restore-revision')
  @ApiOperation({ operationId: 'restorePostRevision' })
  restoreRevision(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('restorePostRevision', id, body, request, response);
  }
  @Delete(':postId')
  @ApiOperation({ operationId: 'trashPost' })
  trash(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('trashPost', id, body, request, response);
  }
  @Post(':postId/restore')
  @ApiOperation({ operationId: 'restoreTrashedPost' })
  restore(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('restoreTrashedPost', id, body, request, response);
  }
  @Patch(':postId/slug')
  @ApiOperation({ operationId: 'changePostSlug' })
  slug(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mutate('changePostSlug', id, body, request, response);
  }
}

@ApiTags('administration')
@Controller('v1/admin/posts')
@UseGuards(MemberGuard, AdminGuard)
export class PostAttributionController {
  constructor(@Inject(PostsService) private readonly posts: PostsService) {}
  @Patch(':postId/author')
  @ApiOperation({ operationId: 'reassignPostAuthor' })
  async author(
    @Param('postId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const postId = uuidInput(id, 'postId');
    const { expectedVersion, key } = writePreconditions(request);
    return operationResponse(
      response,
      await this.posts.mutate(
        principal(request).identity,
        postId,
        'reassignPostAuthor',
        postActionInput('reassignPostAuthor', body),
        expectedVersion,
        key,
        response.locals.traceId as string,
      ),
    );
  }
}
