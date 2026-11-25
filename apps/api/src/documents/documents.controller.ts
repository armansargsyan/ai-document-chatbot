import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_PDF_BYTES,
  type DocumentSummary,
  type ListDocumentsResponse,
} from '@ai-document-chatbot/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirestoreIdPipe } from '../common/firestore-id.pipe';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import type { AuthUser } from '../auth/token-verifier';
import { DocumentsService, type UploadedPdf } from './documents.service';

const DocumentId = new FirestoreIdPipe('Document not found');

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Multipart upload with the PDF in the `file` field. Oversized files get 413. */
  @Post()
  @RateLimit('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 0 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedPdf | undefined,
  ): Promise<DocumentSummary> {
    return this.documents.upload(user.uid, file);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ListDocumentsResponse> {
    return this.documents.list(user.uid);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', DocumentId) id: string,
  ): Promise<void> {
    return this.documents.remove(user.uid, id);
  }
}
