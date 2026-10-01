// main/apps/web/src/pages/ForbiddenPage.tsx
import { useNavigate } from '@bslt/react/router';
import { EmptyState, PageContainer } from '@bslt/ui';

import type { ReactElement } from 'react';

export const ForbiddenPage = (): ReactElement => {
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
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        }
        title="Access denied"
        description="You don't have permission to view this page."
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
