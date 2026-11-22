// main/apps/web/src/pages/NotFoundPage.tsx
import { useNavigate } from '@bslt/react/router';
import { EmptyState, Icon, PageContainer } from '@bslt/ui';

import type { ReactElement } from 'react';

export const NotFoundPage = (): ReactElement => {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <EmptyState
        icon={<Icon name="search-x" size="lg" className="text-muted" />}
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
