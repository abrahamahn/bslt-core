// main/apps/web/src/app/admin/AdminDashboardPage.test.tsx
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockEnvironment, mockAdminUser, renderWithProviders } from '../../__tests__/utils';
import { I18nProvider } from '../../i18n';
import { TIMEZONE_STORAGE_KEY } from '../../i18n/format';

import { AdminDashboardPage } from './AdminDashboardPage';

type MockAction = ReturnType<typeof vi.fn>;

interface AdminDashboardActions {
  refetchAudit: MockAction;
  refetchHealth: MockAction;
  refetchJobs: MockAction;
  refetchMetrics: MockAction;
  refetchQueue: MockAction;
  refetchSecurity: MockAction;
  refreshBilling: MockAction;
  refreshTenants: MockAction;
  refreshUsers: MockAction;
}

const mocks = vi.hoisted(() => ({
  useAdminHealth: vi.fn(),
  useAdminMetrics: vi.fn(),
  useAdminOrgs: vi.fn(),
  useAdminPlans: vi.fn(),
  useAdminUsers: vi.fn(),
  useAuditEvents: vi.fn(),
  useJobsList: vi.fn(),
  useQueueStats: vi.fn(),
  useSecurityMetrics: vi.fn(),
}));

vi.mock('@bslt/audit/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/audit/web')>();
  return {
    ...actual,
    useAuditEvents: mocks.useAuditEvents,
    useSecurityMetrics: mocks.useSecurityMetrics,
  };
});

vi.mock('../../generated/modules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../generated/modules')>();
  return {
    ...actual,
    hasAdminModule: true,
    hasBillingModule: true,
    hasOrgsModule: true,
    useOptionalAdminHealth: mocks.useAdminHealth,
    useOptionalAdminMetrics: mocks.useAdminMetrics,
    useOptionalAdminOrgs: mocks.useAdminOrgs,
    useOptionalAdminPlans: mocks.useAdminPlans,
    useOptionalJobsList: mocks.useJobsList,
    useOptionalQueueStats: mocks.useQueueStats,
  };
});

vi.mock('@bslt/identity/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/identity/web')>();
  return {
    ...actual,
    useAdminUsers: mocks.useAdminUsers,
  };
});

const renderAdminDashboard = (): void => {
  renderWithProviders(
    <I18nProvider initialLocale="en-US">
      <AdminDashboardPage />
    </I18nProvider>,
    {
      environment: createMockEnvironment({
        user: mockAdminUser,
        isAuthenticated: true,
      }),
    },
  );
};

const setDefaultMocks = (): AdminDashboardActions => {
  const actions = {
    refetchAudit: vi.fn(),
    refetchHealth: vi.fn(),
    refetchJobs: vi.fn(),
    refetchMetrics: vi.fn(),
    refetchQueue: vi.fn(),
    refetchSecurity: vi.fn(),
    refreshBilling: vi.fn(),
    refreshTenants: vi.fn(),
    refreshUsers: vi.fn(),
  };

  mocks.useAdminHealth.mockReturnValue({
    data: {
      status: 'healthy',
      services: {
        database: 'up',
        cache: 'up',
        queue: 'up',
        storage: 'up',
        email: 'up',
      },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: actions.refetchHealth,
  });

  mocks.useAdminMetrics.mockReturnValue({
    data: {
      metrics: {
        totalRequests: 12450,
        avgResponseTime: 82,
        errorRate: 0.4,
        activeConnections: 18,
        requestsPerSecond: 6.7,
        p95ResponseTime: 144,
        p99ResponseTime: 212,
      },
      queue: {
        pending: 3,
        failed: 1,
      },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: actions.refetchMetrics,
  });

  mocks.useAdminUsers.mockReturnValue({
    users: [
      {
        id: 'user-1',
        email: 'admin@example.com',
        username: 'admin',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin',
        emailVerified: true,
        emailVerifiedAt: '2026-05-01T00:00:00Z',
        lockedUntil: null,
        lockReason: null,
        failedLoginAttempts: 0,
        phone: null,
        phoneVerified: false,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
      {
        id: 'user-2',
        email: 'locked@example.com',
        username: null,
        firstName: 'Locked',
        lastName: 'User',
        role: 'user',
        emailVerified: false,
        emailVerifiedAt: null,
        lockedUntil: '2026-05-30T00:00:00Z',
        lockReason: 'review',
        failedLoginAttempts: 4,
        phone: null,
        phoneVerified: false,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ],
    total: 42,
    page: 1,
    totalPages: 3,
    hasNext: true,
    hasPrev: false,
    isLoading: false,
    error: null,
    filters: {},
    setFilters: vi.fn(),
    setPage: vi.fn(),
    refresh: actions.refreshUsers,
  });

  mocks.useAdminOrgs.mockReturnValue({
    tenants: [
      {
        id: 'tenant-1',
        name: 'Acme',
        slug: 'acme',
        logoUrl: null,
        ownerId: 'user-1',
        isActive: true,
        memberCount: 5,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
      {
        id: 'tenant-2',
        name: 'Paused',
        slug: 'paused',
        logoUrl: null,
        ownerId: 'user-2',
        isActive: false,
        memberCount: 1,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ],
    total: 7,
    isLoading: false,
    error: null,
    refresh: actions.refreshTenants,
  });

  mocks.useSecurityMetrics.mockReturnValue({
    data: {
      totalEvents: 12,
      criticalEvents: 1,
      highEvents: 2,
      mediumEvents: 3,
      lowEvents: 6,
      tokenReuseCount: 0,
      accountLockedCount: 1,
      suspiciousLoginCount: 2,
      eventsByType: { suspicious_login: 2 },
      period: 'day',
      periodStart: '2026-05-29T00:00:00Z',
      periodEnd: '2026-05-30T00:00:00Z',
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: actions.refetchSecurity,
    period: 'day',
    setPeriod: vi.fn(),
  });

  mocks.useQueueStats.mockReturnValue({
    data: {
      pending: 3,
      processing: 1,
      completed: 120,
      failed: 2,
      deadLetter: 1,
      total: 127,
      failureRate: 1.6,
      recentCompleted: 20,
      recentFailed: 1,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: actions.refetchQueue,
  });

  mocks.useJobsList.mockReturnValue({
    data: {
      data: [],
      total: 5,
      page: 1,
      limit: 5,
      hasNext: false,
      hasPrev: false,
      totalPages: 1,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: actions.refetchJobs,
    setFilter: vi.fn(),
    setPage: vi.fn(),
    setStatus: vi.fn(),
    filter: {},
    pagination: {
      page: 1,
      limit: 5,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    },
  });

  mocks.useAuditEvents.mockReturnValue({
    data: {
      events: [
        {
          id: 'audit-1',
          tenantId: null,
          actorId: 'user-1',
          action: 'admin.lock_user',
          category: 'admin',
          severity: 'warn',
          resource: 'user',
          resourceId: 'user-2',
          metadata: {},
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
          createdAt: '2026-05-29T03:00:00Z',
        },
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: actions.refetchAudit,
  });

  mocks.useAdminPlans.mockReturnValue({
    plans: [
      {
        id: 'plan-pro',
        name: 'Pro',
        description: null,
        interval: 'month',
        priceInCents: 2900,
        currency: 'USD',
        features: [],
        trialDays: 14,
        isActive: true,
        sortOrder: 1,
        stripePriceId: 'price_123',
        stripeProductId: 'prod_123',
        paypalPlanId: null,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
      {
        id: 'plan-old',
        name: 'Legacy',
        description: null,
        interval: 'month',
        priceInCents: 1900,
        currency: 'USD',
        features: [],
        trialDays: 0,
        isActive: false,
        sortOrder: 2,
        stripePriceId: null,
        stripeProductId: null,
        paypalPlanId: null,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ],
    isLoading: false,
    isActing: false,
    error: null,
    create: vi.fn(),
    update: vi.fn(),
    syncToStripe: vi.fn(),
    deactivate: vi.fn(),
    remove: vi.fn(),
    refresh: actions.refreshBilling,
  });

  return actions;
};

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  afterEach(() => {
    window.localStorage.removeItem(TIMEZONE_STORAGE_KEY);
  });

  it('renders the latest audit event date via the locale-aware formatter', () => {
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'UTC');
    renderAdminDashboard();

    // createdAt 2026-05-29T03:00:00Z rendered with the stored UTC preference.
    expect(screen.getByText(/admin · May 29, 3:00/)).toBeInTheDocument();
  });

  it('surfaces the admin API overview', () => {
    renderAdminDashboard();

    expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(screen.getAllByText('System Health').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Users').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Tenants').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Security').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Jobs').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Billing Plans').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /compliance operations/i })).toBeInTheDocument();
    expect(screen.queryByText('API route manifest')).toBeNull();
    expect(screen.queryByText('Feature Flags')).toBeNull();
    expect(screen.queryByText('Notifications')).toBeNull();
    expect(screen.getByText('High priority security events')).toBeInTheDocument();
    expect(screen.getByText('admin.lock_user')).toBeInTheDocument();
  });

  it('refreshes the APIs backing the overview', () => {
    const actions = setDefaultMocks();
    renderAdminDashboard();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh All' }));

    expect(actions.refetchHealth).toHaveBeenCalledTimes(1);
    expect(actions.refetchMetrics).toHaveBeenCalledTimes(1);
    expect(actions.refreshUsers).toHaveBeenCalledTimes(1);
    expect(actions.refreshTenants).toHaveBeenCalledTimes(1);
    expect(actions.refetchSecurity).toHaveBeenCalledTimes(1);
    expect(actions.refetchQueue).toHaveBeenCalledTimes(1);
    expect(actions.refetchJobs).toHaveBeenCalledTimes(1);
    expect(actions.refetchAudit).toHaveBeenCalledTimes(1);
    expect(actions.refreshBilling).toHaveBeenCalledTimes(1);
  });

  it('renders metric fallbacks when derived counters are missing', () => {
    mocks.useAdminMetrics.mockReturnValue({
      ...mocks.useAdminMetrics(),
      data: {
        metrics: {
          totalRequests: 12450,
          avgResponseTime: undefined,
          errorRate: undefined,
          activeConnections: undefined,
          requestsPerSecond: undefined,
          p95ResponseTime: undefined,
          p99ResponseTime: undefined,
        },
        queue: null,
      },
    });

    renderAdminDashboard();

    expect(screen.getByText('0.0 rps')).toBeInTheDocument();
    expect(screen.getByText('Average 0 ms, P99 0 ms')).toBeInTheDocument();
  });

  it('renders metric fallbacks when nested metric sections are missing', () => {
    mocks.useAdminMetrics.mockReturnValue({
      ...mocks.useAdminMetrics(),
      data: {
        queue: null,
      },
    });

    expect(() => {
      renderAdminDashboard();
    }).not.toThrow();
    expect(screen.getByText('0.0 rps')).toBeInTheDocument();
    expect(screen.getByText('Average 0 ms, P99 0 ms')).toBeInTheDocument();
  });

  it('shows an all-clear attention state when no urgent signals exist', () => {
    setDefaultMocks();
    mocks.useAdminMetrics.mockReturnValue({
      ...mocks.useAdminMetrics(),
      data: {
        metrics: {
          totalRequests: 12450,
          avgResponseTime: 82,
          errorRate: 0,
          activeConnections: 18,
          requestsPerSecond: 6.7,
          p95ResponseTime: 144,
          p99ResponseTime: 212,
        },
        queue: {
          pending: 0,
          failed: 0,
        },
      },
    });
    mocks.useSecurityMetrics.mockReturnValue({
      ...mocks.useSecurityMetrics(),
      data: {
        totalEvents: 3,
        criticalEvents: 0,
        highEvents: 0,
        mediumEvents: 1,
        lowEvents: 2,
        tokenReuseCount: 0,
        accountLockedCount: 0,
        suspiciousLoginCount: 0,
        eventsByType: {},
        period: 'day',
        periodStart: '2026-05-29T00:00:00Z',
        periodEnd: '2026-05-30T00:00:00Z',
      },
    });
    mocks.useQueueStats.mockReturnValue({
      ...mocks.useQueueStats(),
      data: {
        pending: 0,
        processing: 0,
        completed: 120,
        failed: 0,
        deadLetter: 0,
        total: 120,
        failureRate: 0,
        recentCompleted: 20,
        recentFailed: 0,
      },
    });
    renderAdminDashboard();

    expect(screen.getByText('0 attention items')).toBeInTheDocument();
    expect(screen.queryByText('Attention Queue')).not.toBeInTheDocument();
  });
});
