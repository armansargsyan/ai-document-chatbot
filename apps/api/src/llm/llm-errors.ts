import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { LlmProviderId } from '@ai-document-chatbot/shared';

/** Raised when the caller's own signal aborted the request; not an error worth reporting. */
export class LlmRequestAbortedError extends Error {
  constructor() {
    super('LLM request aborted');
    this.name = 'LlmRequestAbortedError';
  }
}

/** SDK-internal aborts (e.g. a client-side timeout); only a user abort if the caller's signal fired. */
export function isAbortLike(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return (
    name === 'AbortError' ||
    name === 'APIUserAbortError' ||
    name === 'TimeoutError' ||
    name === 'APIConnectionTimeoutError'
  );
}

/**
 * Maps a vendor SDK error to a Nest HttpException with a generic message.
 * All three SDKs (OpenAI, Anthropic, Google Gen AI) expose an HTTP `status`.
 * Vendor messages are never forwarded: they can contain request details or
 * account information.
 */
export function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (isAbortLike(error)) {
    return new GatewayTimeoutException('The model provider timed out');
  }

  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') {
    if (status === 400 || status === 413 || status === 422) {
      return new BadRequestException('The model rejected the request');
    }
    if (status === 429) {
      return new HttpException(
        'The model provider is rate limiting requests; try again shortly',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (status === 401 || status === 403 || status === 404) {
      // Bad key, no access, or unknown model: a server-side configuration problem.
      return new ServiceUnavailableException(
        'The selected model is unavailable',
      );
    }
  }
  return new BadGatewayException('The model provider failed to respond');
}

interface VendorErrorFields {
  status?: unknown;
  code?: unknown;
  type?: unknown;
  errorCode?: unknown;
  message?: unknown;
}

const OPENAI_QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

const ANTHROPIC_QUOTA_CODES = new Set([
  'enforced_spend_limit_reached',
  'contract_spend_limit_reached',
  'linked_organization_spend_limit_reached',
]);

/** Anthropic's 400 for a spend limit you set, and for a prepaid balance at zero, carry no code. */
const ANTHROPIC_QUOTA_MESSAGE =
  /credit balance is too low|reached your (specified )?API usage limits/i;

/** Gemini: project monthly spend cap and depleted prepay credits (both 429 RESOURCE_EXHAUSTED). */
const GEMINI_QUOTA_MESSAGE = /spending cap|prepayment credits are depleted/i;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * True when a vendor error means the account is out of credit or hit its
 * (monthly) spend cap, as opposed to a short rate limit that is worth
 * retrying. Only reads structured fields and short status phrases; the
 * message is never forwarded.
 *
 * - OpenAI (`APIError`): 429 with `code` or `type` `insufficient_quota`, or a
 *   billing `code` such as `credit_balance_exhausted` /
 *   `project_spend_limit_exceeded`. A plain rate limit has no such code.
 * - Anthropic (`APIError`): 402 `billing_error`; a 429 or 400 whose
 *   `errorCode` (`error.details.error_code`) names a spend limit
 *   (`enforced_spend_limit_reached`, ...); or a 400 whose message says the
 *   credit balance is too low or a usage limit you set was reached (these
 *   carry no code).
 * - Gemini (`ApiError`, message is the JSON error body): 402, or a 429 whose
 *   message names the monthly spending cap or depleted prepayment credits.
 *   Other 429 RESOURCE_EXHAUSTED errors (per-minute, per-day and the rolling
 *   10-minute spend-rate limits) stay rate limits: they clear on their own.
 */
export function isQuotaExhausted(
  provider: LlmProviderId,
  error: unknown,
): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, code, type, errorCode, message } = error as VendorErrorFields;
  switch (provider) {
    case 'openai': {
      const c = str(code);
      return (
        (c !== undefined && OPENAI_QUOTA_CODES.has(c)) ||
        str(type) === 'insufficient_quota'
      );
    }
    case 'anthropic': {
      const c = str(errorCode);
      if (c !== undefined && ANTHROPIC_QUOTA_CODES.has(c)) return true;
      if (status === 402 || str(type) === 'billing_error') return true;
      const m = str(message);
      return (
        status === 400 && m !== undefined && ANTHROPIC_QUOTA_MESSAGE.test(m)
      );
    }
    case 'gemini': {
      if (status === 402) return true;
      const m = str(message);
      return status === 429 && m !== undefined && GEMINI_QUOTA_MESSAGE.test(m);
    }
  }
}

/** Short, secret-free description for logs. */
export function describeProviderError(error: unknown): string {
  const status = (error as { status?: unknown })?.status;
  const name = (error as { name?: unknown })?.name;
  return [
    typeof name === 'string' ? name : 'Error',
    typeof status === 'number' ? `status=${status}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
