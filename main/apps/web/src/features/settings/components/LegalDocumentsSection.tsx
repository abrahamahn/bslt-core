// main/apps/web/src/features/settings/components/LegalDocumentsSection.tsx
/**
 * LegalDocumentsSection
 *
 * Account settings surface for current legal documents and user agreements.
 */

import { getAccessToken } from '@app/authToken';
import { useClientEnvironment } from '@app/ClientEnvironment';
import { SITE_MAP } from '@app/siteMap';
import { getApiClient } from '@bslt/api';
import { useCurrentLegal, useQuery, useUserAgreements } from '@bslt/react';
import { formatDateTime } from '@bslt/shared/helpers';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Heading,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@bslt/ui';
import { useMemo, type ReactElement } from 'react';

import type { LegalClientConfig, LegalDocumentItem, UserAgreementItem } from '@bslt/api';

/**
 * Only the DB-published documents are listed here — the site map marks them by
 * carrying a `document` type. Cookies, acceptable use, and the disclaimer are
 * file-owned (docs/legal/, rendered by `@features/content`): their seeded DB
 * rows are never served to a reader, so listing them would advertise a version
 * of a document that no page renders — with a "Not accepted" badge the user
 * can never clear.
 */
const DB_PUBLISHED_TYPES: ReadonlySet<string> = new Set(
  SITE_MAP.flatMap((page) => (page.document !== undefined ? [page.document] : [])),
);

interface TosStatus {
  accepted: boolean;
  requiredVersion: number | null;
  documentId: string | null;
}

function findAgreementForDocument(
  document: LegalDocumentItem,
  agreements: readonly UserAgreementItem[],
): UserAgreementItem | null {
  return agreements.find((agreement) => agreement.documentId === document.id) ?? null;
}

export const LegalDocumentsSection = (): ReactElement => {
  const { config } = useClientEnvironment();

  const clientConfig: LegalClientConfig = useMemo(
    () => ({
      baseUrl: config.apiUrl,
      getToken: getAccessToken,
    }),
    [config.apiUrl],
  );

  const currentLegal = useCurrentLegal({ clientConfig });
  const userAgreements = useUserAgreements({ clientConfig });

  const tosStatus = useQuery<TosStatus>({
    queryKey: ['auth', 'tos-status'],
    queryFn: async (): Promise<TosStatus> => {
      const api = getApiClient({
        baseUrl: config.apiUrl,
        getToken: getAccessToken,
      });
      return api.getTosStatus();
    },
  });

  const isLoading = currentLegal.isLoading || userAgreements.isLoading || tosStatus.isLoading;
  const error = currentLegal.error ?? userAgreements.error ?? tosStatus.error ?? null;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton height="1.5rem" width="9rem" />
        <Skeleton height="5rem" className="w-full rounded-md" />
        <Skeleton height="5rem" className="w-full rounded-md" />
      </div>
    );
  }

  if (error !== null) {
    return <Alert tone="danger">{error.message}</Alert>;
  }

  const documents = currentLegal.documents.filter((document) =>
    DB_PUBLISHED_TYPES.has(document.type),
  );
  const agreements = userAgreements.agreements;
  const tosStatusData = tosStatus.data;
  const hasPublishedTos =
    tosStatusData !== undefined && typeof tosStatusData.documentId === 'string';
  const tosAccepted = hasPublishedTos && tosStatusData.accepted;
  const tosBadgeTone = tosAccepted ? 'success' : hasPublishedTos ? 'warning' : 'info';
  const tosBadgeLabel = tosAccepted
    ? 'Accepted'
    : hasPublishedTos
      ? 'Action Required'
      : 'Not Published';
  const tosDescription = hasPublishedTos
    ? `Required version ${String(tosStatusData.requiredVersion ?? '-')}`
    : 'No Terms of Service document has been published yet.';

  return (
    <div className="space-y-4">
      <Card>
        <Card.Body>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Heading as="h4" size="sm">
                Terms Acceptance
              </Heading>
              <Text size="sm" tone="muted">
                {tosDescription}
              </Text>
            </div>
            <Badge tone={tosBadgeTone}>{tosBadgeLabel}</Badge>
          </div>
        </Card.Body>
      </Card>

      {documents.length === 0 ? (
        <EmptyState
          title="No legal documents"
          description="Published legal documents will appear here"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead>Agreement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((document) => {
              const agreement = findAgreementForDocument(document, agreements);
              return (
                <TableRow key={document.id}>
                  <TableCell>
                    <Text size="sm">{document.title}</Text>
                    <Text size="xs" tone="muted" className="font-mono">
                      {document.type}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text size="sm">v{document.version}</Text>
                  </TableCell>
                  <TableCell>
                    <Text size="sm">{formatDateTime(document.effectiveAt)}</Text>
                  </TableCell>
                  <TableCell>
                    {agreement !== null ? (
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone="success">Accepted</Badge>
                        <Text size="xs" tone="muted">
                          {formatDateTime(agreement.agreedAt)}
                        </Text>
                      </div>
                    ) : (
                      <Badge tone="warning">Not accepted</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
