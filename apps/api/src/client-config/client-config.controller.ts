import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { ClientConfigResponse } from '@ai-document-chatbot/shared';
import { Public } from '../auth/public.decorator';
import { AppConfigService } from '../config/app-config.service';

@Controller('config')
export class ClientConfigController {
  constructor(private readonly config: AppConfigService) {}

  /** Public: the web app needs this before anyone can sign in. */
  @Public()
  @Get()
  get(): ClientConfigResponse {
    const config = this.config.clientConfig;
    if (!config) {
      throw new ServiceUnavailableException('Sign-in is not configured');
    }
    return config;
  }
}
