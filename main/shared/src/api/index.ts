// main/shared/src/api/index.ts
/**
 * API Contract Definitions
 *
 * This module provides the core types and utilities for defining
 * type-safe API contracts and routers.
 *
 * @module API
 */

export { apiRouter } from './router';
export type { ApiRouter } from './router';
export type {
  ApiResponse,
  ApiResult,
  Contract,
  ContractRouter,
  EndpointDef,
  ErrorCode,
  ErrorResponse,
  HttpMethod,
  InferOkData,
  InferResponseData,
  QueryParams,
  RequestBody,
  StatusCode,
  SuccessResponse,
} from './api';
