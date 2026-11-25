import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';

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
