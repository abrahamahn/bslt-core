// main/modules/devtools/web/HomePage.tsx
import { useMemo, type ReactElement } from 'react';

import { useDelayedFlag } from '@bslt/react/hooks';
import { Link, useSearchParams } from '@bslt/react/router';
import { Heading, Markdown, PageContainer, Skeleton, Text } from '@bslt/ui';
import { useAppRightSidebar, useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { docCategories, docsMeta, type DocKey } from './docsMeta';
import { useDocContent } from './hooks';
import './DevtoolsPages.css';

function isDocKey(value: string): value is DocKey {
  return value in docsMeta;
}

export interface HomeDocViewerProps {
  selectedDoc: string | null;
  content: string | null;
  isLoading: boolean;
}

export const HomeDocViewer = ({
  selectedDoc,
  content,
  isLoading,
}: HomeDocViewerProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const showSkeleton = useDelayedFlag(isLoading, 150);

  if (selectedDoc === null) {
    return (
      <div className="p-2 flex flex-col gap-3">
        <Heading as="h2" size="lg">
          {t('devtools.docs.welcomeHeading')}
        </Heading>
        <Text tone="muted">{t('devtools.docs.welcomeBody')}</Text>
      </div>
    );
  }

  return (
    <div className="p-2">
      {showSkeleton ? (
        <div className="flex flex-col gap-3">
          <Skeleton height="2rem" width="12rem" />
          <Skeleton height="1rem" className="w-full" />
          <Skeleton height="1rem" width="75%" />
          <Skeleton height="1rem" width="83.333%" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Markdown>{content ?? ''}</Markdown>
        </div>
      )}
    </div>
  );
};

export const HomeRightSidebar = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [searchParams] = useSearchParams();
  const activeDoc = searchParams.get('doc') ?? 'readme';

  const groupedDocs = useMemo(() => {
    const groups = new Map<string, { key: string; label: string }[]>();
    for (const [key, meta] of Object.entries(docsMeta)) {
      const existing = groups.get(meta.category) ?? [];
      existing.push({ key, label: meta.label });
      groups.set(meta.category, existing);
    }
    for (const [cat, docs] of groups) {
      docs.sort((a, b) => {
        if (a.label === 'Overview') return -1;
        if (b.label === 'Overview') return 1;
        return a.label.localeCompare(b.label);
      });
      groups.set(cat, docs);
    }
    return groups;
  }, []);

  return (
    <nav className="p-4 flex flex-col gap-4" aria-label={t('devtools.docs.sidebarAria')}>
      <Text tone="muted" className="text-xs uppercase tracking-wide">
        {t('devtools.docs.sidebarHeading')}
      </Text>
      {docCategories.map((cat) => {
        const docs = groupedDocs.get(cat.key);
        if (docs === undefined || docs.length === 0) return null;
        return (
          <div key={cat.key} className="flex flex-col gap-1">
            <Text size="sm" className="font-medium">
              {cat.label}
            </Text>
            {docs.map((doc) => {
              const isActive = doc.key === activeDoc;
              const href = `/clean?doc=${doc.key}`;
              return (
                <Link
                  key={doc.key}
                  to={href}
                  className={`pl-2 text-sm ${isActive ? 'font-medium' : 'text-muted'}`}
                >
                  {doc.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
};

const ProductHome = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);

  const metrics = [
    { label: t('devtools.home.metricAuthLabel'), value: t('devtools.home.metricAuthValue') },
    { label: t('devtools.home.metricTasksLabel'), value: t('devtools.home.metricTasksValue') },
    { label: t('devtools.home.metricChecksLabel'), value: t('devtools.home.metricChecksValue') },
  ];

  const capabilities = [
    {
      title: t('devtools.home.capAccessTitle'),
      description: t('devtools.home.capAccessBody'),
    },
    {
      title: t('devtools.home.capWorkflowTitle'),
      description: t('devtools.home.capWorkflowBody'),
    },
    {
      title: t('devtools.home.capOpsTitle'),
      description: t('devtools.home.capOpsBody'),
    },
  ];

  const workflowSteps = [
    t('devtools.home.step1'),
    t('devtools.home.step2'),
    t('devtools.home.step3'),
    t('devtools.home.step4'),
  ];

  const defaultAppName = t('devtools.home.defaultAppName');
  const viteEnv = import.meta.env as Readonly<Record<string, unknown>> | undefined;
  const rawAppName = viteEnv?.['VITE_APP_NAME'];
  const appName =
    typeof rawAppName === 'string' && rawAppName.trim() !== '' ? rawAppName.trim() : defaultAppName;

  return (
    <PageContainer className="home-page" maxWidth={1180}>
      <section className="home-page__hero" aria-labelledby="home-page-title">
        <div className="home-page__hero-copy">
          <Text as="p" className="home-page__eyebrow">
            {t('devtools.home.eyebrow')}
          </Text>
          <Heading as="h1" id="home-page-title" className="home-page__title">
            {appName}
          </Heading>
          <Text className="home-page__subtitle">{t('devtools.home.subtitle')}</Text>
          <div className="home-page__actions">
            <Link to="/register" className="btn btn-primary btn-medium no-underline">
              {t('devtools.home.createAccount')}
            </Link>
            <Link to="/clean?doc=readme" className="btn btn-secondary btn-medium no-underline">
              {t('devtools.home.readDocs')}
            </Link>
          </div>
        </div>

        <div className="home-page__preview" aria-label={t('devtools.home.previewAria')}>
          <div className="home-page__preview-topbar">
            <span>{t('devtools.home.previewDashboard')}</span>
            <strong>{t('devtools.home.previewReady')}</strong>
          </div>
          <div className="home-page__preview-grid">
            {metrics.map((metric) => (
              <div key={metric.label} className="home-page__metric">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
          <div className="home-page__preview-panel">
            <div>
              <span>{t('devtools.home.gettingStarted')}</span>
              <strong>{t('devtools.home.readyFirstFeature')}</strong>
            </div>
            <div className="home-page__progress" aria-hidden="true">
              <span />
            </div>
          </div>
        </div>
      </section>

      <section className="home-page__capabilities" aria-label={t('devtools.home.capabilitiesAria')}>
        {capabilities.map((capability) => (
          <article key={capability.title} className="home-page__capability">
            <Heading as="h2" size="md">
              {capability.title}
            </Heading>
            <Text>{capability.description}</Text>
          </article>
        ))}
      </section>

      <section className="home-page__workflow" aria-label={t('devtools.home.workflowAria')}>
        <div>
          <Text as="p" className="home-page__eyebrow">
            {t('devtools.home.workflowEyebrow')}
          </Text>
          <Heading as="h2" size="lg">
            {t('devtools.home.workflowHeading')}
          </Heading>
        </div>
        <ol>
          {workflowSteps.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
    </PageContainer>
  );
};

export const HomePage = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const docParam = searchParams.get('doc');
  const isDocsMode = docParam !== null;
  const selectedDoc: DocKey = docParam !== null && isDocKey(docParam) ? docParam : 'readme';
  const { content, isLoading } = useDocContent(selectedDoc);
  const docsSidebar = useMemo(() => (isDocsMode ? <HomeRightSidebar /> : null), [isDocsMode]);
  useAppRightSidebar(docsSidebar);

  if (isDocsMode) {
    return <HomeDocViewer selectedDoc={selectedDoc} content={content} isLoading={isLoading} />;
  }

  return <ProductHome />;
};
