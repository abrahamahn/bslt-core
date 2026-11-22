// main/tools/gates/runner.test.ts
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/paths';

import { gatesForLane, runGates, selfTest, validateRegistry } from './runner';
import { fail, pass, type Gate, type GateContext, type Lane } from './types';

const CTX: GateContext = { root: REPO_ROOT, ci: false, selfTest: false };

function gate(id: string, lanes: readonly Lane[], run: Gate['run']): Gate {
  return { id, description: id, lanes, source: 'main/tools/gates/runner.ts', run };
}

const silent = { log: (): void => {}, error: (): void => {} };

describe('gatesForLane', () => {
  it('keeps registry order and selects by lane', () => {
    const gates = [
      gate('a', ['merge', 'changed'], () => Promise.resolve(pass('a'))),
      gate('b', ['manual'], () => Promise.resolve(pass('b'))),
      gate('c', ['merge'], () => Promise.resolve(pass('c'))),
    ];
    expect(gatesForLane(gates, 'merge').map((g) => g.id)).toEqual(['a', 'c']);
    expect(gatesForLane(gates, 'changed').map((g) => g.id)).toEqual(['a']);
    expect(gatesForLane(gates, 'nightly')).toEqual([]);
  });
});

describe('runGates', () => {
  it('runs every gate, keeps going after a failure, and fails overall', async () => {
    const ran: string[] = [];
    const record =
      (id: string, ok: boolean): Gate['run'] =>
      () => {
        ran.push(id);
        return Promise.resolve(ok ? pass(id) : fail(id, ['broken']));
      };
    const report = await runGates(
      [gate('one', ['merge'], record('one', true)), gate('two', ['merge'], record('two', false))],
      CTX,
      silent,
    );
    expect(ran).toEqual(['one', 'two']);
    expect(report.ok).toBe(false);
    expect(report.results.map((r) => [r.id, r.result.ok])).toEqual([
      ['one', true],
      ['two', false],
    ]);
  });

  it('turns a gate that throws into a failure instead of aborting the lane', async () => {
    const report = await runGates(
      [
        gate('throws', ['merge'], () => Promise.reject(new Error('boom'))),
        gate('after', ['merge'], () => Promise.resolve(pass('after'))),
      ],
      CTX,
      silent,
    );
    expect(report.results[0]?.result).toMatchObject({ ok: false });
    expect(report.results[0]?.result.summary).toContain('boom');
    expect(report.results[1]?.result.ok).toBe(true);
  });

  it('fails an empty lane: a lane that runs nothing checks nothing', async () => {
    const report = await runGates([], CTX, silent);
    expect(report.ok).toBe(false);
  });
});

describe('selfTest', () => {
  it('runs every gate in self-test mode and passes when each returns a result', async () => {
    const contexts: GateContext[] = [];
    const report = await selfTest(
      [
        gate('green', ['merge'], (ctx) => {
          contexts.push(ctx);
          return Promise.resolve(pass('green'));
        }),
        // A gate whose check fails still executed and produced a result.
        gate('red', ['manual'], () => Promise.resolve(fail('red'))),
      ],
      CTX,
      silent,
    );
    expect(contexts.map((ctx) => ctx.selfTest)).toEqual([true]);
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.id)).toEqual(['green', 'red']);
  });

  it('fails on a gate that throws or returns something that is not a result', async () => {
    const report = await selfTest(
      [
        gate('throws', ['merge'], () => Promise.reject(new Error('boom'))),
        gate('shapeless', ['merge'], () => Promise.resolve({ ok: true } as never)),
        gate('fine', ['merge'], () => Promise.resolve(pass('fine'))),
      ],
      CTX,
      silent,
    );
    expect(report.ok).toBe(false);
    expect(report.broken).toEqual(['throws', 'shapeless']);
  });

  it('fails on an invalid registry before running anything', async () => {
    let ran = false;
    const report = await selfTest(
      [
        gate('dup', ['merge'], () => {
          ran = true;
          return Promise.resolve(pass('dup'));
        }),
        gate('dup', ['merge'], () => Promise.resolve(pass('dup'))),
      ],
      CTX,
      silent,
    );
    expect(report.ok).toBe(false);
    expect(ran).toBe(false);
    expect(report.registryProblems.join('\n')).toContain('dup');
  });
});

describe('validateRegistry', () => {
  it('accepts a well-formed registry', () => {
    expect(validateRegistry([gate('a-b', ['merge'], () => Promise.resolve(pass('x')))])).toEqual(
      [],
    );
  });

  it('reports duplicate ids, bad ids, missing lanes and missing sources', () => {
    const run: Gate['run'] = () => Promise.resolve(pass('x'));
    const problems = validateRegistry([
      gate('same', ['merge'], run),
      gate('same', ['merge'], run),
      gate('Not_Kebab', ['merge'], run),
      gate('no-lanes', [], run),
      { ...gate('no-source', ['merge'], run), source: 'main/tools/gates/nope.ts' },
    ]);
    expect(problems).toEqual([
      expect.stringContaining('same'),
      expect.stringContaining('Not_Kebab'),
      expect.stringContaining('no-lanes'),
      expect.stringContaining('nope.ts'),
    ]);
  });
});
