// main/testing/src/http.test.ts
import { describe, expect, it } from 'vitest';

import { buildAuthenticatedRequest, getAllCookies, getResponseCookie, withCsrf } from './http';

const csrf = { token: 'tok', cookie: '_csrf=signed' };

describe('withCsrf', () => {
  it('leaves safe methods as written', () => {
    const request = { method: 'GET' as const, url: '/api/users/me' };
    expect(withCsrf(request, csrf)).toBe(request);
    expect(withCsrf({ url: '/health' }, csrf)).toEqual({ url: '/health' });
  });

  it('adds the header and the cookie to a state-changing request', () => {
    expect(withCsrf({ method: 'POST', url: '/api/x', payload: { a: 1 } }, csrf)).toEqual({
      method: 'POST',
      url: '/api/x',
      payload: { a: 1 },
      headers: { 'x-csrf-token': 'tok', cookie: '_csrf=signed' },
    });
  });

  it('keeps the cookies and headers the test sends', () => {
    const request = withCsrf(
      {
        method: 'post',
        url: '/api/auth/refresh',
        headers: { Cookie: 'refreshToken=abc', authorization: 'Bearer t' },
      },
      csrf,
    );
    expect(request.headers).toEqual({
      authorization: 'Bearer t',
      'x-csrf-token': 'tok',
      cookie: 'refreshToken=abc; _csrf=signed',
    });
  });

  it('does not touch a request that brings its own token', () => {
    const request = {
      method: 'DELETE' as const,
      url: '/api/x',
      headers: { 'X-CSRF-Token': 'forged' },
    };
    expect(withCsrf(request, csrf)).toBe(request);
  });
});

describe('cookie and request helpers', () => {
  const response = {
    headers: { 'set-cookie': ['refreshToken=r1; Path=/; HttpOnly', '_csrf=c1; Path=/'] },
  } as never;

  it('reads one cookie value and all cookies from a response', () => {
    expect(getResponseCookie(response, 'refreshToken')).toBe('r1');
    expect(getResponseCookie(response, 'missing')).toBeUndefined();
    expect(getAllCookies(response)).toHaveLength(2);
    expect(getAllCookies({ headers: {} } as never)).toEqual([]);
  });

  it('builds an authenticated request from its parts', () => {
    expect(
      buildAuthenticatedRequest({
        method: 'POST',
        url: '/api/x',
        accessToken: 'jwt',
        csrfToken: 'tok',
        csrfCookie: '_csrf=c1',
        cookies: { refreshToken: 'r1' },
        tenantId: 'tenant-1',
      }),
    ).toEqual({
      method: 'POST',
      url: '/api/x',
      headers: {
        authorization: 'Bearer jwt',
        'x-csrf-token': 'tok',
        'x-tenant-id': 'tenant-1',
        cookie: '_csrf=c1; refreshToken=r1',
      },
    });
  });
});
