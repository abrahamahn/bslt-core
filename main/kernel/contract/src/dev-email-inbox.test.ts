// main/kernel/contract/src/dev-email-inbox.test.ts
import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearCapturedDevEmails,
  extractEmailLinks,
  listCapturedDevEmails,
  recordCapturedDevEmail,
} from './dev-email-inbox';

describe('dev-email-inbox', () => {
  beforeEach(() => {
    clearCapturedDevEmails();
  });

  it('extracts deduplicated http(s) and internal slash links while rejecting unsafe schemes', () => {
    const links = extractEmailLinks(
      'Verify here: https://app.bslt.dev/verify?token=abc. Ignore ftp://example.com',
      '<a href="https://app.bslt.dev/verify?token=abc">Verify</a><a href="/invitations/123/accept">Accept</a><a href="javascript:alert(1)">Bad</a><a href="//evil.test">ProtoRel</a>',
    );

    expect(links).toEqual(['https://app.bslt.dev/verify?token=abc', '/invitations/123/accept']);
  });

  it('returns empty links when text and html are empty or null', () => {
    expect(extractEmailLinks(null, null)).toEqual([]);
    expect(extractEmailLinks('', '')).toEqual([]);
  });

  it('caps the ring buffer at 100 emails in newest-first order and clears cleanly', () => {
    for (let i = 0; i < 105; i += 1) {
      recordCapturedDevEmail({
        id: `msg-${String(i)}`,
        to: `user${String(i)}@example.com`,
        subject: `Subject ${String(i)}`,
        text: `Open https://localhost:5173/reset/${String(i)}`,
      });
    }

    const list = listCapturedDevEmails();
    expect(list).toHaveLength(100);
    expect(list[0]?.id).toBe('msg-104');
    expect(list[99]?.id).toBe('msg-5');
    expect(list[0]?.links).toEqual(['https://localhost:5173/reset/104']);

    const cleared = clearCapturedDevEmails();
    expect(cleared).toBe(100);
    expect(listCapturedDevEmails()).toEqual([]);
  });
});
