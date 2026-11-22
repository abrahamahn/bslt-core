// main/kernel/contract/src/job.ts
import type { Schema } from '@bslt/schema';

export interface JobDef<N extends string = string, S extends Schema = Schema> {
  readonly name: N;
  readonly payload: S;
  readonly queue: 'default' | 'media';
  readonly maxAttempts: number;
  readonly timeoutMs: number;
}

const JOB_NAME_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_.]*$/;

export function job<const N extends string, S extends Schema>(
  name: N,
  payload: S,
  options: Omit<JobDef<N, S>, 'name' | 'payload'>,
): JobDef<N, S> {
  if (!JOB_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid job name "${name}": expected "<id>.<name>" matching /^[a-z][a-z0-9]*\\.[a-z][a-z0-9_.]*$/`,
    );
  }
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error(`Job "${name}" maxAttempts must be a positive integer`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error(`Job "${name}" timeoutMs must be a positive integer`);
  }
  return { name, payload, ...options };
}
