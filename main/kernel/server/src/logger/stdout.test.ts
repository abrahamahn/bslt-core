// main/kernel/server/src/logger/stdout.test.ts

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const stdoutError = (code: string): Error => Object.assign(new Error(`write ${code}`), { code });

describe('writeLine', () => {
  let listeners: ReturnType<typeof process.stdout.listeners>;
  let write: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listeners = process.stdout.listeners('error');
    write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // A fresh module per test: a broken pipe ends its writes for good.
    vi.resetModules();
  });

  afterEach(() => {
    write.mockRestore();
    for (const listener of process.stdout.listeners('error')) {
      if (!listeners.includes(listener)) process.stdout.off('error', listener);
    }
  });

  test('writes the line and a newline', async () => {
    const { writeLine } = await import('./stdout');
    writeLine('{"a":1}');
    expect(write.mock.calls).toEqual([['{"a":1}\n']]);
  });

  test('a reader that goes away (EPIPE) ends the writes and not the process', async () => {
    const { writeLine } = await import('./stdout');
    writeLine('before');
    expect(() => process.stdout.emit('error', stdoutError('EPIPE'))).not.toThrow();
    writeLine('after');
    expect(write.mock.calls).toEqual([['before\n']]);
  });

  test('another stdout error still surfaces, and the listener is added once', async () => {
    const { writeLine } = await import('./stdout');
    writeLine('first');
    const count = process.stdout.listenerCount('error');
    writeLine('second');
    expect(process.stdout.listenerCount('error')).toBe(count);
    expect(() => process.stdout.emit('error', stdoutError('EIO'))).toThrow('write EIO');
  });
});
