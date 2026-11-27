// main/kernel/react/src/query/debug.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  logQueryFailure,
  logQueryRetryDecision,
  logQueryRetryWait,
  logQueryStart,
  logQuerySuccess,
} from './debug';

interface DebugGlobals {
  __ABE_QUERY_DEBUG__?: unknown;
  __ABE_QUERY_TRACE__?: Array<{
    readonly type: string;
    readonly query: string;
    readonly timestampMs: number;
    readonly details: Record<string, unknown>;
  }>;
}

const globals = globalThis as unknown as DebugGlobals;

describe('query debug telemetry', () => {
  beforeEach(() => {
    delete globals.__ABE_QUERY_DEBUG__;
    delete globals.__ABE_QUERY_TRACE__;
    globalThis.localStorage.removeItem('ABE_QUERY_DEBUG');
  });

  afterEach(() => {
    delete globals.__ABE_QUERY_DEBUG__;
    delete globals.__ABE_QUERY_TRACE__;
    globalThis.localStorage.removeItem('ABE_QUERY_DEBUG');
  });

  it('suppresses all trace records and events when __ABE_QUERY_DEBUG__ is false', () => {
    globals.__ABE_QUERY_DEBUG__ = false;
    const listener = vi.fn();
    globalThis.addEventListener('abe:query-debug', listener);

    const startedAt = logQueryStart(['users', 'list']);
    logQueryRetryDecision(['users', 'list'], 0, 3, {
      retryable: true,
      status: 503,
      reason: 'unavailable',
    });
    logQueryRetryWait(['users', 'list'], 250);
    logQuerySuccess(['users', 'list'], startedAt, 1);
    logQueryFailure(['users', 'list'], startedAt, 2, new Error('boom'));

    globalThis.removeEventListener('abe:query-debug', listener);

    expect(startedAt).toBe(0);
    expect(globals.__ABE_QUERY_TRACE__).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('respects localStorage ABE_QUERY_DEBUG="0" to disable and "1" to enable', () => {
    globalThis.localStorage.setItem('ABE_QUERY_DEBUG', '0');
    expect(logQueryStart(['tasks'])).toBe(0);
    expect(globals.__ABE_QUERY_TRACE__).toBeUndefined();

    globalThis.localStorage.setItem('ABE_QUERY_DEBUG', '1');
    const startedAt = logQueryStart(['tasks']);
    expect(startedAt).toBeGreaterThan(0);
    expect(globals.__ABE_QUERY_TRACE__).toHaveLength(1);
    expect(globals.__ABE_QUERY_TRACE__?.[0]?.type).toBe('start');
  });

  it('emits structured records and CustomEvents for start, retry, wait, success, and failure', () => {
    globals.__ABE_QUERY_DEBUG__ = true;
    const received: Array<{ type: string; details: Record<string, unknown> }> = [];
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ type: string; details: Record<string, unknown> }>)
        .detail;
      received.push({ type: detail.type, details: detail.details });
    };
    globalThis.addEventListener('abe:query-debug', listener);

    const key = ['projects', { orgId: 'org-1' }] as const;
    const startedAt = logQueryStart(key);
    logQueryRetryDecision(key, 1, 3, {
      retryable: true,
      status: 502,
      reason: 'bad gateway',
    });
    logQueryRetryWait(key, 500);
    logQuerySuccess(key, startedAt, 2);
    logQueryFailure(key, startedAt, 3, new Error('gateway timeout'));
    logQueryFailure(key, startedAt, 4, 'non-error failure');

    globalThis.removeEventListener('abe:query-debug', listener);

    expect(received.map((r) => r.type)).toEqual([
      'start',
      'retry-check',
      'retry-wait',
      'success',
      'failure',
      'failure',
    ]);
    expect(received[1]?.details).toEqual({
      attempt: 2,
      maxAttempts: 4,
      status: 502,
      retryable: true,
      reason: 'bad gateway',
    });
    expect(received[2]?.details).toEqual({ delayMs: 500 });
    expect(received[3]?.details['attempts']).toBe(2);
    expect(typeof received[3]?.details['durationMs']).toBe('number');
    expect(received[4]?.details['error']).toBe('gateway timeout');
    expect(received[5]?.details['error']).toBe('non-error failure');
  });

  it('evicts oldest records once trace history reaches the 500-entry cap', () => {
    globals.__ABE_QUERY_DEBUG__ = true;

    for (let i = 0; i < 510; i++) {
      logQueryRetryWait(['item', i], i);
    }

    const trace = globals.__ABE_QUERY_TRACE__ ?? [];
    expect(trace).toHaveLength(500);
    expect(trace[0]?.details['delayMs']).toBe(10);
    expect(trace[499]?.details['delayMs']).toBe(509);
  });
});
