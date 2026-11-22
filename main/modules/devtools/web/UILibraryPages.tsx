// main/modules/devtools/web/UILibraryPages.tsx
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';

import { useKeyboardShortcut } from '@bslt/react/hooks';
import { useNavigate, useSearchParams } from '@bslt/react/router';
import {
  Button,
  Heading,
  IconButton,
  Markdown,
  MenuItem,
  PageContainer,
  ScrollArea,
  SidePeek,
  Text,
} from '@bslt/ui';
import { useAppRightSidebar, useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import {
  componentCatalog,
  getAllCategories,
  getComponentsByCategory,
  type ComponentDemo,
} from './catalog';

import './DevtoolsPages.css';

const SIDE_PEEK_MARKDOWN = `This is a **Notion-style side peek** panel. It slides in from the right and keeps the background visible.

## Features
- URL-synced state (try refreshing!)
- Smooth CSS transitions
- Click overlay or press Escape to close
- Fullscreen toggle button in header
- Multiple size variants (sm, md, lg, xl, full)
- Focus trap for accessibility

## Usage
\`\`\`tsx
import { SidePeek, useSidePeek } from '@bslt/ui';

const { isOpen, open, close } = useSidePeek();

<button onClick={() => open('/details')}>
  Open Side Peek
</button>

<SidePeek.Root open={isOpen} onClose={close}>
  <SidePeek.Header>
    <SidePeek.Title>Title</SidePeek.Title>
    <SidePeek.Close />
  </SidePeek.Header>
  <SidePeek.Content>
    Your content here
  </SidePeek.Content>
</SidePeek.Root>
\`\`\``;

export const SidePeekUILibraryContent = (): ReactElement => {
  return (
    <div className="space-y-4">
      <Markdown>{SIDE_PEEK_MARKDOWN}</Markdown>
    </div>
  );
};

export interface SidePeekUILibraryLayoutProps {
  open: boolean;
  onClose: () => void;
}

export const SidePeekUILibraryLayout = ({
  open,
  onClose,
}: SidePeekUILibraryLayoutProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleExpand = useCallback((): void => {
    setIsFullscreen((prev) => !prev);
  }, []);

  return (
    <SidePeek.Root open={open} onClose={onClose} size={isFullscreen ? 'full' : 'md'}>
      <SidePeek.Header>
        <SidePeek.Title>{t('devtools.uiLibrary.sidePeekTitle')}</SidePeek.Title>
        <IconButton
          variant="text"
          size="small"
          onClick={handleExpand}
          aria-label={t('devtools.uiLibrary.toggleFullscreenAria')}
          className="side-peek-close"
        >
          {isFullscreen
            ? t('devtools.uiLibrary.collapseGlyph')
            : t('devtools.uiLibrary.expandGlyph')}
        </IconButton>
        <SidePeek.Close />
      </SidePeek.Header>
      <SidePeek.Content>
        <SidePeekUILibraryContent />
      </SidePeek.Content>
    </SidePeek.Root>
  );
};

export const SidePeekUILibraryPage = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const navigate = useNavigate();

  return (
    <div className="h-screen overflow-auto">
      <PageContainer>
        <div className="space-y-4">
          <Heading as="h1" size="lg">
            {t('devtools.uiLibrary.sidePeekTitle')}
          </Heading>
          <Button
            type="button"
            variant="text"
            onClick={() => {
              navigate('/ui-library');
            }}
          >
            {t('devtools.uiLibrary.backToLibrary')}
          </Button>
          <SidePeekUILibraryContent />
        </div>
      </PageContainer>
    </div>
  );
};

export interface UILibraryPreviewAreaProps {
  selectedComponent: ComponentDemo | null;
}

export const UILibraryPreviewArea = ({
  selectedComponent,
}: UILibraryPreviewAreaProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);

  return (
    <div className="flex-1 min-w-0 flex-col">
      <ScrollArea className="scroll-flex">
        <div className="min-h-full flex-col">
          <div className="panel-header">
            <div>
              <Heading as="h2" size="md">
                {selectedComponent !== null
                  ? selectedComponent.name
                  : t('devtools.uiLibrary.selectComponentHeading')}
              </Heading>
              {selectedComponent !== null ? (
                <Text tone="muted">{selectedComponent.description}</Text>
              ) : null}
            </div>
          </div>

          {selectedComponent !== null ? (
            <div className="grid-auto" data-story-id={selectedComponent.id}>
              {selectedComponent.variants.map((variant) => (
                <div
                  key={`${selectedComponent.id}-${variant.name}`}
                  className="variant-card border-current"
                >
                  <div className="variant-card-header">
                    <div>
                      <Heading as="h3" size="sm">
                        {variant.name}
                      </Heading>
                      <Text tone="muted" className="text-sm">
                        {variant.description}
                      </Text>
                    </div>
                    <Button
                      size="small"
                      variant="text"
                      className="demo-copy-button"
                      onClick={() => {
                        void navigator.clipboard.writeText(variant.code);
                      }}
                      title={t('devtools.uiLibrary.copyCodeTitle')}
                    >
                      {t('devtools.uiLibrary.copyGlyph')}
                    </Button>
                  </div>
                  <div className="preview-box border-dashed border-current">{variant.render()}</div>
                  <details className="code-details">
                    <summary>{t('devtools.uiLibrary.viewCode')}</summary>
                    <pre>
                      <code>{variant.code}</code>
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Text tone="muted">{t('devtools.uiLibrary.emptyPrompt')}</Text>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

interface UILibraryRightSidebarProps {
  categories: string[];
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
  components: ComponentDemo[];
  selectedComponent: ComponentDemo | null;
  onSelectComponent: (comp: ComponentDemo) => void;
}

const UILibraryRightSidebar = ({
  categories,
  activeCategory,
  onCategoryChange,
  components,
  selectedComponent,
  onSelectComponent,
}: UILibraryRightSidebarProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-1 p-2 border-b">
        {categories.map((cat) => (
          <Button
            key={cat}
            variant={activeCategory === cat ? 'primary' : 'secondary'}
            size="small"
            onClick={() => {
              onCategoryChange(cat);
            }}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </Button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="flex-col gap-1 p-2">
          <Text tone="muted" className="text-xs px-1 pb-1">
            {components.length === 1
              ? t('devtools.uiLibrary.componentCountSingular')
              : t('devtools.uiLibrary.componentCountPlural', {
                  count: String(components.length),
                })}
          </Text>
          {components.map((comp) => (
            <MenuItem
              key={comp.id}
              onClick={() => {
                onSelectComponent(comp);
              }}
              data-selected={selectedComponent?.id === comp.id}
            >
              <Text>{comp.name}</Text>
              <Text tone="muted" className="text-xs">
                {comp.variants.length === 1
                  ? t('devtools.uiLibrary.variantCountSingular')
                  : t('devtools.uiLibrary.variantCountPlural', {
                      count: String(comp.variants.length),
                    })}
              </Text>
            </MenuItem>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

export const UILibraryPage = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const requestedStoryId = searchParams.get('story');
  const initialStory =
    requestedStoryId !== null ? (componentCatalog[requestedStoryId] ?? null) : null;

  const [activeCategory, setActiveCategory] = useState<string>(
    initialStory?.category ?? 'elements',
  );
  const [selectedComponent, setSelectedComponent] = useState<ComponentDemo | null>(initialStory);

  useEffect(() => {
    if (requestedStoryId === null) return;
    const match = componentCatalog[requestedStoryId] ?? null;
    if (match !== null) {
      setActiveCategory(match.category);
      setSelectedComponent(match);
    }
  }, [requestedStoryId]);

  const categories = useMemo(() => getAllCategories(), []);
  const componentsInCategory = useMemo(
    () => getComponentsByCategory(activeCategory),
    [activeCategory],
  );

  const handleCategoryChange = useCallback((cat: string): void => {
    setActiveCategory(cat);
    setSelectedComponent(null);
  }, []);

  const handleSelectComponent = useCallback((comp: ComponentDemo): void => {
    setSelectedComponent(comp);
  }, []);

  useKeyboardShortcut({
    key: 'Escape',
    handler: () => {
      setSelectedComponent(null);
    },
    skipInputs: true,
  });

  const rightSidebarContent = useMemo(
    () => (
      <UILibraryRightSidebar
        categories={categories}
        activeCategory={activeCategory}
        onCategoryChange={handleCategoryChange}
        components={componentsInCategory}
        selectedComponent={selectedComponent}
        onSelectComponent={handleSelectComponent}
      />
    ),
    [
      categories,
      activeCategory,
      handleCategoryChange,
      componentsInCategory,
      selectedComponent,
      handleSelectComponent,
    ],
  );

  useAppRightSidebar(rightSidebarContent);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        <UILibraryPreviewArea selectedComponent={selectedComponent} />
      </div>
    </div>
  );
};
