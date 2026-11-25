import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { AppConfigService as AppConfigServiceType } from './app-config.service';
import { envSchema, type Env } from './env.schema';

// Every key the schema reads. Absent keys are set to '' (treated as unset by
// validateEnv) so neither a local `.env` nor the outer environment can leak in.
const KEYS = Object.keys(envSchema.shape) as (keyof Env)[];

/**
 * ConfigModule.forRoot runs when app-config.module is first imported, so each
 * test sets process.env, resets the module registry and re-imports the real module.
 */
async function compileWith(env: Partial<Record<keyof Env, string>>) {
  for (const key of KEYS) process.env[key] = env[key] ?? '';
  vi.resetModules();
  const mod = await import('./app-config.module');
  const svc = await import('./app-config.service');
  const moduleRef = await Test.createTestingModule({
    imports: [mod.AppConfigModule],
  }).compile();
  return moduleRef.get<AppConfigServiceType>(svc.AppConfigService);
}

describe('AppConfigModule', () => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('validates at startup and fails fast on invalid env', async () => {
    await expect(
      compileWith({ FIREBASE_PROJECT_ID: 'demo-project', PORT: 'abc' }),
    ).rejects.toThrow(/Invalid environment configuration[\s\S]*PORT/);
  });

  it('treats empty strings from .env as unset', async () => {
    const config = await compileWith({
      FIREBASE_PROJECT_ID: 'demo-project',
      FIREBASE_STORAGE_BUCKET: '',
      OPENAI_API_KEY: '',
      PORT: '',
    });
    expect(config.port).toBe(3000);
    expect(config.firebase.storageBucket).toBe(
      'demo-project.firebasestorage.app',
    );
    expect(config.llmApiKeys.openai).toBeUndefined();
  });
});
