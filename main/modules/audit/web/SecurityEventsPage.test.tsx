// main/modules/audit/web/SecurityEventsPage.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecurityEventsPage } from './SecurityEventsPage';

import type {
  ListSecurityEventsResponse,
  SecurityEventsFilter,
  SecurityMetricsPeriod,
  SecurityMetricsResponse,
} from '../contract';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  eventsData: undefined as ListSecurityEventsResponse | undefined,
  eventsLoading: false,
  filter: {} as SecurityEventsFilter,
  setFilter: vi.fn(),
  setPage: vi.fn(),
  refetchEvents: vi.fn(),
  metricsData: undefined as SecurityMetricsResponse | undefined,
  metricsLoading: false,
  period: 'day' as SecurityMetricsPeriod,
  setPeriod: vi.fn(),
  downloadExport: vi.fn(),
  isExporting: false,
  exportError: false,
}));

vi.mock('@bslt/react/router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('./hooks', () => ({
  useSecurityEvents: () => ({
    data: mocks.eventsData,
    isLoading: mocks.eventsLoading,
    isError: false,
    error: null,
    filter: mocks.filter,
    pagination: { page: 1, limit: 50 },
    setFilter: mocks.setFilter,
    setPage: mocks.setPage,
    refetch: mocks.refetchEvents,
  }),
  useSecurityMetrics: () => ({
    data: mocks.metricsData,
    isLoading: mocks.metricsLoading,
    isError: false,
    error: null,
    period: mocks.period,
    setPeriod: mocks.setPeriod,
    refetch: vi.fn(),
  }),
  useExportEvents: () => ({
    exportEvents: vi.fn(),
    downloadExport: mocks.downloadExport,
    isExporting: mocks.isExporting,
    isError: mocks.exportError,
    error: mocks.exportError ? new Error('CSV failed') : null,
    data: null,
  }),
}));

vi.mock('@bslt/ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: (e: { stopPropagation: () => void }) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onClick?.({ stopPropagation: vi.fn() });
      }}
    >
      {children}
    </button>
  ),
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
  Heading: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  Input: ({
    id,
    placeholder,
    value,
    onChange,
  }: {
    id?: string;
    placeholder?: string;
    value?: string;
    onChange?: (e: { target: { value: string } }) => void;
  }) => (
    <input
      id={id}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        onChange?.({ target: { value: e.target.value } });
      }}
    />
  ),
  Dialog: {
    Root: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    Header: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    Description: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    Body: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Footer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Pagination: () => <div data-testid="pagination" />,
  Radio: ({ value, label }: { value: string; label: string }) => (
    <label>
      <input type="radio" value={value} readOnly />
      {label}
    </label>
  ),
  RadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Select: ({
    id,
    children,
    value,
    onChange,
    ...rest
  }: {
    id?: string;
    children: ReactNode;
    value?: string;
    onChange?: (val: string) => void;
  }) => (
    <select
      id={id}
      value={value}
      onChange={(e) => {
        onChange?.(e.target.value);
      }}
      {...rest}
    >
      {children}
    </select>
  ),
  Skeleton: () => <div data-testid="skeleton" />,
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void }) => (
    <tr onClick={onClick} {...rest}>
      {children}
    </tr>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@bslt/ui/components', () => ({
  MetricValue: ({ label, value }: { label: string; value: number }) => (
    <div>
      <span>{label}</span>
      <span>{String(value)}</span>
    </div>
  ),
  TitledCardSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('SecurityEventsPage', () => {
  beforeEach(() => {
    mocks.eventsData = undefined;
    mocks.eventsLoading = false;
    mocks.filter = {};
    mocks.exportError = false;
    mocks.setFilter.mockReset();
    mocks.downloadExport.mockReset();
    mocks.navigate.mockReset();
  });

  it('shows empty state when no security events exist and surfaces export failure in modal', () => {
    mocks.exportError = true;
    render(<SecurityEventsPage />);

    expect(screen.getByText('No security events')).toBeInTheDocument();
    expect(screen.getByTestId('event-type-filter')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Export'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Export failed: CSV failed/)).toBeInTheDocument();
  });

  it('applies email filter without lingering undefined keys and navigates on event row click', () => {
    mocks.eventsData = {
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          userId: null,
          email: 'sec@example.com',
          eventType: 'login_failed',
          severity: 'medium',
          ipAddress: '10.0.0.1',
          userAgent: null,
          metadata: {},
          createdAt: '2026-11-17T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
      hasNext: false,
      hasPrev: false,
      totalPages: 1,
    };

    render(<SecurityEventsPage />);
    expect(screen.getByTestId('event-row')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('event-row'));
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/admin/security/11111111-1111-4111-8111-111111111111',
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'sec@example.com' },
    });
    fireEvent.click(screen.getByText('Apply Filters'));
    expect(mocks.setFilter).toHaveBeenCalledWith({ email: 'sec@example.com' });
  });
});
