// main/kernel/contract/src/event.ts
import type { Infer, Schema } from '@bslt/schema';

export interface NotifyMeta<P> {
  readonly kind: string;
  readonly recipients: (payload: P) => readonly string[];
  readonly level: 'info' | 'success' | 'warning' | 'error';
  readonly category: string;
  readonly channels: readonly ('in_app' | 'email' | 'push')[];
  readonly route?: string;
  readonly title: string;
}

export interface EventDef<N extends string = string, S extends Schema = Schema> {
  readonly name: N;
  readonly payload: S;
  readonly version?: number;
  readonly audit?: {
    readonly category:
      'security' | 'data' | 'billing' | 'trust_safety' | 'compliance' | 'admin' | 'kyc_access';
    readonly severity: 'info' | 'warn' | 'critical';
  };
  readonly activity?: true;
  readonly webhook?: true;
  readonly notify?: NotifyMeta<Infer<S>>;
  readonly realtime?: (payload: Infer<S>) => {
    readonly channel: string;
    readonly invalidate?: readonly string[];
  };
  readonly analytics?: string;
}

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function event<const N extends string, S extends Schema>(
  name: N,
  payload: S,
  meta: Omit<EventDef<N, S>, 'name' | 'payload'> = {},
): EventDef<N, S> {
  if (!EVENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid event name "${name}": expected "<id>.<noun>.<verb>" matching /^[a-z][a-z0-9]*\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$/`,
    );
  }
  if (meta.version !== undefined && (!Number.isInteger(meta.version) || meta.version < 1)) {
    throw new Error(`Event "${name}" version must be a positive integer`);
  }
  const moduleId = name.split('.')[0] ?? '';
  if (meta.notify !== undefined && !meta.notify.kind.startsWith(`${moduleId}.`)) {
    throw new Error(
      `Event "${name}" notify.kind "${meta.notify.kind}" must be prefixed with "${moduleId}."`,
    );
  }

  return { name, payload, ...meta };
}
