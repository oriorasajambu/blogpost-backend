import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  HttpCode,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MemberGuard, principal } from '../identity/member.guard.js';
import {
  VerifiedIdentityGuard,
  verifiedIdentity,
} from '../identity/verified-identity.guard.js';
import { AdminGuard } from '../members/admin.guard.js';
import { operationResponse } from '../members/admin.controller.js';
import {
  InvitationService,
  invitationInput,
  invitationToken,
} from './invitation.service.js';
import { cursorQuery } from '../../platform/http/cursor.js';
import { objectInput, uuidInput } from '../../platform/http/input.js';
import { noQuery } from '../../platform/http/query.js';
import {
  idempotencyKey,
  writePreconditions,
} from '../../platform/http/preconditions.js';
@ApiTags('invitations')
@Controller('v1/admin/invitations')
@UseGuards(MemberGuard, AdminGuard)
export class AdminInvitationsController {
  constructor(
    @Inject(InvitationService) private readonly invitations: InvitationService,
  ) {}
  @Get()
  @ApiOperation({ operationId: 'listInvitations' })
  async list(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.invitations.list(
      principal(request).identity,
      cursorQuery(request, ['status']),
    );
    response.locals.pagination = result.pagination;
    return result.data;
  }
  @Get(':invitationId')
  @ApiOperation({ operationId: 'getInvitation' })
  async get(
    @Param('invitationId') rawId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const invitation = await this.invitations.get(
      principal(request).identity,
      uuidInput(rawId, 'invitationId'),
    );
    response.setHeader('X-Resource-Version', String(invitation.version));
    return invitation;
  }
  @Post()
  @ApiOperation({ operationId: 'createInvitation' })
  async create(
    @Body() value: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const input = invitationInput(value);
    return operationResponse(
      response,
      await this.invitations.create(
        principal(request).identity,
        input,
        idempotencyKey(request),
        response.locals.traceId as string,
      ),
    );
  }
  @Post(':invitationId/revoke')
  @HttpCode(200)
  @ApiOperation({ operationId: 'revokeInvitation' })
  revoke(
    @Param('invitationId') rawId: string,
    @Body() value: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.change(rawId, 'revoke', value, request, response);
  }
  @Post(':invitationId/reissue')
  @ApiOperation({ operationId: 'reissueInvitation' })
  reissue(
    @Param('invitationId') rawId: string,
    @Body() value: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.change(rawId, 'reissue', value, request, response);
  }
  private async change(
    rawId: string,
    action: 'revoke' | 'reissue',
    value: unknown,
    request: Request,
    response: Response,
  ) {
    noQuery(request);
    objectInput(value, []);
    const { expectedVersion, key } = writePreconditions(request);
    const result = await this.invitations.change(
      principal(request).identity,
      uuidInput(rawId, 'invitationId'),
      action,
      expectedVersion,
      key,
      response.locals.traceId as string,
    );
    return operationResponse(response, result);
  }
}
@ApiTags('invitations')
@Controller('v1/invitations')
@UseGuards(VerifiedIdentityGuard)
export class InvitationAcceptanceController {
  constructor(
    @Inject(InvitationService) private readonly invitations: InvitationService,
  ) {}
  @Post('accept')
  @HttpCode(200)
  @ApiOperation({ operationId: 'acceptInvitation' })
  async accept(
    @Body() value: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const result = await this.invitations.accept(
      verifiedIdentity(request),
      invitationToken(value),
      idempotencyKey(request),
      response.locals.traceId as string,
    );
    response.locals.actorId = result.data.id;
    return operationResponse(response, result);
  }
}
