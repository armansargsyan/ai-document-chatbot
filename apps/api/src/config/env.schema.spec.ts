import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

const base = { FIREBASE_PROJECT_ID: 'demo-project' };

describe('validateEnv', () => {
  it('accepts a minimal valid config and applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.FIREBASE_PROJECT_ID).toBe('demo-project');
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ ...base, PORT: '8081' }).PORT).toBe(8081);
  });

  it('treats empty strings as unset', () => {
    const env = validateEnv({ ...base, OPENAI_API_KEY: '', PORT: '' });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.PORT).toBe(3000);
  });

  it('fails when FIREBASE_PROJECT_ID is missing', () => {
    expect(() => validateEnv({})).toThrow(/FIREBASE_PROJECT_ID: is required/);
  });

  it('fails on an invalid PORT', () => {
    expect(() => validateEnv({ ...base, PORT: '70000' })).toThrow(
      /PORT: must be between 1 and 65535/,
    );
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(
      /PORT: must be a number/,
    );
  });

  it('fails on a malformed emulator host', () => {
    expect(() =>
      validateEnv({
        ...base,
        FIRESTORE_EMULATOR_HOST: 'http://localhost:8080',
      }),
    ).toThrow(/FIRESTORE_EMULATOR_HOST: must be host:port/);
  });

  it('requires FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY together', () => {
    expect(() =>
      validateEnv({ ...base, FIREBASE_PRIVATE_KEY: 'fake-key' }),
    ).toThrow(/must be set together/);
  });

  it('never includes secret values in the error message', () => {
    const secret = 'sk-test-should-not-leak';
    let message = '';
    try {
      validateEnv({
        OPENAI_API_KEY: secret,
        FIREBASE_PRIVATE_KEY: secret,
        FIREBASE_CLIENT_EMAIL: secret,
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Invalid environment configuration');
    expect(message).not.toContain(secret);
  });

  it('applies rate-limit defaults and accepts overrides', () => {
    const env = validateEnv({ ...base, RATE_LIMIT_CHAT_PER_MINUTE: '5' });
    expect(env.RATE_LIMIT_CHAT_PER_MINUTE).toBe(5);
    expect(env.RATE_LIMIT_UPLOADS_PER_HOUR).toBe(10);
  });

  it('has no daily rate limits (lifetime demo quotas replace them)', () => {
    const env = validateEnv({ ...base, RATE_LIMIT_CHAT_PER_DAY: '5' });
    expect(env).not.toHaveProperty('RATE_LIMIT_CHAT_PER_DAY');
    expect(env).not.toHaveProperty('RATE_LIMIT_UPLOADS_PER_DAY');
  });

  it('rejects non-positive or non-numeric rate limits', () => {
    expect(() =>
      validateEnv({ ...base, RATE_LIMIT_UPLOADS_PER_HOUR: '0' }),
    ).toThrow(/RATE_LIMIT_UPLOADS_PER_HOUR: must be at least 1/);
    expect(() =>
      validateEnv({ ...base, RATE_LIMIT_CHAT_PER_MINUTE: 'lots' }),
    ).toThrow(/RATE_LIMIT_CHAT_PER_MINUTE: must be a number/);
  });
});
