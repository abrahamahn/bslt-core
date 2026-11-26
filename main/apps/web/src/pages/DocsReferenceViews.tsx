// main/apps/web/src/pages/DocsReferenceViews.tsx
/**
 * Interactive Auto-Synced Reference Explorers for `/docs`
 *
 * Renders the full platform inventory emitted by `pnpm bslt sync docs`
 * (`DOCS_REFERENCE`): all HTTP API endpoints, web routes, vertical modules,
 * kernel packages, PostgreSQL RLS tables/enums/functions, domain events,
 * background jobs, and scheduled crons.
 */

import { createTransport, isApiError } from '@bslt/client-engine';
import { Link } from '@bslt/react/router';
import { Badge, Button, Card, Heading, Input, Text, TextArea } from '@bslt/ui';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { DOC_KERNEL_PACKAGES, getPlatformStats } from './docsCatalog';
import {
  DOCS_REFERENCE,
  type DocsApiEndpointRef,
  type DocsModuleRef,
  type DocsWebRouteRef,
} from './docsReference.generated';

import { clientConfig } from '#app/config';

const HTTP_METHODS = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const AUTH_FILTERS = ['all', 'public', 'user', 'admin'] as const;
const WEB_SPACE_FILTERS = [
  'all',
  'public',
  'auth',
  'protected',
  'workspace',
  'admin',
  'dev',
] as const;

type AuthFilter = (typeof AUTH_FILTERS)[number];
type WebSpaceFilter = (typeof WEB_SPACE_FILTERS)[number];

function methodBadgeTone(method: string): 'info' | 'success' | 'warning' | 'danger' | 'neutral' {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'info';
    case 'POST':
      return 'success';
    case 'PUT':
    case 'PATCH':
      return 'warning';
    case 'DELETE':
      return 'danger';
    default:
      return 'neutral';
  }
}

function formatAuthLabel(endpoint: DocsApiEndpointRef): string {
  if (endpoint.auth === 'public') return 'Public';
  if (endpoint.roles.includes('admin')) return 'Admin';
  if (endpoint.roles.includes('moderator')) return 'Moderator';
  if (endpoint.roles.includes('user') || endpoint.auth === 'authenticated') return 'Authenticated';
  return endpoint.auth;
}

function authBadgeTone(endpoint: DocsApiEndpointRef): 'success' | 'warning' | 'info' | 'neutral' {
  if (endpoint.auth === 'public') return 'success';
  if (endpoint.roles.includes('admin')) return 'warning';
  if (endpoint.roles.includes('user') || endpoint.auth === 'authenticated') return 'info';
  return 'neutral';
}

function matchesAuthFilter(endpoint: DocsApiEndpointRef, filter: AuthFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'public') return endpoint.auth === 'public';
  if (filter === 'admin') return endpoint.roles.includes('admin');
  return endpoint.auth !== 'public' && !endpoint.roles.includes('admin');
}

function classifyWebRouteSpace(route: DocsWebRouteRef): Exclude<WebSpaceFilter, 'all'> {
  if (route.owner === 'devtools') return 'dev';
  if (route.path === '/admin' || route.path.startsWith('/admin/')) return 'admin';
  if (
    route.path === '/workspace' ||
    route.path.startsWith('/workspace/') ||
    route.path === '/organization'
  ) {
    return 'workspace';
  }
  if (route.layouts.includes('AuthShell')) return 'auth';
  if (route.guard === 'protected') return 'protected';
  return 'public';
}

function spaceLabel(space: Exclude<WebSpaceFilter, 'all'>): string {
  switch (space) {
    case 'public':
      return 'Public';
    case 'auth':
      return 'Auth';
    case 'protected':
      return 'Signed-in';
    case 'workspace':
      return 'Workspace';
    case 'admin':
      return 'Admin';
    case 'dev':
      return 'Dev only';
  }
}

function spaceBadgeTone(
  space: Exclude<WebSpaceFilter, 'all'>,
): 'success' | 'info' | 'warning' | 'neutral' {
  switch (space) {
    case 'public':
      return 'success';
    case 'auth':
    case 'protected':
    case 'workspace':
      return 'info';
    case 'admin':
      return 'warning';
    case 'dev':
      return 'neutral';
  }
}

function rlsBadgeTone(rlsClass: string): 'info' | 'success' | 'warning' | 'neutral' {
  switch (rlsClass) {
    case 'owner_user':
    case 'owner_org':
      return 'info';
    case 'public_read':
      return 'success';
    case 'append_only':
    case 'custom':
      return 'warning';
    default:
      return 'neutral';
  }
}

function isLinkablePath(routePath: string): boolean {
  return !routePath.includes(':') && !routePath.includes('*');
}

function buildCurlExample(endpoint: DocsApiEndpointRef): string {
  const samplePath = endpoint.path.replaceAll(/:([A-Za-z0-9_]+)/gu, '<$1>');
  const lines = [`curl -X ${endpoint.method} "https://app.bslt.dev${samplePath}"`];
  if (endpoint.auth !== 'public') {
    lines.push('  -H "Authorization: Bearer <token>"');
  }
  if (endpoint.body !== null) {
    lines.push('  -H "Content-Type: application/json"');
    lines.push("  -d '{}'");
  }
  return lines.join(' \\\n');
}

interface TryRequestState {
  readonly status: 'idle' | 'running' | 'done' | 'error';
  readonly statusCode?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly output?: string | undefined;
}

const DocsEndpointTryPanel = ({
  endpoint,
}: {
  readonly endpoint: DocsApiEndpointRef;
}): ReactElement => {
  const [targetPath, setTargetPath] = useState(endpoint.path);
  const [bearerToken, setBearerToken] = useState('');
  const [requestBody, setRequestBody] = useState(endpoint.body !== null ? '{\n  \n}' : '');
  const [result, setResult] = useState<TryRequestState>({ status: 'idle' });

  const isMutating = endpoint.method !== 'GET' && endpoint.method !== 'HEAD';

  const handleSend = useCallback((): void => {
    const trimmedPath = targetPath.trim();
    if (!trimmedPath.startsWith('/')) {
      setResult({
        status: 'error',
        output: 'Request path must start with "/" (for example, /api/status).',
      });
      return;
    }
    if (trimmedPath.includes('/:')) {
      setResult({
        status: 'error',
        output: 'Replace ":param" path placeholders with concrete IDs before sending.',
      });
      return;
    }

    let parsedBody: unknown;
    if (isMutating && requestBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(requestBody);
      } catch (err: unknown) {
        setResult({
          status: 'error',
          output: `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    }

    const startedAt = Date.now();
    setResult({ status: 'running' });

    const tokenValue = bearerToken.trim();
    const transport = createTransport({
      baseUrl: clientConfig.apiUrl,
      getToken: () => (tokenValue.length > 0 ? tokenValue : null),
    });

    const httpMethod = endpoint.method.toUpperCase() as
      'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

    void transport
      .request(trimmedPath, {
        method: httpMethod,
        rawApiPath: true,
        requiresAuth: endpoint.auth !== 'public' || tokenValue.length > 0,
        ...(parsedBody !== undefined
          ? {
              body: JSON.stringify(parsedBody),
              headers: { 'Content-Type': 'application/json' },
            }
          : {}),
      })
      .then((payload) => {
        setResult({
          status: 'done',
          statusCode: 200,
          durationMs: Math.max(1, Date.now() - startedAt),
          output:
            typeof payload === 'string'
              ? payload
              : JSON.stringify(payload ?? { ok: true }, null, 2),
        });
      })
      .catch((error: unknown) => {
        const durationMs = Math.max(1, Date.now() - startedAt);
        if (isApiError(error)) {
          setResult({
            status: 'error',
            statusCode: error.statusCode,
            durationMs,
            output: JSON.stringify(
              {
                status: error.statusCode,
                code: error.code,
                message: error.message,
              },
              null,
              2,
            ),
          });
          return;
        }
        setResult({
          status: 'error',
          durationMs,
          output: error instanceof Error ? error.message : String(error),
        });
      });
  }, [bearerToken, endpoint.auth, endpoint.method, isMutating, requestBody, targetPath]);

  return (
    <div className="docs-try-panel">
      <div className="docs-try-panel__header">
        <Text as="span" size="xs" className="docs-route-card__label">
          Try Live Request
        </Text>
        <Text as="span" size="xs" tone="muted">
          {endpoint.auth === 'public'
            ? 'Public endpoint — runs directly against this origin.'
            : 'Uses your signed-in browser session or an optional bslt_ API key / Bearer token.'}
        </Text>
      </div>
      <div className="docs-try-panel__controls">
        <div className="docs-try-panel__field">
          <Input
            type="text"
            value={targetPath}
            aria-label={`Request path for ${endpoint.method} ${endpoint.path}`}
            placeholder={endpoint.path}
            onChange={(event) => {
              setTargetPath(event.target.value);
            }}
          />
        </div>
        {endpoint.auth !== 'public' ? (
          <div className="docs-try-panel__token">
            <Input
              type="password"
              value={bearerToken}
              aria-label={`Optional bearer token for ${endpoint.method} ${endpoint.path}`}
              placeholder="Optional Bearer / bslt_ API key"
              onChange={(event) => {
                setBearerToken(event.target.value);
              }}
            />
          </div>
        ) : null}
        <Button
          type="button"
          size="small"
          variant="primary"
          disabled={result.status === 'running'}
          onClick={handleSend}
        >
          {result.status === 'running' ? 'Sending…' : 'Send Request'}
        </Button>
      </div>
      {isMutating ? (
        <TextArea
          rows={4}
          value={requestBody}
          aria-label={`JSON request body for ${endpoint.method} ${endpoint.path}`}
          placeholder='{"example": true}'
          onChange={(event) => {
            setRequestBody(event.target.value);
          }}
        />
      ) : null}
      {result.status === 'done' || result.status === 'error' ? (
        <div className="docs-try-panel__result">
          <div className="docs-try-panel__result-meta">
            <Badge tone={result.status === 'done' ? 'success' : 'danger'}>
              {result.statusCode !== undefined
                ? `HTTP ${String(result.statusCode)}`
                : result.status === 'done'
                  ? 'OK'
                  : 'Error'}
            </Badge>
            {result.durationMs !== undefined ? (
              <Text as="span" size="xs" tone="muted">
                {`${String(result.durationMs)} ms`}
              </Text>
            ) : null}
          </div>
          <pre className="docs-code-block">
            <code>{result.output ?? ''}</code>
          </pre>
        </div>
      ) : null}
    </div>
  );
};

function knownModuleSet(): ReadonlySet<string> {
  return new Set(DOCS_REFERENCE.modules.map((mod) => mod.id));
}

export const DocsPlatformStatsStrip = (): ReactElement => {
  const stats = getPlatformStats();
  return (
    <section aria-label="Live platform inventory" className="docs-stats-grid">
      {stats.map((stat) => (
        <Link key={stat.label} to={stat.to} className="docs-stat-card no-underline">
          <Heading as="p" size="xl" className="docs-stat-card__value">
            {String(stat.value)}
          </Heading>
          <Text as="span" size="sm" className="docs-stat-card__label">
            {stat.label}
          </Text>
          <Text as="span" size="xs" tone="muted">
            {stat.detail}
          </Text>
        </Link>
      ))}
    </section>
  );
};

interface DocsApiReferenceViewProps {
  readonly lockedOwner?: string;
}

export const DocsApiReferenceView = ({ lockedOwner }: DocsApiReferenceViewProps): ReactElement => {
  const [query, setQuery] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<(typeof HTTP_METHODS)[number]>('ALL');
  const [selectedAuth, setSelectedAuth] = useState<AuthFilter>('all');
  const [selectedOwner, setSelectedOwner] = useState<string>(lockedOwner ?? 'all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const effectiveOwner = lockedOwner ?? selectedOwner;
  const moduleIds = useMemo(() => knownModuleSet(), []);

  const scopedRoutes = useMemo(
    () =>
      lockedOwner === undefined
        ? DOCS_REFERENCE.apiRoutes
        : DOCS_REFERENCE.apiRoutes.filter((route) => route.owner === lockedOwner),
    [lockedOwner],
  );

  const ownerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of DOCS_REFERENCE.apiRoutes) {
      counts.set(route.owner, (counts.get(route.owner) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const filteredRoutes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return scopedRoutes.filter((route) => {
      if (effectiveOwner !== 'all' && route.owner !== effectiveOwner) return false;
      if (selectedMethod !== 'ALL' && route.method.toUpperCase() !== selectedMethod) return false;
      if (!matchesAuthFilter(route, selectedAuth)) return false;
      if (normalized.length === 0) return true;
      const haystack = [
        route.method,
        route.path,
        route.owner,
        route.contract,
        route.summary,
        route.body ?? '',
        route.query ?? '',
        route.pathParams ?? '',
        ...route.responses,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [effectiveOwner, query, scopedRoutes, selectedAuth, selectedMethod]);

  const hasFilters =
    query.trim().length > 0 ||
    selectedMethod !== 'ALL' ||
    selectedAuth !== 'all' ||
    (lockedOwner === undefined && selectedOwner !== 'all');

  const handleReset = useCallback((): void => {
    setQuery('');
    setSelectedMethod('ALL');
    setSelectedAuth('all');
    if (lockedOwner === undefined) setSelectedOwner('all');
  }, [lockedOwner]);

  return (
    <section className="docs-ref-section" aria-label="HTTP API endpoint explorer">
      <Card className="docs-filter-bar">
        <div className="docs-filter-bar__row">
          <div className="docs-filter-bar__search">
            <Input
              type="search"
              value={query}
              placeholder="Search endpoints by path, summary, contract, or schema…"
              aria-label="Search API endpoints"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <div className="docs-chip-group" role="group" aria-label="Filter by HTTP method">
            {HTTP_METHODS.map((method) => (
              <Button
                key={method}
                type="button"
                size="small"
                variant={selectedMethod === method ? 'primary' : 'secondary'}
                aria-pressed={selectedMethod === method}
                onClick={() => {
                  setSelectedMethod(method);
                }}
              >
                {method}
              </Button>
            ))}
          </div>
        </div>

        <div className="docs-filter-bar__row">
          <div className="docs-chip-group" role="group" aria-label="Filter by authentication">
            {AUTH_FILTERS.map((auth) => (
              <Button
                key={auth}
                type="button"
                size="small"
                variant={selectedAuth === auth ? 'primary' : 'text'}
                aria-pressed={selectedAuth === auth}
                onClick={() => {
                  setSelectedAuth(auth);
                }}
              >
                {auth === 'all'
                  ? 'All auth'
                  : auth === 'public'
                    ? 'Public'
                    : auth === 'admin'
                      ? 'Admin only'
                      : 'Authenticated'}
              </Button>
            ))}
          </div>
          <div className="docs-filter-bar__status">
            <Text as="span" size="xs" tone="muted">
              {`Showing ${String(filteredRoutes.length)} of ${String(scopedRoutes.length)} endpoints`}
            </Text>
            {hasFilters ? (
              <Button type="button" size="small" variant="text" onClick={handleReset}>
                Reset filters
              </Button>
            ) : null}
            {lockedOwner === undefined ? (
              <a
                href="/openapi.json"
                download="bslt-openapi.json"
                className="btn btn-secondary btn-small no-underline"
              >
                Download OpenAPI 3.1 JSON
              </a>
            ) : null}
          </div>
        </div>

        {lockedOwner === undefined ? (
          <div className="docs-chip-group" role="group" aria-label="Filter by module">
            <Button
              type="button"
              size="small"
              variant={selectedOwner === 'all' ? 'primary' : 'text'}
              aria-pressed={selectedOwner === 'all'}
              onClick={() => {
                setSelectedOwner('all');
              }}
            >
              {`All (${String(DOCS_REFERENCE.apiRoutes.length)})`}
            </Button>
            {ownerCounts.map(([owner, count]) => (
              <Button
                key={owner}
                type="button"
                size="small"
                variant={selectedOwner === owner ? 'primary' : 'text'}
                aria-pressed={selectedOwner === owner}
                onClick={() => {
                  setSelectedOwner(owner);
                }}
              >
                {`${owner} (${String(count)})`}
              </Button>
            ))}
          </div>
        ) : null}
      </Card>

      {filteredRoutes.length === 0 ? (
        <Card className="docs-empty-card">
          <Heading as="h3" size="sm">
            No matching API endpoints
          </Heading>
          <Text size="sm" tone="muted">
            Adjust your search query or clear the active method, auth, and module filters.
          </Text>
        </Card>
      ) : (
        <div className="docs-endpoint-list">
          {filteredRoutes.map((endpoint) => {
            const rowKey = `${endpoint.method}:${endpoint.path}`;
            const isExpanded = expandedKey === rowKey;
            return (
              <div key={rowKey} className="docs-endpoint-item">
                <div className="docs-endpoint-row">
                  <div className="docs-endpoint-row__main">
                    <Badge tone={methodBadgeTone(endpoint.method)} className="docs-method-badge">
                      {endpoint.method}
                    </Badge>
                    <Text as="code" size="xs" className="docs-mono-path">
                      {endpoint.path}
                    </Text>
                  </div>
                  <div className="docs-endpoint-row__meta">
                    {lockedOwner === undefined && moduleIds.has(endpoint.owner) ? (
                      <Link
                        to={`/docs/modules/${endpoint.owner}`}
                        className="docs-inline-link no-underline"
                      >
                        <Badge tone="neutral">{endpoint.owner}</Badge>
                      </Link>
                    ) : (
                      <Badge tone="neutral">{endpoint.owner}</Badge>
                    )}
                    <Badge tone={authBadgeTone(endpoint)}>{formatAuthLabel(endpoint)}</Badge>
                    <Button
                      type="button"
                      size="small"
                      variant="text"
                      aria-expanded={isExpanded}
                      onClick={() => {
                        setExpandedKey(isExpanded ? null : rowKey);
                      }}
                    >
                      {isExpanded ? 'Hide' : 'Details'}
                    </Button>
                  </div>
                </div>
                {endpoint.summary.length > 0 ? (
                  <Text as="p" size="xs" tone="muted" className="docs-endpoint-row__summary">
                    {endpoint.summary}
                  </Text>
                ) : null}
                {isExpanded ? (
                  <div className="docs-endpoint-detail">
                    <div className="docs-endpoint-detail__grid">
                      <div className="docs-kv">
                        <Text as="span" size="xs" tone="muted">
                          Contract
                        </Text>
                        <Text as="code" size="xs" className="docs-mono">
                          {endpoint.contract}
                        </Text>
                      </div>
                      <div className="docs-kv">
                        <Text as="span" size="xs" tone="muted">
                          Path Params
                        </Text>
                        <Text as="code" size="xs" className="docs-mono">
                          {endpoint.pathParams ?? '—'}
                        </Text>
                      </div>
                      <div className="docs-kv">
                        <Text as="span" size="xs" tone="muted">
                          Query Schema
                        </Text>
                        <Text as="code" size="xs" className="docs-mono">
                          {endpoint.query ?? '—'}
                        </Text>
                      </div>
                      <div className="docs-kv">
                        <Text as="span" size="xs" tone="muted">
                          Request Body
                        </Text>
                        <Text as="code" size="xs" className="docs-mono">
                          {endpoint.body ?? '—'}
                        </Text>
                      </div>
                    </div>
                    {endpoint.responses.length > 0 ? (
                      <div className="docs-endpoint-detail__responses">
                        <Text as="span" size="xs" tone="muted">
                          Responses
                        </Text>
                        <div className="docs-chip-group">
                          {endpoint.responses.map((entry) => (
                            <Badge key={entry} tone="neutral">
                              {entry}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <pre className="docs-code-block">
                      <code>{buildCurlExample(endpoint)}</code>
                    </pre>
                    <DocsEndpointTryPanel endpoint={endpoint} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export const DocsWebRoutesView = (): ReactElement => {
  const [query, setQuery] = useState('');
  const [selectedSpace, setSelectedSpace] = useState<WebSpaceFilter>('all');
  const [selectedOwner, setSelectedOwner] = useState<string>('all');

  const moduleIds = useMemo(() => knownModuleSet(), []);

  const ownerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of DOCS_REFERENCE.webRoutes) {
      counts.set(route.owner, (counts.get(route.owner) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const filteredRoutes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return DOCS_REFERENCE.webRoutes.filter((route) => {
      if (selectedOwner !== 'all' && route.owner !== selectedOwner) return false;
      if (selectedSpace !== 'all' && classifyWebRouteSpace(route) !== selectedSpace) return false;
      if (normalized.length === 0) return true;
      const haystack =
        `${route.path} ${route.owner} ${route.page} ${route.guard} ${route.layouts.join(' ')}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query, selectedOwner, selectedSpace]);

  return (
    <div className="docs-ref-section">
      <Card className="docs-filter-bar">
        <div className="docs-filter-bar__row">
          <div className="docs-filter-bar__search">
            <Input
              type="search"
              value={query}
              placeholder="Search web routes by URL path, component, owner, or shell…"
              aria-label="Search web routes"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <Text as="span" size="xs" tone="muted">
            {`Showing ${String(filteredRoutes.length)} of ${String(DOCS_REFERENCE.webRoutes.length)} routes`}
          </Text>
        </div>
        <div className="docs-chip-group" role="group" aria-label="Filter web routes by space">
          {WEB_SPACE_FILTERS.map((space) => (
            <Button
              key={space}
              type="button"
              size="small"
              variant={selectedSpace === space ? 'primary' : 'secondary'}
              aria-pressed={selectedSpace === space}
              onClick={() => {
                setSelectedSpace(space);
              }}
            >
              {space === 'all' ? 'All spaces' : spaceLabel(space)}
            </Button>
          ))}
        </div>
        <div className="docs-chip-group" role="group" aria-label="Filter web routes by owner">
          <Button
            type="button"
            size="small"
            variant={selectedOwner === 'all' ? 'primary' : 'text'}
            aria-pressed={selectedOwner === 'all'}
            onClick={() => {
              setSelectedOwner('all');
            }}
          >
            All owners
          </Button>
          {ownerCounts.map(([owner, count]) => (
            <Button
              key={owner}
              type="button"
              size="small"
              variant={selectedOwner === owner ? 'primary' : 'text'}
              aria-pressed={selectedOwner === owner}
              onClick={() => {
                setSelectedOwner(owner);
              }}
            >
              {`${owner} (${String(count)})`}
            </Button>
          ))}
        </div>
      </Card>

      {filteredRoutes.length === 0 ? (
        <Card className="docs-empty-card">
          <Heading as="h3" size="sm">
            No matching web routes
          </Heading>
          <Text size="sm" tone="muted">
            Try clearing the space or owner filter to see all{' '}
            {String(DOCS_REFERENCE.webRoutes.length)} routes.
          </Text>
        </Card>
      ) : (
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Space</th>
                <th>Owner</th>
                <th>Component</th>
                <th>Shells</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoutes.map((route) => {
                const space = classifyWebRouteSpace(route);
                return (
                  <tr key={`${route.path}:${route.page}`}>
                    <td>
                      {isLinkablePath(route.path) ? (
                        <Link to={route.path} className="docs-mono-link">
                          {route.path}
                        </Link>
                      ) : (
                        <Text as="code" size="xs" className="docs-mono">
                          {route.path}
                        </Text>
                      )}
                    </td>
                    <td>
                      <Badge tone={spaceBadgeTone(space)}>{spaceLabel(space)}</Badge>
                    </td>
                    <td>
                      {moduleIds.has(route.owner) ? (
                        <Link
                          to={`/docs/modules/${route.owner}`}
                          className="docs-inline-link no-underline"
                        >
                          <Badge tone="neutral">{route.owner}</Badge>
                        </Link>
                      ) : (
                        <Badge tone="neutral">{route.owner}</Badge>
                      )}
                    </td>
                    <td>
                      <Text as="code" size="xs" className="docs-mono">
                        {route.page}
                      </Text>
                    </td>
                    <td>
                      <Text as="span" size="xs" tone="muted">
                        {route.layouts.length > 0 ? route.layouts.join(' → ') : '—'}
                      </Text>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {DOCS_REFERENCE.adminSurfaces.length > 0 ? (
        <section aria-labelledby="docs-admin-surfaces-heading" className="docs-section">
          <div className="docs-section__header">
            <Heading as="h2" id="docs-admin-surfaces-heading" size="md">
              {`Platform Admin Console Surfaces (${String(DOCS_REFERENCE.adminSurfaces.length)})`}
            </Heading>
            <Text size="sm" tone="muted">
              Every registered surface mounted under ConsoleShell and AdminLayout.
            </Text>
          </div>
          <div className="docs-route-grid">
            {DOCS_REFERENCE.adminSurfaces.map((surface) => (
              <Link key={surface.id} to={surface.href} className="docs-route-card no-underline">
                <div className="docs-route-card__top">
                  <Text as="span" size="sm" className="docs-route-card__label">
                    {surface.label}
                  </Text>
                  <Badge tone={surface.inNavigation ? 'warning' : 'neutral'}>
                    {surface.inNavigation ? 'Admin Nav' : 'Hidden / Dev'}
                  </Badge>
                </div>
                <Text as="code" size="xs" tone="muted" className="docs-route-card__path">
                  {surface.href}
                </Text>
                <Text as="span" size="xs" tone="muted">
                  {`Owner: @bslt/${surface.owner}`}
                </Text>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

export const DocsModulesView = (): ReactElement => {
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'installed' | 'devOnly'>('all');

  const filteredModules = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return DOCS_REFERENCE.modules.filter((mod) => {
      if (scopeFilter !== 'all' && mod.scope !== scopeFilter) return false;
      if (normalized.length === 0) return true;
      const haystack =
        `${mod.id} @bslt/${mod.id} ${mod.summary} ${mod.dependsOn.join(' ')}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query, scopeFilter]);

  return (
    <div className="docs-ref-section">
      <Card className="docs-filter-bar">
        <div className="docs-filter-bar__row">
          <div className="docs-filter-bar__search">
            <Input
              type="search"
              value={query}
              placeholder="Filter vertical modules by name, summary, or dependency…"
              aria-label="Filter vertical modules"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <div className="docs-chip-group" role="group" aria-label="Filter modules by scope">
            {(['all', 'installed', 'devOnly'] as const).map((scope) => (
              <Button
                key={scope}
                type="button"
                size="small"
                variant={scopeFilter === scope ? 'primary' : 'secondary'}
                aria-pressed={scopeFilter === scope}
                onClick={() => {
                  setScopeFilter(scope);
                }}
              >
                {scope === 'all' ? 'All modules' : scope === 'installed' ? 'Installed' : 'Dev only'}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {filteredModules.length === 0 ? (
        <Card className="docs-empty-card">
          <Heading as="h3" size="sm">
            No matching modules
          </Heading>
          <Text size="sm" tone="muted">
            Clear your search or switch scope back to All modules.
          </Text>
        </Card>
      ) : (
        <div className="docs-module-grid">
          {filteredModules.map((mod) => (
            <Link
              key={mod.id}
              to={`/docs/modules/${mod.id}`}
              className="docs-module-card no-underline"
            >
              <div className="docs-route-card__top">
                <Text as="span" size="sm" className="docs-route-card__label">
                  {`@bslt/${mod.id}`}
                </Text>
                <Badge tone={mod.scope === 'installed' ? 'info' : 'neutral'}>{mod.scope}</Badge>
              </div>
              <Text as="p" size="xs" tone="muted" className="docs-module-card__summary">
                {mod.summary}
              </Text>
              <div className="docs-module-card__metrics">
                <Badge tone="neutral">{`${String(mod.endpointCount)} API`}</Badge>
                <Badge tone="neutral">{`${String(mod.webRouteCount)} screens`}</Badge>
                <Badge tone="neutral">{`${String(mod.tableCount)} tables`}</Badge>
                {mod.eventCount > 0 ? (
                  <Badge tone="neutral">{`${String(mod.eventCount)} events`}</Badge>
                ) : null}
                {mod.jobCount > 0 ? (
                  <Badge tone="neutral">{`${String(mod.jobCount)} jobs`}</Badge>
                ) : null}
              </div>
              {mod.dependsOn.length > 0 ? (
                <Text as="span" size="xs" tone="muted">
                  {`Depends on: ${mod.dependsOn.join(', ')}`}
                </Text>
              ) : null}
            </Link>
          ))}
        </div>
      )}

      <section aria-labelledby="docs-kernel-heading" className="docs-section">
        <div className="docs-section__header">
          <Heading as="h2" id="docs-kernel-heading" size="md">
            {`Platform Kernel Packages (${String(DOC_KERNEL_PACKAGES.length)})`}
          </Heading>
          <Text size="sm" tone="muted">
            Every vertical module runs on top of 12 owned kernel packages under main/kernel/* with
            zero third-party runtime npm dependencies outside React.
          </Text>
        </div>
        <div className="docs-route-grid">
          {DOC_KERNEL_PACKAGES.map((pkg) => (
            <Card key={pkg.name} className="docs-kernel-card">
              <div className="docs-route-card__top">
                <Text as="code" size="xs" className="docs-mono">
                  {pkg.name}
                </Text>
                <Badge
                  tone={
                    pkg.layer === 'Isomorphic'
                      ? 'success'
                      : pkg.layer === 'Server'
                        ? 'warning'
                        : 'info'
                  }
                >
                  {pkg.layer}
                </Badge>
              </div>
              <Text as="p" size="xs" tone="muted">
                {pkg.summary}
              </Text>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
};

interface DocsModuleDetailViewProps {
  readonly moduleRef: DocsModuleRef;
}

export const DocsModuleDetailView = ({ moduleRef }: DocsModuleDetailViewProps): ReactElement => {
  const dependents = useMemo(
    () => DOCS_REFERENCE.modules.filter((candidate) => candidate.dependsOn.includes(moduleRef.id)),
    [moduleRef.id],
  );
  const webRoutes = useMemo(
    () => DOCS_REFERENCE.webRoutes.filter((route) => route.owner === moduleRef.id),
    [moduleRef.id],
  );
  const dbTables = useMemo(
    () => DOCS_REFERENCE.dbTables.filter((table) => table.owner === moduleRef.id),
    [moduleRef.id],
  );
  const events = useMemo(
    () => DOCS_REFERENCE.events.filter((ev) => ev.owner === moduleRef.id),
    [moduleRef.id],
  );
  const jobs = useMemo(
    () => DOCS_REFERENCE.jobs.filter((job) => job.owner === moduleRef.id),
    [moduleRef.id],
  );

  return (
    <div className="docs-ref-section">
      <div className="docs-breadcrumb">
        <Link to="/docs/modules" className="docs-mono-link">
          ← All Vertical Modules
        </Link>
      </div>

      <header className="docs-hero">
        <div className="docs-hero__meta">
          <Text as="span" size="xs" tone="muted" className="docs-hero__eyebrow">
            {`MODULE / @bslt/${moduleRef.id}`}
          </Text>
          <Badge tone={moduleRef.scope === 'installed' ? 'info' : 'neutral'}>
            {moduleRef.scope}
          </Badge>
          <Badge tone="success">{moduleRef.status}</Badge>
        </div>
        <Heading as="h1" id="docs-chapter-title" size="2xl" className="docs-hero__title">
          {`@bslt/${moduleRef.id}`}
        </Heading>
        <Text tone="muted" className="docs-hero__summary">
          {moduleRef.summary}
        </Text>
        <div className="docs-dep-bar">
          <div className="docs-dep-bar__group">
            <Text as="span" size="xs" tone="muted">
              Depends on:
            </Text>
            {moduleRef.dependsOn.length === 0 ? (
              <Badge tone="neutral">kernel only</Badge>
            ) : (
              moduleRef.dependsOn.map((dep) => (
                <Link
                  key={dep}
                  to={`/docs/modules/${dep}`}
                  className="docs-inline-link no-underline"
                >
                  <Badge tone="info">{`@bslt/${dep}`}</Badge>
                </Link>
              ))
            )}
          </div>
          {dependents.length > 0 ? (
            <div className="docs-dep-bar__group">
              <Text as="span" size="xs" tone="muted">
                Required by:
              </Text>
              {dependents.map((dep) => (
                <Link
                  key={dep.id}
                  to={`/docs/modules/${dep.id}`}
                  className="docs-inline-link no-underline"
                >
                  <Badge tone="neutral">{`@bslt/${dep.id}`}</Badge>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="docs-module-stats">
        <Card className="docs-mini-stat">
          <Heading as="p" size="lg">
            {String(moduleRef.endpointCount)}
          </Heading>
          <Text as="span" size="xs" tone="muted">
            API Endpoints
          </Text>
        </Card>
        <Card className="docs-mini-stat">
          <Heading as="p" size="lg">
            {String(webRoutes.length)}
          </Heading>
          <Text as="span" size="xs" tone="muted">
            Web Screens
          </Text>
        </Card>
        <Card className="docs-mini-stat">
          <Heading as="p" size="lg">
            {String(dbTables.length)}
          </Heading>
          <Text as="span" size="xs" tone="muted">
            RLS Tables
          </Text>
        </Card>
        <Card className="docs-mini-stat">
          <Heading as="p" size="lg">
            {String(events.length)}
          </Heading>
          <Text as="span" size="xs" tone="muted">
            Domain Events
          </Text>
        </Card>
        <Card className="docs-mini-stat">
          <Heading as="p" size="lg">
            {String(jobs.length)}
          </Heading>
          <Text as="span" size="xs" tone="muted">
            Background Jobs
          </Text>
        </Card>
      </div>

      {webRoutes.length > 0 ? (
        <section aria-labelledby="docs-mod-web-heading" className="docs-section">
          <Heading as="h2" id="docs-mod-web-heading" size="md">
            {`Web Screens (${String(webRoutes.length)})`}
          </Heading>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Space</th>
                  <th>Component</th>
                  <th>Shells</th>
                </tr>
              </thead>
              <tbody>
                {webRoutes.map((route) => {
                  const space = classifyWebRouteSpace(route);
                  return (
                    <tr key={`${route.path}:${route.page}`}>
                      <td>
                        {isLinkablePath(route.path) ? (
                          <Link to={route.path} className="docs-mono-link">
                            {route.path}
                          </Link>
                        ) : (
                          <Text as="code" size="xs" className="docs-mono">
                            {route.path}
                          </Text>
                        )}
                      </td>
                      <td>
                        <Badge tone={spaceBadgeTone(space)}>{spaceLabel(space)}</Badge>
                      </td>
                      <td>
                        <Text as="code" size="xs" className="docs-mono">
                          {route.page}
                        </Text>
                      </td>
                      <td>
                        <Text as="span" size="xs" tone="muted">
                          {route.layouts.length > 0 ? route.layouts.join(' → ') : '—'}
                        </Text>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="docs-mod-api-heading" className="docs-section">
        <Heading as="h2" id="docs-mod-api-heading" size="md">
          {`HTTP API Endpoints (${String(moduleRef.endpointCount)})`}
        </Heading>
        <DocsApiReferenceView lockedOwner={moduleRef.id} />
      </section>

      {dbTables.length > 0 ? (
        <section aria-labelledby="docs-mod-db-heading" className="docs-section">
          <Heading as="h2" id="docs-mod-db-heading" size="md">
            {`PostgreSQL RLS Tables (${String(dbTables.length)})`}
          </Heading>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>RLS Class</th>
                  <th>Owner Column</th>
                  <th>Columns</th>
                </tr>
              </thead>
              <tbody>
                {dbTables.map((table) => (
                  <tr key={table.name}>
                    <td>
                      <Text as="code" size="xs" className="docs-mono">
                        {table.name}
                      </Text>
                    </td>
                    <td>
                      <Badge tone={rlsBadgeTone(table.rlsClass)}>{table.rlsClass}</Badge>
                    </td>
                    <td>
                      <Text as="code" size="xs" className="docs-mono">
                        {table.ownerColumn ?? '—'}
                      </Text>
                    </td>
                    <td>
                      <Text as="span" size="xs" tone="muted">
                        {String(table.columnCount)}
                      </Text>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {events.length > 0 || jobs.length > 0 ? (
        <section aria-labelledby="docs-mod-async-heading" className="docs-section">
          <Heading as="h2" id="docs-mod-async-heading" size="md">
            Events &amp; Background Jobs
          </Heading>
          {events.length > 0 ? (
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Domain Event</th>
                    <th>Manifest Key</th>
                    <th>Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.name}>
                      <td>
                        <Text as="code" size="xs" className="docs-mono">
                          {ev.name}
                        </Text>
                      </td>
                      <td>
                        <Text as="code" size="xs" className="docs-mono">
                          {ev.key}
                        </Text>
                      </td>
                      <td>
                        <Badge tone={ev.webhook ? 'success' : 'neutral'}>
                          {ev.webhook ? 'Outbound Webhook' : 'Internal Outbox'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {jobs.length > 0 ? (
            <div className="docs-chip-group">
              {jobs.map((job) => (
                <Badge key={job.name} tone="info">
                  {`job: ${job.name}`}
                </Badge>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};

export const DocsDatabaseView = (): ReactElement => {
  const [query, setQuery] = useState('');
  const [selectedRls, setSelectedRls] = useState<string>('all');
  const [selectedOwner, setSelectedOwner] = useState<string>('all');

  const moduleIds = useMemo(() => knownModuleSet(), []);

  const rlsCategories = useMemo(() => {
    const set = new Set(DOCS_REFERENCE.dbTables.map((table) => table.rlsClass));
    return ['all', ...[...set].sort()];
  }, []);

  const owners = useMemo(() => {
    const counts = new Map<string, number>();
    for (const table of DOCS_REFERENCE.dbTables) {
      counts.set(table.owner, (counts.get(table.owner) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const filteredTables = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return DOCS_REFERENCE.dbTables.filter((table) => {
      if (selectedRls !== 'all' && table.rlsClass !== selectedRls) return false;
      if (selectedOwner !== 'all' && table.owner !== selectedOwner) return false;
      if (normalized.length === 0) return true;
      const haystack =
        `${table.name} ${table.owner} ${table.rlsClass} ${table.ownerColumn ?? ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query, selectedOwner, selectedRls]);

  return (
    <div className="docs-ref-section">
      <Card className="docs-filter-bar">
        <div className="docs-filter-bar__row">
          <div className="docs-filter-bar__search">
            <Input
              type="search"
              value={query}
              placeholder="Search PostgreSQL tables by name, owner, or RLS class…"
              aria-label="Search database tables"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <Text as="span" size="xs" tone="muted">
            {`Showing ${String(filteredTables.length)} of ${String(DOCS_REFERENCE.dbTables.length)} tables`}
          </Text>
        </div>
        <div className="docs-chip-group" role="group" aria-label="Filter tables by RLS class">
          {rlsCategories.map((cls) => (
            <Button
              key={cls}
              type="button"
              size="small"
              variant={selectedRls === cls ? 'primary' : 'secondary'}
              aria-pressed={selectedRls === cls}
              onClick={() => {
                setSelectedRls(cls);
              }}
            >
              {cls === 'all' ? 'All RLS classes' : cls}
            </Button>
          ))}
        </div>
        <div className="docs-chip-group" role="group" aria-label="Filter tables by owner">
          <Button
            type="button"
            size="small"
            variant={selectedOwner === 'all' ? 'primary' : 'text'}
            aria-pressed={selectedOwner === 'all'}
            onClick={() => {
              setSelectedOwner('all');
            }}
          >
            All owners
          </Button>
          {owners.map(([owner, count]) => (
            <Button
              key={owner}
              type="button"
              size="small"
              variant={selectedOwner === owner ? 'primary' : 'text'}
              aria-pressed={selectedOwner === owner}
              onClick={() => {
                setSelectedOwner(owner);
              }}
            >
              {`${owner} (${String(count)})`}
            </Button>
          ))}
        </div>
      </Card>

      {filteredTables.length === 0 ? (
        <Card className="docs-empty-card">
          <Heading as="h3" size="sm">
            No matching database tables
          </Heading>
          <Text size="sm" tone="muted">
            Clear your RLS class or owner filter to see all {String(DOCS_REFERENCE.dbTables.length)}{' '}
            tables.
          </Text>
        </Card>
      ) : (
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Owner</th>
                <th>RLS Class</th>
                <th>Owner Column</th>
                <th>Columns</th>
              </tr>
            </thead>
            <tbody>
              {filteredTables.map((table) => (
                <tr key={table.name}>
                  <td>
                    <Text as="code" size="xs" className="docs-mono">
                      {table.name}
                    </Text>
                  </td>
                  <td>
                    {moduleIds.has(table.owner) ? (
                      <Link
                        to={`/docs/modules/${table.owner}`}
                        className="docs-inline-link no-underline"
                      >
                        <Badge tone="neutral">{table.owner}</Badge>
                      </Link>
                    ) : (
                      <Badge tone="neutral">{table.owner}</Badge>
                    )}
                  </td>
                  <td>
                    <Badge tone={rlsBadgeTone(table.rlsClass)}>{table.rlsClass}</Badge>
                  </td>
                  <td>
                    <Text as="code" size="xs" className="docs-mono">
                      {table.ownerColumn ?? '—'}
                    </Text>
                  </td>
                  <td>
                    <Text as="span" size="xs" tone="muted">
                      {String(table.columnCount)}
                    </Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="docs-db-enums-heading" className="docs-section">
        <Heading as="h2" id="docs-db-enums-heading" size="md">
          {`Enum & Domain Types (${String(DOCS_REFERENCE.dbTypes.length)})`}
        </Heading>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Owner</th>
                <th>Kind</th>
                <th>Values</th>
              </tr>
            </thead>
            <tbody>
              {DOCS_REFERENCE.dbTypes.map((dbType) => (
                <tr key={dbType.name}>
                  <td>
                    <Text as="code" size="xs" className="docs-mono">
                      {dbType.name}
                    </Text>
                  </td>
                  <td>
                    <Badge tone="neutral">{dbType.owner}</Badge>
                  </td>
                  <td>
                    <Badge tone="info">{dbType.kind}</Badge>
                  </td>
                  <td>
                    <Text as="code" size="xs" className="docs-mono">
                      {dbType.details}
                    </Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="docs-db-fns-heading" className="docs-section">
        <Heading as="h2" id="docs-db-fns-heading" size="md">
          {`SQL Security & RLS Functions (${String(DOCS_REFERENCE.dbFunctions.length)})`}
        </Heading>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Function</th>
                <th>Owner</th>
                <th>Security</th>
                <th>Volatility</th>
              </tr>
            </thead>
            <tbody>
              {DOCS_REFERENCE.dbFunctions.map((fn) => (
                <tr key={fn.name}>
                  <td>
                    <Text as="code" size="xs" className="docs-mono">
                      {fn.name}
                    </Text>
                  </td>
                  <td>
                    <Badge tone="neutral">{fn.owner}</Badge>
                  </td>
                  <td>
                    <Badge tone={fn.security === 'definer' ? 'warning' : 'info'}>
                      {fn.security}
                    </Badge>
                  </td>
                  <td>
                    <Text as="span" size="xs" tone="muted">
                      {fn.volatility}
                    </Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export const DocsEventsView = (): ReactElement => {
  const [query, setQuery] = useState('');
  const [webhooksOnly, setWebhooksOnly] = useState(false);

  const moduleIds = useMemo(() => knownModuleSet(), []);

  const filteredEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return DOCS_REFERENCE.events.filter((ev) => {
      if (webhooksOnly && !ev.webhook) return false;
      if (normalized.length === 0) return true;
      return `${ev.owner} ${ev.name} ${ev.key}`.toLowerCase().includes(normalized);
    });
  }, [query, webhooksOnly]);

  const webhookCount = useMemo(() => DOCS_REFERENCE.events.filter((ev) => ev.webhook).length, []);

  return (
    <div className="docs-ref-section">
      <Card className="docs-filter-bar">
        <div className="docs-filter-bar__row">
          <div className="docs-filter-bar__search">
            <Input
              type="search"
              value={query}
              placeholder="Search outbox events by name, owner, or manifest key…"
              aria-label="Search domain events"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <Button
            type="button"
            size="small"
            variant={webhooksOnly ? 'primary' : 'secondary'}
            aria-pressed={webhooksOnly}
            onClick={() => {
              setWebhooksOnly((prev) => !prev);
            }}
          >
            {`Outbound Webhooks Only (${String(webhookCount)})`}
          </Button>
        </div>
      </Card>

      <section aria-labelledby="docs-outbox-heading" className="docs-section">
        <Heading as="h2" id="docs-outbox-heading" size="md">
          {`Domain Events (sys_outbox — ${String(filteredEvents.length)} of ${String(DOCS_REFERENCE.events.length)})`}
        </Heading>
        {filteredEvents.length === 0 ? (
          <Card className="docs-empty-card">
            <Text size="sm" tone="muted">
              No matching domain events.
            </Text>
          </Card>
        ) : (
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Event Name</th>
                  <th>Owner</th>
                  <th>Manifest Key</th>
                  <th>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((ev) => (
                  <tr key={ev.name}>
                    <td>
                      <Text as="code" size="xs" className="docs-mono">
                        {ev.name}
                      </Text>
                    </td>
                    <td>
                      {moduleIds.has(ev.owner) ? (
                        <Link
                          to={`/docs/modules/${ev.owner}`}
                          className="docs-inline-link no-underline"
                        >
                          <Badge tone="neutral">{ev.owner}</Badge>
                        </Link>
                      ) : (
                        <Badge tone="neutral">{ev.owner}</Badge>
                      )}
                    </td>
                    <td>
                      <Text as="code" size="xs" className="docs-mono">
                        {ev.key}
                      </Text>
                    </td>
                    <td>
                      <Badge tone={ev.webhook ? 'success' : 'neutral'}>
                        {ev.webhook ? 'Outbound Webhook' : 'Internal Outbox'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="docs-jobs-heading" className="docs-section">
        <Heading as="h2" id="docs-jobs-heading" size="md">
          {`Background Jobs (sys_jobs — ${String(DOCS_REFERENCE.jobs.length)})`}
        </Heading>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Job Name</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {DOCS_REFERENCE.jobs.map((job) => (
                <tr key={job.name}>
                  <td>
                    <Text as="code" size="xs" className="docs-mono">
                      {job.name}
                    </Text>
                  </td>
                  <td>
                    <Badge tone="neutral">{job.owner}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="docs-crons-heading" className="docs-section">
        <Heading as="h2" id="docs-crons-heading" size="md">
          {`Scheduled Crons (sys_cron_schedules — ${String(DOCS_REFERENCE.crons.length)})`}
        </Heading>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Cron Name</th>
                <th>Schedule</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {DOCS_REFERENCE.crons.map((cron) => (
                <tr key={cron.name}>
                  <td>
                    <Text as="code" size="xs" className="docs-mono">
                      {cron.name}
                    </Text>
                  </td>
                  <td>
                    <Text as="code" size="xs" className="docs-mono">
                      {cron.schedule}
                    </Text>
                  </td>
                  <td>
                    <Badge tone="neutral">{cron.owner}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
