// main/tools/gates/ratchets/counters.test.ts
import { describe, expect, it } from 'vitest';

import {
  inlineStyles,
  opaqueSchemas,
  rawSqlSites,
  setIntervalCalls,
  swallowedCatches,
} from './counters';

const lines = (sites: readonly { line: number }[]): number[] => sites.map((site) => site.line);

describe('swallowedCatches', () => {
  it('counts a promise handler that does nothing', () => {
    const source = [
      'void save().catch(() => {});',
      'void save().catch(() => undefined);',
      'void save().catch(function () {});',
      'void save().catch(() => void 0);',
      'void save().then(use, () => {});',
      'void save().catch((_error: unknown) => {',
      '  // best effort',
      '});',
    ].join('\n');
    expect(lines(swallowedCatches('a.ts', source))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('counts an empty catch block, with or without a comment', () => {
    const source = [
      'try { run(); } catch {}',
      'try { run(); } catch (error) {',
      '  // ignored',
      '}',
    ].join('\n');
    expect(lines(swallowedCatches('a.ts', source))).toEqual([1, 2]);
  });

  it('does not count a handler that acts on the error or supplies a value', () => {
    const source = [
      'void save().catch((error: unknown) => { log.warn({ error }); });',
      "const text = await response.text().catch(() => '');",
      'const body = await response.json().catch(() => ({}));',
      'void save().catch(reject);',
      'try { run(); } catch (error) { throw wrap(error); }',
      'promise.then(() => {});',
    ].join('\n');
    expect(swallowedCatches('a.ts', source)).toEqual([]);
  });

  it('reports the line and the source text of a site', () => {
    expect(swallowedCatches('a.ts', '\n  void save().catch(() => {});\n')).toEqual([
      { file: 'a.ts', line: 2, text: '.catch(() => {})' },
    ]);
  });
});

describe('setIntervalCalls', () => {
  it('counts every way of calling setInterval', () => {
    const source = [
      'const a = setInterval(tick, 1000);',
      'const b = globalThis.setInterval(tick, 1000);',
      'const c = window.setInterval(() => {}, 1000);',
    ].join('\n');
    expect(lines(setIntervalCalls('a.ts', source))).toEqual([1, 2, 3]);
  });

  it('does not count clearInterval, setTimeout or a mention in text', () => {
    const source = [
      'clearInterval(timer);',
      'setTimeout(tick, 1000);',
      "const note = 'setInterval(tick)';",
      '// setInterval(tick, 1000)',
      'type Timer = ReturnType<typeof setInterval>;',
    ].join('\n');
    expect(setIntervalCalls('a.ts', source)).toEqual([]);
  });
});

describe('inlineStyles', () => {
  it('counts a style prop, written as an object or passed as a value', () => {
    const source = [
      'export const A = () => <div style={{ color: "red" }} />;',
      'export const B = ({ style }: Props) => <div style={style} />;',
      'export const C = () => <div style={{ ...base, "--ui-gap": gap }} />;',
    ].join('\n');
    expect(lines(inlineStyles('a.tsx', source))).toEqual([1, 2, 3]);
  });

  it('does not count a style object that only sets CSS custom properties', () => {
    const source = [
      'export const A = () => <div style={{ "--ui-progress": `${value}%` }} />;',
      "export const B = () => <div style={{ ['--row-height']: height, '--rows': rows }} />;",
      'export const C = () => <div className="row" data-style="x" />;',
    ].join('\n');
    expect(inlineStyles('a.tsx', source)).toEqual([]);
  });
});

describe('opaqueSchemas', () => {
  it('counts each createSchema call', () => {
    const source = [
      'export const a = createSchema((data: unknown) => parse(data));',
      'export const b: Schema<B> = createSchema<B>((data) => {',
      '  return data as B;',
      '});',
    ].join('\n');
    expect(lines(opaqueSchemas('a.ts', source))).toEqual([1, 2]);
  });

  it('does not count the declaration, an import or a mention in text', () => {
    const source = [
      "import { createSchema } from './factory';",
      'export function createSchema<T>(validate: (data: unknown) => T): Schema<T> {',
      '  return { parse: validate };',
      '}',
      '// createSchema(fn) is opaque',
    ].join('\n');
    expect(opaqueSchemas('a.ts', source)).toEqual([]);
  });
});

describe('rawSqlSites', () => {
  it('counts a statement built with the query builder of @bslt/db', () => {
    const source = [
      "import { deleteFrom, eq, insert, select, update } from '@bslt/db/builder';",
      "const rows = await db.query(select('users').where(eq('id', id)).toSql());",
      "await db.execute(insert('users').values(row).toSql());",
      "await db.execute(update('users').set(row).toSql());",
      "await db.execute(deleteFrom('users').where(eq('id', id)).toSql());",
    ].join('\n');
    expect(lines(rawSqlSites('a.ts', source))).toEqual([2, 3, 4, 5]);
  });

  it('counts a builder imported under another name, from the package root or a relative path', () => {
    const source = [
      "import { select as from } from '@bslt/db';",
      "import { insert } from '../builder';",
      "import { raw } from './builder/index';",
      "from('users');",
      "insert('users');",
      "raw('now()');",
    ].join('\n');
    expect(lines(rawSqlSites('a.ts', source))).toEqual([4, 5, 6]);
  });

  it('counts SQL text handed to the client', () => {
    const source = [
      'await db.raw(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);',
      "await tx.raw('SELECT 1');",
      'await sql.unsafe(text, values);',
    ].join('\n');
    expect(lines(rawSqlSites('a.ts', source))).toEqual([1, 2, 3]);
  });

  it('does not count String.raw, a repository call or a function that shares a builder name', () => {
    const source = [
      "import { select } from './local-menu';",
      "import { eq } from '@bslt/db/builder';",
      'const text = String.raw`a\\b`;',
      'const user = await repos.users.findById(id);',
      "select('first');",
      "const where = eq('id', id);",
    ].join('\n');
    expect(rawSqlSites('a.ts', source)).toEqual([]);
  });
});
