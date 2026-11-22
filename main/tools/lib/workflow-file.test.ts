// main/tools/lib/workflow-file.test.ts
import { describe, expect, it } from 'vitest';

import {
  blockOf,
  expressionEnvOf,
  expressionsIn,
  jobKey,
  jobOf,
  jobsOf,
  needsOf,
  stepOf,
  substituteExpressions,
} from './workflow-file';

const WORKFLOW = [
  'name: Sample',
  '',
  'on:',
  '  push:',
  '',
  'jobs:',
  '  # A comment between jobs.',
  '  first:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@0000000000000000000000000000000000000000 # v1.0.0',
  '',
  '      - name: Say it',
  '        env:',
  '          GREETING: ${{ vars.GREETING }}',
  '          PLAIN: text',
  '        run: |',
  '          if [ -n "$GREETING" ]; then',
  '            echo "$GREETING"',
  '          fi',
  '',
  '          echo done',
  '',
  '      - name: Remote',
  '        uses: some/action@0000000000000000000000000000000000000000 # v1.0.0',
  '        with:',
  '          host: ${{ secrets.HOST }}',
  '          script: |',
  '            cd "${{ inputs.directory }}"',
  '            ls',
  '',
  '  second:',
  '    needs: first',
  "    if: github.event_name == 'push'",
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo second',
  '',
  '  third:',
  '    needs: [first, second]',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo third',
  '',
  '  fourth:',
  '    needs:',
  '      [first, second, third]',
  '    if: >-',
  "      github.event_name == 'push' &&",
  "      github.ref == 'refs/heads/main'",
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo fourth',
  '',
  '  fifth:',
  '    needs:',
  '      - first',
  '      - fourth',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo fifth',
  '',
].join('\n');

describe('workflow-file', () => {
  it('lists the jobs in file order', () => {
    expect([...jobsOf(WORKFLOW).keys()]).toEqual(['first', 'second', 'third', 'fourth', 'fifth']);
  });

  it('gives each job its own text only', () => {
    const second = jobOf(WORKFLOW, 'second');

    expect(second).toContain('echo second');
    expect(second).not.toContain('echo third');
    expect(second).not.toContain('echo done');
  });

  it('throws for a job, a step or a block that is not there', () => {
    expect(() => jobOf(WORKFLOW, 'sixth')).toThrow('no job "sixth"');
    expect(() => stepOf(jobOf(WORKFLOW, 'first'), 'Missing')).toThrow('no step named "Missing"');
    expect(() => blockOf(stepOf(jobOf(WORKFLOW, 'first'), 'Say it'), 'script')).toThrow(
      'no `script: |` block',
    );
    expect(() => jobsOf('name: x\n')).toThrow('no top-level `jobs:`');
  });

  it('reads `needs` in every form YAML allows', () => {
    expect(needsOf(jobOf(WORKFLOW, 'first'))).toEqual([]);
    expect(needsOf(jobOf(WORKFLOW, 'second'))).toEqual(['first']);
    expect(needsOf(jobOf(WORKFLOW, 'third'))).toEqual(['first', 'second']);
    expect(needsOf(jobOf(WORKFLOW, 'fourth'))).toEqual(['first', 'second', 'third']);
    expect(needsOf(jobOf(WORKFLOW, 'fifth'))).toEqual(['first', 'fourth']);
  });

  it('reads a job-level key, joined when it spans lines', () => {
    expect(jobKey(jobOf(WORKFLOW, 'second'), 'if')).toBe("github.event_name == 'push'");
    expect(jobKey(jobOf(WORKFLOW, 'fourth'), 'if')).toBe(
      ">- github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(jobKey(jobOf(WORKFLOW, 'first'), 'if')).toBeUndefined();
  });

  it('returns a run block without its indentation, blank lines kept', () => {
    const script = blockOf(stepOf(jobOf(WORKFLOW, 'first'), 'Say it'), 'run');

    expect(script.split('\n').slice(0, 5)).toEqual([
      'if [ -n "$GREETING" ]; then',
      '  echo "$GREETING"',
      'fi',
      '',
      'echo done',
    ]);
  });

  it('returns a script block nested under `with:`', () => {
    const script = blockOf(stepOf(jobOf(WORKFLOW, 'first'), 'Remote'), 'script');

    expect(script.trimEnd().split('\n')).toEqual(['cd "${{ inputs.directory }}"', 'ls']);
  });

  it('lists the expression-valued env entries of a step', () => {
    const env = expressionEnvOf(stepOf(jobOf(WORKFLOW, 'first'), 'Say it'));

    expect([...env.entries()]).toEqual([['GREETING', '${{ vars.GREETING }}']]);
  });

  it('lists and substitutes expressions', () => {
    const step = stepOf(jobOf(WORKFLOW, 'first'), 'Remote');

    expect(expressionsIn(step)).toEqual(['secrets.HOST', 'inputs.directory']);
    expect(
      substituteExpressions(blockOf(step, 'script'), { 'inputs.directory': '/srv/app' }),
    ).toContain('cd "/srv/app"');
    expect(() => substituteExpressions(blockOf(step, 'script'), {})).toThrow(
      'No fixture value for ${{ inputs.directory }}',
    );
  });
});
