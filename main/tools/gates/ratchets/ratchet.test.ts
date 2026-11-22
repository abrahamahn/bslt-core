// main/tools/gates/ratchets/ratchet.test.ts
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BUDGETS_FILE, readBudgets, runRatchet, type Ratchet, type Site } from './ratchet';

import type { GateContext } from '../types';

const roots: string[] = [];

/** A repository with a budgets file; the ratchet below reports `sites`. */
function repo(budgets: Record<string, number>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-ratchet-'));
  roots.push(root);
  mkdirSync(path.dirname(path.join(root, BUDGETS_FILE)), { recursive: true });
  writeFileSync(path.join(root, BUDGETS_FILE), `${JSON.stringify(budgets, null, 2)}\n`);
  return root;
}

function site(file: string, line: number): Site {
  return { file, line, text: `swallow at ${file}:${String(line)}` };
}

function ratchet(sites: readonly Site[]): Ratchet {
  return {
    id: 'swallowed-catch',
    noun: 'swallowed catch handlers',
    fix: 'Handle the error or let it reach the caller.',
    count: () => sites,
  };
}

function ctx(root: string, extra: Partial<GateContext> = {}): GateContext {
  return { root, ci: false, selfTest: false, ...extra };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('a ratchet gate', () => {
  it('passes when the count equals the budget', () => {
    const root = repo({ 'swallowed-catch': 2 });
    const result = runRatchet(ratchet([site('a.ts', 1), site('b.ts', 2)]), ctx(root));
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('2 swallowed catch handlers, the budget');
  });

  it('fails when the count rises, and names the fix', () => {
    const root = repo({ 'swallowed-catch': 1 });
    const result = runRatchet(ratchet([site('a.ts', 1), site('b.ts', 2)]), ctx(root));
    expect(result.ok).toBe(false);
    expect(result.summary).toBe(
      'swallowed catch handlers: 2, over the budget of 1 (1 new). Handle the error or let it reach the caller.',
    );
  });

  it('lists the sites in the changed files when the count rises', () => {
    const root = repo({ 'swallowed-catch': 1 });
    const changed = { ref: 'origin/main', base: 'abc', files: ['b.ts'] };
    const result = runRatchet(ratchet([site('a.ts', 1), site('b.ts', 2)]), ctx(root, { changed }));
    expect(result.problems).toEqual(['b.ts:2: swallow at b.ts:2']);
  });

  it('lists every site when the count rises and no changed file holds one', () => {
    const root = repo({ 'swallowed-catch': 1 });
    const changed = { ref: 'origin/main', base: 'abc', files: ['c.ts'] };
    const result = runRatchet(ratchet([site('a.ts', 1), site('b.ts', 2)]), ctx(root, { changed }));
    expect(result.problems).toEqual(['a.ts:1: swallow at a.ts:1', 'b.ts:2: swallow at b.ts:2']);
  });

  it('asks which files changed when the lane did not say, and only when the count rose', () => {
    const root = repo({ 'swallowed-catch': 1 });
    let asked = 0;
    const changedFiles = (): string[] => {
      asked += 1;
      return ['b.ts'];
    };
    expect(runRatchet(ratchet([site('a.ts', 1)]), ctx(root), changedFiles).ok).toBe(true);
    expect(asked).toBe(0);
    const result = runRatchet(ratchet([site('a.ts', 1), site('b.ts', 2)]), ctx(root), changedFiles);
    expect(asked).toBe(1);
    expect(result.problems).toEqual(['b.ts:2: swallow at b.ts:2']);
  });

  it('fails when the count falls, and tells the developer to lower the budget', () => {
    const root = repo({ 'swallowed-catch': 3 });
    const result = runRatchet(ratchet([site('a.ts', 1)]), ctx(root));
    expect(result.ok).toBe(false);
    expect(result.summary).toBe(
      `swallowed catch handlers: 1, under the budget of 3. Lower "swallowed-catch" to 1 in ${BUDGETS_FILE} ` +
        '(pnpm bslt gate run swallowed-catch --update).',
    );
  });

  it('--update lowers the budget in the file, and only that one', () => {
    const root = repo({ setinterval: 9, 'swallowed-catch': 3 });
    const result = runRatchet(ratchet([site('a.ts', 1)]), ctx(root, { args: ['--update'] }));
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('swallowed catch handlers: budget lowered from 3 to 1');
    expect(readBudgets(root)).toEqual({ setinterval: 9, 'swallowed-catch': 1 });
    expect(readFileSync(path.join(root, BUDGETS_FILE), 'utf8')).toBe(
      '{\n  "setinterval": 9,\n  "swallowed-catch": 1\n}\n',
    );
  });

  it('--update never raises a budget', () => {
    const root = repo({ 'swallowed-catch': 1 });
    const result = runRatchet(
      ratchet([site('a.ts', 1), site('b.ts', 2)]),
      ctx(root, { args: ['--update'] }),
    );
    expect(result.ok).toBe(false);
    expect(readBudgets(root)).toEqual({ 'swallowed-catch': 1 });
  });

  it('fails when the budgets file has no entry for the ratchet', () => {
    const root = repo({ setinterval: 9 });
    const result = runRatchet(ratchet([]), ctx(root));
    expect(result.ok).toBe(false);
    expect(result.summary).toBe(`no budget for "swallowed-catch" in ${BUDGETS_FILE}`);
  });

  it('refuses a budget that is not a whole number of zero or more', () => {
    const root = repo({ 'swallowed-catch': -1 });
    expect(() => readBudgets(root)).toThrow(/swallowed-catch/u);
  });

  it('--verbose lists every site of a passing ratchet', () => {
    const root = repo({ 'swallowed-catch': 1 });
    const result = runRatchet(ratchet([site('a.ts', 1)]), ctx(root, { args: ['--verbose'] }));
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual(['a.ts:1: swallow at a.ts:1']);
  });
});
