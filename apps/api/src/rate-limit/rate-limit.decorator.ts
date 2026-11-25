import { SetMetadata, type ExecutionContext } from '@nestjs/common';

export type RateLimitKind = 'chat' | 'upload';

const RATE_LIMIT_KEY = 'rateLimitKind';

/**
 * Applies the per-user limits for `kind` to a route. Routes without it are
 * not rate limited. Requires an authenticated route (limits are keyed by uid).
 */
export const RateLimit = (kind: RateLimitKind) =>
  SetMetadata(RATE_LIMIT_KEY, kind);

export function rateLimitKindOf(
  context: ExecutionContext,
): RateLimitKind | undefined {
  return (
    Reflect.getMetadata(RATE_LIMIT_KEY, context.getHandler()) ??
    Reflect.getMetadata(RATE_LIMIT_KEY, context.getClass())
  );
}
