import type { IdentityService } from '../identity/identity.service.js';
import { MembersRepository, databaseFailure } from './members.repository.js';
import { ApiError } from '../../platform/errors/api-error.js';
import { isUnicodeScalarText } from '../../platform/text/unicode.js';
import { toMe, type Me } from './member.js';
import { lockAdministrativeState } from '../../platform/database/operation.js';

/** Operator-only first administrator creation; never exposed as an HTTP endpoint. */
export async function bootstrapAdmin(
  identity: IdentityService,
  members: MembersRepository,
  input: { uid: string; email: string; displayName: string; handle: string },
  traceId: string,
): Promise<Me> {
  if (
    !input.uid ||
    [...input.uid].length > 128 ||
    !isUnicodeScalarText(input.uid) ||
    input.uid.includes('\0') ||
    !input.displayName.trim() ||
    [...input.displayName].length > 80 ||
    !isUnicodeScalarText(input.displayName) ||
    input.displayName.includes('\0') ||
    input.handle.length > 120 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.handle)
  )
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid administrator',
      'Provide a valid display name and stable handle.',
    );
  const account = await identity.googleAccount(input.email);
  if (account.uid !== input.uid)
    throw new ApiError(
      401,
      'INVALID_CREDENTIAL',
      'Identity mismatch',
      'The supplied UID and verified email must identify the same Google account.',
    );
  try {
    return await members.database.prisma.$transaction(
      async (tx) => {
        await lockAdministrativeState(tx);
        const administrators = await tx.member.findMany({
          where: { role: 'ADMIN', active: true },
        });
        const existing = await tx.member.findUnique({
          where: { identityUid: account.uid },
        });
        if (administrators.length) {
          if (existing?.active && existing.role === 'ADMIN')
            return toMe(existing);
          throw new ApiError(
            409,
            'ADMIN_ALREADY_INITIALIZED',
            'Administrator exists',
            'Use the normal administrative workflow.',
          );
        }
        // Bootstrap is initial setup, not a route to reactivating/escalating an existing member.
        if (
          existing ||
          (await tx.auditEvent.count({
            where: { action: 'INITIAL_ADMIN_BOOTSTRAPPED' },
          }))
        )
          throw new ApiError(
            409,
            'ADMIN_ALREADY_INITIALIZED',
            'Bootstrap unavailable',
            'Use the operator recovery procedure.',
          );
        if (await tx.member.findUnique({ where: { handle: input.handle } }))
          throw new ApiError(
            409,
            'HANDLE_TAKEN',
            'Handle unavailable',
            'Choose another stable handle.',
          );
        const created = await tx.member.create({
          data: {
            identityUid: account.uid,
            email: account.email,
            displayName: input.displayName,
            handle: input.handle,
            role: 'ADMIN',
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId: created.id,
            action: 'INITIAL_ADMIN_BOOTSTRAPPED',
            subjectType: 'MEMBER',
            subjectId: created.id,
            changes: {},
            traceId,
          },
        });
        return toMe(created);
      },
      { maxWait: 3000, timeout: 5000 },
    );
  } catch (error) {
    return databaseFailure(error);
  }
}
