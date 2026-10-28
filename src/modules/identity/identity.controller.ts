import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiError } from '../../platform/errors/api-error.js';
import { noQuery } from '../../platform/http/query.js';
import { SessionService } from './session.service.js';

@ApiTags('identity')
@Controller('v1/auth')
export class IdentityController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}
  @Post('web-session')
  @HttpCode(200)
  @ApiOperation({ operationId: 'createWebSession' })
  async exchange(
    @Req() request: Request,
    @Body() value: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    if (request.headers.origin !== undefined)
      throw new ApiError(
        403,
        'INSUFFICIENT_PERMISSION',
        'Server proxy required',
        'This credential exchange is available only through the server proxy.',
      );
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !Object.hasOwn(value, 'idToken') ||
      typeof (value as { idToken?: unknown }).idToken !== 'string' ||
      !(value as { idToken: string }).idToken.length ||
      (value as { idToken: string }).idToken.length > 65536
    )
      throw new ApiError(
        422,
        'VALIDATION_FAILED',
        'Invalid sign-in',
        'Provide only the identity token.',
        [
          {
            location: 'body',
            field: '/idToken',
            code: 'INVALID_VALUE',
            params: {},
          },
        ],
      );
    const result = await this.sessions.exchange(
      (value as { idToken: string }).idToken,
      response.locals.traceId as string,
    );
    response.locals.actorId = result.member.id;
    return result;
  }
}
