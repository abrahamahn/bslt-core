// main/kernel/server/src/security/geo.schemas.test.ts

import { describe, expect, it } from 'vitest';

import {
  JURISDICTION_BLOCKED,
  jurisdictionBlockedBodySchema,
  UNAVAILABLE_PATH,
} from './geo.schemas';

import type { GeoHeaders, GeoLocation, GeoProvider } from './geo.schemas';

describe('jurisdictionBlockedBodySchema', () => {
  it('parses a well-formed body', () => {
    const parsed = jurisdictionBlockedBodySchema.parse({
      code: JURISDICTION_BLOCKED,
      message: 'This service is not offered in your region.',
      jurisdiction: 'US-WA',
      unavailablePath: UNAVAILABLE_PATH,
    });

    expect(parsed).toEqual({
      code: 'JURISDICTION_BLOCKED',
      message: 'This service is not offered in your region.',
      jurisdiction: 'US-WA',
      unavailablePath: '/unavailable',
    });
  });

  it('defaults the unavailable path when the field is absent', () => {
    const parsed = jurisdictionBlockedBodySchema.parse({
      code: JURISDICTION_BLOCKED,
      message: 'blocked',
      jurisdiction: 'US-WA',
    });

    expect(parsed.unavailablePath).toBe(UNAVAILABLE_PATH);
  });

  it('rejects a body carrying a different error code', () => {
    // A client that branches on `code` must not be fooled by a generic 403.
    expect(() =>
      jurisdictionBlockedBodySchema.parse({
        code: 'FORBIDDEN',
        message: 'blocked',
        jurisdiction: 'US-WA',
      }),
    ).toThrow();
  });

  it('rejects a body missing a required field', () => {
    expect(() =>
      jurisdictionBlockedBodySchema.parse({ code: JURISDICTION_BLOCKED, message: 'blocked' }),
    ).toThrow();

    expect(() =>
      jurisdictionBlockedBodySchema.parse({ code: JURISDICTION_BLOCKED, jurisdiction: 'US-WA' }),
    ).toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => jurisdictionBlockedBodySchema.parse(null)).toThrow();
    expect(() => jurisdictionBlockedBodySchema.parse('US-WA')).toThrow();
  });
});

describe('GeoProvider port', () => {
  it('is satisfiable by a total implementation that reports unknown', () => {
    // The port's contract: resolve never throws — an unknown location is `{}`.
    const stub: GeoProvider = {
      name: 'stub',
      resolve: (_headers: GeoHeaders): GeoLocation => ({}),
    };

    expect(stub.resolve({})).toEqual({});
    expect(stub.name).toBe('stub');
  });
});
