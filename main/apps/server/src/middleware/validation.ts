// main/apps/server/src/middleware/validation.ts
/**
 * Input Validation & Sanitization Middleware
 *
 * Comprehensive input validation and sanitization for API endpoints.
 * Prevents injection attacks, validates data types, and sanitizes user input.
 */

import { BadRequestError } from '@bslt/contract';
import {
  getInjectionErrors,
  sanitizeObject,
  type ValidationOptions,
} from '@bslt/server-system/security';

import type { HttpServer, HttpServerRequest } from '@bslt/server-system/http';

// ============================================================================
// HTTP Server Middleware
// ============================================================================

/**
 * Register input validation middleware on an HTTP server instance
 */
export function registerInputValidation(server: HttpServer, options: ValidationOptions = {}): void {
  const {
    strict = true,
    sanitize = true,
    removeEmpty = true,
    maxDepth = 10,
    maxArrayLength = 1000,
    maxStringLength = 10000,
  } = options;

  // Pre-handler validation hook
  server.addHook('preHandler', (req: HttpServerRequest) => {
    const validationResult = validateRequestInput(req, {
      strict,
      sanitize,
      removeEmpty,
      maxDepth,
      maxArrayLength,
      maxStringLength,
    });

    if (!validationResult.valid) {
      throw new BadRequestError('Invalid input data', 'VALIDATION_ERROR', {
        errors: validationResult.errors,
        warnings: validationResult.warnings,
      });
    }

    // Store sanitized data back in request using Object.defineProperty
    // to avoid type assertions
    if (validationResult.sanitizedBody !== undefined) {
      Object.defineProperty(req, 'body', {
        value: validationResult.sanitizedBody,
        writable: true,
        configurable: true,
      });
    }
    if (validationResult.sanitizedQuery !== undefined) {
      Object.defineProperty(req, 'query', {
        value: validationResult.sanitizedQuery,
        writable: true,
        configurable: true,
      });
    }
    if (validationResult.sanitizedParams !== undefined) {
      Object.defineProperty(req, 'params', {
        value: validationResult.sanitizedParams,
        writable: true,
        configurable: true,
      });
    }

    // Security warnings are logged through the sanitization process
    // and can be accessed via validationResult.warnings if needed
  });
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedBody?: unknown;
  sanitizedQuery?: unknown;
  sanitizedParams?: unknown;
}

function isParsedMultipartFileBody(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  return candidate['buffer'] instanceof Uint8Array && typeof candidate['mimetype'] === 'string';
}

/**
 * Validate all request input (body, query, params)
 */
function validateRequestInput(
  req: HttpServerRequest,
  options: ValidationOptions,
): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  let sanitizedBody: unknown;
  let sanitizedQuery: unknown;
  let sanitizedParams: unknown;

  // Validate and sanitize body
  const shouldSkipBodySanitization = isParsedMultipartFileBody(req.body);
  if (!shouldSkipBodySanitization && req.body != null && typeof req.body === 'object') {
    const result = sanitizeObject(req.body, options);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);

    if (result.valid) {
      sanitizedBody = result.data;
    }
  }

  // Validate and sanitize query parameters
  const rawQuery: unknown = req.query;
  if (rawQuery != null && typeof rawQuery === 'object') {
    const result = sanitizeObject(rawQuery, options);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);

    if (result.valid) {
      sanitizedQuery = result.data;
    }
  }

  // Validate and sanitize route parameters
  const rawParams: unknown = req.params;
  if (rawParams != null && typeof rawParams === 'object') {
    const result = sanitizeObject(rawParams, options);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);

    if (result.valid) {
      sanitizedParams = result.data;
    }
  }

  // Check for injection patterns in string inputs
  const skipBodyInjectionCheck =
    shouldSkipBodySanitization || req.routeOptions.config.skipBodyInjectionFilter === true;
  const inputs: [unknown, string][] = [
    ...(skipBodyInjectionCheck ? [] : ([[req.body, 'body']] as [unknown, string][])),
    [req.query, 'query'],
    [req.params, 'params'],
  ];
  for (const [input, source] of inputs) {
    allErrors.push(...getInjectionErrors(input, source));
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    sanitizedBody,
    sanitizedQuery,
    sanitizedParams,
  };
}
