// main/apps/web/src/pages/DocsPage.tsx
/**
 * Starter-Owned App Guide & Documentation Hub (`/docs`, `/docs/:section`)
 *
 * Prerendered over public SSR and also navigable from inside the authenticated
 * SPA (`⌘K`, Dashboard, and Auth headers). Keeps zero auth or optional-module
 * runtime imports so public SSR bundles remain lean and work identically in
 * Minimal Core and full workspace installs.
 */

import { Link, useLocation, useNavigate, useParams } from '@bslt/react/router';
import { Badge, Button, Card, Heading, Input, PageContainer, Text } from '@bslt/ui';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import {
  DOC_CHAPTERS,
  DOC_GROUP_LABELS,
  DOC_GROUP_ORDER,
  filterDocChapters,
  resolveDocChapter,
  type DocRouteLink,
} from './docsCatalog';
import './DocsPage.css';

import { PRODUCT_TAGLINE } from '#app/app/productMeta';
import { clientConfig } from '#app/config';

interface DocsPageProps {
  readonly sectionId?: string;
}

function accessBadgeTone(
  access: DocRouteLink['access'],
): 'info' | 'success' | 'neutral' | 'warning' {
  switch (access) {
    case 'Public':
      return 'success';
    case 'Signed-in':
      return 'info';
    case 'Workspace':
      return 'info';
    case 'Platform Admin':
      return 'warning';
    case 'Dev only':
      return 'neutral';
  }
}

function resolveSectionFromPath(pathname: string): string | undefined {
  if (!pathname.startsWith('/docs/')) return undefined;
  const segment = pathname.slice('/docs/'.length).split('/')[0];
  return segment !== undefined && segment.length > 0 ? segment : undefined;
}

export const DocsPage = ({ sectionId }: DocsPageProps): ReactElement => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [filterQuery, setFilterQuery] = useState('');

  const resolvedSlug = sectionId ?? params['section'] ?? resolveSectionFromPath(location.pathname);
  const activeChapter = resolveDocChapter(resolvedSlug);

  const visibleChapters = useMemo(() => filterDocChapters(filterQuery), [filterQuery]);

  const chapterIndex = DOC_CHAPTERS.findIndex((chapter) => chapter.id === activeChapter.id);
  const previousChapter = chapterIndex > 0 ? DOC_CHAPTERS[chapterIndex - 1] : undefined;
  const nextChapter =
    chapterIndex >= 0 && chapterIndex < DOC_CHAPTERS.length - 1
      ? DOC_CHAPTERS[chapterIndex + 1]
      : undefined;

  const handleSelectChapter = useCallback(
    (path: string): void => {
      navigate(path);
    },
    [navigate],
  );

  return (
    <PageContainer maxWidth={1180} className="docs-page">
      <div className="docs-layout" data-testid="docs-layout">
        <aside className="docs-sidebar" aria-label="App guide chapters">
          <div className="docs-sidebar__header">
            <Heading as="h2" size="md">
              {`${clientConfig.appName} Guide`}
            </Heading>
            <Text size="xs" tone="muted">
              {PRODUCT_TAGLINE}
            </Text>
            <div className="docs-sidebar__search">
              <Input
                type="search"
                value={filterQuery}
                placeholder="Filter topics & routes…"
                aria-label="Filter app guide topics"
                onChange={(event) => {
                  setFilterQuery(event.target.value);
                }}
              />
            </div>
          </div>

          <nav className="docs-sidebar__nav" aria-label="App guide navigation">
            {visibleChapters.length === 0 ? (
              <Text size="sm" tone="muted" className="docs-sidebar__empty">
                No matching guide chapters.
              </Text>
            ) : (
              DOC_GROUP_ORDER.map((group) => {
                const groupChapters = visibleChapters.filter((chapter) => chapter.group === group);
                if (groupChapters.length === 0) return null;
                return (
                  <div key={group} className="docs-sidebar__group">
                    <Text as="span" size="xs" tone="muted" className="docs-sidebar__group-label">
                      {DOC_GROUP_LABELS[group]}
                    </Text>
                    {groupChapters.map((chapter) => {
                      const isActive = chapter.id === activeChapter.id;
                      return (
                        <Button
                          key={chapter.id}
                          type="button"
                          variant={isActive ? 'secondary' : 'text'}
                          className="docs-sidebar__nav-button"
                          aria-current={isActive ? 'page' : undefined}
                          data-active={isActive ? 'true' : 'false'}
                          onClick={() => {
                            handleSelectChapter(chapter.path);
                          }}
                        >
                          {chapter.navLabel}
                        </Button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </nav>
        </aside>

        <article className="docs-content" aria-labelledby="docs-chapter-title">
          <header className="docs-hero">
            <div className="docs-hero__meta">
              <Text as="span" size="xs" tone="muted" className="docs-hero__eyebrow">
                {activeChapter.eyebrow}
              </Text>
              <Badge tone="info">{activeChapter.audience}</Badge>
            </div>
            <Heading as="h1" id="docs-chapter-title" size="2xl" className="docs-hero__title">
              {activeChapter.title}
            </Heading>
            <Text tone="muted" className="docs-hero__summary">
              {activeChapter.summary}
            </Text>
          </header>

          <section aria-labelledby="docs-routes-heading" className="docs-section">
            <div className="docs-section__header">
              <Heading as="h2" id="docs-routes-heading" size="md">
                Screens &amp; Live Routes
              </Heading>
              <Text size="sm" tone="muted">
                Jump directly into any live surface covered in this chapter.
              </Text>
            </div>
            <div className="docs-route-grid">
              {activeChapter.routes.map((route) => (
                <Link key={route.path} to={route.path} className="docs-route-card no-underline">
                  <div className="docs-route-card__top">
                    <Text as="span" size="sm" className="docs-route-card__label">
                      {route.label}
                    </Text>
                    <Badge tone={accessBadgeTone(route.access)}>{route.access}</Badge>
                  </div>
                  <Text as="code" size="xs" tone="muted" className="docs-route-card__path">
                    {route.path}
                  </Text>
                  <Text as="span" size="sm" tone="muted">
                    {route.description}
                  </Text>
                </Link>
              ))}
            </div>
          </section>

          <div className="docs-prose">
            {activeChapter.sections.map((section) => (
              <Card key={section.heading} className="docs-prose-card">
                <Heading as="h2" size="md">
                  {section.heading}
                </Heading>
                <Text tone="muted" size="sm">
                  {section.body}
                </Text>
                {section.bullets !== undefined && section.bullets.length > 0 ? (
                  <ul className="docs-prose-card__list">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>
                        <Text as="span" size="sm">
                          {bullet}
                        </Text>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {section.code !== undefined ? (
                  <pre className="docs-code-block">
                    <code>{section.code}</code>
                  </pre>
                ) : null}
              </Card>
            ))}
          </div>

          <nav aria-label="Chapter pagination" className="docs-pager">
            {previousChapter !== undefined ? (
              <Link to={previousChapter.path} className="docs-pager__link no-underline">
                <Text as="span" size="xs" tone="muted">
                  Previous chapter
                </Text>
                <Text as="span" size="sm" className="docs-pager__title">
                  {`← ${previousChapter.navLabel}`}
                </Text>
              </Link>
            ) : (
              <span />
            )}
            {nextChapter !== undefined ? (
              <Link
                to={nextChapter.path}
                className="docs-pager__link docs-pager__link--next no-underline"
              >
                <Text as="span" size="xs" tone="muted">
                  Next chapter
                </Text>
                <Text as="span" size="sm" className="docs-pager__title">
                  {`${nextChapter.navLabel} →`}
                </Text>
              </Link>
            ) : (
              <Link to="/register" className="docs-pager__link docs-pager__link--next no-underline">
                <Text as="span" size="xs" tone="muted">
                  Ready to try it?
                </Text>
                <Text as="span" size="sm" className="docs-pager__title">
                  Create your account →
                </Text>
              </Link>
            )}
          </nav>
        </article>
      </div>
    </PageContainer>
  );
};
