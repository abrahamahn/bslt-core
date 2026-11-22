// main/kernel/db/src/json.test.ts
import { describe, expectTypeOf, it } from 'vitest';

import type { JsonValue } from './json';

describe('JsonValue', () => {
  it('holds what JSON holds', () => {
    expectTypeOf<{
      plan: string;
      seats: number;
      tags: string[];
      nested: { on: boolean | null };
    }>().toMatchTypeOf<JsonValue>();
    expectTypeOf<null>().toMatchTypeOf<JsonValue>();
    expectTypeOf<Array<string | number>>().toMatchTypeOf<JsonValue>();
  });

  it('does not hold what JSON cannot say', () => {
    expectTypeOf<Date>().not.toMatchTypeOf<JsonValue>();
    expectTypeOf<undefined>().not.toMatchTypeOf<JsonValue>();
    expectTypeOf<() => void>().not.toMatchTypeOf<JsonValue>();
    expectTypeOf<{ at: Date }>().not.toMatchTypeOf<JsonValue>();
    expectTypeOf<bigint>().not.toMatchTypeOf<JsonValue>();
  });
});
