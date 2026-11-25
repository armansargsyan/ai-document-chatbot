import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LLM_MODEL_ID,
  LLM_MODELS,
  getLlmModel,
  isLlmModelId,
} from './llm';

describe('LLM model allow-list', () => {
  it('has unique ids', () => {
    const ids = LLM_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers all three providers', () => {
    expect(new Set(LLM_MODELS.map((m) => m.provider))).toEqual(
      new Set(['openai', 'anthropic', 'gemini']),
    );
  });

  it('includes the default model', () => {
    expect(isLlmModelId(DEFAULT_LLM_MODEL_ID)).toBe(true);
  });

  it('recognises only allow-listed ids', () => {
    expect(isLlmModelId('gemini-4-argon')).toBe(true);
    expect(isLlmModelId('gpt-4')).toBe(false);
    expect(isLlmModelId(undefined)).toBe(false);
  });

  it('looks up a model by id', () => {
    expect(getLlmModel('claude-sonnet-5-5').provider).toBe('anthropic');
  });
});
