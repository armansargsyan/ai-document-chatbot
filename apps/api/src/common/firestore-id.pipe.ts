import { NotFoundException, type PipeTransform } from '@nestjs/common';

/**
 * Route param pipe for Firestore auto-IDs (20 alphanumerics). Anything else
 * cannot exist, so it is a 404 — this also blocks path tricks like `../x`.
 */
export class FirestoreIdPipe implements PipeTransform<string, string> {
  constructor(private readonly notFoundMessage = 'Not found') {}

  transform(value: string): string {
    if (!/^[A-Za-z0-9]{20}$/.test(value)) {
      throw new NotFoundException(this.notFoundMessage);
    }
    return value;
  }
}
