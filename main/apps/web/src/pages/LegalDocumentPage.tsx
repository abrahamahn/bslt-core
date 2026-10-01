// main/apps/web/src/pages/LegalDocumentPage.tsx

import { useClientEnvironment } from '@app/ClientEnvironment';
import { useCurrentLegal } from '@bslt/react';
import { Link } from '@bslt/react/router';
import { DOCUMENT_TYPES } from '@bslt/shared/constants/core';
import { formatDateTime } from '@bslt/shared/helpers';
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
import { useMemo } from 'react';

import './LegalDocumentPage.css';

import type { LegalClientConfig } from '@bslt/api';
import type { DocumentType } from '@bslt/shared/core';
import type { ReactElement } from 'react';

/**
 * The short label on the badge. Keyed by `DocumentType`, so adding a document
 * type fails the type-check here rather than silently rendering the wrong word:
 * this was a two-way ternary that called everything that was not Terms
 * "Privacy".
 */
const BADGE_LABEL: Readonly<Record<DocumentType, string>> = {
  terms_of_service: 'Terms',
  privacy_policy: 'Privacy',
  cookie_policy: 'Cookies',
  acceptable_use: 'Acceptable use',
  disclaimer: 'Disclaimer',
};

/**
 * The `type` column is free text in the database and reaches us typed as
 * `string`, so a fork that adds its own document type can hand us one we have
 * never heard of. Narrow, and fall back to a neutral word rather than rendering
 * `undefined` on a legal page.
 */
function badgeLabel(type: string): string {
  return (DOCUMENT_TYPES as readonly string[]).includes(type)
    ? BADGE_LABEL[type as DocumentType]
    : 'Legal';
}

interface LegalDocumentPageProps {
  documentType: DocumentType;
  fallbackTitle: string;
}

const LegalDocumentPage = ({
  documentType,
  fallbackTitle,
}: LegalDocumentPageProps): ReactElement => {
  const { config } = useClientEnvironment();
  const clientConfig: LegalClientConfig = useMemo(
    () => ({
      baseUrl: config.apiUrl,
    }),
    [config.apiUrl],
  );
  const currentLegal = useCurrentLegal({ clientConfig });
  const document =
    currentLegal.documents.find((candidate) => candidate.type === documentType) ?? null;

  return (
    <PageContainer className="legal-document-page">
      <div className="legal-document-page__header">
        <div>
          <Heading as="h1" size="xl" className="legal-document-page__title">
            {document?.title ?? fallbackTitle}
          </Heading>
          {document !== null ? (
            <Text tone="muted" size="sm">
              Version {document.version.toString()} - Effective{' '}
              {formatDateTime(document.effectiveAt)}
            </Text>
          ) : null}
        </div>
        <Link to="/register" className="btn btn-secondary btn-small legal-document-page__action">
          Create account
        </Link>
      </div>

      {/* `isPending` as well as `isLoading`: before the first fetch resolves —
          the first paint, and the whole of the build-time prerender, where
          effects never run — `documents` is empty because nothing has been
          fetched, not because nothing has been published. Claiming otherwise
          flashes "unavailable" at every visitor, and hands a crawler a /terms
          page that says this product has no terms. */}
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
          title={`${fallbackTitle} unavailable`}
          description="This legal document has not been published yet."
        />
      ) : (
        <Card>
          <Card.Body>
            <div className="legal-document-page__meta">
              <Badge tone="info">{badgeLabel(document.type)}</Badge>
              <Text tone="muted" size="sm">
                Published {formatDateTime(document.createdAt)}
              </Text>
            </div>
            <Markdown>{document.content}</Markdown>
          </Card.Body>
        </Card>
      )}
    </PageContainer>
  );
};

// Only the two DB-published documents render here. Cookies, acceptable use,
// and the disclaimer are file-owned — docs/legal/, rendered by
// @features/content — so they need no fetch, no version row, and no empty
// state.

export const TermsPage = (): ReactElement => (
  <LegalDocumentPage documentType="terms_of_service" fallbackTitle="Terms of Service" />
);

export const PrivacyPolicyPage = (): ReactElement => (
  <LegalDocumentPage documentType="privacy_policy" fallbackTitle="Privacy Policy" />
);
