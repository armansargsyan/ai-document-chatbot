import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  type PipeTransform,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_PDF_BYTES,
  type DocumentSummary,
  type ListDocumentsResponse,
} from '@ai-document-chatbot/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/token-verifier';
import { DocumentsService, type UploadedPdf } from './documents.service';

/** Firestore auto-IDs are 20 alphanumerics; anything else cannot exist. */
class DocumentIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[A-Za-z0-9]{20}$/.test(value))
      throw new NotFoundException('Document not found');
    return value;
  }
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Multipart upload with the PDF in the `file` field. Oversized files get 413. */
  @Post()
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
    @Param('id', DocumentIdPipe) id: string,
  ): Promise<void> {
    return this.documents.remove(user.uid, id);
  }
}
