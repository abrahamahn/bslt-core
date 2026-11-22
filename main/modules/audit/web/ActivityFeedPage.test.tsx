// main/modules/audit/web/ActivityFeedPage.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityFeedPage } from './ActivityFeedPage';

import type { ActivityEntry } from '../contract';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  activities: [] as ActivityEntry[],
  isLoading: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock('./hooks', () => ({
  useActivities: () => ({
    activities: mocks.activities,
    isLoading: mocks.isLoading,
    isError: mocks.isError,
    error: mocks.error,
    refetch: vi.fn(),
  }),
}));

vi.mock('@bslt/ui', () => ({
  Alert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
  Heading: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  cn: (...args: Array<string | undefined>) => args.filter(Boolean).join(' '),
}));

afterEach(() => {
  cleanup();
});

describe('ActivityFeedPage', () => {
  beforeEach(() => {
    mocks.activities = [];
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.error = null;
  });

  it('renders error alert when activity feed fails to load', () => {
    mocks.isError = true;
    mocks.error = new Error('Feed load failure');

    render(<ActivityFeedPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Feed load failure');
  });

  it('renders empty state when there are no recent activities', () => {
    render(<ActivityFeedPage />);
    expect(screen.getByText('Activity Feed')).toBeInTheDocument();
    expect(screen.getByText('No recent activity')).toBeInTheDocument();
  });

  it('renders timeline items when activities exist', () => {
    mocks.activities = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: null,
        actorId: '22222222-2222-4222-8222-222222222222',
        actorType: 'user',
        action: 'tasks.task.created',
        resourceType: 'task',
        resourceId: 'abcdef123456',
        description: null,
        metadata: {},
        ipAddress: null,
        createdAt: new Date().toISOString(),
      },
    ];

    render(<ActivityFeedPage />);
    expect(screen.getByText('Tasks Task Created')).toBeInTheDocument();
    expect(screen.getByText('Task #abcdef12')).toBeInTheDocument();
  });
});
