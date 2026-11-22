// main/modules/devtools/web/RouteManifestPage.tsx
import { useMemo, useState, type JSX } from 'react';

import {
  Badge,
  Checkbox,
  Heading,
  Input,
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
} from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { useRouteManifest } from './hooks';
import './DevtoolsPages.css';

import type { AdminRouteManifestEntry } from '../contract';

type MethodFilter = 'ALL' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const METHOD_TONES: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  GET: 'success',
  POST: 'info',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
};

const ALL_METHODS: readonly MethodFilter[] = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function isMethodFilter(value: string): value is MethodFilter {
  return ALL_METHODS.includes(value as MethodFilter);
}

function MethodBadge({ method }: { method: string }): JSX.Element {
  return (
    <Badge
      tone={METHOD_TONES[method] ?? 'info'}
      className="route-manifest-method font-semibold text-2xs text-center"
    >
      {method}
    </Badge>
  );
}

function AuthBadge({ isPublic, roles }: { isPublic: boolean; roles: string[] }): JSX.Element {
  const t = useModuleMessages(enUsMessages);
  if (isPublic) return <Badge tone="success">{t('devtools.manifest.authPublic')}</Badge>;
  if (roles.length > 0) return <Badge tone="warning">{roles.join(', ')}</Badge>;
  return <Badge tone="danger">{t('devtools.manifest.authProtected')}</Badge>;
}

function RouteTable({ routes }: { routes: AdminRouteManifestEntry[] }): JSX.Element {
  const t = useModuleMessages(enUsMessages);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('devtools.manifest.colMethod')}</TableHead>
          <TableHead>{t('devtools.manifest.colPath')}</TableHead>
          <TableHead>{t('devtools.manifest.colModule')}</TableHead>
          <TableHead>{t('devtools.manifest.colAuth')}</TableHead>
          <TableHead>{t('devtools.manifest.colSchema')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routes.map((route, index) => (
          <TableRow key={`${route.method}-${route.path}-${String(index)}`}>
            <TableCell>
              <MethodBadge method={route.method} />
            </TableCell>
            <TableCell>
              <code className="text-sm">{route.path}</code>
            </TableCell>
            <TableCell>
              <Badge className="capitalize">{route.module}</Badge>
            </TableCell>
            <TableCell>
              <AuthBadge isPublic={route.isPublic} roles={route.roles} />
            </TableCell>
            <TableCell>
              {route.hasSchema ? (
                <Badge>{t('devtools.manifest.schemaYes')}</Badge>
              ) : (
                <Text as="span" className="text-muted text-sm">
                  {t('devtools.manifest.schemaDash')}
                </Text>
              )}
            </TableCell>
          </TableRow>
        ))}

        {routes.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5}>
              <Text className="text-center text-muted py-4">
                {t('devtools.manifest.emptyFiltered')}
              </Text>
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

export const RouteManifestPage = (): JSX.Element => {
  const t = useModuleMessages(enUsMessages);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('ALL');
  const [groupByModule, setGroupByModule] = useState(false);

  const { data, isLoading, isError, error } = useRouteManifest();

  const modules = useMemo(() => {
    if (data === undefined) return [];
    return Array.from(new Set(data.routes.map((route) => route.module))).sort();
  }, [data]);

  const filteredRoutes = useMemo(() => {
    if (data === undefined) return [];
    return data.routes.filter((route) => {
      if (moduleFilter !== 'ALL' && route.module !== moduleFilter) return false;
      if (methodFilter !== 'ALL' && route.method !== methodFilter) return false;
      if (search !== '' && !route.path.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, methodFilter, moduleFilter, search]);

  const groupedRoutes = useMemo(() => {
    if (!groupByModule) return null;

    const groups: Record<string, AdminRouteManifestEntry[]> = {};
    for (const route of filteredRoutes) {
      const key = route.module;
      groups[key] ??= [];
      groups[key].push(route);
    }
    return groups;
  }, [filteredRoutes, groupByModule]);

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex flex-col gap-3 py-4">
          <Skeleton width="8rem" height="1.75rem" />
          <Skeleton width="100%" height="2.5rem" radius="var(--ui-radius-md)" />
          <Skeleton width="100%" height="2rem" />
          <Skeleton width="100%" height="2rem" />
          <Skeleton width="100%" height="2rem" />
        </div>
      </PageContainer>
    );
  }

  if (isError) {
    return (
      <PageContainer>
        <Text className="text-danger">
          {t('devtools.manifest.loadFailed', {
            error: error?.message ?? t('devtools.manifest.unknownError'),
          })}
        </Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <Heading as="h1" size="lg">
              {t('devtools.manifest.heading')}
            </Heading>
            <Text className="text-muted">
              {t('devtools.manifest.registeredCount', { count: String(data?.count ?? 0) })}
            </Text>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={t('devtools.manifest.searchPlaceholder')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            className="route-manifest-search"
          />

          <Select
            aria-label={t('devtools.manifest.allModules')}
            value={moduleFilter}
            onChange={(value) => {
              setModuleFilter(value);
            }}
          >
            <option value="ALL">{t('devtools.manifest.allModules')}</option>
            {modules.map((moduleName) => (
              <option key={moduleName} value={moduleName}>
                {moduleName}
              </option>
            ))}
          </Select>

          <Select
            aria-label={t('devtools.manifest.allMethods')}
            value={methodFilter}
            onChange={(value) => {
              setMethodFilter(isMethodFilter(value) ? value : 'ALL');
            }}
          >
            {ALL_METHODS.map((method) => (
              <option key={method} value={method}>
                {method === 'ALL' ? t('devtools.manifest.allMethods') : method}
              </option>
            ))}
          </Select>

          <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
            <Checkbox
              checked={groupByModule}
              onChange={(checked) => {
                setGroupByModule(checked);
              }}
            />
            {t('devtools.manifest.groupByModule')}
          </label>
        </div>

        <Text className="text-sm text-muted">
          {t('devtools.manifest.showingCount', {
            shown: String(filteredRoutes.length),
            total: String(data?.count ?? 0),
          })}
        </Text>

        {groupByModule && groupedRoutes !== null ? (
          Object.entries(groupedRoutes)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([moduleName, routes]) => (
              <div key={moduleName} className="flex flex-col gap-2">
                <Heading as="h4" size="sm" className="capitalize">
                  {moduleName}
                </Heading>
                <RouteTable routes={routes} />
              </div>
            ))
        ) : (
          <RouteTable routes={filteredRoutes} />
        )}
      </div>
    </PageContainer>
  );
};
