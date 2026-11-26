import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DEMO_LIMITS, type UsageResponse } from '@ai-document-chatbot/shared';
import { limitError } from '../common/limit-errors';
import type { DocumentRecord } from '../documents/document.repository';
import { describeProviderError } from '../llm/llm-errors';
import { ProviderQuotaTracker } from '../llm/provider-quota-tracker';
import { UsageRepository, type UsageCounterField } from './usage.repository';

/**
 * Lifetime demo quotas (`DEMO_LIMITS`). Reservations are atomic and happen
 * before any paid call; callers refund them when the request then fails for
 * a server or provider reason.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly repository: UsageRepository,
    private readonly quota: ProviderQuotaTracker,
  ) {}

  async getUsage(uid: string): Promise<UsageResponse> {
    let read;
    try {
      read = await this.repository.read(uid);
    } catch (error) {
      this.logger.warn(`Reading usage failed: ${describeProviderError(error)}`);
      throw new ServiceUnavailableException('Usage is unavailable');
    }
    return {
      documents: { used: read.documents, limit: DEMO_LIMITS.maxDocuments },
      uploads: {
        used: Math.min(read.usage.uploadsUsed, DEMO_LIMITS.maxUploads),
        limit: DEMO_LIMITS.maxUploads,
      },
      questions: {
        used: Math.min(read.usage.questionsUsed, DEMO_LIMITS.maxQuestions),
        limit: DEMO_LIMITS.maxQuestions,
      },
      searchQuotaExhausted: this.quota.searchExhausted,
    };
  }

  /**
   * Charges one upload and creates the document record in one transaction.
   * 403 `upload_limit_reached` / 409 `document_limit_reached` when over a limit.
   */
  async reserveUpload(
    uid: string,
    documentId: string,
    record: DocumentRecord,
  ): Promise<void> {
    const result = await this.guard('upload', () =>
      this.repository.reserveUpload(uid, documentId, record, DEMO_LIMITS),
    );
    if (result !== 'reserved') throw limitError(result);
  }

  /** Charges one question; 403 `question_limit_reached` when none are left. */
  async reserveQuestion(uid: string): Promise<void> {
    const reserved = await this.guard('question', () =>
      this.repository.reserveQuestion(uid, DEMO_LIMITS.maxQuestions),
    );
    if (!reserved) throw limitError('question_limit_reached');
  }

  /** Best effort: a failed refund is logged, never surfaced. */
  refundUpload(uid: string): Promise<void> {
    return this.refund(uid, 'uploadsUsed');
  }

  refundQuestion(uid: string): Promise<void> {
    return this.refund(uid, 'questionsUsed');
  }

  private async refund(uid: string, field: UsageCounterField): Promise<void> {
    try {
      await this.repository.refund(uid, field);
    } catch (error) {
      this.logger.warn(
        `Refunding ${field} failed: ${describeProviderError(error)}`,
      );
    }
  }

  private async guard<T>(kind: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `Reserving a ${kind} failed: ${describeProviderError(error)}`,
      );
      throw new ServiceUnavailableException(
        'Usage limits could not be checked; try again shortly',
      );
    }
  }
}
