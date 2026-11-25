import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

export interface LlmApiKeys {
  openai?: string;
  anthropic?: string;
  gemini?: string;
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
