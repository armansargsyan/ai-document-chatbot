import { DEMO_LIMITS, type LimitErrorCode } from '@ai-document-chatbot/shared';

const LIMIT_ERROR_CODES: readonly LimitErrorCode[] = [
  'document_limit_reached',
  'upload_limit_reached',
  'question_limit_reached',
  'model_quota_exhausted',
  'search_quota_exhausted',
];

/** The api's `{ code }` on a JSON error body, if it's a demo-limit code. */
export function limitErrorCode(body: unknown): LimitErrorCode | undefined {
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return undefined;
  }
  const { code } = body as { code: unknown };
  return LIMIT_ERROR_CODES.find((c) => c === code);
}

/** The demo's rules in one sentence. */
export const DEMO_RULES = `This is a demo: each account can keep ${DEMO_LIMITS.maxDocuments} documents, upload ${DEMO_LIMITS.maxUploads} in total, and ask ${DEMO_LIMITS.maxQuestions} questions.`;

export const DOCUMENT_LIMIT_MESSAGE = `You can keep ${DEMO_LIMITS.maxDocuments} documents at a time. Delete a document to upload another.`;
export const UPLOAD_LIMIT_MESSAGE = `You’ve used all ${DEMO_LIMITS.maxUploads} demo uploads.`;
export const QUESTION_LIMIT_MESSAGE = `You’ve used all ${DEMO_LIMITS.maxQuestions} demo questions.`;
export const MODEL_QUOTA_MESSAGE =
  'This model has reached its demo limit for this month. Try another model.';
export const SEARCH_QUOTA_MESSAGE =
  'Document search has reached its demo limit for this month, so uploads and questions are paused.';

/** Fallback copy per code (4xx responses usually carry their own message). */
export const LIMIT_MESSAGES: Record<LimitErrorCode, string> = {
  document_limit_reached: DOCUMENT_LIMIT_MESSAGE,
  upload_limit_reached: UPLOAD_LIMIT_MESSAGE,
  question_limit_reached: QUESTION_LIMIT_MESSAGE,
  model_quota_exhausted: MODEL_QUOTA_MESSAGE,
  search_quota_exhausted: SEARCH_QUOTA_MESSAGE,
};
