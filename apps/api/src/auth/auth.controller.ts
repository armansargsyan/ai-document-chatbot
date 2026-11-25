import { Controller, Get } from '@nestjs/common';
import type { MeResponse } from '@ai-document-chatbot/shared';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './token-verifier';

@Controller('auth')
export class AuthController {
  /** The signed-in user, as verified from their ID token. */
  @Get('me')
  me(@CurrentUser() user: AuthUser): MeResponse {
    return {
      uid: user.uid,
      email: user.email,
      name: user.name,
      picture: user.picture,
    };
  }
}
