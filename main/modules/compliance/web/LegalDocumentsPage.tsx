// main/modules/compliance/web/LegalDocumentsPage.tsx
import { useState, type ReactElement, type SyntheticEvent } from 'react';

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Heading,
  Input,
  Markdown,
  PageContainer,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  TextArea,
} from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import {
  DOCUMENT_TYPE_LABELS,
  PUBLISHABLE_DOCUMENT_TYPES,
  type PublishableDocumentType,
} from '../contract';
import enUsMessages from '../i18n/en-US.json';

import { useCurrentLegal, usePublishLegal } from './hooks';

import './LegalDocumentsPage.css';

function toDatetimeLocal(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function isPublishableDocumentType(value: string): value is PublishableDocumentType {
  return PUBLISHABLE_DOCUMENT_TYPES.some((candidate) => candidate === value);
}

export function LegalDocumentsPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const [type, setType] = useState<PublishableDocumentType>(PUBLISHABLE_DOCUMENT_TYPES[0]);
  const [title, setTitle] = useState('');
  const [effectiveAt, setEffectiveAt] = useState(() => toDatetimeLocal(new Date()));
  const [content, setContent] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const currentLegal = useCurrentLegal();
  const publishLegal = usePublishLegal();

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSuccessMessage(null);

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (trimmedTitle === '' || trimmedContent === '') return;

    const result = await publishLegal.publish({
      type,
      title: trimmedTitle,
      content: trimmedContent,
      effectiveAt: new Date(effectiveAt).toISOString(),
    });

    setSuccessMessage(
      t('compliance.publishedSuccess')
        .replace('{title}', result.document.title)
        .replace('{version}', String(result.document.version)),
    );
    setTitle('');
    setContent('');
    await currentLegal.refresh();
  };

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <Heading as="h1">{t('compliance.adminTitle')}</Heading>
          <Text tone="muted" size="sm">
            {t('compliance.adminSubtitle')}
          </Text>
        </div>
      </div>

      <div className="legal-documents-grid">
        <div>
          <Heading as="h2" size="md" className="mb-3">
            {t('compliance.currentDocumentsHeading')}
          </Heading>
          {currentLegal.isLoading ? (
            <div className="space-y-2">
              <Skeleton height="2.5rem" className="w-full" />
              <Skeleton height="2.5rem" className="w-full" />
            </div>
          ) : currentLegal.error !== null ? (
            <Alert tone="danger">{currentLegal.error.message}</Alert>
          ) : currentLegal.documents.length === 0 ? (
            <EmptyState
              title={t('compliance.emptyPublishedTitle')}
              description={t('compliance.emptyPublishedDescription')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('compliance.tableDocument')}</TableHead>
                  <TableHead>{t('compliance.tableVersion')}</TableHead>
                  <TableHead>{t('compliance.tableEffective')}</TableHead>
                  <TableHead>{t('compliance.tableCreated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentLegal.documents.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell>
                      <Text size="sm">{document.title}</Text>
                      <Text size="xs" tone="muted" className="font-mono">
                        {document.type}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <Badge tone="info">
                        {t('compliance.versionBadge').replace(
                          '{version}',
                          String(document.version),
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Text size="sm">{formatTime(document.effectiveAt)}</Text>
                    </TableCell>
                    <TableCell>
                      <Text size="sm">{formatTime(document.createdAt)}</Text>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <Card>
          <Card.Body>
            <Heading as="h2" size="md" className="mb-4">
              {t('compliance.publishVersionHeading')}
            </Heading>
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <div className="flex flex-col gap-1">
                <label htmlFor="legal-document-type" className="text-sm text-muted">
                  {t('compliance.fieldType')}
                </label>
                <Select
                  id="legal-document-type"
                  value={type}
                  onChange={(value: string) => {
                    if (isPublishableDocumentType(value)) setType(value);
                  }}
                  disabled={publishLegal.isPublishing}
                >
                  {PUBLISHABLE_DOCUMENT_TYPES.map((documentType) => (
                    <option key={documentType} value={documentType}>
                      {DOCUMENT_TYPE_LABELS[documentType]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="legal-document-title" className="text-sm text-muted">
                  {t('compliance.fieldTitle')}
                </label>
                <Input
                  id="legal-document-title"
                  value={title}
                  onChange={(event: { target: { value: string } }) => {
                    setTitle(event.target.value);
                  }}
                  disabled={publishLegal.isPublishing}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="legal-document-effective-at" className="text-sm text-muted">
                  {t('compliance.fieldEffectiveAt')}
                </label>
                <Input
                  id="legal-document-effective-at"
                  type="datetime-local"
                  value={effectiveAt}
                  onChange={(event: { target: { value: string } }) => {
                    setEffectiveAt(event.target.value);
                  }}
                  disabled={publishLegal.isPublishing}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="legal-document-content" className="text-sm text-muted">
                  {t('compliance.fieldContent')}
                </label>
                <TextArea
                  id="legal-document-content"
                  rows={10}
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                  }}
                  disabled={publishLegal.isPublishing}
                />
              </div>

              {content.trim() !== '' && (
                <div className="flex flex-col gap-1">
                  <Text size="sm" tone="muted">
                    {t('compliance.previewHeading')}
                  </Text>
                  <div className="legal-documents-preview">
                    <Markdown>{content}</Markdown>
                  </div>
                </div>
              )}

              {publishLegal.error !== null && (
                <Alert tone="danger">{publishLegal.error.message}</Alert>
              )}
              {successMessage !== null && <Alert tone="success">{successMessage}</Alert>}

              <Button
                type="submit"
                disabled={publishLegal.isPublishing || title.trim() === '' || content.trim() === ''}
              >
                {publishLegal.isPublishing
                  ? t('compliance.publishingButton')
                  : t('compliance.publishButton')}
              </Button>
            </form>
          </Card.Body>
        </Card>
      </div>
    </PageContainer>
  );
}
