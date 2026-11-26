import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/token-verifier';
import type { UsageResponse } from '@ai-document-chatbot/shared';
import { UsageService } from './usage.service';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** The caller's demo limits and how much of each is used. */
  @Get()
  get(@CurrentUser() user: AuthUser): Promise<UsageResponse> {
    return this.usage.getUsage(user.uid);
  }
}
