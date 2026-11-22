// main/kernel/server/src/errors/index.ts

export { AuthenticationError, ForbiddenError } from '@bslt/contract';
export { mapErrorToHttpResponse, toHttpErrorResponse } from './errors';
export type {
  ErrorMapperLogger,
  ErrorMapperOptions,
  HttpErrorResponse,
  ToHttpErrorOptions,
} from './types';
