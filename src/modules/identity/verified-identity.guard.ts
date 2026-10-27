import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../../platform/errors/api-error.js';
import { validateCredentialSyntax } from '../../platform/http/metadata.js';
import { IdentityService } from './identity.service.js';
import type { VerifiedIdentity } from './identity.js';
const IDENTITY = Symbol('VERIFIED_IDENTITY');
type IdentityRequest = Request & { [IDENTITY]?: VerifiedIdentity };
export function verifiedIdentity(request: Request): VerifiedIdentity {
  const value = (request as IdentityRequest)[IDENTITY];
  if (!value)
    throw new ApiError(
      401,
      'AUTHENTICATION_REQUIRED',
      'Sign in required',
      'Sign in with Google.',
    );
  return value;
}
export async function authenticate(
  request: Request,
  identity: IdentityService,
): Promise<VerifiedIdentity> {
  validateCredentialSyntax(request);
  const bearer = request.headers.authorization;
  const session = request.headers['x-blogpost-web-session'];
  if (!bearer && !session)
    throw new ApiError(
      401,
      'AUTHENTICATION_REQUIRED',
      'Sign in required',
      'Sign in with Google.',
    );
  const value = await identity.verify(
    bearer ? bearer.slice(7) : String(session),
    bearer ? 'id-token' : 'session',
  );
  (request as IdentityRequest)[IDENTITY] = value;
  return value;
}
@Injectable()
export class VerifiedIdentityGuard implements CanActivate {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await authenticate(
      context.switchToHttp().getRequest<Request>(),
      this.identity,
    );
    return true;
  }
}
