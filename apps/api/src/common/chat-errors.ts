import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ChatErrorCode } from '@ai-document-chatbot/shared';

/**
 * An object passed to an HttpException becomes the response body as-is, so
 * `statusCode` and `error` are set explicitly to keep Nest's default shape,
 * plus a machine-readable `code`.
 */
export function chatNotFound(
  message: string,
  code: ChatErrorCode,
): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message,
    code,
  });
}

export function chatConflict(
  message: string,
  code: ChatErrorCode,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
  });
}
