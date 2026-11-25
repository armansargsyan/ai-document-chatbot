import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@ai-document-chatbot/shared';

@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
