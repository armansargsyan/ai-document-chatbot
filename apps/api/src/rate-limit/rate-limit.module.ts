import { Module, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, type ThrottlerOptions } from '@nestjs/throttler';
import {
  AppConfigService,
  type RateLimitConfig,
} from '../config/app-config.service';
import { rateLimitKindOf, type RateLimitKind } from './rate-limit.decorator';
import { UserThrottlerGuard } from './user-throttler.guard';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Each window only applies to routes marked with its kind. Windows roll
 * (`blockDuration: 0`): a user over a limit can retry as soon as their oldest
 * counted request leaves the window, instead of being locked out for a full ttl.
 * Windows are checked shortest first, so a request rejected by the minute window
 * never spends the daily budget (the reverse order would).
 */
export function buildThrottlers(limits: RateLimitConfig): ThrottlerOptions[] {
  const only = (kind: RateLimitKind) => (context: ExecutionContext) =>
    rateLimitKindOf(context) !== kind;
  return [
    {
      name: 'chat-minute',
      ttl: MINUTE,
      limit: limits.chatPerMinute,
      blockDuration: 0,
      skipIf: only('chat'),
    },
    {
      name: 'chat-day',
      ttl: DAY,
      limit: limits.chatPerDay,
      blockDuration: 0,
      skipIf: only('chat'),
    },
    {
      name: 'upload-hour',
      ttl: HOUR,
      limit: limits.uploadsPerHour,
      blockDuration: 0,
      skipIf: only('upload'),
    },
    {
      name: 'upload-day',
      ttl: DAY,
      limit: limits.uploadsPerDay,
      blockDuration: 0,
      skipIf: only('upload'),
    },
  ];
}

/**
 * Per-user limits for chat messages and uploads, held in memory per api
 * instance. Must be imported after AuthModule so its global guard runs after
 * authentication (limits are keyed by uid).
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: buildThrottlers(config.rateLimits),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class RateLimitModule {}
