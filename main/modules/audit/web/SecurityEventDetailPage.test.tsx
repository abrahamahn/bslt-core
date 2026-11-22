// main/modules/audit/web/SecurityEventDetailPage.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecurityEventDetailPage } from './SecurityEventDetailPage';

import type { SecurityEventEntry } from '../contract';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  id: '11111111-1111-4111-8111-111111111111',
  navigate: vi.fn(),
  event: undefined as SecurityEventEntry | undefined,
  isLoading: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock('@bslt/react/router', () => ({
  useParams: () => ({ id: mocks.id }),
  useNavigate: () => mocks.navigate,
}));

vi.mock('./hooks', () => ({
  useSecurityEvent: () => ({
    data: mocks.event,
    isLoading: mocks.isLoading,
    isError: mocks.isError,
    error: mocks.error,
    refetch: vi.fn(),
  }),
}));

vi.mock('@bslt/ui', () => ({
  Alert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Heading: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@bslt/ui/components', () => ({
  LabeledValueRow: ({ label, value }: { label: string; value: ReactNode }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
  TitledCardSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('SecurityEventDetailPage', () => {
  beforeEach(() => {
    mocks.event = undefined;
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.error = null;
    mocks.navigate.mockReset();
  });

  it('renders error alert and navigates back to /admin/security when event is missing', () => {
    mocks.isError = true;
    mocks.error = new Error('Security event not found');

    render(<SecurityEventDetailPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Security event not found');

    fireEvent.click(screen.getByText('Return to Events List'));
    expect(mocks.navigate).toHaveBeenCalledWith('/admin/security');
  });

  it('renders event-detail sections and metadata when event loads', () => {
    mocks.event = {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      email: 'admin@example.com',
      eventType: 'token_reuse_detected',
      severity: 'critical',
      ipAddress: '192.0.2.10',
      userAgent: 'TestAgent/1.0',
      metadata: { reason: 'replayed_refresh_token' },
      createdAt: '2026-11-17T00:00:00.000Z',
    };

    render(<SecurityEventDetailPage />);
    expect(screen.getByTestId('event-detail')).toBeInTheDocument();
    expect(screen.getByText('Token Reuse Detected')).toBeInTheDocument();
    expect(screen.getByText(/replayed_refresh_token/)).toBeInTheDocument();
  });
});
