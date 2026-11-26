import { DEMO_LIMITS, type UsageResponse } from '@ai-document-chatbot/shared';

/** A `GET /api/usage` body with the demo limits and these `used` counts. */
export function usageOf(
  used: Partial<Record<keyof UsageResponse, number>> = {},
): UsageResponse {
  return {
    documents: { used: used.documents ?? 0, limit: DEMO_LIMITS.maxDocuments },
    uploads: { used: used.uploads ?? 0, limit: DEMO_LIMITS.maxUploads },
    questions: { used: used.questions ?? 0, limit: DEMO_LIMITS.maxQuestions },
  };
}

/** Plenty of room left in every limit. */
export const FRESH_USAGE = usageOf({ documents: 1, uploads: 1, questions: 2 });
