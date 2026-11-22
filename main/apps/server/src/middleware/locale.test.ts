// main/apps/server/src/middleware/locale.test.ts
/**
 * Accept-Language Middleware Tests
 *
 * Tests for header parsing, locale resolution, quality-value sorting,
 * and Fastify hook integration.
 */

import { createHttpServer, type HttpServer } from '@bslt/server-system/http';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  DEFAULT_LOCALE,
  parseAcceptLanguage,
  registerLocaleHook,
  resolveLocale,
  SUPPORTED_LOCALES,
} from './locale';

// ============================================================================
// parseAcceptLanguage
// ============================================================================

describe('parseAcceptLanguage', () => {
  test('should return empty array for empty string', () => {
    expect(parseAcceptLanguage('')).toEqual([]);
  });

  test('should return empty array for wildcard', () => {
    expect(parseAcceptLanguage('*')).toEqual([]);
  });

  test('should parse a single locale', () => {
    const result = parseAcceptLanguage('en-US');
    expect(result).toEqual([{ locale: 'en-US', quality: 1 }]);
  });

  test('should parse multiple locales with quality values', () => {
    const result = parseAcceptLanguage('en-US,en;q=0.9,fr;q=0.8');
    expect(result).toEqual([
      { locale: 'en-US', quality: 1 },
      { locale: 'en', quality: 0.9 },
      { locale: 'fr', quality: 0.8 },
    ]);
  });

  test('should sort by quality descending', () => {
    const result = parseAcceptLanguage('fr;q=0.5,en-US;q=0.9,es;q=0.7');
    expect(result[0]!.locale).toBe('en-US');
    expect(result[1]!.locale).toBe('es');
    expect(result[2]!.locale).toBe('fr');
  });

  test('should default quality to 1 when not specified', () => {
    const result = parseAcceptLanguage('de,fr;q=0.5');
    expect(result[0]).toEqual({ locale: 'de', quality: 1 });
    expect(result[1]).toEqual({ locale: 'fr', quality: 0.5 });
  });

  test('should handle whitespace around entries', () => {
    const result = parseAcceptLanguage(' en-US , fr ; q=0.8 ');
    expect(result).toHaveLength(2);
    expect(result[0]!.locale).toBe('en-US');
    expect(result[1]!.locale).toBe('fr');
  });

  test('should skip wildcard entries within a list', () => {
    const result = parseAcceptLanguage('en-US,*,fr;q=0.5');
    expect(result).toHaveLength(2);
    expect(result[0]!.locale).toBe('en-US');
    expect(result[1]!.locale).toBe('fr');
  });

  test('should skip empty entries from trailing commas', () => {
    const result = parseAcceptLanguage('en-US,,fr;q=0.5,');
    expect(result).toHaveLength(2);
  });

  test('should handle complex real-world Accept-Language headers', () => {
    const header = 'en-US,en;q=0.9,es-MX;q=0.8,es;q=0.7,fr;q=0.6';
    const result = parseAcceptLanguage(header);
    expect(result).toHaveLength(5);
    expect(result[0]!.locale).toBe('en-US');
    expect(result[4]!.locale).toBe('fr');
  });

  test('should ignore invalid quality values', () => {
    const result = parseAcceptLanguage('en;q=abc');
    expect(result).toEqual([{ locale: 'en', quality: 1 }]);
  });

  test('should ignore out-of-range quality values', () => {
    const result = parseAcceptLanguage('en;q=1.5');
    expect(result).toEqual([{ locale: 'en', quality: 1 }]);
  });
});

// ============================================================================
// resolveLocale
// ============================================================================

describe('resolveLocale', () => {
  test('should return DEFAULT_LOCALE for empty entries', () => {
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
  });

  test('should return exact match for en-US', () => {
    const entries = [{ locale: 'en-US', quality: 1 }];
    expect(resolveLocale(entries)).toBe('en-US');
  });

  test('should return en-US for prefix "en" and regional English tags', () => {
    expect(resolveLocale([{ locale: 'en', quality: 1 }])).toBe('en-US');
    expect(resolveLocale([{ locale: 'en-GB', quality: 1 }])).toBe('en-US');
  });

  test('should fall back to DEFAULT_LOCALE for unsupported locales', () => {
    for (const locale of ['es', 'es-MX', 'fr-FR', 'de', 'ja', 'ko', 'zh-CN', 'pt-BR', 'ar', 'th']) {
      expect(resolveLocale([{ locale, quality: 1 }])).toBe(DEFAULT_LOCALE);
    }
  });

  test('should skip unsupported entries and match en-US', () => {
    const entries = [
      { locale: 'th', quality: 1 },
      { locale: 'fr', quality: 0.9 },
      { locale: 'en-GB', quality: 0.8 },
    ];
    expect(resolveLocale(entries)).toBe('en-US');
  });
});

// ============================================================================
// Constants
// ============================================================================

describe('constants', () => {
  test('DEFAULT_LOCALE should be en-US', () => {
    expect(DEFAULT_LOCALE).toBe('en-US');
  });

  test('SUPPORTED_LOCALES should contain only en-US in foundation', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en-US']);
  });
});

// ============================================================================
// registerLocaleHook — Fastify integration
// ============================================================================

describe('registerLocaleHook', () => {
  let server: HttpServer;

  beforeEach(async () => {
    server = createHttpServer();
    registerLocaleHook(server);

    server.get('/test', (request) => {
      return { locale: request.locale };
    });

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  test('should default to en-US when no Accept-Language header', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { locale: string };
    expect(body.locale).toBe('en-US');
  });

  test('should fall back to en-US for non-en-US Accept-Language headers', async () => {
    for (const header of [
      'es',
      'fr-FR,fr;q=0.9,en;q=0.8',
      'th-TH',
      'th-TH,th;q=0.9,fr;q=0.8,en-US;q=0.7',
      'ko-KR,ko;q=0.9',
      'ja',
      'zh-CN,zh;q=0.9',
      'pt-BR,pt;q=0.9',
      'ar-SA,ar;q=0.9',
      'de-DE,de;q=0.9',
    ]) {
      const response = await server.inject({
        method: 'GET',
        url: '/test',
        headers: { 'accept-language': header },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { locale: string };
      expect(body.locale).toBe('en-US');
    }
  });

  test('should resolve en-US from Accept-Language: en-US,en;q=0.9', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { locale: string };
    expect(body.locale).toBe('en-US');
  });

  test('should handle wildcard Accept-Language gracefully', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test',
      headers: { 'accept-language': '*' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { locale: string };
    expect(body.locale).toBe('en-US');
  });
});
