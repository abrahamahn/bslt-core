// main/kernel/db/src/builder/wire.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  applyDriverSettings,
  applyTransactionModes,
  batchDriverStatementWithSettings,
  sendDriverStatement,
} from './wire';

describe('driver wire execution helpers', () => {
  it('skips applyDriverSettings and applyTransactionModes when inputs are empty', async () => {
    const unsafe = vi.fn();
    const client = { unsafe } as never;

    await applyDriverSettings(client, undefined);
    await applyTransactionModes(client, []);
    expect(unsafe).not.toHaveBeenCalled();
  });

  it('propagates driver rejections from applyDriverSettings and applyTransactionModes', async () => {
    const unsafe = vi.fn().mockRejectedValue(new Error('driver rejected'));
    const client = { unsafe } as never;

    await expect(
      applyDriverSettings(client, { text: 'SELECT set_config($1, $2, true)', values: ['a', 'b'] }),
    ).rejects.toThrow('driver rejected');
    await expect(applyTransactionModes(client, ['READ ONLY'])).rejects.toThrow('driver rejected');
  });

  it('attaches AbortSignal.timeout when positive timeoutMs is provided and batches settings', async () => {
    const signal = vi.fn().mockReturnValue('timed-pending');
    const unsafe = vi.fn().mockReturnValue({ signal });
    const batch = vi.fn().mockResolvedValue([[], [{ id: '1' }]]);
    const client = { unsafe, batch } as never;

    const timed = sendDriverStatement(client, 'SELECT 1', [], 250);
    expect(timed).toBe('timed-pending');
    expect(signal).toHaveBeenCalledTimes(1);

    const rows = await batchDriverStatementWithSettings<{ id: string }>(
      client,
      { text: 'SELECT 1', values: [] },
      'SELECT id FROM t',
      [],
      undefined,
    );
    expect(rows).toEqual([{ id: '1' }]);
  });
});
