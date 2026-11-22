// main/kernel/server/src/runtime/ports.test.ts
import { describe, expect, it } from 'vitest';

import { uniquePorts } from './ports';

describe('uniquePorts', () => {
  it('deduplicates finite ports while dropping undefined, NaN, and Infinity', () => {
    expect(
      uniquePorts([8080, undefined, 8080, 3000, Number.NaN, Number.POSITIVE_INFINITY]),
    ).toEqual([8080, 3000]);
    expect(uniquePorts([undefined])).toEqual([]);
  });
});
