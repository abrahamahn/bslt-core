// main/kernel/contract/src/ports.test.ts
import { describe, expect, it } from 'vitest';

import { SubKeys } from './ports';

describe('SubKeys subscription key builders', () => {
  it('formats record and list subscription keys deterministically', () => {
    expect(SubKeys.record('tasks', '123')).toBe('record:tasks:123');
    expect(SubKeys.list('u1', 'notifications')).toBe('list:u1:notifications');
  });
});
