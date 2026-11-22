// main/modules/compliance/web/ComplianceAdminPage.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComplianceAdminPage } from './ComplianceAdminPage';

import type { LegalHoldItem } from '../contract';

const mocks = vi.hoisted(() => ({
  holds: [] as LegalHoldItem[],
  holdsLoading: false,
  holdsError: null as Error | null,
  refreshHolds: vi.fn().mockResolvedValue(undefined),
  placeHold: vi.fn(),
  placeError: null as Error | null,
  releaseHold: vi.fn(),
  releaseError: null as Error | null,
  upsertRule: vi.fn(),
  jurisdictionError: null as Error | null,
  eraseUser: vi.fn(),
  eraseError: null as Error | null,
}));

vi.mock('./hooks', () => ({
  useLegalHolds: () => ({
    holds: mocks.holds,
    isLoading: mocks.holdsLoading,
    error: mocks.holdsError,
    refresh: mocks.refreshHolds,
  }),
  usePlaceLegalHold: () => ({
    placeHold: mocks.placeHold,
    isPlacing: false,
    error: mocks.placeError,
  }),
  useReleaseLegalHold: () => ({
    releaseHold: mocks.releaseHold,
    isReleasing: false,
    error: mocks.releaseError,
  }),
  useUpsertJurisdictionRule: () => ({
    upsertRule: mocks.upsertRule,
    isSaving: false,
    error: mocks.jurisdictionError,
  }),
  useEraseUserData: () => ({
    eraseUser: mocks.eraseUser,
    isErasing: false,
    error: mocks.eraseError,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.holds = [];
  mocks.holdsLoading = false;
  mocks.holdsError = null;
  mocks.placeError = null;
  mocks.releaseError = null;
  mocks.jurisdictionError = null;
  mocks.eraseError = null;
});

afterEach(() => {
  cleanup();
});

describe('ComplianceAdminPage', () => {
  it('blocks hold, jurisdiction, and erasure submissions when required inputs or confirmation are missing', () => {
    render(<ComplianceAdminPage />);

    expect(
      (screen.getByRole('button', { name: 'Place Legal Hold' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Save Jurisdiction Rule' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Erase User Data' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText('Target User ID'), { target: { value: 'user-123' } });
    // Still blocked until confirmation checkbox is checked
    expect(
      (screen.getByRole('button', { name: 'Erase User Data' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.eraseUser).not.toHaveBeenCalled();
  });

  it('surfaces errors for legal hold loading, placement, release, jurisdiction save, and active-hold erasure conflicts', () => {
    mocks.holdsError = new Error('Holds query failed');
    mocks.placeError = new Error('Hold validation failed');
    mocks.releaseError = new Error('Hold already released');
    mocks.jurisdictionError = new Error('Invalid jurisdiction');
    mocks.eraseError = new Error('Cannot erase user under active legal hold');

    render(<ComplianceAdminPage />);

    expect(screen.getByText('Holds query failed')).toBeTruthy();
    expect(screen.getByText('Hold validation failed')).toBeTruthy();
    expect(screen.getByText('Hold already released')).toBeTruthy();
    expect(screen.getByText('Invalid jurisdiction')).toBeTruthy();
    expect(screen.getByText('Cannot erase user under active legal hold')).toBeTruthy();
  });

  it('places and releases legal holds, saves jurisdiction rules, and executes confirmed GDPR erasure', async () => {
    mocks.holds = [
      {
        id: 'hold-1',
        subjectType: 'user',
        subjectId: 'user-42',
        reason: 'Active litigation hold',
        createdByUserId: 'admin-1',
        heldUntil: null,
        releasedAt: null,
        releasedByUserId: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ];
    mocks.placeHold.mockResolvedValue({ hold: mocks.holds[0] });
    mocks.releaseHold.mockResolvedValue({
      hold: { ...mocks.holds[0], releasedAt: '2026-10-02T00:00:00Z' },
    });
    mocks.upsertRule.mockResolvedValue({
      rule: {
        jurisdiction: 'DE',
        minimumAge: 16,
        requiresAgeAssurance: true,
        allowedMethods: ['attestation'],
        serviceAvailable: true,
        updatedAt: '2026-10-02T00:00:00Z',
      },
    });
    mocks.eraseUser.mockResolvedValue({
      userId: 'user-99',
      erasedModules: ['identity', 'compliance'],
    });

    render(<ComplianceAdminPage />);

    // Place a new hold
    fireEvent.change(screen.getByLabelText('Subject ID'), { target: { value: 'user-77' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Audit preservation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place Legal Hold' }));
    await waitFor(() => {
      expect(mocks.placeHold).toHaveBeenCalledWith({
        subjectType: 'user',
        subjectId: 'user-77',
        reason: 'Audit preservation',
      });
    });

    // Release existing hold
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => {
      expect(mocks.releaseHold).toHaveBeenCalledWith('hold-1');
    });

    // Save jurisdiction rule
    fireEvent.change(screen.getByLabelText('Jurisdiction code'), { target: { value: 'de' } });
    fireEvent.change(screen.getByLabelText('Minimum age'), { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Jurisdiction Rule' }));
    await waitFor(() => {
      expect(mocks.upsertRule).toHaveBeenCalledWith({
        jurisdiction: 'DE',
        minimumAge: 16,
        requiresAgeAssurance: false,
        serviceAvailable: true,
      });
    });

    // Erase user with confirmation
    fireEvent.change(screen.getByLabelText('Target User ID'), { target: { value: 'user-99' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Erase User Data' }));
    await waitFor(() => {
      expect(mocks.eraseUser).toHaveBeenCalledWith('user-99');
      expect(
        screen.getByText('Erased user user-99 across modules: identity, compliance.'),
      ).toBeTruthy();
    });
  });
});
