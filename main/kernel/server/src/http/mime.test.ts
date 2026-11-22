// main/kernel/server/src/http/mime.test.ts
import { describe, expect, it } from 'vitest';

import { getMimeType } from './mime';

describe('getMimeType', () => {
  it('resolves known media and document MIME types case-insensitively', () => {
    expect(getMimeType('/uploads/avatar.PNG')).toBe('image/png');
    expect(getMimeType('report.pdf')).toBe('application/pdf');
    expect(getMimeType('icon.svg')).toBe('image/svg+xml');
    expect(getMimeType('archive.tar.gz')).toBe('application/gzip');
  });

  it('falls back to application/octet-stream for unknown, missing, or trailing-dot extensions', () => {
    expect(getMimeType('README')).toBe('application/octet-stream');
    expect(getMimeType('file.')).toBe('application/octet-stream');
    expect(getMimeType('payload.unknownext')).toBe('application/octet-stream');
    expect(getMimeType('')).toBe('application/octet-stream');
  });
});
