// main/modules/compliance/web/LegalDocumentPage.tsx
import { Link } from '@bslt/react/router';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Heading,
  Markdown,
  PageContainer,
  Skeleton,
  Text,
} from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import { DOCUMENT_TYPES, type DocumentType } from '../contract';
import enUsMessages from '../i18n/en-US.json';

import { useCurrentLegal } from './hooks';

import type { ReactElement } from 'react';

import './LegalDocumentPage.css';

const UTC_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${UTC_TIME_FORMATTER.format(date)} UTC`;
}

interface LegalDocumentPageProps {
  readonly documentType: DocumentType;
  readonly fallbackTitleKey: 'compliance.termsTitle' | 'compliance.privacyTitle';
}

function LegalDocumentPage({
  documentType,
  fallbackTitleKey,
}: LegalDocumentPageProps): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const currentLegal = useCurrentLegal();
  const fallbackTitle = t(fallbackTitleKey);
  const document =
    currentLegal.documents.find((candidate) => candidate.type === documentType) ?? null;

  const badgeLabels: Readonly<Record<DocumentType, string>> = {
    terms_of_service: t('compliance.badgeTerms'),
    privacy_policy: t('compliance.badgePrivacy'),
    cookie_policy: t('compliance.badgeCookies'),
    acceptable_use: t('compliance.badgeAcceptableUse'),
    disclaimer: t('compliance.badgeDisclaimer'),
  };

  const badgeText =
    document !== null && (DOCUMENT_TYPES as readonly string[]).includes(document.type)
      ? badgeLabels[document.type as DocumentType]
      : t('compliance.badgeFallback');

  return (
    <PageContainer className="legal-document-page">
      <div className="legal-document-page__header">
        <div>
          <Heading as="h1" size="xl" className="legal-document-page__title">
            {document?.title ?? fallbackTitle}
          </Heading>
          {document !== null ? (
            <Text tone="muted" size="sm">
              {t('compliance.versionEffectiveMeta')
                .replace('{version}', String(document.version))
                .replace('{effectiveAt}', formatTime(document.effectiveAt))}
            </Text>
          ) : null}
        </div>
        <Link to="/register" className="btn btn-secondary btn-small legal-document-page__action">
          {t('compliance.createAccountCta')}
        </Link>
      </div>

      {currentLegal.isLoading || currentLegal.isPending ? (
        <Card>
          <Card.Body>
            <div className="legal-document-page__skeleton">
              <Skeleton width="45%" height="1.5rem" />
              <Skeleton width="100%" height="1rem" />
              <Skeleton width="92%" height="1rem" />
              <Skeleton width="96%" height="1rem" />
              <Skeleton width="60%" height="1rem" />
            </div>
          </Card.Body>
        </Card>
      ) : currentLegal.error !== null ? (
        <Alert tone="danger">{currentLegal.error.message}</Alert>
      ) : document === null ? (
        <EmptyState
          title={t('compliance.documentUnavailableTitle').replace('{title}', fallbackTitle)}
          description={t('compliance.documentUnavailableDescription')}
        />
      ) : (
        <Card>
          <Card.Body>
            <div className="legal-document-page__meta">
              <Badge tone="info">{badgeText}</Badge>
              <Text tone="muted" size="sm">
                {t('compliance.publishedMeta').replace(
                  '{createdAt}',
                  formatTime(document.createdAt),
                )}
              </Text>
            </div>
            <Markdown>{document.content}</Markdown>
          </Card.Body>
        </Card>
      )}
    </PageContainer>
  );
}

export function TermsPage(): ReactElement {
  return (
    <LegalDocumentPage documentType="terms_of_service" fallbackTitleKey="compliance.termsTitle" />
  );
}

export function PrivacyPolicyPage(): ReactElement {
  return (
    <LegalDocumentPage documentType="privacy_policy" fallbackTitleKey="compliance.privacyTitle" />
  );
}
