import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MemberGuard, principal } from '../identity/member.guard.js';
import { AdminGuard } from './admin.guard.js';
import { AdminMembersService, memberPatch } from './admin-members.service.js';
import { AuditService } from './audit.service.js';
import { cursorQuery } from '../../platform/http/cursor.js';
import { uuidInput } from '../../platform/http/input.js';
import { noQuery } from '../../platform/http/query.js';
import { writePreconditions } from '../../platform/http/preconditions.js';
import type { OperationResult } from '../../platform/database/operation.js';
export function operationResponse<T>(
  response: Response,
  result: OperationResult<T>,
): T {
  response.status(result.status);
  response.setHeader('X-Resource-Version', String(result.version));
  if (result.location) response.setHeader('Location', result.location);
  response.locals.idempotency = {
    replayed: result.replayed,
    expiresAt: result.expiresAt,
  };
  return result.data;
}
@ApiTags('administration')
@Controller('v1/admin')
@UseGuards(MemberGuard, AdminGuard)
export class AdminController {
  constructor(
    @Inject(AdminMembersService) private readonly members: AdminMembersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  @Get('members')
  @ApiOperation({ operationId: 'listMembers' })
  async list(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.members.list(
      principal(request).identity,
      cursorQuery(request, ['role', 'active']),
    );
    response.locals.pagination = result.pagination;
    return result.data;
  }
  @Get('members/:memberId')
  @ApiOperation({ operationId: 'getMember' })
  async get(
    @Param('memberId') rawId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const member = await this.members.get(
      principal(request).identity,
      uuidInput(rawId, 'memberId'),
    );
    response.setHeader('X-Resource-Version', String(member.version));
    return member;
  }
  @Patch('members/:memberId')
  @ApiOperation({ operationId: 'updateMember' })
  async update(
    @Param('memberId') rawId: string,
    @Body() value: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noQuery(request);
    const id = uuidInput(rawId, 'memberId');
    const input = memberPatch(value);
    const { expectedVersion, key } = writePreconditions(request);
    return operationResponse(
      response,
      await this.members.update(
        principal(request).identity,
        id,
        input,
        expectedVersion,
        key,
        response.locals.traceId as string,
      ),
    );
  }
  @Get('audit-events')
  @ApiOperation({ operationId: 'listAuditEvents' })
  async auditEvents(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.audit.list(
      principal(request).identity,
      cursorQuery(request, ['subjectType', 'subjectId', 'action']),
    );
    response.locals.pagination = result.pagination;
    return result.data;
  }
}
