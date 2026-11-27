// main/apps/web/src/pages/ForbiddenPage.tsx
import { useNavigate } from '@bslt/react/router';
import { EmptyState, Icon, PageContainer } from '@bslt/ui';

import type { ReactElement } from 'react';

import { useChromeTranslation } from '#app/i18n/chromeLabels';

export const ForbiddenPage = (): ReactElement => {
  const navigate = useNavigate();
  const { t } = useChromeTranslation();

  return (
    <PageContainer>
      <EmptyState
        icon={<Icon name="lock" size="lg" className="text-muted" />}
        title={t('error.forbiddenTitle')}
        description={t('error.forbiddenDescription')}
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
