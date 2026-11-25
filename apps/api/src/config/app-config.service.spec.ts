import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

async function createService(env: Record<string, string>) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        skipProcessEnv: true,
        load: [() => validateEnv(env)],
      }),
    ],
    providers: [AppConfigService],
  }).compile();
  return moduleRef.get(AppConfigService);
}

describe('AppConfigService', () => {
  it('exposes typed values with defaults', async () => {
    const config = await createService({ FIREBASE_PROJECT_ID: 'demo-project' });
    expect(config.port).toBe(3000);
    expect(config.llmApiKeys).toEqual({
      openai: undefined,
      anthropic: undefined,
      gemini: undefined,
    });
    expect(config.firebase).toEqual({
      projectId: 'demo-project',
      storageBucket: 'demo-project.firebasestorage.app',
      serviceAccount: undefined,
    });
  });

  it('returns inline service-account credentials with real newlines', async () => {
    const config = await createService({
      FIREBASE_PROJECT_ID: 'demo-project',
      FIREBASE_STORAGE_BUCKET: 'custom-bucket',
      FIREBASE_CLIENT_EMAIL: 'svc@demo-project.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'line1\\nline2',
    });
    expect(config.firebase.storageBucket).toBe('custom-bucket');
    expect(config.firebase.serviceAccount).toEqual({
      clientEmail: 'svc@demo-project.iam.gserviceaccount.com',
      privateKey: 'line1\nline2',
    });
  });
});
