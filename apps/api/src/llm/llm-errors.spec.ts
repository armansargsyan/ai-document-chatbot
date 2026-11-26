import { describe, expect, it } from 'vitest';
import { APIError as AnthropicApiError } from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError } from '@google/genai';
import { APIError as OpenAiApiError } from 'openai';
import type { LlmProviderId } from '@ai-document-chatbot/shared';
import { isQuotaExhausted, toHttpException } from './llm-errors';

/*
 * Errors are built with each SDK's own factory from response bodies shaped
 * like the documented ones, so the fields we read are the ones the SDK sets.
 * No network.
 */

/** OpenAI: the client wraps the JSON body as `{ error: {...} }`. */
const openai = (status: number, error: Record<string, unknown>) =>
  OpenAiApiError.generate(status, { error }, undefined, new Headers());

/** Anthropic: the full body `{ type: 'error', error: {...} }`. */
const anthropic = (status: number, error: Record<string, unknown>) =>
  AnthropicApiError.generate(
    status,
    { type: 'error', error, request_id: 'req_1' },
    undefined,
    new Headers(),
  );

/** Gemini: `ApiError` whose message is the JSON error body. */
const gemini = (status: number, error: Record<string, unknown>) =>
  new GeminiApiError({ status, message: JSON.stringify({ error }) });

const exhausted: [string, LlmProviderId, unknown][] = [
  [
    'OpenAI insufficient_quota (429)',
    'openai',
    openai(429, {
      message: 'You exceeded your current quota, please check your plan.',
      type: 'insufficient_quota',
      code: 'insufficient_quota',
      param: null,
    }),
  ],
  [
    'OpenAI credit_balance_exhausted (429)',
    'openai',
    openai(429, {
      message: 'Your organization has no prepaid credits remaining.',
      type: 'insufficient_quota',
      code: 'credit_balance_exhausted',
    }),
  ],
  [
    'OpenAI project_spend_limit_exceeded (429)',
    'openai',
    openai(429, {
      message: 'Your project reached its enforced spend limit.',
      type: 'requests',
      code: 'project_spend_limit_exceeded',
    }),
  ],
  [
    'OpenAI in-stream failure carrying insufficient_quota',
    'openai',
    Object.assign(new Error('OpenAI stream failed'), {
      status: 502,
      code: 'insufficient_quota',
    }),
  ],
  [
    'Anthropic monthly spend cap (429 enforced_spend_limit_reached)',
    'anthropic',
    anthropic(429, {
      type: 'rate_limit_error',
      message: 'You have reached your API usage limits: ...',
      details: { error_code: 'enforced_spend_limit_reached' },
    }),
  ],
  [
    'Anthropic spend limit you set (400, no code)',
    'anthropic',
    anthropic(400, {
      type: 'invalid_request_error',
      message:
        'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.',
    }),
  ],
  [
    'Anthropic credit balance too low (400)',
    'anthropic',
    anthropic(400, {
      type: 'invalid_request_error',
      message:
        'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    }),
  ],
  [
    'Anthropic billing_error (402)',
    'anthropic',
    anthropic(402, { type: 'billing_error', message: 'Billing issue.' }),
  ],
  [
    'Gemini monthly spending cap (429 RESOURCE_EXHAUSTED)',
    'gemini',
    gemini(429, {
      code: 429,
      message: 'Your project has exceeded its monthly spending cap.',
      status: 'RESOURCE_EXHAUSTED',
    }),
  ],
  [
    'Gemini prepayment credits depleted (429)',
    'gemini',
    gemini(429, {
      code: 429,
      message:
        'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.',
      status: 'RESOURCE_EXHAUSTED',
    }),
  ],
  [
    'Gemini payment required (402)',
    'gemini',
    gemini(402, { code: 402, message: 'Payment required', status: '' }),
  ],
];

const notExhausted: [string, LlmProviderId, unknown][] = [
  [
    'OpenAI request rate limit (429)',
    'openai',
    openai(429, {
      message: 'Rate limit reached for gpt-6-luna on requests per min (RPM).',
      type: 'requests',
      code: 'rate_limit_exceeded',
    }),
  ],
  [
    'OpenAI slow_down (429)',
    'openai',
    openai(429, { type: 'rate_limit_error', code: 'slow_down', message: '' }),
  ],
  ['OpenAI server error', 'openai', openai(500, { message: 'oops' })],
  [
    'Anthropic rate limit (429)',
    'anthropic',
    anthropic(429, {
      type: 'rate_limit_error',
      message:
        'Number of request tokens has exceeded your per-minute rate limit',
    }),
  ],
  [
    'Anthropic ramp limit (429)',
    'anthropic',
    anthropic(429, {
      type: 'rate_limit_error',
      message: 'Usage increased too quickly',
      details: { error_code: 'ramp_limit_exceeded' },
    }),
  ],
  [
    'Anthropic invalid request (400)',
    'anthropic',
    anthropic(400, {
      type: 'invalid_request_error',
      message: 'messages: roles must alternate',
    }),
  ],
  [
    'Anthropic overloaded (529)',
    'anthropic',
    anthropic(529, { type: 'overloaded_error', message: 'Overloaded' }),
  ],
  [
    'Gemini per-minute quota (429 RESOURCE_EXHAUSTED)',
    'gemini',
    gemini(429, {
      code: 429,
      message:
        'You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_paid_tier_input_token_count, limit: 1000000. Please retry in 21s.',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaId: 'GenerateContentPaidTierInputTokensPerModelPerMinute',
            },
          ],
        },
        {
          '@type': 'type.googleapis.com/google.rpc.RetryInfo',
          retryDelay: '21s',
        },
      ],
    }),
  ],
  [
    'Gemini server error',
    'gemini',
    gemini(500, { code: 500, message: 'Internal', status: 'INTERNAL' }),
  ],
  ['a non-object', 'openai', 'boom'],
  ['null', 'gemini', null],
];

describe('isQuotaExhausted', () => {
  it.each(exhausted)('recognizes %s', (_label, provider, error) => {
    expect(isQuotaExhausted(provider, error)).toBe(true);
  });

  it.each(notExhausted)('does not flag %s', (_label, provider, error) => {
    expect(isQuotaExhausted(provider, error)).toBe(false);
  });

  it('only applies a provider’s own rules', () => {
    const openaiQuota = openai(429, {
      message: 'quota',
      type: 'insufficient_quota',
      code: 'insufficient_quota',
    });
    // Gemini reads only status + message; this message names no spending cap.
    expect(isQuotaExhausted('gemini', openaiQuota)).toBe(false);
  });

  it('keeps plain rate limits as 429 in toHttpException', () => {
    const error = openai(429, { message: 'slow', code: 'rate_limit_exceeded' });
    expect(toHttpException(error).getStatus()).toBe(429);
  });
});
