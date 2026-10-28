import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../platform/config/config.js';
import { DatabaseService } from '../platform/database/database.service.js';
import { FirebaseIdentityGateway } from '../modules/identity/firebase-identity.gateway.js';
import { IdentityService } from '../modules/identity/identity.service.js';
import { MembersRepository } from '../modules/members/members.repository.js';
import { bootstrapAdmin } from '../modules/members/bootstrap-admin.js';
import { runJob } from './run.js';

await runJob(async () => {
  const config = readConfig(process.env, 'bootstrap-admin');
  const gateway = new FirebaseIdentityGateway(config);
  const database = new DatabaseService(2);
  try {
    const uid = process.env.INITIAL_ADMIN_UID;
    const email = process.env.INITIAL_ADMIN_EMAIL;
    const displayName = process.env.INITIAL_ADMIN_DISPLAY_NAME;
    const handle = process.env.INITIAL_ADMIN_HANDLE;
    if (!uid || !email || !displayName || !handle)
      throw new Error('Missing first-administrator input');
    const member = await bootstrapAdmin(
      new IdentityService(gateway, config),
      new MembersRepository(database),
      { uid, email, displayName, handle },
      randomBytes(16).toString('hex'),
    );
    process.stdout.write(
      JSON.stringify({
        event: 'administrator_initialized',
        memberId: member.id,
      }) + '\n',
    );
  } finally {
    await gateway.onModuleDestroy();
    await database.onModuleDestroy();
  }
});
