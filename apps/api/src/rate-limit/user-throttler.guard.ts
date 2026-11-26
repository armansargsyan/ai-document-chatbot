import {
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/firebase-auth.guard';
import { rateLimitKindOf, type RateLimitKind } from './rate-limit.decorator';

function wait(seconds: number): string {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.ceil(minutes / 60)} hours`;
}

export function limitMessage(
  kind: RateLimitKind,
  retryAfterSeconds: number,
): string {
  const when = `Try again in ${wait(retryAfterSeconds)}.`;
  return kind === 'upload'
    ? `You've reached the upload limit. ${when}`
    : `You're sending messages too quickly. ${when}`;
}

/**
 * Throttles per Firebase uid (never by IP). Runs after FirebaseAuthGuard, so
 * `request.user` is set on every route it applies to. Every request to a
 * limited route counts, including ones that later fail validation.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const uid = (req as unknown as AuthenticatedRequest).user?.uid;
    // Limited routes are never public; refuse rather than share one bucket.
    if (!uid) throw new UnauthorizedException();
    return uid;
  }

  /**
   * One budget per window and user, shared by every route of that kind (the
   * default key is per route, so a second `@RateLimit('chat')` route would
   * otherwise double the limit). Window names include the kind.
   */
  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    throttlerName: string,
  ): string {
    return `${throttlerName}:${tracker}`;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfter = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(retryAfter));
    throw new ThrottlerException(
      limitMessage(rateLimitKindOf(context) ?? 'chat', retryAfter),
    );
  }
}
