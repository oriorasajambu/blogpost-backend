import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MemberGuard, principal } from '../identity/member.guard.js';
import { noQuery } from '../../platform/http/query.js';
import { AccountSecurityService } from './account-security.service.js';

@ApiTags('members')
@Controller('v1/me')
@UseGuards(MemberGuard)
export class AccountSecurityController {
  constructor(
    @Inject(AccountSecurityService)
    private readonly security: AccountSecurityService,
  ) {}
  @Post('password')
  @HttpCode(202)
  @ApiOperation({ operationId: 'changePassword' })
  password(
    @Req() request: Request,
    @Body() value: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    return this.security.changePassword(
      principal(request).identity,
      value,
      response.locals.traceId as string,
    );
  }
  @Post('email-change')
  @HttpCode(202)
  @ApiOperation({ operationId: 'requestEmailChange' })
  email(
    @Req() request: Request,
    @Body() value: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    return this.security.requestEmailChange(
      principal(request).identity,
      value,
      response.locals.traceId as string,
    );
  }
}
