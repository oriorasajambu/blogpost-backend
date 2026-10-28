import { Inject, Injectable } from '@nestjs/common';
import { AdminOperations } from './admin-operations.js';
import type { VerifiedIdentity } from '../identity/identity.js';
import {
  CursorService,
  afterCursor,
  type CursorQuery,
} from '../../platform/http/cursor.js';
import { ApiError } from '../../platform/errors/api-error.js';
@Injectable()
export class AuditService {
  constructor(
    @Inject(AdminOperations) private readonly operations: AdminOperations,
    @Inject(CursorService) private readonly cursors: CursorService,
  ) {}
  list(identity: VerifiedIdentity, query: CursorQuery) {
    return this.operations.read(identity, async (tx) => {
      const rows = await tx.auditEvent.findMany({
        where: {
          ...query.filters,
          ...afterCursor(
            this.cursors.decode(identity.uid, '/v1/admin/audit-events', query),
          ),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.pageSize + 1,
        include: {
          actor: { select: { id: true, handle: true, displayName: true } },
        },
      });
      const page = this.cursors.page(
        identity.uid,
        '/v1/admin/audit-events',
        query,
        rows,
      );
      return {
        data: page.rows.map((row) => {
          if (!row.actor)
            throw new ApiError(
              503,
              'DEPENDENCY_UNAVAILABLE',
              'Audit unavailable',
              'The audit projection is temporarily unavailable.',
            );
          return {
            id: row.id,
            actor: row.actor,
            action: row.action,
            subjectType: row.subjectType,
            subjectId: row.subjectId,
            changes: row.changes,
            createdAt: row.createdAt.toISOString(),
          };
        }),
        pagination: page.pagination,
      };
    });
  }
}
