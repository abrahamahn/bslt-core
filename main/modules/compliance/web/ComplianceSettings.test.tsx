// main/modules/compliance/web/ComplianceSettings.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConsentPreferences,
  CookieConsentBanner,
  DataControlsSection,
  DataExportSection,
  DoNotSellControl,
  LegalDocumentsSection,
} from './ComplianceSettings';
import { readConsent, resetConsentCache, writeConsent } from './consent/store';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  user: null as { id: string } | null,
  consent: {
    preferences: {
      analytics: true,
      marketing_email: false,
      third_party_sharing: null,
      profiling: false,
    } as {
      analytics: boolean | null;
      marketing_email: boolean | null;
      third_party_sharing: boolean | null;
      profiling: boolean | null;
    } | null,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  updateConsent: vi.fn(),
  dataExport: {
    exportInfo: null as {
      status: 'none' | 'pending' | 'ready' | 'expired';
      estimatedReadyAt: string | null;
      requestedAt: string | null;
      expiresAt: string | null;
    } | null,
    isLoading: false,
    error: null as Error | null,
    requestExport: vi.fn(),
    isRequesting: false,
    requestError: null as Error | null,
    downloadExport: vi.fn(),
    isDownloading: false,
  },
  currentLegal: {
    documents: [] as Array<{
      id: string;
      type: 'terms_of_service' | 'privacy_policy' | 'cookie_policy';
      title: string;
      version: number;
      effectiveAt: string;
      content: string;
      createdAt: string;
    }>,
    isLoading: false,
    error: null as Error | null,
  },
  userAgreements: {
    agreements: [] as Array<{ documentId: string; agreedAt: string }>,
    isLoading: false,
    error: null as Error | null,
  },
  tosStatus: {
    status: null as {
      accepted: boolean;
      documentId: string | null;
      requiredVersion: number | null;
    } | null,
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock('@bslt/react/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/react/hooks')>();
  return {
    ...actual,
    useIsMobile: () => false,
  };
});

vi.mock('@bslt/react/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/react/router')>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('@bslt/identity/web', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('./hooks', () => ({
  useConsent: () => mocks.consent,
  useUpdateConsent: () => ({
    updateConsent: mocks.updateConsent,
    isUpdating: false,
    error: null,
  }),
  useDataExport: () => mocks.dataExport,
  useCurrentLegal: () => mocks.currentLegal,
  useUserAgreements: () => mocks.userAgreements,
  useTosStatus: () => mocks.tosStatus,
}));

beforeEach(() => {
  window.localStorage.clear();
  resetConsentCache();
  vi.clearAllMocks();
  mocks.user = null;
  mocks.updateConsent.mockResolvedValue({
    preferences: {
      analytics: false,
      marketing_email: false,
      third_party_sharing: false,
      profiling: false,
    },
    updated: 1,
  });
  mocks.dataExport.error = null;
  mocks.dataExport.exportInfo = null;
  mocks.currentLegal.error = null;
  mocks.currentLegal.documents = [];
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetConsentCache();
});

describe('ComplianceSettings', () => {
  it('fails closed on banner Reject/Manage and hides banner when already dismissed', () => {
    window.localStorage.setItem('cookie-consent-dismissed', 'true');
    const { unmount } = render(<CookieConsentBanner />);
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull();
    expect(readConsent()).toBeNull();
    unmount();

    window.localStorage.clear();
    render(<CookieConsentBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(readConsent()?.analytics).toBe('denied');
    expect(readConsent()?.ads).toBe('denied');
    expect(mocks.navigate).toHaveBeenCalledWith('/settings#data-controls');
  });

  it('keeps local CPRA opt-out even when server mirror rejects', async () => {
    mocks.user = { id: 'user-1' };
    mocks.updateConsent.mockRejectedValueOnce(new Error('offline'));
    writeConsent({ analytics: 'granted', ads: 'granted' });

    render(<DoNotSellControl />);
    fireEvent.click(
      screen.getByRole('switch', { name: 'Do Not Sell or Share My Personal Information' }),
    );

    await waitFor(() => {
      expect(readConsent()?.ads).toBe('denied');
      expect(readConsent()?.analytics).toBe('granted');
    });
  });

  it('surfaces ConsentPreferences, DataExportSection, and LegalDocumentsSection error states and renders DataControlsSection', () => {
    mocks.consent.error = new Error('Failed to load consent');
    const { unmount: unmountConsent } = render(<ConsentPreferences />);
    expect(screen.getByText('Failed to load consent')).toBeTruthy();
    mocks.consent.error = null;
    unmountConsent();

    mocks.dataExport.error = new Error('Export failed');
    const { unmount: unmountExport } = render(<DataExportSection />);
    expect(screen.getByText('Export failed')).toBeTruthy();
    mocks.dataExport.error = null;
    unmountExport();

    mocks.currentLegal.error = new Error('Legal load failed');
    const { unmount: unmountLegal } = render(<LegalDocumentsSection />);
    expect(screen.getByText('Legal load failed')).toBeTruthy();
    mocks.currentLegal.error = null;
    unmountLegal();

    const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString();
    render(
      <DataControlsSection accountStatus="pending_deletion" deletionScheduledAt={inTwoDays} />,
    );
    expect(screen.getByTestId('account-status-badge').textContent).toBe('Pending Deletion');
    expect(screen.getByTestId('deletion-countdown')).toBeTruthy();
  });
});
