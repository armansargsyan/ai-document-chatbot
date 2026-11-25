import { Module } from '@nestjs/common';
import { DocumentRepository } from './document.repository';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PdfTextExtractor } from './pdf-text-extractor';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentRepository, PdfTextExtractor],
  exports: [DocumentRepository],
})
export class DocumentsModule {}
