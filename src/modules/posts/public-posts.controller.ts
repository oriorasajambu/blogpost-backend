import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  availabilityInput,
  PublicPostsService,
} from './public-posts.service.js';
import {
  pageQuery,
  publicQuery,
  slugInput,
} from '../../platform/http/collections.js';
import { noQuery } from '../../platform/http/query.js';
import { uuidInput } from '../../platform/http/input.js';

@ApiTags('public')
@Controller('v1/public')
export class PublicPostsController {
  constructor(
    @Inject(PublicPostsService) private readonly posts: PublicPostsService,
  ) {}
  @Get('posts')
  @ApiOperation({ operationId: 'listPublicPosts' })
  async feed(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.posts.feed(publicQuery(request));
    response.locals.pagination = result.pagination;
    return result.data;
  }
  @Get('posts/by-slug/:slug')
  @ApiOperation({ operationId: 'resolvePublicPostSlug' })
  slug(@Param('slug') slug: string, @Req() request: Request) {
    noQuery(request);
    return this.posts.slug(slugInput(slug, 'slug'));
  }
  @Get('posts/:postId')
  @ApiOperation({ operationId: 'getPublicPost' })
  get(@Param('postId') id: string, @Req() request: Request) {
    noQuery(request);
    return this.posts.get(uuidInput(id, 'postId'));
  }
  @Get('authors/:handle')
  @ApiOperation({ operationId: 'getPublicAuthor' })
  author(@Param('handle') handle: string, @Req() request: Request) {
    noQuery(request);
    return this.posts.author(slugInput(handle, 'handle'));
  }
  @Post('posts/availability')
  @HttpCode(200)
  @ApiOperation({ operationId: 'checkPublicPostAvailability' })
  availability(@Body() body: unknown, @Req() request: Request) {
    noQuery(request);
    return this.posts.availability(availabilityInput(body));
  }
  @Get('search')
  @ApiOperation({ operationId: 'searchPublicPosts' })
  async search(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.posts.search(publicQuery(request, true));
    response.locals.pagination = result.pagination;
    return result.data;
  }
  @Get('categories')
  @ApiOperation({ operationId: 'listPublicCategories' })
  async categories(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.posts.taxonomy('categories', pageQuery(request));
    response.locals.pagination = result.pagination;
    return result.data;
  }
  @Get('tags')
  @ApiOperation({ operationId: 'listPublicTags' })
  async tags(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.posts.taxonomy('tags', pageQuery(request));
    response.locals.pagination = result.pagination;
    return result.data;
  }
}
