// main/server/core/src/users/errors.ts
import { AUTH_ERROR_NAMES, ERROR_CODES } from '@bslt/shared/constants';
import { NotFoundError } from '@bslt/shared/system';

export class UserNotFoundError extends NotFoundError {
  constructor(message = 'User not found') {
    super(message, ERROR_CODES.USER_NOT_FOUND);
    this.name = AUTH_ERROR_NAMES.UserNotFoundError;
  }
}
