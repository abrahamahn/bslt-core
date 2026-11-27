// main/apps/web/src/pages/NotFoundPage.tsx
import { useNavigate } from '@bslt/react/router';
import { EmptyState, Icon, PageContainer } from '@bslt/ui';

import type { ReactElement } from 'react';

import { useChromeTranslation } from '#app/i18n/chromeLabels';

export const NotFoundPage = (): ReactElement => {
  const navigate = useNavigate();
  const { t } = useChromeTranslation();

  return (
    <PageContainer>
      <EmptyState
        icon={<Icon name="search-x" size="lg" className="text-muted" />}
        title={t('error.notFoundTitle')}
        description={t('error.notFoundDescription')}
        action={{
          label: t('error.goToHome'),
          onClick: () => {
            navigate('/');
          },
        }}
      />
    </PageContainer>
  );
};
