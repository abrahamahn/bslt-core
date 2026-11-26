// main/kernel/ui/src/utils/cn.test.ts
import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('omits falsy values, flattens nested arrays, and evaluates conditional object maps', () => {
    expect(cn()).toBe('');
    expect(cn(false, null, undefined, '', 0)).toBe('');
    const showHidden: boolean = false;
    expect(cn('btn', showHidden && 'hidden', 0, null, undefined, 'btn-primary')).toBe(
      'btn btn-primary',
    );
    expect(cn(['a', ['b', null, { c: true, d: false, e: 0, f: '' }]], 42)).toBe('a b c 42');
  });
});
