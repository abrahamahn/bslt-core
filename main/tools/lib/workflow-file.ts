// main/tools/lib/workflow-file.ts
/**
 * Reads GitHub workflow files as text, for the tests that pin what the
 * workflows do (`main/tools/scripts/audit/workflows.test.ts` and the deploy
 * simulations next to it).
 *
 * The tools carry no YAML parser, and need none for this: Prettier formats
 * every workflow, so a job is a key at two spaces under `jobs:`, a step starts
 * with `- ` at six, and a `run: |` or `script: |` block is the more deeply
 * indented lines that follow it. The readers below rely on exactly that and
 * throw when the thing asked for is not there, so a renamed job or step fails
 * a test instead of silently matching nothing.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PATHS } from './paths';

/** The text of `.github/workflows/<name>`. */
export function readWorkflow(name: string): string {
  return readFileSync(path.join(PATHS.workflows, name), 'utf8');
}

/** Job id to the job's own text (its key line included), in file order. */
export function jobsOf(workflow: string): Map<string, string> {
  const lines = workflow.split('\n');
  const start = lines.indexOf('jobs:');
  if (start === -1) throw new Error('the workflow has no top-level `jobs:` key');

  const jobs = new Map<string, string>();
  let current: string | undefined;
  let block: string[] = [];
  const close = (): void => {
    if (current !== undefined) jobs.set(current, block.join('\n'));
  };
  for (const line of lines.slice(start + 1)) {
    // Any other top-level key ends the jobs map.
    if (/^[^\s#]/u.test(line)) break;
    const key = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/u.exec(line)?.[1];
    if (key !== undefined) {
      close();
      current = key;
      block = [line];
    } else {
      block.push(line);
    }
  }
  close();
  return jobs;
}

/** The text of one job; throws when the workflow has no such job. */
export function jobOf(workflow: string, id: string): string {
  const job = jobsOf(workflow).get(id);
  if (job === undefined) throw new Error(`the workflow has no job "${id}"`);
  return job;
}

/** The value of a job-level key (`if`, `environment`, ...), or undefined. */
export function jobKey(job: string, key: string): string | undefined {
  const lines = job.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`    ${key}:`));
  if (index === -1) return undefined;
  const collected = [(lines[index] ?? '').slice(`    ${key}:`.length).trim()];
  // A value Prettier wrapped onto the following, more deeply indented lines.
  for (const line of lines.slice(index + 1)) {
    if (!/^ {6,}\S/u.test(line)) break;
    collected.push(line.trim());
  }
  return collected.join(' ').trim();
}

/** The job ids a job lists under `needs:`; empty when it has none. */
export function needsOf(job: string): string[] {
  const value = jobKey(job, 'needs');
  if (value === undefined) return [];
  // `a`, `[a, b]` and a `- a` list all reduce to the job ids they name.
  return value.match(/[A-Za-z_][A-Za-z0-9_-]*/gu) ?? [];
}

/** The text of the step named `name` in a job; throws when it is missing. */
export function stepOf(job: string, name: string): string {
  const lines = job.split('\n');
  const starts = lines.flatMap((line, index) => (/^ {6}- /u.test(line) ? [index] : []));
  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1] ?? lines.length;
    const step = lines.slice(start, end);
    if (step.some((line) => line.trim().replace(/^- /u, '') === `name: ${name}`)) {
      return step.join('\n');
    }
  }
  throw new Error(`the job has no step named "${name}"`);
}

/**
 * The body of a block scalar in a step (`run: |`, or `script: |` under
 * `with:`), with the block's own indentation removed.
 */
export function blockOf(step: string, key: 'run' | 'script'): string {
  const lines = step.split('\n');
  const index = lines.findIndex((line) => line.trim() === `${key}: |`);
  if (index === -1) throw new Error(`the step has no \`${key}: |\` block`);
  const keyIndent = (lines[index] ?? '').search(/\S/u);
  const body: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (line.trim() !== '' && line.search(/\S/u) <= keyIndent) break;
    body.push(line);
  }
  const indent = Math.min(
    ...body.filter((line) => line.trim() !== '').map((line) => line.search(/\S/u)),
  );
  return body.map((line) => line.slice(indent)).join('\n');
}

/**
 * The `KEY: ${{ expression }}` pairs of a step (its `env:` block), by name.
 * Only whole-value expressions are returned.
 */
export function expressionEnvOf(step: string): Map<string, string> {
  return new Map(
    [...step.matchAll(/^ +([A-Z][A-Z0-9_]*): (\$\{\{.+\}\})$/gmu)].map((match) => [
      match[1] ?? '',
      match[2] ?? '',
    ]),
  );
}

/** Every `${{ ... }}` expression in a text, without the braces. */
export function expressionsIn(text: string): string[] {
  return [...text.matchAll(/\$\{\{\s*(.+?)\s*\}\}/gu)].map((match) => match[1] ?? '');
}

/** Replaces each `${{ expression }}` with its fixture value; throws on one without a value. */
export function substituteExpressions(
  text: string,
  values: Readonly<Record<string, string>>,
): string {
  return text.replace(/\$\{\{\s*(.+?)\s*\}\}/gu, (_whole, expression: string) => {
    const value = values[expression];
    if (value === undefined) throw new Error(`No fixture value for \${{ ${expression} }}`);
    return value;
  });
}
