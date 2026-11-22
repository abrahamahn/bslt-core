// main/kernel/db/src/builder/types/types.ts

/**
 * Parameterized SQL: a string with $1, $2, ... placeholders and the values for
 * them. It is the shape of a finished query (`toSql()`) and of the pieces the
 * builder assembles internally. On its own it is only a shape: anything can
 * have it, a JSON body included.
 */
export interface SqlText {
  /** Parameterized SQL string with $1, $2, etc. placeholders */
  readonly text: string;
  /** Values corresponding to placeholders in text */
  readonly values: readonly unknown[];
}

/**
 * The runtime brand of a fragment. It is private to this module, so only
 * `fragment()` below can put it on an object, and it is a symbol, so no JSON,
 * form or query-string value can carry it.
 */
const SQL_FRAGMENT = Symbol('bslt.sql-fragment');

/**
 * The type-level mark of a fragment. It has no runtime value; it makes a plain
 * `{ text, values }` literal a type error wherever a fragment is expected.
 */
declare const sqlFragmentBrand: unique symbol;

/**
 * SQL Fragment - the fundamental building block of the query builder: a piece
 * of SQL the builder may write into a statement.
 *
 * A fragment is made ONLY by the builder's constructors: `fragment()`, `raw()`,
 * `param()`, `rawCondition()`, the condition helpers (`eq()`, `and()`, ...)
 * and the window functions. It is recognised by a private brand, never by its
 * shape. An object that merely has `text` and `values` is a value: `set()`,
 * `values()` and the conditions bind it as a parameter, and every method that
 * takes a fragment refuses it. A value a client sent can therefore never
 * become SQL.
 *
 * IMPORTANT: All values MUST be parameterized. Never interpolate values into text.
 */
export interface SqlFragment extends SqlText {
  /** @internal Present on what `fragment()` made, and on nothing else. */
  readonly [sqlFragmentBrand]: true;
}

/**
 * Whether `value` is a fragment made by the builder's constructors.
 *
 * @param value - Anything.
 * @returns `true` only for an object `fragment()` made. A copy, a JSON round
 *   trip or a look-alike is not one.
 */
export function isSqlFragment(value: unknown): value is SqlFragment {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, SQL_FRAGMENT);
}

/**
 * Refuse what is not a fragment where the builder is about to write it into SQL.
 *
 * @param value - What the caller passed.
 * @param place - The method or argument, for the message.
 * @throws {TypeError} When `value` was not made by the builder. The message
 *   never repeats the text it was given.
 */
export function assertSqlFragment(value: unknown, place: string): asserts value is SqlFragment {
  if (!isSqlFragment(value)) {
    throw new TypeError(
      `${place} must be a SQL fragment made by the query builder (eq(), and(), raw(), fragment(), ...), not a plain object`,
    );
  }
}

/**
 * Create a SQL fragment from text and values: THE constructor. `text` is
 * written into the statement as it is, so it must be SQL the server wrote,
 * never something a client sent; what a client sent goes into `values`.
 */
export function fragment(text: string, values: readonly unknown[] = []): SqlFragment {
  const made = { text, values };
  // Not enumerable: a spread or Object.assign copy does not carry it.
  Object.defineProperty(made, SQL_FRAGMENT, { value: true });
  return made as unknown as SqlFragment;
}

/**
 * Empty SQL fragment constant - useful for identity operations
 */
export const EMPTY_FRAGMENT: SqlFragment = fragment('', []);

/**
 * Create a raw SQL fragment (no parameterization).
 * WARNING: Only use for trusted static strings like column names or SQL keywords.
 */
export function raw(text: string): SqlFragment {
  return fragment(text, []);
}

/**
 * Create a parameterized value placeholder.
 * Returns ($N, value) where N is based on the provided offset.
 */
export function param(value: unknown, paramIndex: number): SqlFragment {
  return fragment(`$${String(paramIndex)}`, [value]);
}

/**
 * Join pieces of parameterized SQL into one, renumbering the parameters.
 * Internal assembly: the pieces are text the builder itself has just written.
 */
export function joinSql(pieces: readonly SqlText[], separator = ' '): SqlText {
  const allValues: unknown[] = [];
  const textParts: string[] = [];

  for (const piece of pieces) {
    if (piece.text === '') continue;

    // Renumber parameters
    let renumberedText = piece.text;
    for (let i = piece.values.length; i >= 1; i--) {
      const newIndex = allValues.length + i;
      renumberedText = renumberedText.replace(
        new RegExp(`\\$${String(i)}(?!\\d)`, 'g'),
        `$${String(newIndex)}`,
      );
    }

    textParts.push(renumberedText);
    allValues.push(...piece.values);
  }

  return { text: textParts.join(separator), values: allValues };
}

/**
 * Combine multiple SQL fragments into one.
 * Renumbers parameters automatically.
 */
export function combine(fragments: readonly SqlFragment[], separator = ' '): SqlFragment {
  if (fragments.length === 0) {
    return EMPTY_FRAGMENT;
  }
  for (const piece of fragments) {
    assertSqlFragment(piece, 'combine()');
  }

  const joined = joinSql(fragments, separator);
  return fragment(joined.text, joined.values);
}

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sort specification
 */
export interface SortSpec {
  column: string;
  direction: SortDirection;
  nulls?: 'first' | 'last';
}

/**
 * Query result from toSql() methods: a finished statement and its values.
 */
export type QueryResult = SqlText;

/**
 * Base interface for all query builders
 */
export interface QueryBuilder {
  toSql(): QueryResult;
}

/**
 * Table specification for queries
 */
export interface TableSpec {
  name: string;
  alias?: string;
  schema?: string;
  subquery?: SqlFragment;
}

/**
 * Join specification
 */
export interface JoinSpec {
  type: 'inner' | 'left' | 'right' | 'full';
  table: TableSpec;
  on: SqlFragment;
}

/**
 * Value type for database operations
 * Supports common PostgreSQL types
 */
export type DbValue =
  string | number | boolean | Date | null | Buffer | DbValue[] | Record<string, unknown>;

/**
 * Type-safe identifier escaping.
 * Uses double quotes for PostgreSQL identifiers.
 */
export function escapeIdentifier(name: string): string {
  // Check for valid identifier characters
  if (!/^[\w]+$/i.test(name)) {
    // Contains special characters - quote it
    return `"${name.replace(/"/g, '""')}"`;
  }
  // Simple alphanumeric - no quoting needed
  return name;
}

/**
 * Format a table name with optional schema or subquery.
 *
 * @throws {TypeError} When the subquery is not a fragment made by the builder.
 */
export function formatTable(table: TableSpec): SqlText {
  let text = '';
  let values: unknown[] = [];

  if (table.subquery !== undefined) {
    assertSqlFragment(table.subquery, 'A subquery used as a table');
    // For subqueries, wrap in parentheses if not already
    text = `(${table.subquery.text})`;
    values = [...table.subquery.values];
  } else {
    if (table.schema !== undefined && table.schema !== '') {
      text = escapeIdentifier(table.schema) + '.';
    }
    text += escapeIdentifier(table.name);
  }

  if (table.alias !== undefined && table.alias !== '') {
    text += ' AS ' + escapeIdentifier(table.alias);
  }
  return { text, values };
}
