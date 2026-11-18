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
import { AccountsService } from './accounts.service.js';

/** Public account routes; like the credential exchange they are reachable only via the server proxy. */
function proxyOnly(request: Request): void {
  noQuery(request);
  if (request.headers.origin !== undefined)
    throw new ApiError(
      403,
      'INSUFFICIENT_PERMISSION',
      'Server proxy required',
      'This operation is available only through the server proxy.',
    );
}
@ApiTags('identity')
@Controller('v1/auth')
export class AccountsController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}
  @Post('register')
  @HttpCode(202)
  @ApiOperation({ operationId: 'registerAccount' })
  register(
    @Req() request: Request,
    @Body() value: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    proxyOnly(request);
    return this.accounts.register(value, response.locals.traceId as string);
  }
  @Post('verify-email/resend')
  @HttpCode(202)
  @ApiOperation({ operationId: 'resendVerificationEmail' })
  resend(
    @Req() request: Request,
    @Body() value: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    proxyOnly(request);
    return this.accounts.resendVerification(
      value,
      response.locals.traceId as string,
    );
  }
}
