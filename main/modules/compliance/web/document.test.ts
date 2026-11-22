// main/modules/compliance/web/document.test.ts
import { describe, expect, it } from 'vitest';

import { fillDocument, OPERATOR } from './document';

describe('fillDocument', () => {
  it('replaces unknown and multiline placeholders with [pending] and never leaks raw [[...]] tokens', () => {
    expect(fillDocument('Contact [[UNKNOWN_TOKEN]] today.')).toBe('Contact [pending] today.');
    expect(fillDocument('Draft [[TODO:\nreplace before launch\n]] end.')).toBe(
      'Draft [pending] end.',
    );
    expect(fillDocument('[[lowercase]]')).toBe('[[lowercase]]');

    for (const [token, value] of Object.entries(OPERATOR)) {
      expect(value.trim().length).toBeGreaterThan(0);
      expect(fillDocument(`Value: [[${token}]]`)).toBe(`Value: ${value}`);
    }
  });
});
