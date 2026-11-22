// main/kernel/server/src/http/request-context.test.ts
/**
 * Tests for request-context helpers: the shared authenticated-user guard
 * used by core handlers.
 */

import { AuthenticationError, type AuthenticatedUser, type RequestContext } from '@bslt/contract';
import { describe, expect, test } from 'vitest';

import { getAuthenticatedUser, requireAuthenticatedUser } from './request-context';

import type { Logger } from '../logger/types';
import type { HttpRequest } from './http';

const user: AuthenticatedUser = { userId: 'u-1', role: 'user' };

const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: (): Logger => noopLogger,
};

function httpRequest(withUser: boolean): HttpRequest {
  const request: HttpRequest = {
    body: undefined,
    params: {},
    query: {},
    headers: {},
    ip: '127.0.0.1',
    method: 'GET',
    url: '/test',
    correlationId: 'cid',
    log: noopLogger,
  };
  if (withUser) {
    // Spread: interfaces lack the implicit index signature HttpRequest['user'] expects.
    request.user = { ...user };
  }
  return request;
}

function requestContext(withUser: boolean): RequestContext {
  const context: RequestContext = { requestInfo: { ip: '127.0.0.1' } };
  if (withUser) {
    context.user = user;
  }
  return context;
}

describe('getAuthenticatedUser', () => {
  test('returns the user attached to an HttpRequest', () => {
    expect(getAuthenticatedUser(httpRequest(true))).toEqual(user);
  });

  test('returns the user attached to a RequestContext', () => {
    expect(getAuthenticatedUser(requestContext(true))).toEqual(user);
  });

  test('returns undefined when no user is attached', () => {
    expect(getAuthenticatedUser(httpRequest(false))).toBeUndefined();
    expect(getAuthenticatedUser(requestContext(false))).toBeUndefined();
  });
});

describe('requireAuthenticatedUser', () => {
  test('returns the user when authenticated', () => {
    expect(requireAuthenticatedUser(httpRequest(true))).toEqual(user);
  });

  test('throws AuthenticationError when no user is attached', () => {
    expect(() => requireAuthenticatedUser(httpRequest(false))).toThrow(AuthenticationError);
    expect(() => requireAuthenticatedUser(requestContext(false))).toThrow('Unauthorized');
  });

  test('thrown error maps to a 401 authentication kind', () => {
    try {
      requireAuthenticatedUser(requestContext(false));
      expect.unreachable('should have thrown');
    } catch (error) {
      const appError = error as AuthenticationError;
      expect(appError.kind).toBe('authentication');
      expect(appError.statusCode).toBe(401);
    }
  });
});
