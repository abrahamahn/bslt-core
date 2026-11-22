// main/kernel/db/src/migrate/sql-statements.ts
/**
 * Splits a SQL script into its statements.
 *
 * A script sent to Postgres as one string runs as one implicit transaction, so
 * a migration marked `-- bslt:no-transaction` (`CREATE INDEX CONCURRENTLY`,
 * `ALTER TYPE ... ADD VALUE` before its use) has to be sent statement by
 * statement. The splitter knows the places a `;` does not end a statement:
 * quoted strings and identifiers, dollar-quoted bodies and comments.
 */

/** A `$tag$` opener at `index`, or null. Tags are identifiers or empty. */
function dollarTagAt(sql: string, index: number): string | null {
  const match = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/u.exec(
    sql.slice(index, index + 128),
  );
  return match === null ? null : match[0];
}

/** Whether the quote at `index` opens an `E'...'` string, where a backslash escapes. */
function isEscapeString(sql: string, index: number): boolean {
  const prefix = sql[index - 1];
  if (prefix !== 'E' && prefix !== 'e') return false;
  const before = sql[index - 2];
  return before === undefined || !/[A-Za-z0-9_$]/u.test(before);
}

/**
 * The statements of `sql`, trimmed, without the terminating `;`, in order.
 * Text that holds only whitespace and comments is not a statement.
 *
 * @throws {Error} When a string, an identifier, a dollar-quoted body or a block
 *   comment is not closed.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let hasContent = false;
  let index = 0;

  const push = (end: number): void => {
    if (hasContent) statements.push(sql.slice(start, end).trim());
    start = end + 1;
    hasContent = false;
  };

  while (index < sql.length) {
    const char = sql[index] as string;
    const next = sql[index + 1];

    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      let depth = 1;
      index += 2;
      while (depth > 0) {
        if (index >= sql.length) throw new Error('unterminated block comment');
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      const escapes = char === "'" && isEscapeString(sql, index);
      hasContent = true;
      index += 1;
      for (;;) {
        if (index >= sql.length) {
          throw new Error(char === "'" ? 'unterminated string' : 'unterminated quoted identifier');
        }
        if (escapes && sql[index] === '\\') {
          index += 2;
        } else if (sql[index] === char) {
          if (sql[index + 1] === char) index += 2;
          else break;
        } else {
          index += 1;
        }
      }
      index += 1;
      continue;
    }
    if (char === '$') {
      const tag = dollarTagAt(sql, index);
      // `$1` is a parameter and `a$b` an identifier: neither opens a body.
      const previous = sql[index - 1];
      if (tag !== null && (previous === undefined || !/[A-Za-z0-9_$]/u.test(previous))) {
        const close = sql.indexOf(tag, index + tag.length);
        if (close === -1) throw new Error(`unterminated dollar-quoted string ${tag}`);
        hasContent = true;
        index = close + tag.length;
        continue;
      }
    }
    if (char === ';') {
      push(index);
      index += 1;
      continue;
    }
    if (!/\s/u.test(char)) hasContent = true;
    index += 1;
  }
  push(sql.length);
  return statements;
}
