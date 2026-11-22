// main/modules/devtools/web/docsMeta.ts
export type DocKey = string;

export interface DocMeta {
  readonly label: string;
  readonly category: string;
}

export interface DocCategoryDef {
  readonly key: string;
  readonly label: string;
}

const DOCS_PREFIX = '../../../../docs/';
const viteEnv = import.meta.env as Readonly<Record<string, unknown>> | undefined;
const DEV_TOOLS_BUILD = viteEnv?.['DEV'] === true;

const docGlob: Record<string, () => Promise<string>> = DEV_TOOLS_BUILD
  ? import.meta.glob<string>('../../../../docs/**/*.md', {
      query: '?raw',
      import: 'default',
    })
  : {};

const rootReadmeGlob: Record<string, () => Promise<string>> = DEV_TOOLS_BUILD
  ? import.meta.glob<string>('../../../../README.md', {
      query: '?raw',
      import: 'default',
    })
  : {};

const CATEGORY_LABELS: Record<string, string> = {
  root: 'Home',
  docs: 'Docs',
  deploy: 'Deployment',
  dev: 'Development',
  log: 'Changelog',
  quickstart: 'Quick Start',
  reference: 'Reference',
  specs: 'Specifications',
  todo: 'Roadmap',
};

const CATEGORY_ORDER = [
  'root',
  'docs',
  'quickstart',
  'specs',
  'dev',
  'deploy',
  'reference',
  'todo',
  'log',
];

function formatLabel(filename: string): string {
  const name = filename.replace(/\.md$/u, '');
  if (name === 'README') return 'Overview';
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function deriveKey(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.md$/u, '');
  const parts = withoutExt.split('/');
  const normalizedPath = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');

  if (parts.length === 1) {
    return `docs-${normalizedPath}`;
  }
  return normalizedPath;
}

const loaderMap = new Map<DocKey, () => Promise<string>>();
const metaRecord: Record<DocKey, DocMeta> = {};

for (const [_globPath, loader] of Object.entries(rootReadmeGlob)) {
  const key = 'readme';
  loaderMap.set(key, loader);
  metaRecord[key] = { label: 'Readme', category: 'root' };
}

for (const [globPath, loader] of Object.entries(docGlob)) {
  const relativePath = globPath.slice(DOCS_PREFIX.length);
  const parts = relativePath.split('/');

  let category: string;
  let filename: string;

  if (parts.length === 1) {
    category = 'docs';
    filename = parts[0] ?? '';
  } else {
    category = parts[0] ?? 'docs';
    filename = parts[parts.length - 1] ?? '';
  }

  const key = deriveKey(relativePath);
  loaderMap.set(key, loader);
  metaRecord[key] = { label: formatLabel(filename), category };
}

export const docsMeta: Record<DocKey, DocMeta> = metaRecord;

export const docCategories: DocCategoryDef[] = CATEGORY_ORDER.filter((cat) =>
  Object.values(metaRecord).some((m) => m.category === cat),
).map((cat) => ({
  key: cat,
  label: CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1),
}));

export async function loadDocContent(key: DocKey): Promise<string> {
  const loader = loaderMap.get(key);
  if (loader === undefined) {
    throw new Error(`Unknown doc key: ${key}`);
  }
  return loader();
}
