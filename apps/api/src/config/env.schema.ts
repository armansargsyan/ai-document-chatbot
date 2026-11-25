import { z } from 'zod';

const hostPort = z.string().regex(/^[\w.-]+:\d{1,5}$/, {
  error: 'must be host:port, e.g. 127.0.0.1:8080',
});

const optionalSecret = z.string().optional();

/** A positive request limit with a default. */
const limit = (fallback: number) =>
  z.coerce
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(1, { error: 'must be at least 1' })
    .default(fallback);

export const envSchema = z
  .object({
    PORT: z.coerce
      .number({ error: 'must be a number' })
      .int({ error: 'must be an integer' })
      .min(1, { error: 'must be between 1 and 65535' })
      .max(65535, { error: 'must be between 1 and 65535' })
      .default(3000),

    OPENAI_API_KEY: optionalSecret,
    ANTHROPIC_API_KEY: optionalSecret,
    GEMINI_API_KEY: optionalSecret,

    FIREBASE_PROJECT_ID: z.string({ error: 'is required' }),
    FIREBASE_STORAGE_BUCKET: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z
      .email({ error: 'must be a service-account email' })
      .optional(),
    FIREBASE_PRIVATE_KEY: optionalSecret,

    FIRESTORE_EMULATOR_HOST: hostPort.optional(),
    FIREBASE_AUTH_EMULATOR_HOST: hostPort.optional(),
    FIREBASE_STORAGE_EMULATOR_HOST: hostPort.optional(),

    // Per-user limits (keyed by Firebase uid).
    RATE_LIMIT_CHAT_PER_MINUTE: limit(10),
    RATE_LIMIT_CHAT_PER_DAY: limit(200),
    RATE_LIMIT_UPLOADS_PER_HOUR: limit(10),
    RATE_LIMIT_UPLOADS_PER_DAY: limit(30),
  })
  .superRefine((env, ctx) => {
    if (!!env.FIREBASE_CLIENT_EMAIL !== !!env.FIREBASE_PRIVATE_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIREBASE_CLIENT_EMAIL'],
        message:
          'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be set together',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates raw environment variables for `ConfigModule.forRoot({ validate })`.
 * Empty strings (as copied from `.env.example`) count as unset.
 * Error messages name the offending keys but never include their values.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const input = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== ''),
  );
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
