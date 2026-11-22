// main/kernel/storage/src/providers/local.test.ts
/**
 * LocalStorageProvider signed URLs.
 *
 * Risk assessment — how this provider could leak data:
 * 1. Handing out `${publicBaseUrl}/${key}`: a permanent, unauthenticated link
 *    to private files (the defect this suite pins down).
 * 2. Returning `file://<absolute path>`: discloses the server's filesystem
 *    layout to clients.
 * 3. Signing a different key from the one it stores under (normalization
 *    drift), or accepting an unbounded expiry that is permanent in practice.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { S3_DEFAULTS } from '@bslt/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveStorageUrlKey,
  MAX_SIGNED_URL_EXPIRES_SECONDS,
  verifyStorageUrl,
  type StorageUrlVerdict,
} from '../signing';

import { LocalStorageProvider } from './local';

import type { LocalStorageConfig } from '../types';

const SECRET = 'local-provider-signing-secret-0123456789';
const NOW_MS = Date.UTC(2026, 10, 10, 12, 0, 0);
const NOW_S = NOW_MS / 1000;
const BASE = 'http://localhost:8080/uploads';

interface ParsedSignedUrl {
  pathname: string;
  key: string;
  expires: string | null;
  signature: string | null;
}

function parseSignedUrl(url: string, prefix = '/uploads/'): ParsedSignedUrl {
  const parsed = new URL(url, 'http://relative.invalid');
  const all = (name: string): string[] => parsed.searchParams.getAll(name);
  expect(all('expires')).toHaveLength(1);
  expect(all('signature')).toHaveLength(1);
  return {
    pathname: parsed.pathname,
    key: decodeURIComponent(parsed.pathname.slice(prefix.length)),
    expires: parsed.searchParams.get('expires'),
    signature: parsed.searchParams.get('signature'),
  };
}

function verifyAgainst(url: string, secret: string, nowMs = NOW_MS): StorageUrlVerdict {
  const { key, expires, signature } = parseSignedUrl(url);
  return verifyStorageUrl(
    { method: 'GET', key, expires: expires ?? undefined, signature: signature ?? undefined },
    deriveStorageUrlKey(secret),
    nowMs,
  );
}

describe('LocalStorageProvider', () => {
  let root: string;

  function provider(overrides: Partial<LocalStorageConfig> = {}): LocalStorageProvider {
    return new LocalStorageProvider({
      provider: 'local',
      rootPath: root,
      publicBaseUrl: BASE,
      signingSecret: SECRET,
      maxFileSize: 1024 * 1024,
      allowedTypes: ['*'],
      ...overrides,
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'local-storage-test-'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  describe('construction', () => {
    it.each([
      ['empty', ''],
      ['too short', 'x'.repeat(31)],
    ])('refuses a %s signing secret', (_label, signingSecret) => {
      expect(() => provider({ signingSecret })).toThrow(/at least 32/);
    });
  });

  describe('getSignedUrl', () => {
    it('does not return the permanent public URL', async () => {
      const url = await provider().getSignedUrl('files/user-1/a.png');

      expect(url).not.toBe(`${BASE}/files/user-1/a.png`);
      expect(url.startsWith(`${BASE}/files/user-1/a.png?`)).toBe(true);
    });

    it('issues a URL whose signature verifies with the same secret', async () => {
      const url = await provider().getSignedUrl('files/user-1/a.png');

      expect(verifyAgainst(url, SECRET)).toEqual({
        valid: true,
        expiresAt: NOW_S + S3_DEFAULTS.PRESIGN_EXPIRES_SECONDS,
      });
    });

    it('defaults the expiry to the S3 presign default', async () => {
      const { expires } = parseSignedUrl(await provider().getSignedUrl('files/user-1/a.png'));

      expect(Number(expires)).toBe(NOW_S + S3_DEFAULTS.PRESIGN_EXPIRES_SECONDS);
    });

    it('honours an explicit expiry, up to the maximum', async () => {
      const short = parseSignedUrl(await provider().getSignedUrl('files/u/a.png', 60));
      const max = parseSignedUrl(
        await provider().getSignedUrl('files/u/a.png', MAX_SIGNED_URL_EXPIRES_SECONDS),
      );

      expect(Number(short.expires)).toBe(NOW_S + 60);
      expect(Number(max.expires)).toBe(NOW_S + MAX_SIGNED_URL_EXPIRES_SECONDS);
    });

    it.each([
      ['zero', 0],
      ['negative', -60],
      ['fractional', 1.5],
      ['NaN', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
      ['beyond the maximum', MAX_SIGNED_URL_EXPIRES_SECONDS + 1],
    ])('refuses a %s expiry', async (_label, expiresIn) => {
      await expect(provider().getSignedUrl('files/u/a.png', expiresIn)).rejects.toThrow();
    });

    it('produces a URL that is refused once it expires', async () => {
      const url = await provider().getSignedUrl('files/user-1/a.png', 60);

      expect(verifyAgainst(url, SECRET, NOW_MS + 60_000)).toEqual({
        valid: false,
        reason: 'expired',
      });
    });

    it('produces a URL another deployment secret cannot verify', async () => {
      const url = await provider().getSignedUrl('files/user-1/a.png');

      expect(verifyAgainst(url, 'another-deployment-secret-0123456789abc')).toEqual({
        valid: false,
        reason: 'invalid',
      });
    });

    it('never discloses the filesystem path when no public base URL is configured', async () => {
      const storage = new LocalStorageProvider({
        provider: 'local',
        rootPath: root,
        signingSecret: SECRET,
        maxFileSize: 1024,
        allowedTypes: ['*'],
      });
      const url = await storage.getSignedUrl('files/u/a.png');

      expect(url.startsWith('/uploads/files/u/a.png?')).toBe(true);
      expect(url).not.toContain('file:');
      expect(url).not.toContain(root);
    });

    it('signs the canonical key the file is stored under', async () => {
      const storage = provider();
      const storedKey = await storage.upload('/files/user-1/doc.txt', 'secret body', 'text/plain');
      const { key } = parseSignedUrl(await storage.getSignedUrl(storedKey));

      expect(key).toBe('files/user-1/doc.txt');
      expect(await readFile(join(root, key), 'utf8')).toBe('secret body');
    });

    it('never emits a parent-directory segment for a traversal key', async () => {
      const url = await provider().getSignedUrl('../../etc/passwd');
      const { pathname, key } = parseSignedUrl(url);

      expect(pathname.split('/')).not.toContain('..');
      expect(key.split('/')).not.toContain('..');
      expect(verifyAgainst(url, SECRET).valid).toBe(true);
    });

    it('percent-encodes each key segment and signs the decoded key', async () => {
      const url = await provider().getSignedUrl('files/user 1/a#b?c.png');
      const { pathname, key } = parseSignedUrl(url);

      expect(pathname).toBe('/uploads/files/user%201/a%23b%3Fc.png');
      expect(key).toBe('files/user 1/a#b?c.png');
      expect(verifyAgainst(url, SECRET).valid).toBe(true);
    });

    it.each(['', '/', '..', '/../'])('refuses to sign an empty key (%j)', async (key) => {
      await expect(provider().getSignedUrl(key)).rejects.toThrow();
    });
  });

  describe('upload sessions, head, copy, and multipart', () => {
    it('rejects invalid multipart uploadIds, out-of-range partNumbers, mismatched ETags, and missing sources', async () => {
      const storage = provider();
      await expect(storage.copy('files/missing.bin', 'files/dst.bin')).rejects.toThrow();
      await expect(
        storage.uploadPart('files/a.bin', '../escape', 1, Buffer.from('x')),
      ).rejects.toThrow();
      await expect(
        storage.uploadPart(
          'files/a.bin',
          '11111111-1111-4111-8111-111111111111',
          0,
          Buffer.from('x'),
        ),
      ).rejects.toThrow();
      await expect(
        storage.completeMultipartUpload('files/a.bin', '11111111-1111-4111-8111-111111111111', []),
      ).rejects.toThrow();

      const mp = await storage.createMultipartUpload('files/a.bin', 'application/octet-stream');
      await storage.uploadPart('files/a.bin', mp.uploadId, 1, Buffer.from('part-1'));
      await expect(
        storage.completeMultipartUpload('files/a.bin', mp.uploadId, [
          { partNumber: 1, etag: '"forged-etag"' },
        ]),
      ).rejects.toThrow(/etag/i);
    });

    it('completes multipart uploads in part order, signs PUT URLs with method=PUT, and supports head/copy/abort', async () => {
      const storage = provider();
      const putUrl = await storage.getSignedUploadUrl('files/u1/direct.png', 'image/png', 120);
      const { key, expires, signature } = parseSignedUrl(putUrl);
      expect(
        verifyStorageUrl(
          { method: 'PUT', key, expires: expires ?? undefined, signature: signature ?? undefined },
          deriveStorageUrlKey(SECRET),
          NOW_MS,
        ),
      ).toEqual({ valid: true, expiresAt: NOW_S + 120 });
      expect(
        verifyStorageUrl(
          { method: 'GET', key, expires: expires ?? undefined, signature: signature ?? undefined },
          deriveStorageUrlKey(SECRET),
          NOW_MS,
        ),
      ).toEqual({ valid: false, reason: 'invalid' });

      const mp = await storage.createMultipartUpload('files/u1/video.mp4', 'video/mp4');
      const p2 = await storage.uploadPart(
        'files/u1/video.mp4',
        mp.uploadId,
        2,
        Buffer.from('-two'),
      );
      const p1 = await storage.uploadPart('files/u1/video.mp4', mp.uploadId, 1, Buffer.from('one'));

      const listed = await storage.listUploadedParts('files/u1/video.mp4', mp.uploadId);
      expect(listed).toEqual([
        { partNumber: 1, etag: p1.etag, size: 3 },
        { partNumber: 2, etag: p2.etag, size: 4 },
      ]);

      await storage.completeMultipartUpload('files/u1/video.mp4', mp.uploadId, [
        { partNumber: 2, etag: p2.etag },
        { partNumber: 1, etag: p1.etag },
      ]);
      expect(await storage.head('files/u1/video.mp4')).toEqual({
        exists: true,
        sizeBytes: 7,
      });
      expect((await storage.download('files/u1/video.mp4')).toString('utf8')).toBe('one-two');

      await storage.copy('files/u1/video.mp4', 'files/u1/video-copy.mp4');
      expect((await storage.download('files/u1/video-copy.mp4')).toString('utf8')).toBe('one-two');

      const mpAbort = await storage.createMultipartUpload('files/u1/abort.mp4', 'video/mp4');
      await storage.uploadPart('files/u1/abort.mp4', mpAbort.uploadId, 1, Buffer.from('temp'));
      await storage.abortMultipartUpload('files/u1/abort.mp4', mpAbort.uploadId);
      expect(await storage.listUploadedParts('files/u1/abort.mp4', mpAbort.uploadId)).toEqual([]);
    });
  });
});
