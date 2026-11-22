// main/apps/server/src/middleware/geo.test.ts

import {
  JURISDICTION_BLOCKED,
  jurisdictionBlockedBodySchema,
  type GeoHeaders,
} from '@bslt/server-system/security';
import { describe, expect, it, vi } from 'vitest';

import {
  createGeoBlockMiddleware,
  createGeoProvider,
  HeaderGeoAdapter,
  NullGeoAdapter,
} from './geo';

import type { HttpReply, HttpRequest } from '@bslt/server-system/http';

// ============================================================================
// Test Doubles
// ============================================================================

class ReplyStub implements HttpReply {
  statusCode: number | undefined;
  body: unknown;
  sent = false;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  code(code: number): this {
    return this.status(code);
  }

  send(data: unknown): this {
    this.body = data;
    this.sent = true;
    return this;
  }

  header(): this {
    return this;
  }
}

/** The middleware reads only `url` and `headers`; the rest is Fastify's shape. */
function createRequest(headers: GeoHeaders, url = '/api/users/me'): HttpRequest {
  return {
    headers,
    url,
    method: 'POST',
    ip: '203.0.113.10',
    body: undefined,
    params: {},
    query: {},
    correlationId: 'test-correlation-id',
  } as unknown as HttpRequest;
}

const WA = ['US-WA'];
const WA_HEADERS: GeoHeaders = { 'cf-ipcountry': 'US', 'cf-region-code': 'WA' };

const HEADER_OPTIONS = {
  countryHeader: 'cf-ipcountry',
  regionHeaders: ['cf-region-code', 'x-geo-region', 'cf-region'],
} as const;

interface GateResult {
  reply: ReplyStub;
  /** What the hook told Fastify: `true` = it answered, do not continue. */
  blocked: boolean;
}

function createMiddleware(
  blockedRegions: readonly string[] = WA,
): (headers: GeoHeaders, url?: string) => GateResult {
  const middleware = createGeoBlockMiddleware({
    blockedRegions,
    provider: new HeaderGeoAdapter(HEADER_OPTIONS),
  });

  return (headers, url) => {
    const reply = new ReplyStub();
    const blocked = middleware(createRequest(headers, url), reply);
    return { reply, blocked };
  };
}

// ============================================================================
// HeaderGeoAdapter
// ============================================================================

describe('HeaderGeoAdapter', () => {
  const adapter = new HeaderGeoAdapter(HEADER_OPTIONS);

  it('reads country and region from the CDN headers', () => {
    expect(adapter.resolve(WA_HEADERS)).toEqual({ country: 'US', region: 'WA' });
  });

  it('parses headers case-insensitively — name and value', () => {
    expect(adapter.resolve({ 'CF-IPCountry': 'us', 'CF-Region-Code': 'wa' })).toEqual({
      country: 'US',
      region: 'WA',
    });
  });

  it('takes the first value of a repeated header', () => {
    expect(adapter.resolve({ 'cf-ipcountry': ['US', 'GB'], 'cf-region-code': ['WA'] })).toEqual({
      country: 'US',
      region: 'WA',
    });
  });

  it('falls through the region headers in priority order', () => {
    // cf-region-code absent -> x-geo-region answers.
    expect(adapter.resolve({ 'cf-ipcountry': 'US', 'x-geo-region': 'WA' })).toEqual({
      country: 'US',
      region: 'WA',
    });

    // A present-but-empty header is not an answer; the next one is consulted.
    expect(
      adapter.resolve({ 'cf-ipcountry': 'US', 'cf-region-code': '', 'cf-region': 'Washington' }),
    ).toEqual({ country: 'US', region: 'WASHINGTON' });

    // The highest-priority header that answers wins.
    expect(
      adapter.resolve({ 'cf-ipcountry': 'US', 'cf-region-code': 'WA', 'cf-region': 'Washington' }),
    ).toEqual({ country: 'US', region: 'WA' });
  });

  it('reports an unknown location when no country header is present', () => {
    expect(adapter.resolve({})).toEqual({});
    expect(adapter.resolve({ 'user-agent': 'curl/8' })).toEqual({});
  });

  it('reports an unknown location when the CDN says it does not know', () => {
    expect(adapter.resolve({ 'cf-ipcountry': 'XX', 'cf-region-code': 'WA' })).toEqual({});
    expect(adapter.resolve({ 'cf-ipcountry': 'T1' })).toEqual({});
  });

  it('drops a region it cannot attribute to a country', () => {
    expect(adapter.resolve({ 'cf-region-code': 'WA' })).toEqual({});
  });

  it('reports the country alone when no region header is present', () => {
    expect(adapter.resolve({ 'cf-ipcountry': 'US' })).toEqual({
      country: 'US',
      region: undefined,
    });
  });
});

describe('NullGeoAdapter', () => {
  it('never reports a location, even when the headers carry one', () => {
    expect(new NullGeoAdapter().resolve()).toEqual({});
  });
});

describe('createGeoProvider', () => {
  it('uses the header adapter when a country header is configured', () => {
    expect(createGeoProvider(HEADER_OPTIONS).name).toBe('header');
  });

  it('uses the null adapter when the deployment declares no geo source', () => {
    expect(createGeoProvider({ countryHeader: '', regionHeaders: [] }).name).toBe('null');
    expect(createGeoProvider({ countryHeader: '  ', regionHeaders: [] }).name).toBe('null');
  });
});

// ============================================================================
// createGeoBlockMiddleware
// ============================================================================

describe('createGeoBlockMiddleware', () => {
  it('rejects a blocked region with 403 and a machine-readable body', () => {
    const { reply, blocked } = createMiddleware()(WA_HEADERS);

    // `true` is what stops Fastify continuing to the route.
    expect(blocked).toBe(true);
    expect(reply.statusCode).toBe(403);
    expect(reply.sent).toBe(true);

    const body = jurisdictionBlockedBodySchema.parse(reply.body);
    expect(body.code).toBe(JURISDICTION_BLOCKED);
    expect(body.jurisdiction).toBe('US-WA');
    expect(body.unavailablePath).toBe('/unavailable');
  });

  it('allows an UNKNOWN region — we cannot know, so we must not block', () => {
    // No CDN in front of the app: no headers at all.
    expect(createMiddleware()({})).toMatchObject({ blocked: false });
    // A CDN that cannot place the request.
    expect(createMiddleware()({ 'cf-ipcountry': 'XX' })).toMatchObject({ blocked: false });
    // A region with no country to attribute it to.
    expect(createMiddleware()({ 'cf-region-code': 'WA' })).toMatchObject({ blocked: false });
  });

  it('allows a non-blocked region', () => {
    expect(createMiddleware()({ 'cf-ipcountry': 'US', 'cf-region-code': 'NV' }).blocked).toBe(
      false,
    );
    expect(createMiddleware()({ 'cf-ipcountry': 'GB' }).blocked).toBe(false);
    // The country is not blocked — only the one subdivision is.
    expect(createMiddleware()({ 'cf-ipcountry': 'US' }).blocked).toBe(false);
  });

  it('changes behaviour with the configured list — new jurisdiction, no new code', () => {
    const ontario: GeoHeaders = { 'cf-ipcountry': 'CA', 'cf-region-code': 'ON' };

    expect(createMiddleware(WA)(ontario).blocked).toBe(false);

    const { reply, blocked } = createMiddleware(['US-WA', 'CA-ON'])(ontario);
    expect(blocked).toBe(true);
    expect(reply.statusCode).toBe(403);
    expect(jurisdictionBlockedBodySchema.parse(reply.body).jurisdiction).toBe('CA-ON');
  });

  it('accepts a lower-case configured list', () => {
    expect(createMiddleware(['us-wa'])(WA_HEADERS).reply.statusCode).toBe(403);
  });

  it('blocks a whole country when the list names one', () => {
    const { reply } = createMiddleware(['US'])({ 'cf-ipcountry': 'US', 'cf-region-code': 'NV' });

    expect(reply.statusCode).toBe(403);
    expect(jurisdictionBlockedBodySchema.parse(reply.body).jurisdiction).toBe('US');
  });

  it('stays inert when nothing is configured as blocked', () => {
    expect(createMiddleware([])(WA_HEADERS).blocked).toBe(false);
  });

  it('never blocks a health probe — a geo gate must not read as an outage', () => {
    expect(createMiddleware()(WA_HEADERS, '/health').blocked).toBe(false);
    expect(createMiddleware()(WA_HEADERS, '/health/live').blocked).toBe(false);
    expect(createMiddleware()(WA_HEADERS, '/health/ready?deep=1').blocked).toBe(false);
    // ...but everything else from a blocked region is gone.
    expect(createMiddleware()(WA_HEADERS, '/api/auth/register').reply.statusCode).toBe(403);
  });

  it('never blocks when the provider cannot see a location', () => {
    const middleware = createGeoBlockMiddleware({
      blockedRegions: WA,
      provider: new NullGeoAdapter(),
    });
    const reply = new ReplyStub();

    const blocked = middleware(createRequest(WA_HEADERS), reply);

    expect(blocked).toBe(false);
    expect(reply.sent).toBe(false);
  });

  it('reports the block once, with the jurisdiction that matched', () => {
    const onBlocked = vi.fn();
    const middleware = createGeoBlockMiddleware({
      blockedRegions: WA,
      provider: new HeaderGeoAdapter(HEADER_OPTIONS),
      onBlocked,
    });

    middleware(createRequest(WA_HEADERS), new ReplyStub());
    middleware(createRequest({ 'cf-ipcountry': 'GB' }), new ReplyStub());

    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked.mock.calls[0]?.[0]).toBe('US-WA');
  });
});
