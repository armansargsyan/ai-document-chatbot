import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './firebase-auth.guard';
import type { AuthUser } from './token-verifier';

/**
 * Injects the user verified by `FirebaseAuthGuard`. Throws 401 if there is none
 * (e.g. the route was marked `@Public()`), rather than handing handlers `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new UnauthorizedException();
    return user;
  },
);
