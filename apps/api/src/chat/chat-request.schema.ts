import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import {
  MAX_CHAT_MESSAGE_LENGTH,
  isLlmModelId,
  type ChatRequest,
  type LlmModelId,
} from '@ai-document-chatbot/shared';

export const chatRequestSchema = z
  .object({
    message: z
      .string({ error: 'message must be a string' })
      .trim()
      .min(1, { error: 'message must not be empty' })
      .max(MAX_CHAT_MESSAGE_LENGTH, {
        error: `message must be at most ${MAX_CHAT_MESSAGE_LENGTH} characters`,
      }),
    modelId: z
      .string({ error: 'modelId must be a string' })
      .refine(isLlmModelId, { error: 'modelId is not a supported model' })
      .transform((id) => id as LlmModelId),
    conversationId: z
      .string()
      .regex(/^[A-Za-z0-9]{20}$/, { error: 'conversationId is invalid' })
      .optional(),
  })
  .strict() satisfies z.ZodType<ChatRequest>;

/** Validates the request body; errors name the field, never echo the input. */
export class ChatRequestPipe implements PipeTransform<unknown, ChatRequest> {
  transform(value: unknown): ChatRequest {
    const result = chatRequestSchema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((issue) =>
          issue.code === 'unrecognized_keys'
            ? 'Unexpected fields in request'
            : issue.message,
        ),
      );
    }
    return result.data;
  }
}
