import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { connection } from './connection.js';

export const SCHEMA_VERSION = 1;
export const DATABASE_POOL_LIMIT = Symbol('DATABASE_POOL_LIMIT');
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly prisma: PrismaClient;
  constructor(
    @Optional() @Inject(DATABASE_POOL_LIMIT) maxConnections?: number,
  ) {
    const config = connection('app');
    if (maxConnections !== undefined) {
      if (
        !Number.isInteger(maxConnections) ||
        maxConnections < 1 ||
        maxConnections > config.max!
      )
        throw new Error('Invalid database pool limit');
      config.max = maxConnections;
    }
    this.prisma = new PrismaClient({
      adapter: new PrismaPg(config, { schema: 'blogpost' }),
    });
  }
  async ready(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<
        { version: number }[]
      >`SELECT version FROM blogpost."SchemaMeta" WHERE id = 1 AND to_regclass('blogpost."MediaUploadAttempt"') IS NOT NULL
        AND to_regclass('blogpost."MaintenanceCheckpoint"') IS NOT NULL
        AND has_table_privilege(current_user, 'blogpost."MediaUploadAttempt"', 'SELECT')
        AND has_table_privilege(current_user, 'blogpost."MediaUploadAttempt"', 'INSERT')
        AND has_table_privilege(current_user, 'blogpost."MediaUploadAttempt"', 'UPDATE')
        AND has_table_privilege(current_user, 'blogpost."MediaUploadAttempt"', 'DELETE')`;
      return rows[0]?.version === SCHEMA_VERSION;
    } catch {
      return false;
    }
  }
  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
