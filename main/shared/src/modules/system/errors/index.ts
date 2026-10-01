// main/shared/src/modules/system/errors/index.ts

export {
  AppError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ERROR_CODES,
  ExternalDependencyError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RequestSchemaError,
  UnprocessableError,
  TooManyRequestsError,
  TimeoutError,
  UnavailableError,
  ValidationError,
  getKindForStatusCode,
  getStatusCodeForKind,
  isAppError,
  normalizeUnknownError,
  toErrorWire,
} from './errors';
export type {
  AppErrorInit,
  ErrorCode,
  ErrorKind,
  ErrorStatusCode,
  ErrorWire,
  FieldError,
} from './errors';
