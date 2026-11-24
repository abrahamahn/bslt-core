// main/modules/devtools/web/DevEmailInboxPage.tsx
import { useState, type ReactElement } from 'react';

import { Link } from '@bslt/react/router';
import { Alert, Badge, Button, Card, EmptyState, Heading, PageContainer, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { useDevEmails } from './hooks';

import './DevtoolsPages.css';

export function DevEmailInboxPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const { emails, isLoading, error, isClearing, refresh, clearInbox } = useDevEmails();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'html' | 'text'>('html');

  const selectedEmail = emails.find((item) => item.id === selectedId) ?? emails[0] ?? null;

  return (
    <PageContainer className="dev-inbox-page" maxWidth={1280}>
      <header className="dev-inbox-header">
        <div className="dev-inbox-header__copy">
          <Badge tone="info">{t('devtools.sandbox.badge')}</Badge>
          <Heading as="h1" size="xl">
            {t('devtools.emailInbox.heading')}
          </Heading>
          <Text tone="muted" size="sm">
            {t('devtools.emailInbox.subtitle')}
          </Text>
        </div>
        <div className="dev-inbox-header__actions">
          <Link to="/developer/billing-sandbox">
            <Button variant="secondary" size="small">
              {t('devtools.emailInbox.billingSandboxLink')}
            </Button>
          </Link>
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={isLoading}
            onClick={() => {
              void refresh();
            }}
          >
            {isLoading ? t('devtools.emailInbox.refreshing') : t('devtools.emailInbox.refresh')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={isClearing || emails.length === 0}
            onClick={() => {
              clearInbox();
            }}
          >
            {isClearing ? t('devtools.emailInbox.clearing') : t('devtools.emailInbox.clear')}
          </Button>
        </div>
      </header>

      {error !== null ? <Alert tone="danger">{error.message}</Alert> : null}

      {emails.length === 0 ? (
        <Card className="dev-inbox-empty">
          <EmptyState
            title={t('devtools.emailInbox.emptyTitle')}
            description={t('devtools.emailInbox.emptyDescription')}
          />
        </Card>
      ) : (
        <div className="dev-inbox-split">
          <aside className="dev-inbox-list" aria-label={t('devtools.emailInbox.listAria')}>
            {emails.map((email) => {
              const isSelected = selectedEmail?.id === email.id;
              const linkBadge =
                email.links.length === 1
                  ? t('devtools.emailInbox.linkCountSingular')
                  : t('devtools.emailInbox.linkCountPlural', { count: String(email.links.length) });
              return (
                <Button
                  key={email.id}
                  type="button"
                  variant={isSelected ? 'secondary' : 'text'}
                  className="dev-inbox-list__item"
                  data-active={isSelected ? 'true' : 'false'}
                  onClick={() => {
                    setSelectedId(email.id);
                  }}
                >
                  <div className="dev-inbox-list__item-top">
                    <Text as="span" size="sm" className="dev-inbox-list__subject">
                      {email.subject}
                    </Text>
                    {email.links.length > 0 ? <Badge tone="info">{linkBadge}</Badge> : null}
                  </div>
                  <Text as="span" size="xs" tone="muted">
                    {t('devtools.emailInbox.toPrefix', { recipients: email.to.join(', ') })}
                  </Text>
                </Button>
              );
            })}
          </aside>

          {selectedEmail !== null ? (
            <Card className="dev-inbox-preview">
              <div className="dev-inbox-preview__header">
                <div className="dev-inbox-header__copy">
                  <Heading as="h2" size="md">
                    {selectedEmail.subject}
                  </Heading>
                  <Text size="xs" tone="muted">
                    {t('devtools.emailInbox.metaLine', {
                      recipients: selectedEmail.to.join(', '),
                      sentAt: selectedEmail.sentAt,
                    })}
                  </Text>
                </div>
                <div className="dev-inbox-header__actions">
                  <Button
                    type="button"
                    size="small"
                    variant={viewMode === 'html' ? 'primary' : 'secondary'}
                    disabled={selectedEmail.html === null}
                    onClick={() => {
                      setViewMode('html');
                    }}
                  >
                    {t('devtools.emailInbox.htmlPreview')}
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant={viewMode === 'text' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setViewMode('text');
                    }}
                  >
                    {t('devtools.emailInbox.plainText')}
                  </Button>
                </div>
              </div>

              {selectedEmail.links.length > 0 ? (
                <div className="dev-inbox-links">
                  <Text size="xs" tone="muted" className="dev-inbox-list__subject">
                    {t('devtools.emailInbox.extractedLinks')}
                  </Text>
                  <div className="dev-inbox-links__list">
                    {selectedEmail.links.map((href) => (
                      <a
                        key={href}
                        href={href}
                        className="dev-inbox-links__anchor"
                        rel="noopener noreferrer"
                      >
                        {href}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              {viewMode === 'html' && selectedEmail.html !== null ? (
                <iframe
                  title={t('devtools.emailInbox.iframeTitle', { subject: selectedEmail.subject })}
                  sandbox=""
                  srcDoc={selectedEmail.html}
                  className="dev-inbox-preview__frame"
                />
              ) : (
                <pre className="dev-inbox-preview__text">
                  {selectedEmail.text ?? t('devtools.emailInbox.noPlainText')}
                </pre>
              )}
            </Card>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
