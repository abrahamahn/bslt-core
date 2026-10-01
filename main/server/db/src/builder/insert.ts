// main/server/db/src/builder/insert.ts
/**
 * InsertBuilder - Fluent API for building INSERT queries
 *
 * @example
 * const query = insert('users')
 *   .values({ email: 'user@example.com', name: 'John' })
 *   .returning('id', 'created_at')
 *   .toSql();
 */

import {
  escapeIdentifier,
  formatTable,
  type QueryBuilder,
  type QueryResult,
  type SqlFragment,
  type TableSpec,
} from './types/types';

/**
 * InsertBuilder class for constructing INSERT queries
 */
export class InsertBuilder implements QueryBuilder {
  private readonly _table: TableSpec;
  private _columns: string[] = [];
  private readonly _values: unknown[][] = [];
  private _returning: string[] = [];
  private _onConflict: {
    columns?: string[];
    constraint?: string;
    action: 'nothing' | 'update';
    updateColumns?: string[];
    updateSet?: SqlFragment;
    updateWhere?: SqlFragment;
  } | null = null;

  constructor(table: string | TableSpec) {
    this._table = typeof table === 'string' ? { name: table } : table;
  }

  /**
   * Add values to insert (single row)
   * @example insert('users').values({ email: 'user@example.com', name: 'John' })
   */
  values(row: Record<string, unknown>): this {
    const columns = Object.keys(row);
    const values = Object.values(row);

    if (this._columns.length === 0) {
      this._columns = columns;
    } else if (!arraysEqual(this._columns, columns)) {
      throw new Error('All inserted rows must have the same columns');
    }

    this._values.push(values);
    return this;
  }

  /**
   * Add multiple rows to insert
   * @example insert('users').valuesMany([{ email: 'a@b.com' }, { email: 'c@d.com' }])
   */
  valuesMany(rows: Record<string, unknown>[]): this {
    for (const row of rows) {
      this.values(row);
    }
    return this;
  }

  /**
   * Specify columns to return after insert
   * @example insert('users').values(...).returning('id', 'created_at')
   */
  returning(...cols: string[]): this {
    this._returning = cols;
    return this;
  }

  /**
   * Return all columns after insert
   * @example insert('users').values(...).returningAll()
   */
  returningAll(): this {
    this._returning = ['*'];
    return this;
  }

  /**
   * ON CONFLICT DO NOTHING
   * @example insert('users').values(...).onConflictDoNothing('email')
   */
  onConflictDoNothing(columns?: string | string[]): this {
    this._onConflict = {
      action: 'nothing',
    };
    if (columns !== undefined) {
      this._onConflict.columns = Array.isArray(columns) ? columns : [columns];
    }
    return this;
  }

  /**
   * ON CONFLICT ON CONSTRAINT DO NOTHING
   * @example insert('users').values(...).onConflictConstraintDoNothing('users_email_unique')
   */
  onConflictConstraintDoNothing(constraint: string): this {
    this._onConflict = {
      constraint,
      action: 'nothing',
    };
    return this;
  }

  /**
   * ON CONFLICT DO UPDATE (upsert)
   * @example insert('users').values(...).onConflictDoUpdate('email', ['name', 'updated_at'])
   */
  onConflictDoUpdate(
    columns: string | string[],
    updateColumns: string[],
    where?: SqlFragment,
  ): this {
    this._onConflict = {
      columns: Array.isArray(columns) ? columns : [columns],
      action: 'update',
      updateColumns,
    };
    if (where !== undefined) {
      this._onConflict.updateWhere = where;
    }
    return this;
  }

  /**
   * ON CONFLICT DO UPDATE with a raw SET fragment, for SQL-side arithmetic
   * such as atomic counters. The fragment's $1..$n placeholders are renumbered
   * after the VALUES parameters; identifiers in the fragment are not escaped.
   * @example insert('counters').values({ id, count: 1 })
   *   .onConflictDoUpdateRaw('id', rawCondition('count = counters.count + $1', [1]))
   */
  onConflictDoUpdateRaw(columns: string | string[], set: SqlFragment, where?: SqlFragment): this {
    this._onConflict = {
      columns: Array.isArray(columns) ? columns : [columns],
      action: 'update',
      updateSet: set,
    };
    if (where !== undefined) {
      this._onConflict.updateWhere = where;
    }
    return this;
  }

  /**
   * Build the SQL query
   */
  toSql(): QueryResult {
    if (this._columns.length === 0 || this._values.length === 0) {
      throw new Error('INSERT requires at least one column and one row');
    }

    const parts: string[] = [];
    const allValues: unknown[] = [];

    // INSERT INTO table (columns)
    const columnList = this._columns.map(escapeIdentifier).join(', ');
    const tableFragment = formatTable(this._table);
    parts.push(`INSERT INTO ${tableFragment.text} (${columnList})`);
    allValues.push(...tableFragment.values); // Push table subquery params first

    // VALUES
    const rowPlaceholders: string[] = [];
    for (const rowValues of this._values) {
      const placeholders = rowValues.map((_, i) => `$${String(allValues.length + i + 1)}`);
      rowPlaceholders.push(`(${placeholders.join(', ')})`);
      allValues.push(...rowValues);
    }
    parts.push(`VALUES ${rowPlaceholders.join(', ')}`);

    // ON CONFLICT
    if (this._onConflict !== null) {
      if (this._onConflict.constraint !== undefined && this._onConflict.constraint !== '') {
        parts.push(`ON CONFLICT ON CONSTRAINT ${escapeIdentifier(this._onConflict.constraint)}`);
      } else if (this._onConflict.columns !== undefined && this._onConflict.columns.length > 0) {
        const conflictCols = this._onConflict.columns.map(escapeIdentifier).join(', ');
        parts.push(`ON CONFLICT (${conflictCols})`);
      } else {
        parts.push('ON CONFLICT');
      }

      if (this._onConflict.action === 'nothing') {
        parts.push('DO NOTHING');
      } else {
        let setClause: string | null = null;
        if (this._onConflict.updateSet !== undefined) {
          const set = this._onConflict.updateSet;
          setClause = renumberParams(set.text, set.values.length, allValues.length);
          allValues.push(...set.values);
        } else if (
          this._onConflict.updateColumns !== undefined &&
          this._onConflict.updateColumns.length > 0
        ) {
          setClause = this._onConflict.updateColumns
            .map((col) => `${escapeIdentifier(col)} = EXCLUDED.${escapeIdentifier(col)}`)
            .join(', ');
        }

        if (setClause !== null) {
          parts.push(`DO UPDATE SET ${setClause}`);

          if (this._onConflict.updateWhere !== undefined) {
            const where = this._onConflict.updateWhere;
            parts.push(
              `WHERE ${renumberParams(where.text, where.values.length, allValues.length)}`,
            );
            allValues.push(...where.values);
          }
        }
      }
    }

    // RETURNING
    if (this._returning.length > 0) {
      const returnList =
        this._returning[0] === '*' ? '*' : this._returning.map(escapeIdentifier).join(', ');
      parts.push(`RETURNING ${returnList}`);
    }

    return { text: parts.join(' '), values: allValues };
  }
}

/**
 * Create a new InsertBuilder
 * @example insert('users').values({ email: 'user@example.com' }).returning('id')
 */
export function insert(table: string | TableSpec): InsertBuilder {
  return new InsertBuilder(table);
}

/**
 * Shift a fragment's $1..$count placeholders by offset (highest first so
 * $1 does not clobber an already-renumbered $10)
 */
function renumberParams(text: string, count: number, offset: number): string {
  let renumbered = text;
  for (let i = count; i >= 1; i--) {
    renumbered = renumbered.replace(
      new RegExp(`\\$${String(i)}(?!\\d)`, 'g'),
      `$${String(offset + i)}`,
    );
  }
  return renumbered;
}

/**
 * Helper to check if two arrays have the same elements in the same order
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
