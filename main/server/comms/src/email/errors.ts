// main/server/comms/src/email/errors.ts
import { AUTH_ERROR_NAMES, ERROR_CODES, ERROR_MESSAGES } from '@bslt/shared/constants';
import { UnavailableError } from '@bslt/shared/system';

export class EmailSendError extends UnavailableError {
  public readonly originalError: Error | undefined;
  public override name = AUTH_ERROR_NAMES.EmailSendError;

  constructor(message: string = ERROR_MESSAGES.EMAIL_SEND_FAILED, originalError?: Error) {
    super(message, ERROR_CODES.EMAIL_SEND_FAILED, { retryAfterMs: 30_000 });
    this.originalError = originalError;
  }
}
