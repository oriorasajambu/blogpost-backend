import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { DatabaseService } from '../../platform/database/database.service.js';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    if (!(await this.database.ready())) throw new ServiceUnavailableException();
    return { status: 'ok' };
  }
}
