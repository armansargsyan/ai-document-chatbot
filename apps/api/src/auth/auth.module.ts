import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { FirebaseTokenVerifier } from './firebase-token-verifier';
import { TokenVerifier } from './token-verifier';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: TokenVerifier, useClass: FirebaseTokenVerifier },
    // Applied to every route; opt out with @Public().
    { provide: APP_GUARD, useClass: FirebaseAuthGuard },
  ],
})
export class AuthModule {}
