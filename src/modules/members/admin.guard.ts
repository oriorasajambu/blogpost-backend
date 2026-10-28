import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../../platform/errors/api-error.js';
import { principal } from '../identity/member.guard.js';
import type { MemberRow } from './member.js';
export function administrator(member: MemberRow): MemberRow {
  if (member.role !== 'ADMIN')
    throw new ApiError(
      403,
      'INSUFFICIENT_PERMISSION',
      'Administrator required',
      'This operation requires current administrator access.',
    );
  return member;
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    administrator(
      principal(context.switchToHttp().getRequest<Request>()).member,
    );
    return true;
  }
}
