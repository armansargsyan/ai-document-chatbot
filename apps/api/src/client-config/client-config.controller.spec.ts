import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { validateEnv } from '../config/env.schema';
import { ClientConfigController } from './client-config.controller';

async function controllerWith(env: Record<string, string>) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        skipProcessEnv: true,
        load: [() => validateEnv(env)],
      }),
    ],
    controllers: [ClientConfigController],
    providers: [AppConfigService],
  }).compile();
  return moduleRef.get(ClientConfigController);
}

const web = {
  FIREBASE_PROJECT_ID: 'demo-project',
  FIREBASE_API_KEY: 'public-web-key',
  FIREBASE_AUTH_DOMAIN: 'demo-project.firebaseapp.com',
  FIREBASE_APP_ID: '1:123:web:abc',
};

describe('ClientConfigController', () => {
  it('returns the public web config', async () => {
    const controller = await controllerWith({
      ...web,
      FIREBASE_MESSAGING_SENDER_ID: '123',
    });
    expect(controller.get()).toEqual({
      firebase: {
        apiKey: 'public-web-key',
        authDomain: 'demo-project.firebaseapp.com',
        projectId: 'demo-project',
        appId: '1:123:web:abc',
        messagingSenderId: '123',
      },
      authEmulatorUrl: null,
    });
  });

  it('includes the auth emulator URL in local development', async () => {
    const controller = await controllerWith({
      ...web,
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    });
    expect(controller.get().authEmulatorUrl).toBe('http://127.0.0.1:9099');
  });

  it('never exposes server-side secrets', async () => {
    const controller = await controllerWith({
      ...web,
      OPENAI_API_KEY: 'sk-secret-openai',
      FIREBASE_CLIENT_EMAIL: 'svc@demo-project.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'secret-private-key',
    });
    const body = JSON.stringify(controller.get());
    expect(body).not.toContain('sk-secret');
    expect(body).not.toContain('secret-private-key');
    expect(body).not.toContain('iam.gserviceaccount.com');
  });

  it('answers 503 when the web config is incomplete', async () => {
    const controller = await controllerWith({
      FIREBASE_PROJECT_ID: 'demo-project',
    });
    expect(() => controller.get()).toThrow(HttpException);
    try {
      controller.get();
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(503);
    }
  });
});
