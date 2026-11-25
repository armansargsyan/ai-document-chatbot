import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientConfigResponse } from '@ai-document-chatbot/shared';
import type { Env } from './env.schema';

export interface LlmApiKeys {
  openai?: string;
  anthropic?: string;
  gemini?: string;
}

export interface RateLimitConfig {
  chatPerMinute: number;
  chatPerDay: number;
  uploadsPerHour: number;
  uploadsPerDay: number;
}

export interface FirebaseConfig {
  projectId: string;
  storageBucket: string;
  /** Inline service-account credentials; when absent, Application Default Credentials are used. */
  serviceAccount?: { clientEmail: string; privateKey: string };
}

/** Typed, validated access to configuration. Use this instead of `process.env`. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get llmApiKeys(): LlmApiKeys {
    return {
      openai: this.config.get('OPENAI_API_KEY', { infer: true }),
      anthropic: this.config.get('ANTHROPIC_API_KEY', { infer: true }),
      gemini: this.config.get('GEMINI_API_KEY', { infer: true }),
    };
  }

  get rateLimits(): RateLimitConfig {
    return {
      chatPerMinute: this.config.get('RATE_LIMIT_CHAT_PER_MINUTE', {
        infer: true,
      }),
      chatPerDay: this.config.get('RATE_LIMIT_CHAT_PER_DAY', { infer: true }),
      uploadsPerHour: this.config.get('RATE_LIMIT_UPLOADS_PER_HOUR', {
        infer: true,
      }),
      uploadsPerDay: this.config.get('RATE_LIMIT_UPLOADS_PER_DAY', {
        infer: true,
      }),
    };
  }

  /**
   * Public Firebase web config for the browser (null if not configured). Not a
   * secret: Firebase web config is public by design; access is enforced by
   * Auth + the api, and security rules deny direct client access.
   */
  get clientConfig(): ClientConfigResponse | null {
    const apiKey = this.config.get('FIREBASE_API_KEY', { infer: true });
    const authDomain = this.config.get('FIREBASE_AUTH_DOMAIN', { infer: true });
    const appId = this.config.get('FIREBASE_APP_ID', { infer: true });
    if (!apiKey || !authDomain || !appId) return null;
    const emulator = this.config.get('FIREBASE_AUTH_EMULATOR_HOST', {
      infer: true,
    });
    return {
      firebase: {
        apiKey,
        authDomain,
        appId,
        projectId: this.config.get('FIREBASE_PROJECT_ID', { infer: true }),
        messagingSenderId:
          this.config.get('FIREBASE_MESSAGING_SENDER_ID', { infer: true }) ??
          null,
      },
      authEmulatorUrl: emulator ? `http://${emulator}` : null,
    };
  }

  get firebase(): FirebaseConfig {
    const projectId = this.config.get('FIREBASE_PROJECT_ID', { infer: true });
    const clientEmail = this.config.get('FIREBASE_CLIENT_EMAIL', {
      infer: true,
    });
    const privateKey = this.config.get('FIREBASE_PRIVATE_KEY', { infer: true });
    return {
      projectId,
      storageBucket:
        this.config.get('FIREBASE_STORAGE_BUCKET', { infer: true }) ??
        `${projectId}.firebasestorage.app`,
      serviceAccount:
        clientEmail && privateKey
          ? { clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }
          : undefined,
    };
  }
}
