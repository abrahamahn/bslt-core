// main/apps/web/src/pages/NotFoundPage.tsx
import { useNavigate } from '@bslt/react/router';
import { EmptyState, PageContainer } from '@bslt/ui';

import type { ReactElement } from 'react';

export const NotFoundPage = (): ReactElement => {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <EmptyState
        icon={
          <svg
            className="icon-lg text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
            <path d="M11 8v3" />
            <path d="M11 14h.01" />
          </svg>
        }
        title="Page not found"
        description="The page you're looking for doesn't exist or has been moved."
        action={{
          label: 'Go to Home',
          onClick: () => {
            navigate('/');
          },
        }}
      />
    </PageContainer>
  );
};
