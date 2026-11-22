// main/apps/server/src/middleware/pagination.ts
/**
 * Pagination module for HTTP middleware and request typing.
 */

import {
  DEFAULT_PAGE_LIMIT,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  type CursorPaginationOptions,
  type PaginationOptions,
  type SortOrder,
} from '@bslt/contract';
import {
  createPaginationHelpers,
  getQueryParam,
  parseLimitParam,
  parsePageParam,
  parseSortByParam,
  parseSortOrderParam,
  type PaginationHelpers,
} from '@bslt/db';

import type { HttpServerReply, HttpServerRequest } from '@bslt/server-system/http';

interface PaginationMiddlewareOptions {
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

interface PaginationContext {
  type: 'offset' | 'cursor';
  offset?: PaginationOptions;
  cursor?: CursorPaginationOptions;
  helpers: PaginationHelpers;
}

export interface PaginationRequest extends HttpServerRequest {
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

  return function paginationMiddleware(request: HttpServerRequest, _reply: HttpServerReply): void {
    const rawQuery: unknown = request.query;
    const query =
      typeof rawQuery === 'object' && rawQuery !== null
        ? (rawQuery as Record<string, unknown>)
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
