// main/apps/web/src/features/content/components/DocumentPage.tsx
/**
 * Renders one authored Markdown document as a page.
 *
 * The documents ship with the bundle rather than coming from the database:
 * they are prose, they change when the code changes, and they must render
 * fully at build time in the prerender, where effects never run. The
 * versioned, acceptance-tracked legal system still owns Terms and Privacy —
 * this is the reading surface for everything else.
 *
 * The chrome deliberately reuses LegalDocumentPage's stylesheet and structure,
 * so a file-owned /cookies is indistinguishable from the DB-owned /terms.
 */

import { Badge, Card, Heading, Markdown, PageContainer } from '@bslt/ui';

import { fillDocument } from '../lib/document';

import type { ReactElement } from 'react';

import '@pages/LegalDocumentPage.css';

export interface DocumentPageProps {
  /** The raw Markdown body, imported with `?raw`. */
  readonly body: string;
  /** Short badge label, e.g. "Cookies". Omitted → no badge row. */
  readonly badge?: string;
  /**
   * Page heading above the card. Omitted → the document's own `#` heading
   * carries the title, which avoids printing it twice.
   */
  readonly title?: string;
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
