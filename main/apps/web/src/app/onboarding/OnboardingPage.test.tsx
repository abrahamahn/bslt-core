// main/apps/web/src/app/onboarding/OnboardingPage.test.tsx
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockEnvironment, mockUser, renderWithProviders } from '../../__tests__/utils';

import { OnboardingPage } from './OnboardingPage';
import { isOnboardingCompleted } from './onboardingState';

const { mockNavigate, mockUpdateProfile, mockUpdateOrg, mockCreateInvite, mockOrgs } = vi.hoisted(
  () => ({
    mockNavigate: vi.fn(),
    mockUpdateProfile: vi.fn(),
    mockUpdateOrg: vi.fn(),
    mockCreateInvite: vi.fn(),
    mockOrgs: [
      {
        id: 'org-1',
        name: 'Starter Workspace',
        slug: 'starter-workspace',
        role: 'owner',
      },
    ],
  }),
);

vi.mock('@bslt/react/router', async () => {
  const actual = await vi.importActual('@bslt/react/router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@bslt/identity/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/identity/web')>();
  return {
    ...actual,
    useProfileUpdate: (opts?: { onSuccess?: () => void }) => ({
      updateProfile: (payload: unknown) => {
        mockUpdateProfile(payload);
        opts?.onSuccess?.();
      },
      isLoading: false,
      isSuccess: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }),
  };
});

vi.mock('../../generated/modules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../generated/modules')>();
  return {
    ...actual,
    hasOrgsModule: true,
    hasBillingModule: true,
    OptionalAvatarUpload: () => null,
    useOptionalActiveOrg: () => ({ activeOrgId: 'org-1', setActiveOrg: vi.fn() }),
    useOptionalOrganizations: () => ({
      organizations: mockOrgs,
      isLoading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    }),
    useOptionalUpdateOrganization: (opts?: { onSuccess?: () => void }) => ({
      mutate: (vars: unknown) => {
        mockUpdateOrg(vars);
        opts?.onSuccess?.();
      },
      isLoading: false,
      error: null,
      reset: vi.fn(),
    }),
    useOptionalCreateInvitation: (opts?: { onSuccess?: () => void }) => ({
      mutate: (vars: unknown) => {
        mockCreateInvite(vars);
        opts?.onSuccess?.();
      },
      isLoading: false,
      error: null,
      reset: vi.fn(),
    }),
  };
});

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('rejects empty first name on step 1 and saves valid profile to advance to step 2', () => {
    const environment = createMockEnvironment({
      user: { ...mockUser, firstName: '', lastName: '' },
      isAuthenticated: true,
    });

    renderWithProviders(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'orgs.teams': true, 'flags.billing': true },
        }}
      >
        <OnboardingPage />
      </CapabilityProvider>,
      { environment },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(screen.getByText(/Please enter your first name/i)).toBeInTheDocument();
    expect(mockUpdateProfile).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));

    expect(mockUpdateProfile).toHaveBeenCalledWith({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(screen.getByRole('heading', { name: '2. Name your workspace' })).toBeInTheDocument();
  });

  it('validates workspace name on step 2, rejects invalid invite email on step 3, and marks complete on finish', () => {
    const environment = createMockEnvironment({ user: mockUser, isAuthenticated: true });
    renderWithProviders(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'orgs.teams': true, 'flags.billing': true },
        }}
      >
        <OnboardingPage />
      </CapabilityProvider>,
      { environment },
    );

    fireEvent.click(screen.getByRole('button', { name: /Workspace identity/i }));
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument();
    expect(mockUpdateOrg).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Acme Labs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(mockUpdateOrg).toHaveBeenCalledWith({ id: 'org-1', data: { name: 'Acme Labs' } });
    expect(screen.getByRole('heading', { name: /3\. Invite teammates/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Teammate email'), { target: { value: 'invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(mockCreateInvite).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Teammate email'), {
      target: { value: 'colleague@acme.io' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(mockCreateInvite).toHaveBeenCalledWith({
      tenantId: 'org-1',
      data: { email: 'colleague@acme.io', role: 'member' },
    });
    expect(screen.getByText('1 invitation sent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Finish setup/i }));
    expect(isOnboardingCompleted(mockUser.id)).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });
});
