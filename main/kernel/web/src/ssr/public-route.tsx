// main/kernel/web/src/ssr/public-route.tsx
/**
 * Owned Public SSR seam (restructure plan §11.3).
 *
 * Isolates server rendering and client hydration strictly to `PublicRoute<D>`
 * declarations backed by `AnonymousSdk` (`auth: 'public'` + `cache.public` only,
 * `credentials: 'omit'`, zero cookies/sessions forwarded, per-request `QueryCache`).
 */

import {
  createEndpointClient,
  createTransport,
  QueryCache,
  type EndpointCall,
  type EndpointClientInput,
  type QueryKey,
  type Transport,
} from '@bslt/client-engine';
import {
  endpointQueryKey,
  MemoryRouter,
  QueryCacheProvider,
  RouterContext,
  TransportProvider,
  useLocation,
  type NavigateFunction,
  type NavigationType,
  type RouterLocation,
} from '@bslt/react';
import { ThemeProvider } from '@bslt/ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '../capabilities';

import type { Endpoint, ModuleDefinition, OutputOf } from '@bslt/contract';

export const SSR_STATE_ELEMENT_ID = '__BSLT_STATE__';
const APP_SPLASH_ID = 'app-splash';
const HEAD_MARKER = '<!--ssr-head-->';
const OUTLET_MARKER = '<!--ssr-outlet-->';
const ROOT_OPEN = '<div id="root">';
const DEFAULT_TITLE_PATTERN = /\s*<title data-default-title>[\s\S]*?<\/title>/u;
const MAIN_SCRIPT_PATTERN =
  /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>/iu;

const FORBIDDEN_ANONYMOUS_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-sudo-token',
  'x-tenant-id',
]);

export class AnonymousSdkViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnonymousSdkViolationError';
  }
}

type PublicCachedEndpointKeys<C extends Readonly<Record<string, Endpoint>>> = {
  readonly [K in keyof C & string]: C[K] extends {
    readonly auth: 'public';
    readonly cache: { readonly public: number };
  }
    ? K
    : never;
}[keyof C & string];

type AnonymousModuleClient<Id extends string, C extends Readonly<Record<string, Endpoint>>> = {
  readonly [K in PublicCachedEndpointKeys<C>]: EndpointCall<Id, K, C[K]>;
};

export type AnonymousSdkForModules<
  Mods extends readonly Pick<ModuleDefinition, 'id' | 'endpoints'>[],
> = {
  readonly [
    M in Mods[number] as PublicCachedEndpointKeys<M['endpoints']> extends never ? never : M['id']
  ]: AnonymousModuleClient<M['id'], M['endpoints']>;
};

export type AnonymousSdk = Readonly<Record<string, Readonly<Record<string, EndpointCall>>>>;

export interface HeadTags {
  readonly title: string;
  readonly description?: string | undefined;
  readonly canonical?: string | undefined;
  readonly ogTitle?: string | undefined;
  readonly ogDescription?: string | undefined;
  readonly ogType?: 'website' | 'article' | undefined;
  readonly ogImage?: string | undefined;
  readonly twitterCard?: 'summary' | 'summary_large_image' | undefined;
  readonly robots?: string | undefined;
  readonly jsonLd?: Readonly<Record<string, unknown>> | undefined;
}

interface SitemapEntry {
  readonly path: `/${string}`;
  readonly lastmod?: string | undefined;
}

export interface PublicRoute<D, Sdk = AnonymousSdk> {
  readonly path: `/${string}`;
  load(ctx: {
    readonly sdk: Sdk;
    readonly params: Readonly<Record<string, string>>;
    readonly url: URL;
  }): Promise<D>;
  head(data: D): HeadTags;
  readonly Component: ComponentType<{ readonly data: D }>;
  sitemap?(sdk: Sdk): AsyncIterable<SitemapEntry>;
  readonly cacheSeconds: number;
}

interface DehydratedPublicState {
  readonly routePath: string;
  readonly urlPathname: string;
  readonly data: unknown;
  readonly queries: readonly { readonly queryKey: QueryKey; readonly data: unknown }[];
}

export interface SsrEnv<Sdk = AnonymousSdk> {
  readonly apiInternalUrl: string;
  readonly siteUrl: string | null;
  readonly appName?: string | undefined;
  readonly template?: string | undefined;
  readonly modules?: readonly Pick<ModuleDefinition, 'id' | 'endpoints'>[] | undefined;
  readonly sdk?: Sdk | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly Shell?: ComponentType<{ readonly children?: ReactNode }> | undefined;
  readonly publicEntryScripts?: readonly string[] | undefined;
  readonly publicEntryStyles?: readonly string[] | undefined;
}

export interface SsrResult {
  readonly status: 200;
  readonly html: string;
  readonly bodyHtml: string;
  readonly headHtml: string;
  readonly stateScriptHtml: string;
  readonly cacheControl: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface HydratePublicOptions<Sdk = AnonymousSdk> {
  readonly modules?: readonly Pick<ModuleDefinition, 'id' | 'endpoints'>[] | undefined;
  readonly sdk?: Sdk | undefined;
  readonly apiBaseUrl?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly Shell?: ComponentType<{ readonly children?: ReactNode }> | undefined;
  readonly onUnhandledNavigate?: ((href: string) => void) | undefined;
}

export interface HydratePublicHandle {
  unmount(): void;
}

function normalizePathname(pathname: string): string {
  if (pathname === '' || pathname === '/') return '/';
  const trimmed = pathname.replace(/\/+$/u, '');
  return trimmed === '' ? '/' : trimmed;
}

function trimOrigin(siteUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error(`Invalid siteUrl "${siteUrl}": expected an absolute http(s):// origin`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid siteUrl "${siteUrl}": expected an absolute http(s):// origin`);
  }
  return parsed.origin;
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function escapeHtmlAttr(value: string): string {
  return JSON.stringify(value);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function escapeJsonForScript(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

export function serializeDehydratedState(state: DehydratedPublicState): string {
  return `<script type="application/json" id="${SSR_STATE_ELEMENT_ID}">${escapeJsonForScript(state)}</script>`;
}

function parseDehydratedState(doc: Document = document): DehydratedPublicState | null {
  const el = doc.getElementById(SSR_STATE_ELEMENT_ID);
  if (el === null) return null;
  const raw = el.textContent.trim();
  if (raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj['routePath'] !== 'string' || typeof obj['urlPathname'] !== 'string') {
      return null;
    }
    const rawQueries = Array.isArray(obj['queries']) ? obj['queries'] : [];
    const queries: Array<{ readonly queryKey: QueryKey; readonly data: unknown }> = [];
    for (const item of rawQueries) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const q = item as Record<string, unknown>;
        if (Array.isArray(q['queryKey'])) {
          queries.push({ queryKey: q['queryKey'] as QueryKey, data: q['data'] });
        }
      }
    }
    return {
      routePath: obj['routePath'],
      urlPathname: obj['urlPathname'],
      data: obj['data'],
      queries,
    };
  } catch {
    return null;
  }
}

function assertNoForbiddenHeaders(headersInit: HeadersInit | undefined): Headers {
  const headers = new Headers(headersInit);
  for (const [name] of headers.entries()) {
    if (FORBIDDEN_ANONYMOUS_HEADERS.has(name.toLowerCase())) {
      throw new AnonymousSdkViolationError(
        `AnonymousSdk forbids forwarding credential or session header "${name}" during public SSR`,
      );
    }
  }
  return headers;
}

function createAnonymousTransport(options: {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch | undefined;
}): Transport {
  const baseFetch = options.fetchImpl ?? globalThis.fetch;
  const anonymousFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const cleanHeaders = assertNoForbiddenHeaders(init?.headers);
    return baseFetch(input, {
      ...init,
      headers: cleanHeaders,
      credentials: 'omit',
    });
  };

  return createTransport({
    baseUrl: options.baseUrl,
    getToken: () => null,
    getTenantId: () => null,
    onUnauthorized: () => Promise.resolve(false),
    fetchImpl: anonymousFetch,
  });
}

function isEligiblePublicCachedEndpoint(ep: Endpoint): boolean {
  return (
    ep.auth === 'public' &&
    ep.cache !== undefined &&
    typeof ep.cache.public === 'number' &&
    Number.isInteger(ep.cache.public) &&
    ep.cache.public >= 0
  );
}

export function createAnonymousSdk<
  const Mods extends readonly Pick<ModuleDefinition, 'id' | 'endpoints'>[],
>(
  modules: Mods,
  options: {
    readonly baseUrl: string;
    readonly fetchImpl?: typeof fetch | undefined;
    readonly queryCache?: QueryCache | undefined;
  },
): AnonymousSdkForModules<Mods> {
  const transport = createAnonymousTransport({
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  });

  const moduleMap = new Map<string, Readonly<Record<string, unknown>>>();

  for (const mod of modules) {
    const rawClient = createEndpointClient(mod, transport);
    const allowedCalls = new Map<string, EndpointCall>();

    for (const [endpointName, ep] of Object.entries(mod.endpoints)) {
      if (!isEligiblePublicCachedEndpoint(ep)) continue;
      const underlying = rawClient[endpointName];
      if (underlying === undefined) continue;

      const wrappedInvoke = async (
        input?: EndpointClientInput<Endpoint>,
        callOptions?: { readonly headers?: Readonly<Record<string, string>> | undefined },
      ): Promise<OutputOf<Endpoint>> => {
        if (callOptions?.headers !== undefined) {
          assertNoForbiddenHeaders(callOptions.headers);
        }
        const invokeFn = underlying as (
          arg?: EndpointClientInput<Endpoint>,
          opts?: { readonly headers?: Readonly<Record<string, string>> | undefined },
        ) => Promise<OutputOf<Endpoint>>;
        const data = await invokeFn(input, callOptions);
        if (options.queryCache !== undefined) {
          const key = endpointQueryKey(underlying, input);
          const staleMs = (ep.cache?.public ?? 0) * 1000;
          options.queryCache.setQueryData(key, data, {
            staleTime: Math.max(staleMs, 1000),
          });
        }
        return data;
      };

      const wrappedCall = Object.assign(wrappedInvoke, {
        moduleId: mod.id,
        endpointName,
        endpoint: ep,
      }) as EndpointCall;

      allowedCalls.set(endpointName, wrappedCall);
    }

    const moduleProxy = new Proxy(Object.freeze({}), {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') return undefined;
        const call = allowedCalls.get(prop);
        if (call !== undefined) return call;
        throw new AnonymousSdkViolationError(
          `Endpoint "${mod.id}.${prop}" is not eligible for AnonymousSdk (requires auth: "public" and cache.public)`,
        );
      },
      has(_target, prop) {
        return typeof prop === 'string' && allowedCalls.has(prop);
      },
      ownKeys() {
        return [...allowedCalls.keys()];
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === 'string' && allowedCalls.has(prop)) {
          return {
            configurable: true,
            enumerable: true,
            value: allowedCalls.get(prop),
            writable: false,
          };
        }
        return undefined;
      },
    });

    moduleMap.set(mod.id, moduleProxy);
  }

  const sdkProxy = new Proxy(Object.freeze({}), {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') return undefined;
      const modClient = moduleMap.get(prop);
      if (modClient !== undefined) return modClient;
      throw new AnonymousSdkViolationError(`Module "${prop}" is not registered in AnonymousSdk`);
    },
    has(_target, prop) {
      return typeof prop === 'string' && moduleMap.has(prop);
    },
    ownKeys() {
      return [...moduleMap.keys()];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'string' && moduleMap.has(prop)) {
        return {
          configurable: true,
          enumerable: true,
          value: moduleMap.get(prop),
          writable: false,
        };
      }
      return undefined;
    },
  });

  return sdkProxy as unknown as AnonymousSdkForModules<Mods>;
}

export function definePublicRoute<D, Sdk = AnonymousSdk>(
  route: PublicRoute<D, Sdk>,
): PublicRoute<unknown, Sdk> {
  if (!route.path.startsWith('/') || route.path.length === 0) {
    throw new Error(`PublicRoute path "${route.path}" must start with "/"`);
  }
  if (/\s/u.test(route.path)) {
    throw new Error(`PublicRoute path "${route.path}" must not contain whitespace`);
  }
  if (
    typeof route.cacheSeconds !== 'number' ||
    Number.isNaN(route.cacheSeconds) ||
    route.cacheSeconds < 0 ||
    (Number.isFinite(route.cacheSeconds) && !Number.isInteger(route.cacheSeconds))
  ) {
    throw new Error(
      `PublicRoute "${route.path}" cacheSeconds must be a non-negative integer or Infinity`,
    );
  }
  return Object.freeze({ ...route }) as unknown as PublicRoute<unknown, Sdk>;
}

function matchPublicRoute<Sdk = AnonymousSdk>(
  pathname: string,
  routes: readonly PublicRoute<unknown, Sdk>[],
): {
  readonly route: PublicRoute<unknown, Sdk>;
  readonly params: Readonly<Record<string, string>>;
} | null {
  const normalized = normalizePathname(pathname);
  const urlSegments = normalized === '/' ? [] : normalized.slice(1).split('/');

  for (const route of routes) {
    const routeNormalized = normalizePathname(route.path);
    if (routeNormalized === normalized && !routeNormalized.includes(':')) {
      return { route, params: Object.freeze({}) };
    }
    const routeSegments = routeNormalized === '/' ? [] : routeNormalized.slice(1).split('/');
    if (routeSegments.length !== urlSegments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < routeSegments.length; i++) {
      const patternSeg = routeSegments[i] ?? '';
      const actualSeg = urlSegments[i] ?? '';
      if (patternSeg.startsWith(':')) {
        const key = patternSeg.slice(1);
        if (key === '' || actualSeg === '') {
          matched = false;
          break;
        }
        try {
          params[key] = decodeURIComponent(actualSeg);
        } catch {
          matched = false;
          break;
        }
      } else if (patternSeg !== actualSeg) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { route, params: Object.freeze(params) };
    }
  }

  return null;
}

function resolveAbsoluteCanonical(
  explicitCanonical: string | undefined,
  siteUrl: string | null,
  pathname: string,
): string | null {
  if (explicitCanonical !== undefined && explicitCanonical.trim() !== '') {
    const candidate = explicitCanonical.trim();
    if (/^https?:\/\//iu.test(candidate) && URL.canParse(candidate)) {
      return new URL(candidate).toString();
    }
  }
  if (siteUrl === null || siteUrl.trim() === '') {
    return null;
  }
  const origin = trimOrigin(siteUrl);
  const normalized = normalizePathname(pathname);
  return `${origin}${normalized}`;
}

export function formatHeadTags(
  tags: HeadTags,
  options: {
    readonly siteUrl: string | null;
    readonly pathname: string;
    readonly appName: string;
  },
): string {
  const title = tags.title.trim() === '' ? options.appName : tags.title;
  const description = tags.description?.trim() ?? '';
  const ogTitle = tags.ogTitle?.trim() ?? title;
  const ogDescription = tags.ogDescription?.trim() ?? description;
  const ogType = tags.ogType ?? 'website';
  const canonical = resolveAbsoluteCanonical(tags.canonical, options.siteUrl, options.pathname);
  const resolvedOgImage =
    tags.ogImage !== undefined && tags.ogImage.trim() !== ''
      ? tags.ogImage.trim()
      : canonical !== null
        ? `${new URL(canonical).origin}/brand/og-image.png`
        : '';
  const twitterCard =
    tags.twitterCard ?? (resolvedOgImage !== '' ? 'summary_large_image' : 'summary');

  const lines: string[] = [
    `<title>${escapeHtmlText(title)}</title>`,
    description !== '' ? `<meta name="description" content=${escapeHtmlAttr(description)}>` : '',
    tags.robots !== undefined && tags.robots.trim() !== ''
      ? `<meta name="robots" content=${escapeHtmlAttr(tags.robots.trim())}>`
      : '',
    `<meta property="og:site_name" content=${escapeHtmlAttr(options.appName)}>`,
    `<meta property="og:title" content=${escapeHtmlAttr(ogTitle)}>`,
    ogDescription !== ''
      ? `<meta property="og:description" content=${escapeHtmlAttr(ogDescription)}>`
      : '',
    `<meta property="og:type" content=${escapeHtmlAttr(ogType)}>`,
    resolvedOgImage !== ''
      ? `<meta property="og:image" content=${escapeHtmlAttr(resolvedOgImage)}>`
      : '',
    `<meta name="twitter:card" content=${escapeHtmlAttr(twitterCard)}>`,
    `<meta name="twitter:title" content=${escapeHtmlAttr(ogTitle)}>`,
    ogDescription !== ''
      ? `<meta name="twitter:description" content=${escapeHtmlAttr(ogDescription)}>`
      : '',
    resolvedOgImage !== ''
      ? `<meta name="twitter:image" content=${escapeHtmlAttr(resolvedOgImage)}>`
      : '',
    canonical !== null ? `<link rel="canonical" href=${escapeHtmlAttr(canonical)}>` : '',
    canonical !== null ? `<meta property="og:url" content=${escapeHtmlAttr(canonical)}>` : '',
  ];

  if (tags.jsonLd !== undefined) {
    lines.push(`<script type="application/ld+json">${escapeJsonForScript(tags.jsonLd)}</script>`);
  } else if (canonical !== null) {
    const origin = new URL(canonical).origin;
    const defaultJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      url: canonical,
      ...(description !== '' ? { description } : {}),
      isPartOf: {
        '@type': 'WebSite',
        name: options.appName,
        url: origin,
      },
    };
    lines.push(`<script type="application/ld+json">${escapeJsonForScript(defaultJsonLd)}</script>`);
  }

  return lines.filter((line) => line !== '').join('\n    ');
}

function upsertMetaTag(
  doc: Document,
  attr: 'name' | 'property',
  key: string,
  content: string,
): void {
  const selector = `meta[${attr}="${key}"]`;
  const existing = doc.head.querySelector(selector);
  if (content === '') {
    existing?.remove();
    return;
  }
  if (existing !== null) {
    existing.setAttribute('content', content);
    return;
  }
  const el = doc.createElement('meta');
  el.setAttribute(attr, key);
  el.setAttribute('content', content);
  doc.head.appendChild(el);
}

function upsertCanonicalLink(doc: Document, href: string | null): void {
  const existing = doc.head.querySelector('link[rel="canonical"]');
  if (href === null) {
    existing?.remove();
    return;
  }
  if (existing !== null) {
    existing.setAttribute('href', href);
    return;
  }
  const el = doc.createElement('link');
  el.setAttribute('rel', 'canonical');
  el.setAttribute('href', href);
  doc.head.appendChild(el);
}

export function applyClientHeadTags(
  doc: Document,
  tags: HeadTags,
  options: {
    readonly appName: string;
    readonly siteUrl?: string | null | undefined;
    readonly pathname?: string | undefined;
  },
): void {
  const title = tags.title.trim() === '' ? options.appName : tags.title.trim();
  const description = tags.description?.trim() ?? '';
  const ogTitle = tags.ogTitle?.trim() ?? title;
  const ogDescription = tags.ogDescription?.trim() ?? description;
  const ogType = tags.ogType ?? 'website';
  const siteUrl = options.siteUrl ?? null;
  const pathname = options.pathname ?? '/';
  const canonical = resolveAbsoluteCanonical(tags.canonical, siteUrl, pathname);
  const resolvedOgImage =
    tags.ogImage !== undefined && tags.ogImage.trim() !== ''
      ? tags.ogImage.trim()
      : canonical !== null
        ? `${new URL(canonical).origin}/brand/og-image.png`
        : '';
  const twitterCard =
    tags.twitterCard ?? (resolvedOgImage !== '' ? 'summary_large_image' : 'summary');

  doc.title = title;
  upsertMetaTag(doc, 'name', 'description', description);
  upsertMetaTag(doc, 'name', 'robots', tags.robots?.trim() ?? '');
  upsertMetaTag(doc, 'property', 'og:site_name', options.appName);
  upsertMetaTag(doc, 'property', 'og:title', ogTitle);
  upsertMetaTag(doc, 'property', 'og:description', ogDescription);
  upsertMetaTag(doc, 'property', 'og:type', ogType);
  upsertMetaTag(doc, 'property', 'og:image', resolvedOgImage);
  upsertMetaTag(doc, 'property', 'og:url', canonical ?? '');
  upsertMetaTag(doc, 'name', 'twitter:card', twitterCard);
  upsertMetaTag(doc, 'name', 'twitter:title', ogTitle);
  upsertMetaTag(doc, 'name', 'twitter:description', ogDescription);
  upsertMetaTag(doc, 'name', 'twitter:image', resolvedOgImage);
  upsertCanonicalLink(doc, canonical);
}

function cacheControlForSeconds(cacheSeconds: number): string {
  if (!Number.isFinite(cacheSeconds)) {
    return 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
  }
  if (cacheSeconds <= 0) {
    return 'public, max-age=0, must-revalidate';
  }
  const stale = Math.max(cacheSeconds, 60);
  return `public, max-age=${String(cacheSeconds)}, s-maxage=${String(cacheSeconds)}, stale-while-revalidate=${String(stale)}`;
}

export function injectPublicSsrHtml(
  template: string,
  parts: {
    readonly headHtml: string;
    readonly bodyHtml: string;
    readonly stateScriptHtml: string;
    readonly publicEntryScripts?: readonly string[] | undefined;
    readonly publicEntryStyles?: readonly string[] | undefined;
  },
): string {
  for (const marker of [HEAD_MARKER, OUTLET_MARKER, ROOT_OPEN]) {
    if (!template.includes(marker)) {
      throw new Error(`SSR template is missing required marker ${marker}`);
    }
  }

  const styleLinks = (parts.publicEntryStyles ?? [])
    .map((href) => `<link rel="stylesheet" crossorigin href=${escapeHtmlAttr(href)}>`)
    .join('\n    ');
  const combinedHead = styleLinks !== '' ? `${parts.headHtml}\n    ${styleLinks}` : parts.headHtml;

  let doc = template
    .replace(DEFAULT_TITLE_PATTERN, '')
    .replace(HEAD_MARKER, combinedHead)
    .replace(ROOT_OPEN, '<div id="root" data-ssr-public="true">')
    .replace(`${OUTLET_MARKER}</div>`, `${parts.bodyHtml}</div>\n    ${parts.stateScriptHtml}`);

  if (parts.publicEntryScripts !== undefined && parts.publicEntryScripts.length > 0) {
    const scriptTags = parts.publicEntryScripts
      .map((src) => `<script type="module" crossorigin src=${escapeHtmlAttr(src)}></script>`)
      .join('\n    ');
    doc = doc.replace(MAIN_SCRIPT_PATTERN, scriptTags);
  }

  return doc;
}

function DefaultPublicFrame({ children }: { readonly children?: ReactNode }): ReactElement {
  return <>{children}</>;
}

export async function renderPublic<Sdk = AnonymousSdk>(
  url: URL,
  routes: readonly PublicRoute<unknown, Sdk>[],
  env: SsrEnv<Sdk>,
): Promise<SsrResult | null> {
  const matched = matchPublicRoute(url.pathname, routes);
  if (matched === null) {
    return null;
  }

  const queryCache = new QueryCache({
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const transport = createAnonymousTransport({
    baseUrl: env.apiInternalUrl,
    fetchImpl: env.fetchImpl,
  });

  const sdk =
    env.sdk ??
    (createAnonymousSdk(env.modules ?? [], {
      baseUrl: env.apiInternalUrl,
      fetchImpl: env.fetchImpl,
      queryCache,
    }) as unknown as Sdk);

  try {
    const data = await matched.route.load({
      sdk,
      params: matched.params,
      url,
    });

    const headTags = matched.route.head(data);
    const headHtml = formatHeadTags(headTags, {
      siteUrl: env.siteUrl,
      pathname: url.pathname,
      appName: env.appName ?? 'BSLT',
    });

    const Shell = env.Shell ?? DefaultPublicFrame;
    const RouteComponent = matched.route.Component;
    const initialEntry = `${normalizePathname(url.pathname)}${url.search}`;

    const bodyHtml = renderToString(
      <ThemeProvider>
        <QueryCacheProvider cache={queryCache}>
          <TransportProvider transport={transport}>
            <CapabilityProvider
              transport={transport}
              viewerKey={null}
              viewerPending={false}
              initialContext={EMPTY_CAPABILITY_CONTEXT}
            >
              <MemoryRouter initialEntries={[initialEntry]}>
                <Shell>
                  <RouteComponent data={data} />
                </Shell>
              </MemoryRouter>
            </CapabilityProvider>
          </TransportProvider>
        </QueryCacheProvider>
      </ThemeProvider>,
    );

    const visibleText = bodyHtml.replace(/<[^>]+>/gu, '').trim();
    const hasEmbeddedMedia = /<(?:img|svg|input|textarea|select|video|canvas)\b/iu.test(bodyHtml);
    if (visibleText === '' && !hasEmbeddedMedia) {
      throw new Error(
        `PublicRoute "${matched.route.path}" rendered an empty <div id="root"> at "${url.pathname}"`,
      );
    }

    const dehydratedQueries = queryCache
      .getAll()
      .filter((entry) => entry.state.status === 'success' && entry.state.data !== undefined)
      .map((entry) => ({
        queryKey: entry.queryKey,
        data: entry.state.data,
      }));

    const stateScriptHtml = serializeDehydratedState({
      routePath: matched.route.path,
      urlPathname: normalizePathname(url.pathname),
      data,
      queries: dehydratedQueries,
    });

    const cacheControl = cacheControlForSeconds(matched.route.cacheSeconds);
    const headers: Readonly<Record<string, string>> = Object.freeze({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cacheControl,
    });

    const html =
      env.template !== undefined
        ? injectPublicSsrHtml(env.template, {
            headHtml,
            bodyHtml,
            stateScriptHtml,
            publicEntryScripts: env.publicEntryScripts,
            publicEntryStyles: env.publicEntryStyles,
          })
        : `<!doctype html><html><head>${headHtml}</head><body><div id="root" data-ssr-public="true">${bodyHtml}</div>${stateScriptHtml}</body></html>`;

    return {
      status: 200,
      html,
      bodyHtml,
      headHtml,
      stateScriptHtml,
      cacheControl,
      headers,
    };
  } finally {
    queryCache.destroy();
  }
}

function PublicHydratedViewport<Sdk = AnonymousSdk>({
  routes,
  initialPathname,
  initialData,
  hasInitialData,
  sdk,
  Shell,
  onUnhandledNavigate,
}: {
  readonly routes: readonly PublicRoute<unknown, Sdk>[];
  readonly initialPathname: string;
  readonly initialData: unknown;
  readonly hasInitialData: boolean;
  readonly sdk: Sdk;
  readonly Shell: ComponentType<{ readonly children?: ReactNode }>;
  readonly onUnhandledNavigate: (href: string) => void;
}): ReactElement | null {
  const location = useLocation();
  const currentPathname = normalizePathname(location.pathname);

  const [routeState, setRouteState] = useState<{
    readonly pathname: string;
    readonly data: unknown;
    readonly ready: boolean;
  }>(() => ({
    pathname: initialPathname,
    data: initialData,
    ready: hasInitialData && currentPathname === initialPathname,
  }));

  useEffect(() => {
    const matched = matchPublicRoute(currentPathname, routes);
    if (matched === null) {
      onUnhandledNavigate(`${location.pathname}${location.search}${location.hash}`);
      return;
    }
    if (routeState.ready && routeState.pathname === currentPathname) {
      return;
    }

    let cancelled = false;
    const targetUrl = new URL(window.location.href);
    void matched.route
      .load({
        sdk,
        params: matched.params,
        url: targetUrl,
      })
      .then((nextData) => {
        if (cancelled) return;
        const nextHead = matched.route.head(nextData);
        applyClientHeadTags(document, nextHead, {
          appName: nextHead.title.trim() !== '' ? nextHead.title : document.title,
          siteUrl: window.location.origin,
          pathname: currentPathname,
        });
        setRouteState({
          pathname: currentPathname,
          data: nextData,
          ready: true,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentPathname,
    location.hash,
    location.pathname,
    location.search,
    onUnhandledNavigate,
    routeState.pathname,
    routeState.ready,
    routes,
    sdk,
  ]);

  const matched = matchPublicRoute(currentPathname, routes);
  if (matched === null) {
    return null;
  }

  const RouteComponent = matched.route.Component;
  const activeData = routeState.pathname === currentPathname ? routeState.data : undefined;

  return (
    <Shell>
      <RouteComponent data={activeData} />
    </Shell>
  );
}

function PublicBrowserRouter({
  initialPathname,
  children,
}: {
  readonly initialPathname: string;
  readonly children: ReactNode;
}): ReactElement {
  const [routerState, setRouterState] = useState<{
    readonly location: RouterLocation;
    readonly navigationType: NavigationType;
  }>(() => ({
    location: {
      pathname: initialPathname,
      search: typeof window !== 'undefined' ? window.location.search : '',
      hash: typeof window !== 'undefined' ? window.location.hash : '',
      state: null,
      key: 'ssr-initial',
    },
    navigationType: 'POP',
  }));

  useEffect(() => {
    const onPopState = (): void => {
      setRouterState({
        location: {
          pathname: window.location.pathname,
          search: window.location.search,
          hash: window.location.hash,
          state: window.history.state ?? null,
          key: `pop-${String(Date.now())}`,
        },
        navigationType: 'POP',
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const navigate: NavigateFunction = useCallback((to, navOptions = {}) => {
    if (typeof to === 'number') {
      window.history.go(to);
      return;
    }
    const targetHref = to.startsWith('/') ? to : `/${to}`;
    const parsed = new URL(targetHref, window.location.origin);
    const nextKey = `nav-${String(Date.now())}`;
    if (navOptions.replace === true) {
      window.history.replaceState(navOptions.state ?? null, '', targetHref);
    } else {
      window.history.pushState(navOptions.state ?? null, '', targetHref);
    }
    setRouterState({
      location: {
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
        state: navOptions.state ?? null,
        key: nextKey,
      },
      navigationType: navOptions.replace === true ? 'REPLACE' : 'PUSH',
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      location: routerState.location,
      navigationType: routerState.navigationType,
      navigate,
    }),
    [navigate, routerState.location, routerState.navigationType],
  );

  return <RouterContext.Provider value={contextValue}>{children}</RouterContext.Provider>;
}

export function hydratePublic<Sdk = AnonymousSdk>(
  root: Element,
  routes: readonly PublicRoute<unknown, Sdk>[],
  options: HydratePublicOptions<Sdk> = {},
): HydratePublicHandle {
  const ownerDocument = root.ownerDocument;
  const splash = ownerDocument.getElementById(APP_SPLASH_ID);
  if (splash !== null) {
    splash.remove();
  }

  const dehydrated = parseDehydratedState(ownerDocument);
  const queryCache = new QueryCache({
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  if (dehydrated !== null) {
    for (const entry of dehydrated.queries) {
      queryCache.setQueryData(entry.queryKey, entry.data, {
        staleTime: 60_000,
      });
    }
  }

  const apiBaseUrl = options.apiBaseUrl ?? '';
  const transport = createAnonymousTransport({
    baseUrl: apiBaseUrl,
    fetchImpl: options.fetchImpl,
  });
  const sdk =
    options.sdk ??
    (createAnonymousSdk(options.modules ?? [], {
      baseUrl: apiBaseUrl,
      fetchImpl: options.fetchImpl,
      queryCache,
    }) as unknown as Sdk);

  const Shell = options.Shell ?? DefaultPublicFrame;
  const initialPathname = dehydrated?.urlPathname ?? normalizePathname(window.location.pathname);
  const handleUnhandledNavigate =
    options.onUnhandledNavigate ??
    ((href: string): void => {
      window.location.assign(href);
    });

  const reactRoot = hydrateRoot(
    root,
    <ThemeProvider>
      <QueryCacheProvider cache={queryCache}>
        <TransportProvider transport={transport}>
          <CapabilityProvider
            transport={transport}
            viewerKey={null}
            viewerPending={false}
            initialContext={EMPTY_CAPABILITY_CONTEXT}
          >
            <PublicBrowserRouter initialPathname={initialPathname}>
              <PublicHydratedViewport
                routes={routes}
                initialPathname={initialPathname}
                initialData={dehydrated?.data}
                hasInitialData={dehydrated !== null}
                sdk={sdk}
                Shell={Shell}
                onUnhandledNavigate={handleUnhandledNavigate}
              />
            </PublicBrowserRouter>
          </CapabilityProvider>
        </TransportProvider>
      </QueryCacheProvider>
    </ThemeProvider>,
  );

  return {
    unmount(): void {
      reactRoot.unmount();
      queryCache.destroy();
    },
  };
}

export async function buildRuntimeSitemapXml<Sdk = AnonymousSdk>(
  siteUrl: string,
  routes: readonly PublicRoute<unknown, Sdk>[],
  sdk: Sdk,
): Promise<string> {
  const origin = trimOrigin(siteUrl);
  const entriesByPath = new Map<string, SitemapEntry>();

  for (const route of routes) {
    if (route.sitemap !== undefined) {
      for await (const entry of route.sitemap(sdk)) {
        if (!entry.path.startsWith('/') || /\s/u.test(entry.path)) {
          throw new Error(
            `Sitemap entry path "${entry.path}" from route "${route.path}" must start with "/" and contain no whitespace`,
          );
        }
        const normalized = normalizePathname(entry.path) as `/${string}`;
        entriesByPath.set(normalized, { path: normalized, lastmod: entry.lastmod });
      }
    } else if (!route.path.includes(':')) {
      const normalized = normalizePathname(route.path) as `/${string}`;
      entriesByPath.set(normalized, { path: normalized });
    }
  }

  const urls = [...entriesByPath.values()]
    .map((entry) => {
      const loc = `    <loc>${escapeXml(`${origin}${entry.path}`)}</loc>`;
      const lastmod =
        entry.lastmod !== undefined && entry.lastmod.trim() !== ''
          ? `\n    <lastmod>${escapeXml(entry.lastmod.trim())}</lastmod>`
          : '';
      return `  <url>\n${loc}${lastmod}\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function buildRobotsTxt(siteUrl: string | null): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (siteUrl !== null && siteUrl.trim() !== '') {
    const origin = trimOrigin(siteUrl);
    lines.push('', `Sitemap: ${origin}/sitemap.xml`);
  }
  return `${lines.join('\n')}\n`;
}
