// main/kernel/db/src/migrate/sql-statements.test.ts
import { describe, expect, it } from 'vitest';

import { splitSqlStatements } from './sql-statements';

describe('splitSqlStatements', () => {
  it('splits on the semicolons that end a statement', () => {
    expect(splitSqlStatements('CREATE TABLE a (id int);\nCREATE INDEX i ON a (id);\n')).toEqual([
      'CREATE TABLE a (id int)',
      'CREATE INDEX i ON a (id)',
    ]);
  });

  it('keeps a last statement that has no semicolon', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('does not split inside a string, with doubled quotes', () => {
    expect(splitSqlStatements(`INSERT INTO a VALUES ('x;y', 'it''s; fine'); SELECT 1;`)).toEqual([
      `INSERT INTO a VALUES ('x;y', 'it''s; fine')`,
      'SELECT 1',
    ]);
  });

  it('honours backslash escapes only in an E string', () => {
    expect(splitSqlStatements(`SELECT E'a\\';b'; SELECT 'c\\'; SELECT 2;`)).toEqual([
      `SELECT E'a\\';b'`,
      `SELECT 'c\\'`,
      'SELECT 2',
    ]);
  });

  it('does not split inside a quoted identifier', () => {
    expect(splitSqlStatements('SELECT 1 AS "a;b"; SELECT 2;')).toEqual([
      'SELECT 1 AS "a;b"',
      'SELECT 2',
    ]);
  });

  it('does not split inside a dollar-quoted body, tagged or not', () => {
    const fn = `CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$ LANGUAGE plpgsql`;
    const tagged = `DO $body$ BEGIN EXECUTE 'SELECT $$x;y$$'; END $body$`;
    expect(splitSqlStatements(`${fn};\n${tagged};`)).toEqual([fn, tagged]);
  });

  it('does not take a parameter or an identifier with a dollar for a body', () => {
    expect(splitSqlStatements('SELECT $1; SELECT a$b FROM t$1$x; SELECT 3;')).toEqual([
      'SELECT $1',
      'SELECT a$b FROM t$1$x',
      'SELECT 3',
    ]);
  });

  it('ignores semicolons in line comments and nested block comments', () => {
    expect(
      splitSqlStatements('SELECT 1; -- not; one\n/* a; /* b; */ c; */ SELECT 2; -- end'),
    ).toEqual(['SELECT 1', '-- not; one\n/* a; /* b; */ c; */ SELECT 2']);
  });

  it('returns nothing for whitespace and comments alone', () => {
    expect(splitSqlStatements('  \n-- only a comment\n/* and a block */\n ;; ')).toEqual([]);
  });

  it('refuses a construct that is not closed', () => {
    expect(() => splitSqlStatements(`SELECT 'open`)).toThrow('unterminated string');
    expect(() => splitSqlStatements('SELECT "open')).toThrow('unterminated quoted identifier');
    expect(() => splitSqlStatements('DO $$ BEGIN')).toThrow('unterminated dollar-quoted string');
    expect(() => splitSqlStatements('/* open')).toThrow('unterminated block comment');
  });
});
