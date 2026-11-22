// main/modules/identity/web/useImpersonation.test.ts
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImpersonation } from './useImpersonation';

const mocks = vi.hoisted(() => ({
  impersonation: null as { targetEmail: string } | null,
  user: null as { email: string } | null,
  startImpersonation: vi.fn(),
  endImpersonation: vi.fn(),
}));

vi.mock('./authService', () => ({
  useAuth: () => ({
    impersonation: mocks.impersonation,
    user: mocks.user,
    startImpersonation: mocks.startImpersonation,
    endImpersonation: mocks.endImpersonation,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.impersonation = null;
  mocks.user = null;
});

describe('useImpersonation', () => {
  it('reports inactive state when not impersonating and wraps start/end errors with context', async () => {
    mocks.startImpersonation.mockRejectedValueOnce(new Error('forbidden'));
    mocks.endImpersonation.mockRejectedValueOnce('bad token');

    const { result } = renderHook(() => useImpersonation());
    expect(result.current.isImpersonating).toBe(false);
    expect(result.current.targetEmail).toBeNull();

    await expect(result.current.startImpersonation('u-2')).rejects.toThrow(
      'Failed to start impersonation: forbidden',
    );
    await expect(result.current.endImpersonation()).rejects.toThrow(
      'Failed to end impersonation: Unknown error',
    );
  });

  it('exposes targetEmail and delegates start/end when impersonation is active', async () => {
    mocks.impersonation = { targetEmail: 'target@example.com' };
    mocks.startImpersonation.mockResolvedValueOnce(undefined);
    mocks.endImpersonation.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useImpersonation());
    expect(result.current.isImpersonating).toBe(true);
    expect(result.current.targetEmail).toBe('target@example.com');

    await result.current.startImpersonation('u-2');
    await result.current.endImpersonation();
    expect(mocks.startImpersonation).toHaveBeenCalledWith('u-2');
    expect(mocks.endImpersonation).toHaveBeenCalledTimes(1);
  });
});
