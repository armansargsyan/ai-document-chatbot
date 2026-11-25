import { describe, expect, it } from 'vitest';
import type { AppConfigService } from '../config/app-config.service';
import { createLlmProviders } from './llm.module';

/** Constructing SDK clients makes no network calls, so real clients are fine here. */
function configWith(keys: AppConfigService['llmApiKeys']) {
  return { llmApiKeys: keys } as AppConfigService;
}

describe('createLlmProviders', () => {
  it('creates no providers when no keys are configured', () => {
    expect(createLlmProviders(configWith({}))).toEqual([]);
  });

  it('creates exactly the providers that have a key', () => {
    const ids = createLlmProviders(
      configWith({
        anthropic: 'fake-anthropic-key',
        gemini: 'fake-gemini-key',
      }),
    ).map((p) => p.id);
    expect(ids).toEqual(['anthropic', 'gemini']);
  });

  it('creates all three when every key is set', () => {
    const ids = createLlmProviders(
      configWith({
        openai: 'fake-openai-key',
        anthropic: 'fake-anthropic-key',
        gemini: 'fake-gemini-key',
      }),
    ).map((p) => p.id);
    expect(ids).toEqual(['openai', 'anthropic', 'gemini']);
  });
});
