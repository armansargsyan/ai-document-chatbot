import {
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TokenVerifier, type AuthUser } from './token-verifier';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Global guard: every route requires `Authorization: Bearer <Firebase ID token>`
 * unless marked `@Public()`. On success the verified user is attached to
 * `request.user`. Failures are a generic 401; provider errors and tokens are
 * never echoed back or logged.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(FirebaseAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenVerifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['authorization'];
    const token =
      typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
    if (!token) {
      throw new UnauthorizedException(
        'Missing or malformed Authorization header',
      );
    }

    try {
      request.user = await this.tokenVerifier.verify(token);
      return true;
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      this.logger.debug(
        `ID token rejected${typeof code === 'string' ? ` (${code})` : ''}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
