// main/modules/compliance/web/ContentPages.tsx
import { Badge, Card, Heading, Markdown, PageContainer } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';
import acceptableUseDoc from '../seeds/legal/acceptable-use.md?raw';
import cookiePolicyDoc from '../seeds/legal/cookie-policy.md?raw';
import disclaimerDoc from '../seeds/legal/disclaimer.md?raw';

import { fillDocument } from './document';

import type { ReactElement } from 'react';

import './LegalDocumentPage.css';

interface DocumentPageProps {
  readonly body: string;
  readonly badge?: string | undefined;
  readonly title?: string | undefined;
}

export function DocumentPage({ body, badge, title }: DocumentPageProps): ReactElement {
  return (
    <PageContainer className="legal-document-page">
      {title !== undefined ? (
        <div className="legal-document-page__header">
          <Heading as="h1" size="xl" className="legal-document-page__title">
            {title}
          </Heading>
        </div>
      ) : null}
      <Card>
        <Card.Body>
          {badge !== undefined ? (
            <div className="legal-document-page__meta">
              <Badge tone="info">{badge}</Badge>
            </div>
          ) : null}
          <Markdown className="legal-document-page__body">{fillDocument(body)}</Markdown>
        </Card.Body>
      </Card>
    </PageContainer>
  );
}

export function CookiePolicyPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  return <DocumentPage body={cookiePolicyDoc} badge={t('compliance.badgeCookies')} />;
}

export function AcceptableUsePage(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  return <DocumentPage body={acceptableUseDoc} badge={t('compliance.badgeAcceptableUse')} />;
}

export function DisclaimerPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  return <DocumentPage body={disclaimerDoc} badge={t('compliance.badgeDisclaimer')} />;
}
