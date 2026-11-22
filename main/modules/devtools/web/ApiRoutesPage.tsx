// main/modules/devtools/web/ApiRoutesPage.tsx
import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';

import {
  Badge,
  Button,
  Card,
  Heading,
  Input,
  PageContainer,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  TextArea,
} from '@bslt/ui';
import { useAppRightSidebar, useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { apiRouteInventory, getApiRouteCoverage, type ApiRouteDefinition } from './routeInventory';
import './DevtoolsPages.css';

type VisibilityFilter = 'ALL' | 'PUBLIC' | 'PROTECTED';
type MethodFilter = 'ALL' | ApiRouteDefinition['method'];
type FrontendFilter = 'ALL' | 'CALLER' | 'MISSING';
type RouteGroupMode = 'CATEGORY' | 'MODULE' | 'NONE';
type JsonRecord = Record<string, string | number | boolean | null | undefined>;
type SortKey = 'auth' | 'method' | 'module' | 'path' | 'product' | 'smoke';
type SortDirection = 'asc' | 'desc';
type SortState = {
  direction: SortDirection;
  key: SortKey;
};
type RouteGroup = {
  id: string;
  label: string;
  routes: ApiRouteDefinition[];
};

type ApiRouteRequestResult = {
  body: string;
  elapsedMs: number;
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
};

const ROUTES = [...apiRouteInventory].sort((a, b) => {
  const pathCompare = a.path.localeCompare(b.path);
  if (pathCompare !== 0) return pathCompare;
  return a.method.localeCompare(b.method);
});

const DEFAULT_SELECTED_ROUTE_KEY = routeKey(ROUTES[0] as ApiRouteDefinition);
const PUBLIC_ROUTE_COUNT = ROUTES.filter((route) => route.public).length;
const PROTECTED_ROUTE_COUNT = ROUTES.length - PUBLIC_ROUTE_COUNT;
const SMOKE_COVERED_ROUTE_COUNT = ROUTES.filter(
  (route) => getApiRouteCoverage(route).smoke !== 'Pending',
).length;
const FRONTEND_CALLER_ROUTE_COUNT = ROUTES.filter(
  (route) => getApiRouteCoverage(route).frontend === 'Product workflow',
).length;

const ROUTE_METHODS: readonly ApiRouteDefinition['method'][] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
];
const ALL_METHODS: readonly MethodFilter[] = ['ALL', ...ROUTE_METHODS];
const METHOD_SORT_ORDER = new Map<ApiRouteDefinition['method'], number>(
  ROUTE_METHODS.map((method, index) => [method, index]),
);
const ROUTE_CATEGORY_LABELS = new Map<string, string>([
  ['activities', 'Activities'],
  ['admin', 'Admin'],
  ['auth', 'Authentication'],
  ['billing', 'Billing'],
  ['email', 'Email'],
  ['feature-flags', 'Feature flags'],
  ['files', 'Files'],
  ['invitations', 'Invitations'],
  ['legal', 'Legal'],
  ['notifications', 'Notifications'],
  ['tenants', 'Tenants'],
  ['users', 'Users'],
  ['webhooks', 'Webhooks'],
]);
const MODULE_LABELS = new Map<string, string>([
  ['auth', 'Authentication'],
  ['data-export', 'Data export'],
  ['flags', 'Feature flags'],
]);

function routeKey(route: ApiRouteDefinition): string {
  return `${route.method}:${route.path}`;
}

function pluralizeRouteCount(count: number): string {
  return `${String(count)} route${count === 1 ? '' : 's'}`;
}

function formatGroupSummary(groupMode: RouteGroupMode, groupCount: number): string {
  if (groupMode === 'NONE') return '';
  const label = groupMode === 'CATEGORY' ? 'category' : 'module';
  return ` across ${String(groupCount)} ${label} group${groupCount === 1 ? '' : 's'}`;
}

function formatRouteGroupLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getRouteCategoryKey(route: ApiRouteDefinition): string {
  const segments = route.path.split('/').filter(Boolean);
  if (segments[0] === 'api' && segments[1] !== undefined) {
    return segments[1];
  }
  return route.module;
}

function getRouteCategoryLabel(route: ApiRouteDefinition): string {
  const categoryKey = getRouteCategoryKey(route);
  return ROUTE_CATEGORY_LABELS.get(categoryKey) ?? formatRouteGroupLabel(categoryKey);
}

function getRouteModuleLabel(route: ApiRouteDefinition): string {
  return MODULE_LABELS.get(route.module) ?? formatRouteGroupLabel(route.module);
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function groupRoutes(routes: ApiRouteDefinition[], groupMode: RouteGroupMode): RouteGroup[] {
  if (groupMode === 'NONE') {
    return [{ id: 'all', label: 'All routes', routes }];
  }

  const groups = new Map<string, RouteGroup>();
  for (const route of routes) {
    const groupKey =
      groupMode === 'CATEGORY' ? getRouteCategoryKey(route) : `module:${route.module}`;
    const groupLabel =
      groupMode === 'CATEGORY' ? getRouteCategoryLabel(route) : getRouteModuleLabel(route);
    const group = groups.get(groupKey) ?? { id: groupKey, label: groupLabel, routes: [] };
    group.routes.push(route);
    groups.set(groupKey, group);
  }

  return Array.from(groups.values()).sort((a, b) => compareText(a.label, b.label));
}

function methodTone(method: string): 'success' | 'info' | 'warning' | 'danger' {
  if (method === 'GET') return 'success';
  if (method === 'POST') return 'info';
  if (method === 'PUT' || method === 'PATCH') return 'warning';
  if (method === 'DELETE') return 'danger';
  return 'info';
}

function coverageTone(status: string): 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'Pending' || status === 'No product workflow') return 'warning';
  if (status === 'Mutation smoke' || status === 'External callback') return 'info';
  return 'success';
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/u, '');
}

function buildApiUrl(apiBaseUrl: string, resolvedPath: string): string {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  if (baseUrl === '') return resolvedPath;
  if (baseUrl.endsWith('/api') && resolvedPath.startsWith('/api/')) {
    return `${baseUrl}${resolvedPath.slice('/api'.length)}`;
  }
  return `${baseUrl}${resolvedPath}`;
}

function appendQueryString(url: string, query: JsonRecord): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }

  const queryString = params.toString();
  if (queryString === '') return url;
  return `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
}

function extractPathParams(path: string): string[] {
  const params: string[] = [];
  const seen = new Set<string>();
  for (const match of path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/gu)) {
    const name = match[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    params.push(name);
  }
  return params;
}

function sampleParamValue(name: string): string {
  const lowered = name.toLowerCase();
  if (lowered.includes('tenant')) return '11111111-1111-4111-8111-111111111111';
  if (lowered.includes('user')) return '22222222-2222-4222-8222-222222222222';
  if (lowered.includes('delivery')) return '33333333-3333-4333-8333-333333333333';
  if (lowered.includes('invitation')) return '44444444-4444-4444-8444-444444444444';
  if (lowered.includes('token')) return 'sample-token';
  if (lowered.includes('key')) return 'sample-key';
  if (lowered.includes('job')) return 'sample-job';
  if (lowered === 'id' || lowered.endsWith('id')) return '55555555-5555-4555-8555-555555555555';
  return `sample-${name}`;
}

function createDefaultPathParams(path: string): Record<string, string> {
  return Object.fromEntries(extractPathParams(path).map((name) => [name, sampleParamValue(name)]));
}

function routeSupportsBody(route: ApiRouteDefinition): boolean {
  return route.method !== 'GET';
}

function createDefaultBody(route: ApiRouteDefinition): string {
  return routeSupportsBody(route) ? '{}' : '';
}

function resolvePath(path: string, pathParams: Record<string, string>): string {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/gu, (_match, name: string) => {
    const value = pathParams[name]?.trim();
    if (value === undefined || value === '') {
      throw new Error(`${name} path parameter is required`);
    }
    return encodeURIComponent(value);
  });
}

function parseJson(input: string, label: string): unknown {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function parseJsonRecord(input: string, label: string): JsonRecord {
  const parsed = parseJson(input, label);
  if (parsed === undefined) return {};
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as JsonRecord;
}

function parseHeaders(input: string): Headers {
  const record = parseJsonRecord(input, 'Headers JSON');
  const headers = new Headers();
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    headers.set(key, String(value));
  }
  return headers;
}

async function readResponseBody(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text().catch(() => '');
  if (!contentType.includes('application/json') || text === '') return text;
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

function isCsrfFailure(response: Response, body: string): boolean {
  return response.status === 403 && body.toLowerCase().includes('csrf');
}

async function fetchCsrfToken(apiBaseUrl: string): Promise<string> {
  const response = await fetch(buildApiUrl(apiBaseUrl, '/api/csrf-token'), {
    method: 'GET',
    credentials: 'include',
  });
  const body = (await response.json().catch(() => ({}))) as {
    token?: unknown;
    message?: unknown;
  };
  if (!response.ok || typeof body.token !== 'string' || body.token === '') {
    throw new Error(typeof body.message === 'string' ? body.message : 'Failed to fetch CSRF token');
  }
  return body.token;
}

function formatRouteRequestSnippet(route: ApiRouteDefinition): string {
  const payloadLines = [
    `path: '${route.path}',`,
    `method: '${route.method}',`,
    ...(extractPathParams(route.path).length > 0
      ? [
          `// Replace ${extractPathParams(route.path)
            .map((param) => `:${param}`)
            .join(', ')} first.`,
        ]
      : []),
    ...(routeSupportsBody(route) ? ['body: {},'] : []),
  ];
  return `client.request({\n  ${payloadLines.join('\n  ')}\n});`;
}

function selectedRouteLabel(route: ApiRouteDefinition): string {
  return `${route.method} ${route.path}`;
}

function compareRoutesBySort(
  a: ApiRouteDefinition,
  b: ApiRouteDefinition,
  sort: SortState,
): number {
  const aCoverage = getApiRouteCoverage(a);
  const bCoverage = getApiRouteCoverage(b);

  let result = 0;
  if (sort.key === 'method') {
    result =
      (METHOD_SORT_ORDER.get(a.method) ?? Number.MAX_SAFE_INTEGER) -
      (METHOD_SORT_ORDER.get(b.method) ?? Number.MAX_SAFE_INTEGER);
  } else if (sort.key === 'auth') {
    result = Number(!a.public) - Number(!b.public);
  } else if (sort.key === 'path') {
    result = compareText(a.path, b.path);
  } else if (sort.key === 'module') {
    result = compareText(a.module, b.module);
  } else if (sort.key === 'smoke') {
    result = compareText(aCoverage.smoke, bCoverage.smoke);
  } else {
    result = compareText(aCoverage.frontend, bCoverage.frontend);
  }

  if (result === 0) {
    result = compareText(a.path, b.path) || compareText(a.method, b.method);
  }

  return sort.direction === 'asc' ? result : -result;
}

export interface ApiRoutesPageProps {
  apiBaseUrl?: string;
  getAccessToken?: () => string | null;
}

export function ApiRoutesPage({
  apiBaseUrl = '',
  getAccessToken,
}: ApiRoutesPageProps = {}): JSX.Element {
  const t = useModuleMessages(enUsMessages);
  const [query, setQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('ALL');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('ALL');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [frontendFilter, setFrontendFilter] = useState<FrontendFilter>('ALL');
  const [groupMode, setGroupMode] = useState<RouteGroupMode>('CATEGORY');
  const [sort, setSort] = useState<SortState>({ direction: 'asc', key: 'path' });
  const [selectedRouteKey, setSelectedRouteKey] = useState(DEFAULT_SELECTED_ROUTE_KEY);
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [queryJson, setQueryJson] = useState('{}');
  const [headersJson, setHeadersJson] = useState('{}');
  const [bodyJson, setBodyJson] = useState('{}');
  const [requestResult, setRequestResult] = useState<ApiRouteRequestResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const modules = useMemo(() => {
    return Array.from(new Set(ROUTES.map((route) => route.module))).sort();
  }, []);

  const selectedRoute = useMemo(() => {
    return (
      ROUTES.find((route) => routeKey(route) === selectedRouteKey) ??
      (ROUTES[0] as ApiRouteDefinition)
    );
  }, [selectedRouteKey]);

  const visibleRoutes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return ROUTES.filter((route) => {
      const coverage = getApiRouteCoverage(route);
      if (visibilityFilter === 'PUBLIC' && !route.public) return false;
      if (visibilityFilter === 'PROTECTED' && route.public) return false;
      if (methodFilter !== 'ALL' && route.method !== methodFilter) return false;
      if (moduleFilter !== 'ALL' && route.module !== moduleFilter) return false;
      if (frontendFilter === 'CALLER' && coverage.frontend !== 'Product workflow') return false;
      if (frontendFilter === 'MISSING' && coverage.frontend !== 'No product workflow') return false;
      if (normalizedQuery === '') return true;
      return (
        route.path.toLowerCase().includes(normalizedQuery) ||
        route.method.toLowerCase().includes(normalizedQuery) ||
        route.module.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [frontendFilter, methodFilter, moduleFilter, query, visibilityFilter]);

  const sortedRoutes = useMemo(() => {
    return [...visibleRoutes].sort((a, b) => compareRoutesBySort(a, b, sort));
  }, [sort, visibleRoutes]);

  const routeGroups = useMemo(
    () => groupRoutes(sortedRoutes, groupMode),
    [groupMode, sortedRoutes],
  );

  const selectedPathParams = useMemo(
    () => extractPathParams(selectedRoute.path),
    [selectedRoute.path],
  );

  useEffect(() => {
    setPathParams(createDefaultPathParams(selectedRoute.path));
    setQueryJson('{}');
    setHeadersJson('{}');
    setBodyJson(createDefaultBody(selectedRoute));
    setRequestResult(null);
    setRequestError(null);
  }, [selectedRoute]);

  const handleSend = useCallback(async (): Promise<void> => {
    setIsSending(true);
    setRequestError(null);
    setRequestResult(null);

    try {
      const resolvedPath = resolvePath(selectedRoute.path, pathParams);
      const queryRecord = parseJsonRecord(queryJson, 'Query JSON');
      const headers = parseHeaders(headersJson);
      const token = getAccessToken?.() ?? null;
      if (token !== null && token !== '') {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const hasBody = routeSupportsBody(selectedRoute);
      const body = hasBody ? parseJson(bodyJson, 'Body JSON') : undefined;
      if (hasBody) {
        headers.set('Content-Type', 'application/json');
      }
      headers.set('Accept', 'application/json');

      const url = appendQueryString(buildApiUrl(apiBaseUrl, resolvedPath), queryRecord);
      const requestInit: RequestInit = {
        method: selectedRoute.method,
        headers,
        credentials: 'include',
        ...(hasBody && body !== undefined ? { body: JSON.stringify(body) } : {}),
      };

      const startedAt = performance.now();
      let response = await fetch(url, requestInit);
      let responseBody = await readResponseBody(response);

      if (hasBody && isCsrfFailure(response, responseBody)) {
        const csrfToken = await fetchCsrfToken(apiBaseUrl);
        headers.set('x-csrf-token', csrfToken);
        response = await fetch(url, { ...requestInit, headers });
        responseBody = await readResponseBody(response);
      }

      setRequestResult({
        body: responseBody,
        elapsedMs: Math.round(performance.now() - startedAt),
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url,
      });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  }, [apiBaseUrl, bodyJson, getAccessToken, headersJson, pathParams, queryJson, selectedRoute]);

  const handleSortChange = useCallback((key: SortKey): void => {
    setSort((current) => {
      if (current.key !== key) {
        return { direction: 'asc', key };
      }
      return { direction: current.direction === 'asc' ? 'desc' : 'asc', key };
    });
  }, []);

  const responsePanel = useMemo(
    () => (
      <RouteResponsePanel
        isSending={isSending}
        requestError={requestError}
        requestResult={requestResult}
        route={selectedRoute}
      />
    ),
    [isSending, requestError, requestResult, selectedRoute],
  );
  const hasAppRightSidebar = useAppRightSidebar(responsePanel);

  return (
    <PageContainer className="api-routes-page" maxWidth={1600}>
      <div className="api-routes-page__content">
        <div className="space-y-2">
          <Heading as="h1" size="xl">
            {t('devtools.apiRoutes.heading')}
          </Heading>
          <div className="api-routes-page__toolbar">
            <Badge tone="info">
              {t('devtools.apiRoutes.badgeTotal', { count: String(ROUTES.length) })}
            </Badge>
            <Badge tone="success">
              {t('devtools.apiRoutes.badgePublic', { count: String(PUBLIC_ROUTE_COUNT) })}
            </Badge>
            <Badge tone="warning">
              {t('devtools.apiRoutes.badgeProtected', { count: String(PROTECTED_ROUTE_COUNT) })}
            </Badge>
            <Badge tone="success">
              {t('devtools.apiRoutes.badgeSmoke', { count: String(SMOKE_COVERED_ROUTE_COUNT) })}
            </Badge>
            <Badge tone="info">
              {t('devtools.apiRoutes.badgeWorkflows', {
                count: String(FRONTEND_CALLER_ROUTE_COUNT),
              })}
            </Badge>
            <Badge tone="success">
              {t('devtools.apiRoutes.badgeConsole', { count: String(ROUTES.length) })}
            </Badge>
          </div>
        </div>

        <div className="api-routes-page__main">
          <div className="api-routes-page__column">
            <RouteFilters
              modules={modules}
              query={query}
              visibilityFilter={visibilityFilter}
              methodFilter={methodFilter}
              moduleFilter={moduleFilter}
              frontendFilter={frontendFilter}
              groupMode={groupMode}
              onQueryChange={setQuery}
              onVisibilityFilterChange={setVisibilityFilter}
              onMethodFilterChange={setMethodFilter}
              onModuleFilterChange={setModuleFilter}
              onFrontendFilterChange={setFrontendFilter}
              onGroupModeChange={setGroupMode}
            />

            <Text size="sm" tone="muted">
              {t('devtools.apiRoutes.showingSummary', {
                shown: String(visibleRoutes.length),
                total: String(ROUTES.length),
                groups: formatGroupSummary(groupMode, routeGroups.length),
              })}
            </Text>

            {groupMode === 'NONE' ? (
              <div className="api-routes-page__table-shell">
                <RouteTable
                  routes={sortedRoutes}
                  selectedRouteKey={selectedRouteKey}
                  sort={sort}
                  onSelectRoute={setSelectedRouteKey}
                  onSortChange={handleSortChange}
                />
              </div>
            ) : (
              <RouteGroupList
                groups={routeGroups}
                selectedRouteKey={selectedRouteKey}
                sort={sort}
                onSelectRoute={setSelectedRouteKey}
                onSortChange={handleSortChange}
              />
            )}
          </div>

          <div className="api-routes-page__column">
            {!hasAppRightSidebar ? responsePanel : null}

            <RouteRequestPanel
              bodyJson={bodyJson}
              headersJson={headersJson}
              isSending={isSending}
              pathParams={pathParams}
              queryJson={queryJson}
              route={selectedRoute}
              selectedPathParams={selectedPathParams}
              onBodyJsonChange={setBodyJson}
              onHeadersJsonChange={setHeadersJson}
              onPathParamChange={(name, value) => {
                setPathParams((current) => ({ ...current, [name]: value }));
              }}
              onQueryJsonChange={setQueryJson}
              onSend={handleSend}
            />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function LabeledSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <Text as="label" size="sm" className="font-medium">
        {label}
      </Text>
      <Select aria-label={label} value={value} onChange={onChange}>
        {children}
      </Select>
    </div>
  );
}

function RouteFilters({
  frontendFilter,
  groupMode,
  methodFilter,
  moduleFilter,
  modules,
  onFrontendFilterChange,
  onGroupModeChange,
  onMethodFilterChange,
  onModuleFilterChange,
  onQueryChange,
  onVisibilityFilterChange,
  query,
  visibilityFilter,
}: {
  frontendFilter: FrontendFilter;
  groupMode: RouteGroupMode;
  methodFilter: MethodFilter;
  moduleFilter: string;
  modules: string[];
  onFrontendFilterChange: (value: FrontendFilter) => void;
  onGroupModeChange: (value: RouteGroupMode) => void;
  onMethodFilterChange: (value: MethodFilter) => void;
  onModuleFilterChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onVisibilityFilterChange: (value: VisibilityFilter) => void;
  query: string;
  visibilityFilter: VisibilityFilter;
}): JSX.Element {
  const t = useModuleMessages(enUsMessages);

  return (
    <Card>
      <Card.Body>
        <div className="api-routes-page__filters">
          <Input.Field
            label={t('devtools.apiRoutes.searchLabel')}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
            }}
            placeholder={t('devtools.apiRoutes.searchPlaceholder')}
          />

          <LabeledSelect
            label={t('devtools.apiRoutes.filterAuthLabel')}
            value={visibilityFilter}
            onChange={(value) => {
              onVisibilityFilterChange(value as VisibilityFilter);
            }}
          >
            <option value="ALL">{t('devtools.apiRoutes.filterAuthAll')}</option>
            <option value="PUBLIC">{t('devtools.apiRoutes.authPublic')}</option>
            <option value="PROTECTED">{t('devtools.apiRoutes.authProtected')}</option>
          </LabeledSelect>

          <LabeledSelect
            label={t('devtools.apiRoutes.filterMethodLabel')}
            value={methodFilter}
            onChange={(value) => {
              onMethodFilterChange(
                ALL_METHODS.includes(value as MethodFilter) ? (value as MethodFilter) : 'ALL',
              );
            }}
          >
            {ALL_METHODS.map((method) => (
              <option key={method} value={method}>
                {method === 'ALL' ? t('devtools.apiRoutes.filterMethodAll') : method}
              </option>
            ))}
          </LabeledSelect>

          <LabeledSelect
            label={t('devtools.apiRoutes.filterModuleLabel')}
            value={moduleFilter}
            onChange={(value) => {
              onModuleFilterChange(value);
            }}
          >
            <option value="ALL">{t('devtools.apiRoutes.filterModuleAll')}</option>
            {modules.map((moduleName) => (
              <option key={moduleName} value={moduleName}>
                {moduleName}
              </option>
            ))}
          </LabeledSelect>

          <LabeledSelect
            label={t('devtools.apiRoutes.filterSurfaceLabel')}
            value={frontendFilter}
            onChange={(value) => {
              onFrontendFilterChange(value as FrontendFilter);
            }}
          >
            <option value="ALL">{t('devtools.apiRoutes.filterSurfaceAll')}</option>
            <option value="CALLER">{t('devtools.apiRoutes.filterSurfaceCaller')}</option>
            <option value="MISSING">{t('devtools.apiRoutes.filterSurfaceMissing')}</option>
          </LabeledSelect>

          <LabeledSelect
            label={t('devtools.apiRoutes.filterGroupLabel')}
            value={groupMode}
            onChange={(value) => {
              onGroupModeChange(value as RouteGroupMode);
            }}
          >
            <option value="CATEGORY">{t('devtools.apiRoutes.groupCategory')}</option>
            <option value="MODULE">{t('devtools.apiRoutes.groupModule')}</option>
            <option value="NONE">{t('devtools.apiRoutes.groupNone')}</option>
          </LabeledSelect>
        </div>
      </Card.Body>
    </Card>
  );
}

function RouteGroupList({
  groups,
  onSelectRoute,
  onSortChange,
  selectedRouteKey,
  sort,
}: {
  groups: RouteGroup[];
  onSelectRoute: (key: string) => void;
  onSortChange: (key: SortKey) => void;
  selectedRouteKey: string;
  sort: SortState;
}): JSX.Element {
  const t = useModuleMessages(enUsMessages);

  if (groups.length === 0) {
    return (
      <div className="api-routes-page__table-shell">
        <RouteTable
          routes={[]}
          selectedRouteKey={selectedRouteKey}
          sort={sort}
          onSelectRoute={onSelectRoute}
          onSortChange={onSortChange}
        />
      </div>
    );
  }

  return (
    <div className="api-routes-page__route-groups">
      {groups.map((group) => {
        const publicCount = group.routes.filter((route) => route.public).length;
        const protectedCount = group.routes.length - publicCount;

        return (
          <section key={group.id} className="api-routes-page__route-group">
            <div className="api-routes-page__group-header">
              <Heading as="h2" size="sm">
                {group.label}
              </Heading>
              <div className="api-routes-page__group-meta">
                <Badge tone="info">{pluralizeRouteCount(group.routes.length)}</Badge>
                {publicCount > 0 ? (
                  <Badge tone="success">
                    {t('devtools.apiRoutes.badgePublic', { count: String(publicCount) })}
                  </Badge>
                ) : null}
                {protectedCount > 0 ? (
                  <Badge tone="warning">
                    {t('devtools.apiRoutes.badgeProtected', { count: String(protectedCount) })}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="api-routes-page__table-shell">
              <RouteTable
                routes={group.routes}
                selectedRouteKey={selectedRouteKey}
                sort={sort}
                onSelectRoute={onSelectRoute}
                onSortChange={onSortChange}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SortableTableHead({
  label,
  onSortChange,
  sort,
  sortKey,
}: {
  label: string;
  onSortChange: (key: SortKey) => void;
  sort: SortState;
  sortKey: SortKey;
}): JSX.Element {
  const t = useModuleMessages(enUsMessages);
  const isActive = sort.key === sortKey;
  const nextDirection =
    isActive && sort.direction === 'asc'
      ? t('devtools.apiRoutes.sortDesc')
      : t('devtools.apiRoutes.sortAsc');

  return (
    <TableHead
      aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <Button
        type="button"
        variant="text"
        size="inline"
        className="text-muted"
        aria-label={t('devtools.apiRoutes.sortAria', { label, direction: nextDirection })}
        onClick={() => {
          onSortChange(sortKey);
        }}
      >
        <span>{label}</span>
        {isActive ? (
          <span aria-hidden="true">
            {sort.direction === 'asc'
              ? t('devtools.apiRoutes.sortUpGlyph')
              : t('devtools.apiRoutes.sortDownGlyph')}
          </span>
        ) : null}
      </Button>
    </TableHead>
  );
}

function RouteTable({
  onSelectRoute,
  onSortChange,
  routes,
  selectedRouteKey,
  sort,
}: {
  onSelectRoute: (key: string) => void;
  onSortChange: (key: SortKey) => void;
  routes: ApiRouteDefinition[];
  selectedRouteKey: string;
  sort: SortState;
}): JSX.Element {
  const t = useModuleMessages(enUsMessages);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableTableHead
            label={t('devtools.apiRoutes.filterMethodLabel')}
            sortKey="method"
            sort={sort}
            onSortChange={onSortChange}
          />
          <SortableTableHead
            label={t('devtools.apiRoutes.colPath')}
            sortKey="path"
            sort={sort}
            onSortChange={onSortChange}
          />
          <SortableTableHead
            label={t('devtools.apiRoutes.filterModuleLabel')}
            sortKey="module"
            sort={sort}
            onSortChange={onSortChange}
          />
          <SortableTableHead
            label={t('devtools.apiRoutes.filterAuthLabel')}
            sortKey="auth"
            sort={sort}
            onSortChange={onSortChange}
          />
          <SortableTableHead
            label={t('devtools.apiRoutes.colSmoke')}
            sortKey="smoke"
            sort={sort}
            onSortChange={onSortChange}
          />
          <SortableTableHead
            label={t('devtools.apiRoutes.colProduct')}
            sortKey="product"
            sort={sort}
            onSortChange={onSortChange}
          />
          <TableHead>{t('devtools.apiRoutes.colConsole')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routes.map((route) => {
          const coverage = getApiRouteCoverage(route);
          const key = routeKey(route);
          const isSelected = key === selectedRouteKey;
          const actionLabel = isSelected
            ? t('devtools.apiRoutes.rowSelected')
            : t('devtools.apiRoutes.rowOpen');
          const actionAriaLabel = `${actionLabel} ${selectedRouteLabel(route)}`;

          return (
            <TableRow key={key} className={isSelected ? 'bg-surface' : undefined}>
              <TableCell>
                <Badge
                  tone={methodTone(route.method)}
                  className="api-routes-page__method font-semibold text-center"
                >
                  {route.method}
                </Badge>
              </TableCell>
              <TableCell>
                <code className="text-sm font-mono">{route.path}</code>
              </TableCell>
              <TableCell>
                <Badge>{route.module}</Badge>
              </TableCell>
              <TableCell>
                <Badge tone={route.public ? 'success' : 'warning'}>
                  {route.public
                    ? t('devtools.apiRoutes.authPublic')
                    : t('devtools.apiRoutes.authProtected')}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge tone={coverageTone(coverage.smoke)}>{coverage.smoke}</Badge>
              </TableCell>
              <TableCell>
                <Badge tone={coverageTone(coverage.frontend)}>{coverage.frontend}</Badge>
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  size="small"
                  variant={isSelected ? 'primary' : 'secondary'}
                  aria-label={actionAriaLabel}
                  onClick={() => {
                    onSelectRoute(key);
                  }}
                >
                  {actionLabel}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}

        {routes.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7}>
              <Text className="text-center text-muted py-4">
                {t('devtools.apiRoutes.emptyFiltered')}
              </Text>
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

function JsonEditor({
  label,
  onChange,
  rows,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  rows: number;
  value: string;
}): JSX.Element {
  const id = label.toLowerCase().replace(/\s+/gu, '-');
  return (
    <div className="space-y-1">
      <label className="input-label" htmlFor={id}>
        {label}
      </label>
      <TextArea
        id={id}
        className="font-mono text-sm"
        rows={rows}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function RouteRequestPanel({
  bodyJson,
  headersJson,
  isSending,
  onBodyJsonChange,
  onHeadersJsonChange,
  onPathParamChange,
  onQueryJsonChange,
  onSend,
  pathParams,
  queryJson,
  route,
  selectedPathParams,
}: {
  bodyJson: string;
  headersJson: string;
  isSending: boolean;
  onBodyJsonChange: (value: string) => void;
  onHeadersJsonChange: (value: string) => void;
  onPathParamChange: (name: string, value: string) => void;
  onQueryJsonChange: (value: string) => void;
  onSend: () => Promise<void>;
  pathParams: Record<string, string>;
  queryJson: string;
  route: ApiRouteDefinition;
  selectedPathParams: string[];
}): JSX.Element {
  const t = useModuleMessages(enUsMessages);
  const coverage = getApiRouteCoverage(route);
  const supportsBody = routeSupportsBody(route);

  return (
    <Card className="2xl:order-1">
      <Card.Header>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={methodTone(route.method)}>{route.method}</Badge>
            <code className="text-sm font-mono break-all">{route.path}</code>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{route.module}</Badge>
            <Badge tone={route.public ? 'success' : 'warning'}>
              {route.public
                ? t('devtools.apiRoutes.authPublic')
                : t('devtools.apiRoutes.authProtected')}
            </Badge>
            <Badge tone={coverageTone(coverage.frontend)}>{coverage.frontend}</Badge>
          </div>
        </div>
      </Card.Header>
      <Card.Body>
        <div className="space-y-4">
          {selectedPathParams.length > 0 ? (
            <div className="grid gap-3">
              {selectedPathParams.map((param) => (
                <Input.Field
                  key={param}
                  label={t('devtools.apiRoutes.pathParamLabel', { param })}
                  value={pathParams[param] ?? ''}
                  onChange={(event) => {
                    onPathParamChange(param, event.target.value);
                  }}
                />
              ))}
            </div>
          ) : null}

          <JsonEditor
            label={t('devtools.apiRoutes.queryJsonLabel')}
            value={queryJson}
            rows={3}
            onChange={onQueryJsonChange}
          />
          <JsonEditor
            label={t('devtools.apiRoutes.headersJsonLabel')}
            value={headersJson}
            rows={3}
            onChange={onHeadersJsonChange}
          />
          {supportsBody ? (
            <JsonEditor
              label={t('devtools.apiRoutes.bodyJsonLabel')}
              value={bodyJson}
              rows={5}
              onChange={onBodyJsonChange}
            />
          ) : null}

          <div className="space-y-2">
            <Text size="sm" className="font-medium">
              {t('devtools.apiRoutes.clientShapeHeading')}
            </Text>
            <pre className="api-routes-page__code overflow-auto rounded border bg-surface p-3 text-xs">
              {formatRouteRequestSnippet(route)}
            </pre>
          </div>

          <Button
            type="button"
            onClick={() => {
              void onSend();
            }}
            disabled={isSending}
          >
            {isSending ? t('devtools.apiRoutes.sendingButton') : t('devtools.apiRoutes.sendButton')}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}

function RouteResponsePanel({
  isSending,
  requestError,
  requestResult,
  route,
}: {
  isSending: boolean;
  requestError: string | null;
  requestResult: ApiRouteRequestResult | null;
  route: ApiRouteDefinition;
}): JSX.Element {
  const t = useModuleMessages(enUsMessages);
  const statusBadgeText =
    requestResult !== null ? `${String(requestResult.status)} ${requestResult.statusText}` : null;

  return (
    <Card className="xl:sticky xl:top-4 xl:self-start 2xl:order-2">
      <Card.Header>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Heading as="h2" size="md">
              {t('devtools.apiRoutes.responseHeading')}
            </Heading>
            {statusBadgeText !== null && requestResult !== null ? (
              <Badge tone={requestResult.ok ? 'success' : 'danger'}>{statusBadgeText}</Badge>
            ) : null}
          </div>
          <Text size="sm" tone="muted" className="break-all">
            {selectedRouteLabel(route)}
          </Text>
        </div>
      </Card.Header>
      <Card.Body>
        <div className="space-y-3" aria-live="polite">
          {isSending ? (
            <Text size="sm" tone="muted">
              {t('devtools.apiRoutes.sendingStatus')}
            </Text>
          ) : null}

          {requestError !== null ? (
            <Text role="alert" tone="danger" size="sm">
              {requestError}
            </Text>
          ) : null}

          {requestResult !== null ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone="info">
                  {t('devtools.apiRoutes.elapsedMs', { ms: String(requestResult.elapsedMs) })}
                </Badge>
              </div>
              <Text size="sm" tone="muted" className="break-all">
                {requestResult.url}
              </Text>
              <pre className="api-routes-page__code api-routes-page__code--response overflow-auto rounded border bg-surface p-3 text-xs">
                {requestResult.body === ''
                  ? t('devtools.apiRoutes.emptyResponse')
                  : requestResult.body}
              </pre>
            </>
          ) : null}

          {!isSending && requestError === null && requestResult === null ? (
            <div className="rounded border border-dashed bg-surface p-4">
              <Text size="sm" tone="muted">
                {t('devtools.apiRoutes.emptyPrompt')}
              </Text>
            </div>
          ) : null}
        </div>
      </Card.Body>
    </Card>
  );
}
