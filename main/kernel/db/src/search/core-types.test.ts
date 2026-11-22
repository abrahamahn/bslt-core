// main/kernel/db/src/search/core-types.test.ts
import { describe, expect, it } from 'vitest';

import {
  FILTER_OPERATORS,
  LOGICAL_OPERATORS,
  SEARCH_ERROR_TYPES,
  isCompoundFilter,
  isFilterCondition,
  type CompoundFilter,
  type FilterCondition,
} from './core-types';

describe('search core-types', () => {
  it('distinguishes atomic filter conditions from compound filters and rejects malformed shapes', () => {
    const condition: FilterCondition<{ title: string }> = {
      field: 'title',
      operator: FILTER_OPERATORS.EQ,
      value: 'hello',
    };
    const compound: CompoundFilter<{ title: string }> = {
      operator: LOGICAL_OPERATORS.AND,
      conditions: [condition],
    };

    expect(isFilterCondition(condition)).toBe(true);
    expect(isCompoundFilter(condition)).toBe(false);

    expect(isCompoundFilter(compound)).toBe(true);
    expect(isFilterCondition(compound)).toBe(false);

    expect(
      isCompoundFilter({
        operator: LOGICAL_OPERATORS.OR,
        conditions: 'not-an-array' as unknown as FilterCondition[],
      }),
    ).toBe(false);
    expect(
      isFilterCondition({
        operator: LOGICAL_OPERATORS.NOT,
        conditions: [],
      }),
    ).toBe(false);
  });

  it('freezes operator and error registries so callers cannot mutate them at runtime', () => {
    expect(Object.isFrozen(FILTER_OPERATORS)).toBe(true);
    expect(Object.isFrozen(LOGICAL_OPERATORS)).toBe(true);
    expect(Object.isFrozen(SEARCH_ERROR_TYPES)).toBe(true);

    expect(() => {
      (FILTER_OPERATORS as Record<string, string>)['EQ'] = 'tampered';
    }).toThrow(TypeError);
    expect(() => {
      (LOGICAL_OPERATORS as Record<string, string>)['AND'] = 'tampered';
    }).toThrow(TypeError);
    expect(() => {
      (SEARCH_ERROR_TYPES as Record<string, string>)['InvalidQuery'] = 'tampered';
    }).toThrow(TypeError);
  });
});
