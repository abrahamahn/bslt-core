// main/apps/server/src/middleware/pagination.ts
/**
 * Pagination module for HTTP middleware and request typing.
 */

import { createPaginationHelpers, type PaginationHelpers } from '@bslt/db';
import { DEFAULT_PAGE_LIMIT, DEFAULT_SORT_BY, DEFAULT_SORT_ORDER } from '@bslt/shared/constants';
import {
  getQueryParam,
  parseLimitParam,
  parsePageParam,
  parseSortByParam,
  parseSortOrderParam,
} from '@bslt/shared/db';

import type { CursorPaginationOptions, PaginationOptions, SortOrder } from '@bslt/shared/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface PaginationMiddlewareOptions {
  defaultLimit?: number;
  maxLimit?: number;
  defaultSortBy?: string;
  defaultSortOrder?: SortOrder;
  enableCursorPagination?: boolean;
  paramNames?: {
    page?: string;
    limit?: string;
    cursor?: string;
    sortBy?: string;
    sortOrder?: string;
  };
}

export interface PaginationContext {
  type: 'offset' | 'cursor';
  offset?: PaginationOptions;
  cursor?: CursorPaginationOptions;
  helpers: PaginationHelpers;
}

export interface PaginationRequest extends FastifyRequest {
  pagination: PaginationContext;
}

const DEFAULT_OPTIONS: Required<PaginationMiddlewareOptions> = {
  defaultLimit: DEFAULT_PAGE_LIMIT,
  maxLimit: 100,
  defaultSortBy: DEFAULT_SORT_BY,
  defaultSortOrder: DEFAULT_SORT_ORDER,
  enableCursorPagination: true,
  paramNames: {
    page: 'page',
    limit: 'limit',
    cursor: 'cursor',
    sortBy: 'sortBy',
    sortOrder: 'sortOrder',
  },
};

export function createPaginationMiddleware(options: PaginationMiddlewareOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return function paginationMiddleware(request: FastifyRequest, _reply: FastifyReply): void {
    const query =
      typeof request.query === 'object' && request.query !== null
        ? (request.query as Record<string, unknown>)
        : {};
    const paramNames = config.paramNames;
    const cursorParam = getQueryParam(query, paramNames.cursor || 'cursor');
    const pageParam = getQueryParam(query, paramNames.page || 'page');
    const hasCursor = cursorParam !== undefined;

    const paginationType: 'offset' | 'cursor' =
      hasCursor && config.enableCursorPagination ? 'cursor' : 'offset';

    const paginationContext: PaginationContext = {
      type: paginationType,
      helpers: createPaginationHelpers(),
    };

    if (paginationType === 'cursor') {
      const cursor = Array.isArray(cursorParam) ? cursorParam[0] : cursorParam;
      const limit = parseLimitParam(getQueryParam(query, paramNames.limit || 'limit'), config);
      const sortBy = parseSortByParam(getQueryParam(query, paramNames.sortBy || 'sortBy'), config);
      const sortOrder = parseSortOrderParam(
        getQueryParam(query, paramNames.sortOrder || 'sortOrder'),
        config,
      );

      const cursorOptions: CursorPaginationOptions = { limit, sortBy, sortOrder };
      if (cursor !== undefined) cursorOptions.cursor = cursor;
      paginationContext.cursor = cursorOptions;
    } else {
      const page = parsePageParam(pageParam);
      const limit = parseLimitParam(getQueryParam(query, paramNames.limit || 'limit'), config);
      const sortBy = parseSortByParam(getQueryParam(query, paramNames.sortBy || 'sortBy'), config);
      const sortOrder = parseSortOrderParam(
        getQueryParam(query, paramNames.sortOrder || 'sortOrder'),
        config,
      );

      paginationContext.offset = { page, limit, sortBy, sortOrder };
    }

    (request as PaginationRequest).pagination = paginationContext;
  };
}
