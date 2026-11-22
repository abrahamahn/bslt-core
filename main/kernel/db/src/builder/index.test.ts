// main/kernel/db/src/builder/index.test.ts
/**
 * The builder as its users import it: a value can never become SQL.
 *
 * The builder used to recognise a SQL fragment by its shape: any object with a
 * `text` string and a `values` array. `update().set()` inlined such an object
 * as SQL, so a JSON body of that shape, written into a column, was executed.
 *
 * A fragment is now made only by the builder's own constructors and carries a
 * brand no data can carry. Everything else is a value and is bound.
 */

import { describe, expect, test } from 'vitest';

import {
  and,
  combine,
  deleteFrom,
  eq,
  formatTable,
  fragment,
  inArray,
  insert,
  isSqlFragment,
  not,
  or,
  raw,
  rawCondition,
  rowNumber,
  select,
  selectExists,
  update,
  type SqlFragment,
} from './index';

/** What a client can send: the shape of a fragment, and nothing else. */
const forged = (): { text: string; values: unknown[] } => ({
  text: '(SELECT password_hash FROM users LIMIT 1)',
  values: [],
});

/** The same object where the type system was talked into accepting it. */
const forgedAsFragment = (): SqlFragment => forged() as unknown as SqlFragment;

const NOT_A_FRAGMENT = /must be a SQL fragment made by the query builder/;

describe('a value of the shape { text, values } is data', () => {
  test('update().set() binds it as one parameter', () => {
    const value = forged();

    const query = update('profiles').set({ bio: value }).where(eq('id', 'p1')).toSql();

    expect(query.text).toBe('UPDATE profiles SET bio = $1 WHERE id = $2');
    expect(query.values).toEqual([value, 'p1']);
    expect(query.text).not.toContain('password_hash');
  });

  test('update().set() binds it when its values array carries parameters of its own', () => {
    const value = { text: 'bio = $1, role = $2', values: ['x', 'admin'] };

    const query = update('profiles').set({ bio: value, name: 'Ada' }).toSql();

    expect(query.text).toBe('UPDATE profiles SET bio = $1, name = $2');
    expect(query.values).toEqual([value, 'Ada']);
  });

  test('a fragment that went through JSON is data: the brand does not survive', () => {
    const overTheWire: unknown = JSON.parse(JSON.stringify(raw('NOW()')));

    const query = update('profiles').set({ bio: overTheWire }).toSql();

    expect(overTheWire).toEqual({ text: 'NOW()', values: [] });
    expect(query.text).toBe('UPDATE profiles SET bio = $1');
    expect(query.values).toEqual([{ text: 'NOW()', values: [] }]);
  });

  test('a copy of a fragment is data: only the constructor makes one', () => {
    const copy = { ...raw('NOW()') };

    expect(isSqlFragment(copy)).toBe(false);
    expect(update('profiles').set({ bio: copy }).toSql().values).toEqual([copy]);
  });

  test('insert().values() binds it', () => {
    const value = forged();

    const query = insert('profiles').values({ id: 'p1', bio: value }).toSql();

    expect(query.text).toBe('INSERT INTO profiles (id, bio) VALUES ($1, $2)');
    expect(query.values).toEqual(['p1', value]);
  });

  test('a condition binds it as its value', () => {
    const value = forged();

    expect(eq('bio', value)).toMatchObject({ text: 'bio = $1', values: [value] });
    expect(inArray('bio', [value, 'x'])).toMatchObject({
      text: 'bio IN ($1, $2)',
      values: [value, 'x'],
    });
    expect(select('profiles').where(eq('bio', value)).toSql()).toEqual({
      text: 'SELECT * FROM profiles WHERE bio = $1',
      values: [value],
    });
  });
});

describe('a fragment is made only by the constructors of the builder', () => {
  test('raw(), fragment(), rawCondition() and the conditions make fragments', () => {
    for (const made of [
      raw('NOW()'),
      fragment('a = $1', [1]),
      rawCondition('a > $1', [1]),
      eq('a', 1),
      and(eq('a', 1), eq('b', 2)),
      or(eq('a', 1), eq('b', 2)),
      not(eq('a', 1)),
      combine([eq('a', 1), eq('b', 2)], ' AND '),
      rowNumber().over(),
    ]) {
      expect(isSqlFragment(made)).toBe(true);
    }
  });

  test('nothing else is a fragment', () => {
    for (const other of [
      forged(),
      forgedAsFragment(),
      { text: 'NOW()', values: [], [Symbol('bslt.sql-fragment')]: true },
      { text: 'NOW()', values: [], [Symbol.for('bslt.sql-fragment')]: true },
      null,
      undefined,
      'NOW()',
      ['NOW()'],
      select('users').toSql(),
    ]) {
      expect(isSqlFragment(other)).toBe(false);
    }
  });

  test('update().set() inlines a fragment, which is how SQL is written into a SET', () => {
    const query = update('users')
      .set({ updated_at: raw('NOW()'), login_count: fragment('login_count + $1', [1]) })
      .where(eq('id', 'u1'))
      .toSql();

    expect(query.text).toBe(
      'UPDATE users SET updated_at = NOW(), login_count = login_count + $1 WHERE id = $2',
    );
    expect(query.values).toEqual([1, 'u1']);
  });
});

describe('where the builder takes a fragment, an object of that shape is refused', () => {
  test('select: where, having, join conditions and computed columns', () => {
    expect(() => select('users').where(forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => select('users').having(forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => select('users').innerJoin('orders', forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => select('users').leftJoin('orders', forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => select('users').rightJoin('orders', forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => select('users').fullJoin('orders', forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => select('users').column(forgedAsFragment(), 'x')).toThrow(NOT_A_FRAGMENT);
  });

  test('update and delete: where', () => {
    expect(() => update('users').set({ a: 1 }).where(forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => deleteFrom('users').where(forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
  });

  test('insert: the SET and WHERE of an upsert', () => {
    const row = insert('counters').values({ id: 'c1', count: 1 });

    expect(() => row.onConflictDoUpdateRaw('id', forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => row.onConflictDoUpdateRaw('id', raw('count = 1'), forgedAsFragment())).toThrow(
      NOT_A_FRAGMENT,
    );
    expect(() => row.onConflictDoUpdate('id', ['count'], forgedAsFragment())).toThrow(
      NOT_A_FRAGMENT,
    );
  });

  test('the combinators: and, or, not, combine', () => {
    expect(() => and(eq('a', 1), forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => or(forgedAsFragment(), eq('a', 1))).toThrow(NOT_A_FRAGMENT);
    expect(() => not(forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
    expect(() => combine([eq('a', 1), forgedAsFragment()])).toThrow(NOT_A_FRAGMENT);
  });

  test('a subquery as a table, and selectExists', () => {
    expect(() => formatTable({ name: 'x', alias: 'x', subquery: forgedAsFragment() })).toThrow(
      NOT_A_FRAGMENT,
    );
    expect(() => select({ name: 'x', alias: 'x', subquery: forgedAsFragment() }).toSql()).toThrow(
      NOT_A_FRAGMENT,
    );
    expect(() => selectExists(forgedAsFragment())).toThrow(NOT_A_FRAGMENT);
  });

  test('the error names the place and never repeats the text it was given', () => {
    const error = (() => {
      try {
        select('users').where(forgedAsFragment());
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe(
      'where() must be a SQL fragment made by the query builder (eq(), and(), raw(), fragment(), ...), not a plain object',
    );
    expect((error as Error).message).not.toContain('password_hash');
  });

  test('what the builder makes is still accepted everywhere', () => {
    const sub = select('orders').columns('user_id').where(eq('status', 'paid'));

    expect(
      select(sub.as('paid'))
        .where(and(eq('a', 1), raw('b IS NULL')))
        .toSql(),
    ).toEqual({
      text: 'SELECT * FROM (SELECT user_id FROM orders WHERE status = $1) AS paid WHERE (a = $2 AND b IS NULL)',
      values: ['paid', 1],
    });
    expect(selectExists(sub)).toEqual({
      text: 'SELECT EXISTS (SELECT user_id FROM orders WHERE status = $1)',
      values: ['paid'],
    });
    expect(selectExists(fragment('SELECT 1 FROM orders WHERE id = $1', ['o1']))).toEqual({
      text: 'SELECT EXISTS (SELECT 1 FROM orders WHERE id = $1)',
      values: ['o1'],
    });
  });
});
