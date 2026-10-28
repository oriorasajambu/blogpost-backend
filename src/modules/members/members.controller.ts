import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MemberGuard, principal } from '../identity/member.guard.js';
import { noQuery } from '../../platform/http/query.js';
import { writePreconditions } from '../../platform/http/preconditions.js';
import { ProfileService, profilePatch } from './profile.service.js';
import { toMe } from './member.js';

@ApiTags('members')
@Controller('v1/me')
@UseGuards(MemberGuard)
export class MembersController {
  constructor(
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}
  @Get()
  @ApiOperation({ operationId: 'getMe' })
  get(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noQuery(request);
    const member = principal(request).member;
    response.setHeader('X-Resource-Version', String(member.version));
    return toMe(member);
  }
  @Patch()
  @ApiOperation({ operationId: 'updateMe' })
  async update(
    @Req() request: Request,
    @Body() value: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const input = profilePatch(value);
    const { expectedVersion, key } = writePreconditions(request);
    const result = await this.profiles.update(
      principal(request).identity,
      input,
      expectedVersion,
      key,
      response.locals.traceId as string,
    );
    response.setHeader('X-Resource-Version', String(result.data.version));
    response.locals.idempotency = {
      replayed: result.replayed,
      expiresAt: result.expiresAt,
    };
    return result.data;
  }
}
