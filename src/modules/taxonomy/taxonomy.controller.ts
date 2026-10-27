import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MemberGuard, principal } from '../identity/member.guard.js';
import { EditorGuard } from '../members/editor-operations.js';
import { operationResponse } from '../members/admin.controller.js';
import {
  TaxonomyService,
  taxonInput,
  type TaxonKind,
} from './taxonomy.service.js';
import { pageQuery } from '../../platform/http/collections.js';
import { uuidInput } from '../../platform/http/input.js';
import { noQuery } from '../../platform/http/query.js';
import {
  idempotencyKey,
  writePreconditions,
} from '../../platform/http/preconditions.js';

@ApiTags('taxonomy')
@Controller('v1')
@UseGuards(MemberGuard, EditorGuard)
export class TaxonomyController {
  constructor(
    @Inject(TaxonomyService) private readonly taxonomy: TaxonomyService,
  ) {}
  private async list(kind: TaxonKind, request: Request, response: Response) {
    const result = await this.taxonomy.list(
      principal(request).identity,
      kind,
      pageQuery(request, true),
    );
    response.locals.pagination = result.pagination;
    return result.data;
  }
  private async get(
    kind: TaxonKind,
    rawId: string,
    request: Request,
    response: Response,
  ) {
    noQuery(request);
    const id = uuidInput(rawId, kind === 'categories' ? 'categoryId' : 'tagId');
    const result = await this.taxonomy.get(
      principal(request).identity,
      kind,
      id,
    );
    response.setHeader('X-Resource-Version', String(result.version));
    return result;
  }
  private async write(
    kind: TaxonKind,
    rawId: string | null,
    body: unknown,
    request: Request,
    response: Response,
  ) {
    noQuery(request);
    const id =
      rawId === null
        ? null
        : uuidInput(rawId, kind === 'categories' ? 'categoryId' : 'tagId');
    const conditions = id
      ? writePreconditions(request)
      : { key: idempotencyKey(request), expectedVersion: undefined };
    return operationResponse(
      response,
      await this.taxonomy.write(
        principal(request).identity,
        kind,
        id,
        taxonInput(body, id === null),
        conditions.key,
        response.locals.traceId as string,
        conditions.expectedVersion,
      ),
    );
  }
  @Get('categories')
  @ApiOperation({ operationId: 'listManagedCategories' })
  categories(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.list('categories', request, response);
  }
  @Get('tags')
  @ApiOperation({ operationId: 'listManagedTags' })
  tags(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.list('tags', request, response);
  }
  @Get('categories/:categoryId')
  @ApiOperation({ operationId: 'getManagedCategory' })
  category(
    @Param('categoryId') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.get('categories', id, request, response);
  }
  @Get('tags/:tagId')
  @ApiOperation({ operationId: 'getManagedTag' })
  tag(
    @Param('tagId') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.get('tags', id, request, response);
  }
  @Post('categories')
  @ApiOperation({ operationId: 'createCategory' })
  createCategory(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.write('categories', null, body, request, response);
  }
  @Post('tags')
  @ApiOperation({ operationId: 'createTag' })
  createTag(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.write('tags', null, body, request, response);
  }
  @Patch('categories/:categoryId')
  @ApiOperation({ operationId: 'updateCategory' })
  updateCategory(
    @Param('categoryId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.write('categories', id, body, request, response);
  }
  @Patch('tags/:tagId')
  @ApiOperation({ operationId: 'updateTag' })
  updateTag(
    @Param('tagId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.write('tags', id, body, request, response);
  }
}
