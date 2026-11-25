import { Controller, Get } from '@nestjs/common';
import type { LlmModelsResponse } from '@ai-document-chatbot/shared';
import { LlmService } from './llm.service';

@Controller('models')
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  /** Allow-listed models and whether each is usable on this server. */
  @Get()
  list(): LlmModelsResponse {
    return this.llm.listModels();
  }
}
