import { HttpException, HttpStatus } from '@nestjs/common';
import { DEMO_LIMITS, type LimitErrorCode } from '@ai-document-chatbot/shared';

const LIMIT_ERRORS: Record<
  LimitErrorCode,
  { status: HttpStatus; error: string; message: string }
> = {
  document_limit_reached: {
    status: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: `You can keep up to ${DEMO_LIMITS.maxDocuments} documents. Delete one to upload another.`,
  },
  upload_limit_reached: {
    status: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    message: `You've used all ${DEMO_LIMITS.maxUploads} demo uploads.`,
  },
  question_limit_reached: {
    status: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    message: `You've used all ${DEMO_LIMITS.maxQuestions} demo questions.`,
  },
  model_quota_exhausted: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    error: 'Service Unavailable',
    message:
      'This model has reached its demo limit for this month. Try another model.',
  },
  search_quota_exhausted: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    error: 'Service Unavailable',
    message:
      'Document search has reached its demo limit for this month, so uploads and questions are paused.',
  },
};

/**
 * A demo-limit error with the body `{ statusCode, error, message, code }`
 * (same shape as `chat-errors.ts`).
 */
export function limitError(code: LimitErrorCode): HttpException {
  const { status, error, message } = LIMIT_ERRORS[code];
  return new HttpException(
    { statusCode: status, error, message, code },
    status,
  );
}
