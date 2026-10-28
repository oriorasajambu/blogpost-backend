import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from './platform/config/config.js';
import { DatabaseService } from './platform/database/database.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { APP_CONFIG, MetaController } from './modules/meta/meta.controller.js';
import { IdentityController } from './modules/identity/identity.controller.js';
import { IDENTITY_GATEWAY } from './modules/identity/identity.js';
import { FirebaseIdentityGateway } from './modules/identity/firebase-identity.gateway.js';
import { IdentityService } from './modules/identity/identity.service.js';
import { MemberGuard } from './modules/identity/member.guard.js';
import { SessionService } from './modules/identity/session.service.js';
import { MembersRepository } from './modules/members/members.repository.js';
import { MembershipService } from './modules/members/membership.service.js';
import { ProfileService } from './modules/members/profile.service.js';
import { MembersController } from './modules/members/members.controller.js';
import { CursorService } from './platform/http/cursor.js';
import { VerifiedIdentityGuard } from './modules/identity/verified-identity.guard.js';
import { AdminGuard } from './modules/members/admin.guard.js';
import { AdminOperations } from './modules/members/admin-operations.js';
import { AdminMembersService } from './modules/members/admin-members.service.js';
import { AuditService } from './modules/members/audit.service.js';
import { AdminController } from './modules/members/admin.controller.js';
import { InvitationService } from './modules/invitations/invitation.service.js';
import { PostsRepository } from './modules/posts/posts.repository.js';
import { PostsService } from './modules/posts/posts.service.js';
import { PublicPostsService } from './modules/posts/public-posts.service.js';
import { PublicPostsController } from './modules/posts/public-posts.controller.js';
import { TaxonomyService } from './modules/taxonomy/taxonomy.service.js';
import { TaxonomyController } from './modules/taxonomy/taxonomy.controller.js';
import { MediaRepository } from './modules/media/media.repository.js';
import { MediaService } from './modules/media/media.service.js';
import {
  MediaController,
  PublicMediaController,
} from './modules/media/media.controller.js';
import { MEDIA_STORAGE, StorageAdapter } from './modules/media/storage.js';
import {
  EditorOperations,
  EditorGuard,
} from './modules/members/editor-operations.js';
import {
  PostsController,
  PostAttributionController,
} from './modules/posts/posts.controller.js';
import {
  AdminInvitationsController,
  InvitationAcceptanceController,
} from './modules/invitations/invitations.controller.js';

@Module({})
export class AppModule {
  static configure(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        MetaController,
        IdentityController,
        MembersController,
        AdminController,
        AdminInvitationsController,
        InvitationAcceptanceController,
        PostsController,
        PostAttributionController,
        PublicPostsController,
        TaxonomyController,
        MediaController,
        PublicMediaController,
      ],
      providers: [
        DatabaseService,
        { provide: APP_CONFIG, useValue: config },
        { provide: IDENTITY_GATEWAY, useClass: FirebaseIdentityGateway },
        IdentityService,
        MemberGuard,
        SessionService,
        MembersRepository,
        MembershipService,
        ProfileService,
        CursorService,
        VerifiedIdentityGuard,
        AdminGuard,
        AdminOperations,
        AdminMembersService,
        AuditService,
        InvitationService,
        PostsRepository,
        PostsService,
        PublicPostsService,
        TaxonomyService,
        EditorOperations,
        EditorGuard,
        MediaRepository,
        MediaService,
        StorageAdapter,
        { provide: MEDIA_STORAGE, useExisting: StorageAdapter },
      ],
    };
  }
}
