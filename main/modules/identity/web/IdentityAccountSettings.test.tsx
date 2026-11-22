// main/modules/identity/web/IdentityAccountSettings.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DangerZone,
  DeletionStatusIndicator,
  DevicesList,
  SessionsList,
  SudoModal,
} from './IdentityAccountSettings';

const mockState = vi.hoisted(() => ({
  logout: vi.fn().mockResolvedValue(undefined),
  logoutAll: vi.fn().mockResolvedValue({ message: 'ok' }),
  sessions: [] as Array<{
    id: string;
    userAgent: string | null;
    ipAddress: string | null;
    createdAt: string;
    isCurrent: boolean;
  }>,
  sessionsLoading: false,
  sessionsError: false,
  sessionsErrorObj: null as Error | null,
  revokeSession: vi.fn(),
  revokeAllSessions: vi.fn(),
  devices: [] as Array<{
    id: string;
    deviceFingerprint: string;
    label: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    trusted: boolean;
    firstSeenAt: string;
    lastSeenAt: string;
    createdAt: string;
  }>,
  devicesLoading: false,
  devicesError: null as Error | null,
  trustDevice: vi.fn(),
  revokeDevice: vi.fn(),
  invalidateSessions: vi.fn().mockResolvedValue(undefined),
  sudoFn: vi.fn(),
  sudoReset: vi.fn(),
  sudoLoading: false,
  sudoError: null as Error | null,
  deactivate: vi.fn(),
  requestDeletion: vi.fn(),
  reactivate: vi.fn(),
  dangerError: null as Error | null,
}));

vi.mock('./authService', () => ({
  useAuth: () => ({ logout: mockState.logout }),
}));

vi.mock('./hooks', () => ({
  useLogoutAll: () => mockState.logoutAll,
  useSessions: () => ({
    sessions: mockState.sessions,
    isLoading: mockState.sessionsLoading,
    isError: mockState.sessionsError,
    error: mockState.sessionsErrorObj,
    refetch: vi.fn(),
  }),
  useRevokeSession: () => ({
    revokeSession: mockState.revokeSession,
    isLoading: false,
    error: null,
  }),
  useRevokeAllSessions: () => ({
    revokeAllSessions: mockState.revokeAllSessions,
    isLoading: false,
    error: null,
    revokedCount: null,
  }),
  useDevices: () => ({
    devices: mockState.devices,
    isLoading: mockState.devicesLoading,
    error: mockState.devicesError,
    trustDevice: mockState.trustDevice,
    revokeDevice: mockState.revokeDevice,
    invalidateSessions: mockState.invalidateSessions,
  }),
  useSudo: () => ({
    sudo: mockState.sudoFn,
    reset: mockState.sudoReset,
    isLoading: mockState.sudoLoading,
    error: mockState.sudoError,
  }),
  useDeactivateAccount: () => ({
    deactivate: mockState.deactivate,
    isLoading: false,
    error: mockState.dangerError,
    reset: vi.fn(),
  }),
  useDeleteAccount: () => ({
    requestDeletion: mockState.requestDeletion,
    isLoading: false,
    error: null,
    reset: vi.fn(),
  }),
  useReactivateAccount: () => ({
    reactivate: mockState.reactivate,
    isLoading: false,
    error: null,
    reset: vi.fn(),
  }),
}));

describe('IdentityAccountSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.sessions = [];
    mockState.sessionsLoading = false;
    mockState.sessionsError = false;
    mockState.sessionsErrorObj = null;
    mockState.devices = [];
    mockState.devicesLoading = false;
    mockState.devicesError = null;
    mockState.sudoLoading = false;
    mockState.sudoError = null;
    mockState.dangerError = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('SessionsList and DevicesList SURFACE load errors without rendering stale device controls', () => {
    mockState.sessionsError = true;
    mockState.sessionsErrorObj = new Error('Sessions service down');
    mockState.devicesError = new Error('Devices service down');

    render(
      <div>
        <SessionsList />
        <DevicesList />
      </div>,
    );

    expect(screen.getByText(/Failed to load sessions: Sessions service down/)).not.toBeNull();
    expect(screen.getByText('Devices service down')).not.toBeNull();
  });

  it('SudoModal UNMOUNTS when closed, DISABLES empty password submit, and SURFACES sudo errors', () => {
    const onSuccess = vi.fn();
    const onDismiss = vi.fn();
    mockState.sudoError = new Error('Wrong password');

    const { rerender } = render(
      <SudoModal
        open={false}
        title="Delete Account"
        description="Permanent"
        onSuccess={onSuccess}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.queryByText('Delete Account')).toBeNull();

    rerender(
      <SudoModal
        open={true}
        title="Delete Account"
        description="Permanent"
        onSuccess={onSuccess}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText('Wrong password')).not.toBeNull();
  });

  it('DeletionStatusIndicator HIDES cancel button when grace period has expired and DangerZone SURFACES errors', () => {
    mockState.dangerError = new Error('Sudo token expired');
    const expired = new Date(Date.now() - 86_400_000).toISOString();

    render(
      <div>
        <DeletionStatusIndicator scheduledDeletionAt={expired} onCancelDeletion={vi.fn()} />
        <DangerZone accountStatus="active" />
      </div>,
    );

    expect(screen.queryByTestId('cancel-deletion-button')).toBeNull();
    expect(screen.getByText(/being permanently deleted/)).not.toBeNull();
    expect(screen.getByText('Sudo token expired')).not.toBeNull();
  });

  it('DangerZone renders countdown and cancel action when pending_deletion with future gracePeriodEnds', () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    render(<DangerZone accountStatus="pending_deletion" gracePeriodEnds={future} />);

    expect(screen.getByTestId('deletion-status-indicator')).not.toBeNull();
    fireEvent.click(screen.getByTestId('cancel-deletion-button'));
    expect(mockState.reactivate).toHaveBeenCalledTimes(1);
  });
});
