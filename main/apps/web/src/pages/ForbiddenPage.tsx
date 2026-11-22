// main/apps/web/src/pages/ForbiddenPage.tsx
import { useNavigate } from '@bslt/react/router';
import { EmptyState, Icon, PageContainer } from '@bslt/ui';

import type { ReactElement } from 'react';

export const ForbiddenPage = (): ReactElement => {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <EmptyState
        icon={<Icon name="lock" size="lg" className="text-muted" />}
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
