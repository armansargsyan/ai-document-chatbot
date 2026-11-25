import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [DocumentsModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
