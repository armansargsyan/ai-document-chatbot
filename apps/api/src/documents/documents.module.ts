import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage.module';
import { DocumentRepository } from './document.repository';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PdfTextExtractor } from './pdf-text-extractor';

@Module({
  imports: [UsageModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentRepository, PdfTextExtractor],
  exports: [DocumentRepository],
})
export class DocumentsModule {}
