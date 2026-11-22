// main/kernel/contract/src/errors.ts

export const ERROR_KINDS = [
  'validation',
  'authentication',
  'authorization',
  'not_found',
  'conflict',
  'rate_limit',
  'external_dependency',
  'timeout',
  'unavailable',
  'internal',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504;

export interface RegisteredError {
  readonly code: string;
  readonly moduleId: string;
  readonly name: string;
  readonly status: ErrorStatusCode;
  readonly kind: ErrorKind;
}

const VALID_ERROR_STATUSES: ReadonlySet<number> = new Set<ErrorStatusCode>([
  400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504,
]);

const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*$/;
const ERROR_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const errorRegistry = new Map<string, RegisteredError>();

export function kindForStatus(status: ErrorStatusCode): ErrorKind {
  switch (status) {
    case 400:
    case 422:
      return 'validation';
    case 401:
      return 'authentication';
    case 403:
      return 'authorization';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limit';
    case 502:
      return 'external_dependency';
    case 503:
      return 'unavailable';
    case 504:
      return 'timeout';
    case 500:
      return 'internal';
  }
}

export function defineErrors<
  const M extends string,
  const Defs extends Readonly<Record<string, ErrorStatusCode>>,
>(moduleId: M, defs: Defs): { readonly [K in keyof Defs & string]: `${M}.${K}` } {
  if (!MODULE_ID_PATTERN.test(moduleId)) {
    throw new Error(
      `Invalid module id "${moduleId}" in defineErrors: expected lowercase alphanumeric matching /^[a-z][a-z0-9]*$/`,
    );
  }

  const out: Record<string, string> = {};
  for (const [key, status] of Object.entries(defs)) {
    if (!ERROR_KEY_PATTERN.test(key)) {
      throw new Error(
        `Invalid error key "${key}" in module "${moduleId}": expected UPPER_SNAKE_CASE matching /^[A-Z][A-Z0-9_]*$/`,
      );
    }
    if (!VALID_ERROR_STATUSES.has(status)) {
      throw new Error(
        `Invalid HTTP error status ${String(status)} for "${moduleId}.${key}": expected one of 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504`,
      );
    }

    const code = `${moduleId}.${key}`;
    const existing = errorRegistry.get(code);
    if (existing !== undefined && existing.status !== status) {
      throw new Error(
        `Error code "${code}" is already registered with status ${String(existing.status)} (cannot re-register with ${String(status)})`,
      );
    }

    if (existing === undefined) {
      errorRegistry.set(code, {
        code,
        moduleId,
        name: key,
        status,
        kind: kindForStatus(status),
      });
    }
    out[key] = code;
  }

  return Object.freeze(out) as { readonly [K in keyof Defs & string]: `${M}.${K}` };
}

export function lookupErrorCode(code: string): RegisteredError | undefined {
  return errorRegistry.get(code);
}
