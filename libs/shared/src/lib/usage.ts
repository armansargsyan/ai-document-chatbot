/**
 * Lifetime demo limits per user (no daily reset). Deleting a document frees a
 * document slot but does not give back an upload.
 */
export const DEMO_LIMITS = {
  /** Documents a user can have at the same time (any status). */
  maxDocuments: 3,
  /** Uploads a user can ever make (accepted uploads; not refunded on delete). */
  maxUploads: 6,
  /** Questions a user can ever ask. */
  maxQuestions: 30,
} as const;

export interface UsageCounter {
  used: number;
  limit: number;
}

/** Response of `GET /api/usage`. */
export interface UsageResponse {
  documents: UsageCounter;
  uploads: UsageCounter;
  questions: UsageCounter;
  /**
   * True while the embeddings provider's monthly demo budget is used up:
   * uploads and questions are paused until it resets.
   */
  searchQuotaExhausted?: boolean;
}

/**
 * Machine-readable `code` on JSON errors for demo limits (body:
 * `{ statusCode, message, code }`).
 * - `document_limit_reached` (409): already at `maxDocuments`; delete one first
 * - `upload_limit_reached` / `question_limit_reached` (403): lifetime quota used
 * - `model_quota_exhausted` (503): this model's provider hit its monthly demo budget
 * - `search_quota_exhausted` (503): the embeddings provider hit its monthly demo
 *   budget, so uploads and document search are paused
 */
export type LimitErrorCode =
  | 'document_limit_reached'
  | 'upload_limit_reached'
  | 'question_limit_reached'
  | 'model_quota_exhausted'
  | 'search_quota_exhausted';
