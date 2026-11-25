import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type { LlmModelsResponse } from '@ai-document-chatbot/shared';
import {
  ChatModels,
  MODEL_STORAGE,
  MODEL_STORAGE_KEY,
  MODELS_URL,
  pickDefaultModel,
} from './chat-models';
import { MODELS, MemoryStorage } from './testing/fake-fetch';

const withAvailability = (
  available: Record<string, boolean>,
): LlmModelsResponse => ({
  ...MODELS,
  models: MODELS.models.map((m) => ({
    ...m,
    available: available[m.id] ?? m.available,
  })),
});

describe('pickDefaultModel', () => {
  it('prefers the saved model while it is available', () => {
    expect(pickDefaultModel(MODELS, 'gpt-6.2-astra')).toBe('gpt-6.2-astra');
  });

  it('ignores a saved model that is unavailable or unknown', () => {
    expect(pickDefaultModel(MODELS, 'gemini-4-argon')).toBe('claude-haiku-5-5');
    expect(pickDefaultModel(MODELS, 'retired-model')).toBe('claude-haiku-5-5');
  });

  it('uses the server default without a saved choice', () => {
    expect(pickDefaultModel(MODELS, null)).toBe('claude-haiku-5-5');
  });

  it('falls back to the first available model when the default is unavailable', () => {
    const response = withAvailability({ 'claude-haiku-5-5': false });
    expect(pickDefaultModel(response, null)).toBe('gpt-6.2-astra');
  });

  it('returns null when no model is available', () => {
    const response = withAvailability({
      'gpt-6.2-astra': false,
      'claude-haiku-5-5': false,
    });
    expect(pickDefaultModel(response, 'gpt-6.2-astra')).toBeNull();
  });
});

describe('ChatModels', () => {
  let models: ChatModels;
  let httpMock: HttpTestingController;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        ChatModels,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MODEL_STORAGE, useValue: storage },
      ],
    });
    models = TestBed.inject(ChatModels);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function load(response: LlmModelsResponse | 'error' = MODELS) {
    TestBed.tick();
    const req = httpMock.expectOne(MODELS_URL);
    if (response === 'error') {
      req.flush(null, { status: 500, statusText: 'Server Error' });
    } else {
      req.flush(response);
    }
    await TestBed.inject(ApplicationRef).whenStable();
  }

  it('groups models by provider, in order', async () => {
    await load();
    expect(
      models.groups().map((g) => [g.label, g.models.map((m) => m.id)]),
    ).toEqual([
      ['OpenAI', ['gpt-6.2-astra']],
      ['Claude', ['claude-haiku-5-5']],
      ['Gemini', ['gemini-4-argon']],
    ]);
    expect(models.someUnavailable()).toBe(true);
  });

  it('restores the saved choice and remembers a new one', async () => {
    storage.setItem(MODEL_STORAGE_KEY, 'gpt-6.2-astra');
    await load();
    expect(models.selectedId()).toBe('gpt-6.2-astra');

    models.select('claude-haiku-5-5');
    expect(models.selectedId()).toBe('claude-haiku-5-5');
    expect(storage.getItem(MODEL_STORAGE_KEY)).toBe('claude-haiku-5-5');
  });

  it('refuses to select an unavailable or unknown model', async () => {
    await load();
    models.select('gemini-4-argon');
    models.select('nope');
    expect(models.selectedId()).toBe('claude-haiku-5-5');
    expect(storage.getItem(MODEL_STORAGE_KEY)).toBeNull();
  });

  it('reports when no model is available', async () => {
    await load(
      withAvailability({ 'gpt-6.2-astra': false, 'claude-haiku-5-5': false }),
    );
    expect(models.noneAvailable()).toBe(true);
    expect(models.selectedId()).toBeNull();
  });

  it('still works when storage throws', async () => {
    storage.getItem = () => {
      throw new Error('SecurityError');
    };
    storage.setItem = storage.getItem;
    await load();
    expect(models.selectedId()).toBe('claude-haiku-5-5');
    models.select('gpt-6.2-astra');
    expect(models.selectedId()).toBe('gpt-6.2-astra');
  });

  it('reports a failed load and nothing selected', async () => {
    await load('error');
    expect(models.loadFailed()).toBe(true);
    expect(models.selectedId()).toBeNull();
    expect(models.noneAvailable()).toBe(false);
  });
});
