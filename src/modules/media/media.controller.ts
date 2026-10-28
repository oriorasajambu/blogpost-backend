import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MemberGuard, principal } from '../identity/member.guard.js';
import { MediaService } from './media.service.js';
import { parseMultipart } from './multipart.js';
import { idempotencyKey } from '../../platform/http/preconditions.js';
import { invalidInput, uuidInput } from '../../platform/http/input.js';
import { noQuery } from '../../platform/http/query.js';
import type { VariantName } from './image-normalizer.js';
import { storageFailure } from './storage.js';
import { envelope } from '../../platform/http/envelope.js';

function variant(value: string): VariantName {
  if (!['w480', 'w960', 'w1600'].includes(value))
    return invalidInput('/variant', 'path');
  return value as VariantName;
}
function file(
  result: Awaited<ReturnType<MediaService['stream']>>,
  response: Response,
) {
  return new StreamableFile(result.stream, {
    type: result.mimeType,
    length: result.byteSize,
    disposition: 'inline',
  })
    .setErrorLogger(() => {})
    .setErrorHandler(() => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const error = storageFailure();
      response.removeHeader('Content-Length');
      response.removeHeader('Content-Disposition');
      response.setHeader('Retry-After', '1');
      response
        .status(503)
        .json(envelope(response.locals.traceId as string, 503, null, error));
    });
}
@ApiTags('media')
@Controller('v1/posts')
@UseGuards(MemberGuard)
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Post(':postId/media')
  @ApiOperation({ operationId: 'stagePostMedia' })
  async upload(
    @Param('postId') rawId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const id = uuidInput(rawId, 'postId');
    const key = idempotencyKey(request);
    const identity = principal(request).identity;
    await this.media.authorizeUpload(identity, id);
    const input = await parseMultipart(request, response);
    const result = await this.media.upload(
      identity,
      id,
      key,
      input,
      response.locals.traceId as string,
    );
    response.status(result.status);
    if (result.location) response.setHeader('Location', result.location);
    response.locals.idempotency = {
      replayed: result.replayed,
      expiresAt: result.expiresAt,
    };
    return result.data;
  }
  @Get(':postId/media/:mediaId')
  @ApiOperation({ operationId: 'getPostMediaMetadata' })
  metadata(
    @Param('postId') rawId: string,
    @Param('mediaId') rawMedia: string,
    @Req() request: Request,
  ) {
    noQuery(request);
    return this.media.metadata(
      principal(request).identity,
      uuidInput(rawId, 'postId'),
      uuidInput(rawMedia, 'mediaId'),
    );
  }
  @Get(':postId/media/:mediaId/:variant')
  @ApiOperation({ operationId: 'getPrivatePostMedia' })
  async read(
    @Param('postId') rawId: string,
    @Param('mediaId') rawMedia: string,
    @Param('variant') name: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    return file(
      await this.media.stream(
        principal(request).identity,
        uuidInput(rawId, 'postId'),
        uuidInput(rawMedia, 'mediaId'),
        variant(name),
      ),
      response,
    );
  }
}
@ApiTags('public')
@Controller('v1/public/posts')
export class PublicMediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Get(':postId/media/:mediaId/:variant')
  @ApiOperation({ operationId: 'getPublicPostMedia' })
  async read(
    @Param('postId') rawId: string,
    @Param('mediaId') rawMedia: string,
    @Param('variant') name: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    return file(
      await this.media.stream(
        null,
        uuidInput(rawId, 'postId'),
        uuidInput(rawMedia, 'mediaId'),
        variant(name),
      ),
      response,
    );
  }
}
