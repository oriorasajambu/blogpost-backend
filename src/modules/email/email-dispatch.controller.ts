import { Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { EmailOutboxService } from './email-outbox.service.js';
import { SchedulerGuard } from './scheduler-oidc.js';

/** Called every 2 minutes by Cloud Scheduler to retry queued invitation email. Not public API. */
@ApiExcludeController()
@Controller('internal/email-outbox')
export class EmailDispatchController {
  constructor(
    @Inject(EmailOutboxService) private readonly outbox: EmailOutboxService,
  ) {}
  @Post('dispatch')
  @HttpCode(200)
  @UseGuards(SchedulerGuard)
  dispatch() {
    return this.outbox.dispatchDue();
  }
}
