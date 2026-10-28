import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../../platform/errors/api-error.js';
import { authenticate } from './verified-identity.guard.js';
import { MembershipService } from '../members/membership.service.js';
import type { MemberRow } from '../members/member.js';
import { IdentityService } from './identity.service.js';
import type { VerifiedIdentity } from './identity.js';

const PRINCIPAL = Symbol('VERIFIED_MEMBER');
export interface Principal {
  identity: VerifiedIdentity;
  member: MemberRow;
}
type MemberRequest = Request & { [PRINCIPAL]?: Principal };
export function principal(request: Request): Principal {
  const value = (request as MemberRequest)[PRINCIPAL];
  if (!value)
    throw new ApiError(
      401,
      'AUTHENTICATION_REQUIRED',
      'Sign in required',
      'Sign in to access staff resources.',
    );
  return value;
}
@Injectable()
export class MemberGuard implements CanActivate {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(MembershipService) private readonly membership: MembershipService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MemberRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const identity = await authenticate(request, this.identity);
    const member = await this.membership.current(
      identity,
      response.locals.traceId as string,
    );
    response.locals.actorId = member.id;
    request[PRINCIPAL] = { identity, member };
    return true;
  }
}
