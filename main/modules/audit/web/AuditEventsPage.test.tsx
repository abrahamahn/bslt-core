// main/modules/audit/web/AuditEventsPage.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditEventsPage } from './AuditEventsPage';

import type { AuditLogEntry } from '../contract';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  events: [] as AuditLogEntry[],
  isLoading: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
  lastFilter: undefined as Record<string, unknown> | undefined,
}));

vi.mock('./hooks', () => ({
  useAuditEvents: (opts?: { filter?: Record<string, unknown> }) => {
    mocks.lastFilter = opts?.filter;
    return {
      data: { events: mocks.events, limit: 100, truncated: false },
      isLoading: mocks.isLoading,
      isError: mocks.isError,
      error: mocks.error,
      refetch: mocks.refetch,
    };
  },
}));

vi.mock('@bslt/ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
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
    placeholder,
    value,
    onChange,
  }: {
    placeholder?: string;
    value?: string;
    onChange?: (e: { target: { value: string } }) => void;
  }) => (
    <input
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        onChange?.({ target: { value: e.target.value } });
      }}
    />
  ),
  PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Select: ({
    children,
    value,
    onChange,
  }: {
    children: ReactNode;
    value?: string;
    onChange?: (val: string) => void;
  }) => (
    <select
      value={value}
      onChange={(e) => {
        onChange?.(e.target.value);
      }}
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
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

afterEach(() => {
  cleanup();
});

describe('AuditEventsPage', () => {
  beforeEach(() => {
    mocks.events = [];
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.error = null;
    mocks.refetch.mockReset();
  });

  it('displays error message when loading audit log fails', () => {
    mocks.isError = true;
    mocks.error = new Error('Forbidden');

    render(<AuditEventsPage />);
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
  });

  it('renders empty state when no audit events match filters', () => {
    render(<AuditEventsPage />);
    expect(screen.getByText('No audit events')).toBeInTheDocument();
  });

  it('renders audit rows and forwards action filter to server hook', () => {
    mocks.events = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: null,
        actorId: '22222222-2222-4222-8222-222222222222',
        action: 'tasks.task.created',
        category: 'data',
        severity: 'info',
        resource: 'task',
        resourceId: '99999999-9999-4999-8999-999999999999',
        metadata: {},
        ipAddress: '127.0.0.1',
        userAgent: null,
        createdAt: '2026-11-17T00:00:00.000Z',
      },
    ];

    render(<AuditEventsPage />);
    expect(screen.getByText('tasks.task.created')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Filter by action...'), {
      target: { value: 'tasks.task.created' },
    });
    expect(mocks.lastFilter?.['action']).toBe('tasks.task.created');
  });
});
