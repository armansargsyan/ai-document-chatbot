import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { LlmProviderId } from '@ai-document-chatbot/shared';

/**
 * How long a provider stays marked exhausted before one request may probe it
 * again. A wrong guess (e.g. a short spend-rate limit that looked like the
 * monthly cap) heals by itself, and a top-up or raised cap is picked up
 * without a restart.
 */
export const QUOTA_RECHECK_MS = 60 * 60_000;

/** Start of the next calendar month in UTC (when the monthly demo budgets reset). */
export function startOfNextUtcMonth(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/**
 * Remembers which providers have hit their monthly spend cap or run out of
 * credit, so requests fail fast (no charge, no upstream call) and
 * `GET /api/models` can show them as unavailable.
 *
 * A provider stays exhausted until the earlier of the next UTC month and
 * `QUOTA_RECHECK_MS` from when it was marked; then the next request probes it
 * and re-marks it if the cap still applies. In memory, per api instance: a
 * restart or another instance learns it again from the first failing request.
 *
 * OpenAI also powers embeddings (same key), so `openai` being exhausted means
 * document search is paused too.
 */
@Injectable()
export class ProviderQuotaTracker {
  private readonly logger = new Logger(ProviderQuotaTracker.name);
  private readonly exhaustedUntil = new Map<LlmProviderId, number>();

  constructor(private readonly now: () => number = Date.now) {}

  markExhausted(provider: LlmProviderId): void {
    const now = this.now();
    const until = Math.min(startOfNextUtcMonth(now), now + QUOTA_RECHECK_MS);
    if (!this.isExhausted(provider)) {
      this.logger.warn(
        `${provider} quota exhausted; paused until ${new Date(until).toISOString()}`,
      );
    }
    this.exhaustedUntil.set(provider, until);
  }

  isExhausted(provider: LlmProviderId): boolean {
    const until = this.exhaustedUntil.get(provider);
    if (until === undefined) return false;
    if (this.now() < until) return true;
    this.exhaustedUntil.delete(provider);
    return false;
  }

  /** Embeddings run on OpenAI. */
  get searchExhausted(): boolean {
    return this.isExhausted('openai');
  }
}

/** One tracker shared by the LLM, embeddings, documents, chat and usage code. */
@Global()
@Module({
  providers: [
    {
      provide: ProviderQuotaTracker,
      useFactory: () => new ProviderQuotaTracker(),
    },
  ],
  exports: [ProviderQuotaTracker],
})
export class ProviderQuotaModule {}
