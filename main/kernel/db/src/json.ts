// main/kernel/db/src/json.ts
/**
 * What a `json` or `jsonb` column holds, as the driver returns it. The
 * generated row types (`pnpm bslt sync rows`) use it for every JSON column; a
 * repository narrows it to the shape it stores.
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
