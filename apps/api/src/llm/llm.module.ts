import { Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { AppConfigService } from '../config/app-config.service';
import { LLM_PROVIDERS, type LlmProvider } from './llm-provider';
import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';

// Per-attempt timeout for OpenAI and Anthropic until the response starts (the SDK
// stops it once streaming begins), so a stuck attempt is retried. Kept below
// LlmService's FIRST_TOKEN_TIMEOUT_MS (120s), which bounds the whole wait for every
// provider. Gemini's SDK timeout would cap the entire stream, so it is not set.
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

/** Builds an adapter for each provider whose API key is configured. */
export function createLlmProviders(config: AppConfigService): LlmProvider[] {
  const keys = config.llmApiKeys;
  const providers: LlmProvider[] = [];
  if (keys.openai) {
    providers.push(
      new OpenAiProvider(
        new OpenAI({
          apiKey: keys.openai,
          timeout: TIMEOUT_MS,
          maxRetries: MAX_RETRIES,
        }),
      ),
    );
  }
  if (keys.anthropic) {
    providers.push(
      new AnthropicProvider(
        new Anthropic({
          apiKey: keys.anthropic,
          timeout: TIMEOUT_MS,
          maxRetries: MAX_RETRIES,
        }),
      ),
    );
  }
  if (keys.gemini) {
    providers.push(
      new GeminiProvider(new GoogleGenAI({ apiKey: keys.gemini })),
    );
  }
  return providers;
}

@Module({
  controllers: [LlmController],
  providers: [
    {
      provide: LLM_PROVIDERS,
      inject: [AppConfigService],
      useFactory: createLlmProviders,
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
