import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { CONTRACT_VERSION } from '../../platform/http/envelope.js';

export { APP_CONFIG } from '../../platform/config/config.js';
export const API_LIMITS = {
  defaultPageSize: 20,
  maxPageSize: 50,
  defaultTaxonomyPageSize: 50,
  maxSearchResults: 1000,
  maxMarkdownBytes: 131072,
  maxJsonBodyBytes: 1048576,
  maxUploadFileBytes: 5242880,
  maxMultipartBodyBytes: 6291456,
  maxImagePixels: 12000000,
  maxTagsPerPost: 5,
  maxAvailabilityIds: 50,
  maxActivePostsPerMember: 100,
  maxPendingUploadBytesPerMember: 104857600,
  idempotencyTtlSeconds: 86400,
  unattachedMediaTtlSeconds: 86400,
  invitationTtlSeconds: 604800,
};
@ApiTags('meta')
@Controller('v1/meta')
export class MetaController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  @Get()
  @ApiOperation({ operationId: 'getApiMeta' })
  get() {
    return {
      apiMajor: 1,
      contractVersion: CONTRACT_VERSION,
      markdownContractVersion: 1,
      buildSha: this.config.buildSha,
      features: [],
      limits: API_LIMITS,
      clients: {
        web: { recommendedVersion: '0.0.0', minimumSupportedVersion: null },
        android: { recommendedVersion: '0.0.0', minimumSupportedVersion: null },
      },
      lifecycle: {
        status: 'ACTIVE',
        successorApiMajor: null,
        noticePublishedAt: null,
        deprecatedAt: null,
        sunsetAt: null,
        migrationGuidePath: null,
      },
      deployment: {
        environment: this.config.environment,
        revision: this.config.revision,
        runtimeInputDigest: this.config.runtimeInputDigest,
        configurationDigest: this.config.configurationDigest,
      },
    };
  }
}
