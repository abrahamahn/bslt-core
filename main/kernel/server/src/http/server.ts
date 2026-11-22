// main/kernel/server/src/http/server.ts
/**
 * Owned HTTP/1.1 Server, Radix Router, Hook Lifecycle, and In-Memory `inject()`
 * built directly on `node:http` (restructure plan §13, C1 — replaces `fastify`
 * and `fastify-plugin`).
 */

import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { Socket } from 'node:net';
import { PassThrough, Readable } from 'node:stream';

import { createLogger } from '../logger/logger';

import type { Logger, LogRequestContext } from '../logger/types';
import type { CookieOptions } from './cookies';
import type { JsonSchemaObject } from './routing';
import type { Locale } from '@bslt/contract';

// ============================================================================
// Framework Errors (`HTTP_ERR_*`)
// ============================================================================

class HttpFrameworkError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'HttpFrameworkError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class BodyTooLargeError extends HttpFrameworkError {
  constructor(message = 'Request body is too large') {
    super('HTTP_ERR_BODY_TOO_LARGE', 413, message);
  }
}

class InvalidMediaTypeError extends HttpFrameworkError {
  constructor(message = 'Unsupported Media Type') {
    super('HTTP_ERR_INVALID_MEDIA_TYPE', 415, message);
  }
}

class InvalidJsonBodyError extends HttpFrameworkError {
  constructor(message = 'Body is not valid JSON') {
    super('HTTP_ERR_INVALID_JSON_BODY', 400, message);
  }
}

class BadUrlError extends HttpFrameworkError {
  constructor(message = 'Invalid URL encoding') {
    super('HTTP_ERR_BAD_URL', 400, message);
  }
}

class RequestTimeoutError extends HttpFrameworkError {
  constructor(message = 'Request Timeout') {
    super('HTTP_ERR_REQUEST_TIMEOUT', 408, message);
  }
}

export const httpErrorCodes = {
  BODY_TOO_LARGE: BodyTooLargeError,
  INVALID_MEDIA_TYPE: InvalidMediaTypeError,
  INVALID_JSON_BODY: InvalidJsonBodyError,
  BAD_URL: BadUrlError,
  REQUEST_TIMEOUT: RequestTimeoutError,
} as const;

// ============================================================================
// Public Request, Reply, Hook, Plugin, Route & Inject Types
// ============================================================================

interface HttpRouteConfig {
  rawBody?: boolean;
  skipBodyInjectionFilter?: boolean;
  extensionSignedWebhook?: boolean;
  webhookVerified?: boolean;
  [key: string]: unknown;
}

interface RouteGenericInterface {
  Body?: unknown;
  Querystring?: unknown;
  Params?: unknown;
  Headers?: unknown;
  Reply?: unknown;
}

export type HttpRequestPayload = Readable & { receivedEncodedLength?: number | undefined };

interface HttpRouteRuntimeOptions {
  readonly url?: string | undefined;
  readonly bodyLimit: number;
  readonly config: HttpRouteConfig;
}

export interface HttpServerRequest<
  RouteGeneric extends RouteGenericInterface = RouteGenericInterface,
> {
  id: string;
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  params: RouteGeneric extends { Params: infer P }
    ? unknown extends P
      ? Record<string, string | undefined>
      : P
    : Record<string, string | undefined>;
  query: RouteGeneric extends { Querystring: infer Q }
    ? unknown extends Q
      ? Record<string, string | string[] | undefined>
      : Q
    : Record<string, string | string[] | undefined>;
  body: RouteGeneric extends { Body: infer B } ? B : unknown;
  ip: string;
  raw: IncomingMessage;
  log: Logger;
  readonly server: HttpServer;
  routeOptions: HttpRouteRuntimeOptions;

  // Standard request extensions populated by server hooks & middleware
  cookies: Record<string, string | undefined>;
  unsignCookie: (value: string) => { valid: boolean; value: string | null };
  rawBody?: Buffer | undefined;
  correlationId: string;
  requestInfo: {
    ip: string;
    ipAddress: string;
    userAgent?: string | undefined;
  };
  requestContext: LogRequestContext;
  requestStart?: bigint | undefined;
  locale: Locale;
  apiVersion: 1;
  apiVersionInfo: { version: 1; source: 'url' | 'accept-header' | 'custom-header' | 'default' };
  context?: unknown;
  user?:
    | {
        userId: string;
        email?: string | undefined;
        role: string;
        tenantId?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
  actingOrg?: { readonly orgId: string; readonly permissions: bigint } | undefined;
  permissionResult?:
    | {
        allowed: boolean;
        reason?: string | undefined;
        matchedRule?: string | undefined;
      }
    | undefined;
  permissionRecord?: unknown;
}

export interface HttpServerReply {
  statusCode: number;
  sent: boolean;
  readonly elapsedTime: number;
  readonly raw?: ServerResponse | undefined;
  status(code: number): this;
  code(code: number): this;
  type(contentType: string): this;
  header(key: string, value: string | number | readonly string[] | undefined): this;
  headers(values: Record<string, string | number | readonly string[] | undefined>): this;
  getHeader(key: string): string | number | string[] | undefined;
  getHeaders(): Record<string, string | number | string[] | undefined>;
  hasHeader(key: string): boolean;
  removeHeader(key: string): this;
  send(payload?: unknown): this;

  // Cookie & CSRF reply extensions registered by middleware
  setCookie(name: string, value: string, options?: CookieOptions): this;
  clearCookie(name: string, options?: CookieOptions): this;
  generateCsrf(): string;
}

export type HookDoneFunction = (err?: Error | null) => void;
type PreParsingDoneFunction = (err?: Error | null, newPayload?: HttpRequestPayload) => void;
type OnSendDoneFunction = (err?: Error | null, newPayload?: unknown) => void;

type OnRequestHookHandler = (
  request: HttpServerRequest,
  reply: HttpServerReply,
  done: HookDoneFunction,
) => unknown;

export type PreParsingHookHandler = (
  request: HttpServerRequest,
  reply: HttpServerReply,
  payload: HttpRequestPayload,
  done: PreParsingDoneFunction,
) => unknown;

type PreHandlerHookHandler = (
  request: HttpServerRequest,
  reply: HttpServerReply,
  done: HookDoneFunction,
) => unknown;

type OnSendHookHandler = (
  request: HttpServerRequest,
  reply: HttpServerReply,
  payload: unknown,
  done: OnSendDoneFunction,
) => unknown;

type OnResponseHookHandler = (
  request: HttpServerRequest,
  reply: HttpServerReply,
  done: HookDoneFunction,
) => unknown;

type OnCloseHookHandler = (instance: HttpServer, done: HookDoneFunction) => unknown;

export interface HttpRouteSchema {
  body?: JsonSchemaObject | Record<string, unknown> | undefined;
  querystring?: JsonSchemaObject | Record<string, unknown> | undefined;
  params?: JsonSchemaObject | Record<string, unknown> | undefined;
  response?: Record<number, JsonSchemaObject> | undefined;
  [key: string]: unknown;
}

interface OnRoutePayload {
  method: string | string[];
  url: string;
  bodyLimit: number;
  config: HttpRouteConfig;
  schema?: HttpRouteSchema | undefined;
  onRequest?: OnRequestHookHandler | OnRequestHookHandler[] | undefined;
  preParsing?: PreParsingHookHandler | PreParsingHookHandler[] | undefined;
  preValidation?: PreHandlerHookHandler | PreHandlerHookHandler[] | undefined;
  preHandler?: PreHandlerHookHandler | PreHandlerHookHandler[] | undefined;
  onSend?: OnSendHookHandler | OnSendHookHandler[] | undefined;
}

type OnRouteHookHandler = (routeOptions: OnRoutePayload) => void;

type HttpRouteHandler<RouteGeneric extends RouteGenericInterface = RouteGenericInterface> = (
  request: HttpServerRequest<RouteGeneric>,
  reply: HttpServerReply,
) => unknown;

interface HttpShorthandOptions<RouteGeneric extends RouteGenericInterface = RouteGenericInterface> {
  bodyLimit?: number | undefined;
  config?: HttpRouteConfig | undefined;
  schema?: HttpRouteSchema | undefined;
  onRequest?: OnRequestHookHandler | OnRequestHookHandler[] | undefined;
  preParsing?: PreParsingHookHandler | PreParsingHookHandler[] | undefined;
  preValidation?: PreHandlerHookHandler | PreHandlerHookHandler[] | undefined;
  preHandler?:
    | ((
        request: HttpServerRequest<RouteGeneric>,
        reply: HttpServerReply,
        done: HookDoneFunction,
      ) => unknown)
    | Array<
        (
          request: HttpServerRequest<RouteGeneric>,
          reply: HttpServerReply,
          done: HookDoneFunction,
        ) => unknown
      >
    | undefined;
  onSend?: OnSendHookHandler | OnSendHookHandler[] | undefined;
}

interface HttpRouteOptions<
  RouteGeneric extends RouteGenericInterface = RouteGenericInterface,
> extends HttpShorthandOptions<RouteGeneric> {
  method: string | readonly string[];
  url: string;
  handler: HttpRouteHandler<RouteGeneric>;
}

type HttpErrorHandler = (
  error: Error,
  request: HttpServerRequest,
  reply: HttpServerReply,
) => unknown;

export type HttpPlugin<Options = Record<string, unknown>> = (
  instance: HttpServer,
  opts: Options,
  done: (err?: Error) => void,
) => unknown;

interface ContentTypeParserOptions {
  parseAs: 'string' | 'buffer';
  bodyLimit?: number | undefined;
}

type ContentTypeStringParser = (
  request: HttpServerRequest,
  body: string,
  done: (err: Error | null, parsed?: unknown) => void,
) => unknown;

type ContentTypeBufferParser = (
  request: HttpServerRequest,
  body: Buffer,
  done: (err: Error | null, parsed?: unknown) => void,
) => unknown;

export interface InjectOptions {
  method?: string | undefined;
  url?: string | undefined;
  path?: string | undefined;
  headers?: Record<string, string | string[] | number | undefined> | undefined;
  cookies?: Record<string, string> | undefined;
  query?: Record<string, string | string[]> | undefined;
  payload?: unknown;
  body?: unknown;
  remoteAddress?: string | undefined;
}

interface InjectCookie {
  readonly name: string;
  readonly value: string;
}

export interface InjectResponse {
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
  readonly payload: string;
  readonly rawPayload: Buffer;
  readonly cookies: readonly InjectCookie[];
  json(): unknown;
}

interface CreateHttpServerOptions {
  loggerInstance?: Logger | undefined;
  logger?: boolean | undefined;
  disableRequestLogging?: boolean | undefined;
  trustProxy?: boolean | undefined;
  bodyLimit?: number | undefined;
  requestTimeout?: number | undefined;
  keepAliveTimeout?: number | undefined;
  genReqId?: ((req: IncomingMessage) => string) | undefined;
}

export interface HttpServer {
  readonly server: http.Server;
  readonly log: Logger;
  appLog?: Logger | undefined;

  route<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    opts: HttpRouteOptions<RouteGeneric>,
  ): this;

  get<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;
  get<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    opts: HttpShorthandOptions<RouteGeneric>,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;

  post<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;
  post<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    opts: HttpShorthandOptions<RouteGeneric>,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;

  put<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;
  put<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    opts: HttpShorthandOptions<RouteGeneric>,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;

  patch<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;
  patch<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    opts: HttpShorthandOptions<RouteGeneric>,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;

  delete<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;
  delete<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    opts: HttpShorthandOptions<RouteGeneric>,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;

  head<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;
  head<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    opts: HttpShorthandOptions<RouteGeneric>,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;

  options<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;
  options<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
    url: string,
    opts: HttpShorthandOptions<RouteGeneric>,
    handler: HttpRouteHandler<RouteGeneric>,
  ): this;

  addHook(name: 'onRoute', hook: OnRouteHookHandler): this;
  addHook(name: 'onRequest', hook: OnRequestHookHandler): this;
  addHook(name: 'preParsing', hook: PreParsingHookHandler): this;
  addHook(name: 'preValidation' | 'preHandler', hook: PreHandlerHookHandler): this;
  addHook(name: 'onSend', hook: OnSendHookHandler): this;
  addHook(name: 'onResponse', hook: OnResponseHookHandler): this;
  addHook(name: 'onClose', hook: OnCloseHookHandler): this;
  addHook(name: string, hook: (...args: never[]) => unknown): this;

  setErrorHandler(handler: HttpErrorHandler): this;

  addContentTypeParser(
    contentType: string | RegExp,
    opts: { parseAs: 'string'; bodyLimit?: number | undefined },
    parser: ContentTypeStringParser,
  ): this;
  addContentTypeParser(
    contentType: string | RegExp,
    opts: { parseAs: 'buffer'; bodyLimit?: number | undefined },
    parser: ContentTypeBufferParser,
  ): this;
  removeContentTypeParser(contentType: string | RegExp): this;

  decorate(name: string, value: unknown): this;
  decorateRequest(name: string, value: unknown): this;
  decorateReply(name: string, value: unknown): this;
  hasRequestDecorator(name: string): boolean;

  register<Options = Record<string, unknown>>(plugin: HttpPlugin<Options>, opts?: Options): this;
  after(): Promise<void>;
  ready(): Promise<void>;

  hasRoute(opts: { method: string; url: string }): boolean;
  printRoutes(): string;

  inject(opts: InjectOptions | string): Promise<InjectResponse>;

  listen(opts: { port: number; host?: string | undefined }): Promise<string>;
  close(): Promise<void>;
}

// ============================================================================
// Radix Router
// ============================================================================

interface StoredRoute {
  readonly method: string;
  readonly url: string;
  readonly paramNames: readonly string[];
  readonly isAutoHead: boolean;
  readonly bodyLimit: number;
  readonly config: HttpRouteConfig;
  readonly schema?: HttpRouteSchema | undefined;
  readonly onRequest: readonly OnRequestHookHandler[];
  readonly preParsing: readonly PreParsingHookHandler[];
  readonly preValidation: readonly PreHandlerHookHandler[];
  readonly preHandler: readonly PreHandlerHookHandler[];
  readonly onSend: readonly OnSendHookHandler[];
  readonly handler: HttpRouteHandler;
}

interface RadixNode {
  readonly staticChildren: Map<string, RadixNode>;
  paramChild?: { readonly name: string; readonly node: RadixNode } | undefined;
  wildcardChild?: RadixNode | undefined;
  readonly routesByMethod: Map<string, StoredRoute>;
}

function createRadixNode(): RadixNode {
  return {
    staticChildren: new Map(),
    routesByMethod: new Map(),
  };
}

function splitRoutePattern(url: string): string[] {
  const clean = url.split('?', 1)[0] ?? '/';
  if (clean === '/' || clean === '') return [];
  const trimmed = clean.startsWith('/') ? clean.slice(1) : clean;
  return trimmed.split('/');
}

function insertRouteNode(root: RadixNode, route: StoredRoute): void {
  const segments = splitRoutePattern(route.url);
  let node = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? '';
    if (seg === '*') {
      node.wildcardChild ??= createRadixNode();
      node = node.wildcardChild;
      break;
    }
    if (seg.startsWith(':') && seg.length > 1) {
      const paramName = seg.slice(1);
      if (node.paramChild === undefined) {
        node.paramChild = { name: paramName, node: createRadixNode() };
      }
      node = node.paramChild.node;
      continue;
    }
    let next = node.staticChildren.get(seg);
    if (next === undefined) {
      next = createRadixNode();
      node.staticChildren.set(seg, next);
    }
    node = next;
  }
  node.routesByMethod.set(route.method, route);
}

interface RouteMatch {
  readonly route: StoredRoute;
  readonly params: Record<string, string>;
}

function decodeSegmentOrThrow(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new BadUrlError();
  }
}

function decodeWildcardTail(segments: readonly string[]): string {
  const rawTail = segments.join('/');
  try {
    return decodeURIComponent(rawTail);
  } catch {
    return rawTail;
  }
}

function buildParamsMap(
  route: StoredRoute,
  capturedValues: readonly string[],
  wildcardTail?: string,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < route.paramNames.length; i += 1) {
    const name = route.paramNames[i];
    const value = capturedValues[i];
    if (name !== undefined && value !== undefined) {
      params[name] = value;
    }
  }
  if (wildcardTail !== undefined) {
    params['*'] = wildcardTail;
  }
  return params;
}

function matchRadixNode(
  node: RadixNode,
  segments: readonly string[],
  index: number,
  method: string,
  capturedValues: readonly string[],
): RouteMatch | null {
  if (index === segments.length) {
    const exact = node.routesByMethod.get(method);
    if (exact !== undefined) {
      return { route: exact, params: buildParamsMap(exact, capturedValues) };
    }
    if (node.wildcardChild !== undefined) {
      const wildEmpty = node.wildcardChild.routesByMethod.get(method);
      if (wildEmpty !== undefined) {
        return { route: wildEmpty, params: buildParamsMap(wildEmpty, capturedValues, '') };
      }
    }
    return null;
  }

  const seg = segments[index] ?? '';

  // 1. Static child has highest priority
  const staticChild = node.staticChildren.get(seg);
  if (staticChild !== undefined) {
    const matched = matchRadixNode(staticChild, segments, index + 1, method, capturedValues);
    if (matched !== null) return matched;
  }

  // 2. Parametric child (`:param`)
  if (node.paramChild !== undefined && seg !== '') {
    const decoded = decodeSegmentOrThrow(seg);
    const matched = matchRadixNode(node.paramChild.node, segments, index + 1, method, [
      ...capturedValues,
      decoded,
    ]);
    if (matched !== null) return matched;
  }

  // 3. Wildcard child (`*`) captures the remaining tail
  if (node.wildcardChild !== undefined) {
    const wildRoute = node.wildcardChild.routesByMethod.get(method);
    if (wildRoute !== undefined) {
      const tail = decodeWildcardTail(segments.slice(index));
      return { route: wildRoute, params: buildParamsMap(wildRoute, capturedValues, tail) };
    }
  }

  return null;
}

// ============================================================================
// Lightweight JSON-Schema Validator (`route.schema`)
// ============================================================================

interface SchemaIssue {
  readonly instancePath: string;
  readonly message: string;
  readonly keyword: string;
}

function validateJsonSchemaValue(
  schema: Record<string, unknown>,
  value: unknown,
  instancePath: string,
  issues: SchemaIssue[],
): void {
  const expectedType = schema['type'];
  if (typeof expectedType === 'string') {
    const typeOk =
      expectedType === 'object'
        ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : expectedType === 'array'
          ? Array.isArray(value)
          : expectedType === 'integer'
            ? typeof value === 'number' && Number.isInteger(value)
            : expectedType === 'number'
              ? typeof value === 'number' && Number.isFinite(value)
              : expectedType === 'null'
                ? value === null
                : typeof value === expectedType;
    if (!typeOk) {
      issues.push({
        instancePath,
        keyword: 'type',
        message: `must be ${expectedType}`,
      });
      return;
    }
  }

  if (Array.isArray(schema['enum']) && !schema['enum'].includes(value)) {
    issues.push({
      instancePath,
      keyword: 'enum',
      message: 'must be equal to one of the allowed values',
    });
  }

  if (typeof value === 'string') {
    if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
      issues.push({
        instancePath,
        keyword: 'minLength',
        message: `must NOT have fewer than ${String(schema['minLength'])} characters`,
      });
    }
    if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) {
      issues.push({
        instancePath,
        keyword: 'maxLength',
        message: `must NOT have more than ${String(schema['maxLength'])} characters`,
      });
    }
    if (typeof schema['pattern'] === 'string') {
      const re = new RegExp(schema['pattern'], 'u');
      if (!re.test(value)) {
        issues.push({
          instancePath,
          keyword: 'pattern',
          message: `must match pattern "${schema['pattern']}"`,
        });
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
      issues.push({
        instancePath,
        keyword: 'minimum',
        message: `must be >= ${String(schema['minimum'])}`,
      });
    }
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) {
      issues.push({
        instancePath,
        keyword: 'maximum',
        message: `must be <= ${String(schema['maximum'])}`,
      });
    }
  }

  if (Array.isArray(value) && schema['items'] !== null && typeof schema['items'] === 'object') {
    const itemSchema = schema['items'] as Record<string, unknown>;
    for (let i = 0; i < value.length; i++) {
      validateJsonSchemaValue(itemSchema, value[i], `${instancePath}/${String(i)}`, issues);
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(schema['required'])) {
      for (const reqKey of schema['required']) {
        if (typeof reqKey === 'string' && !(reqKey in record)) {
          issues.push({
            instancePath,
            keyword: 'required',
            message: `must have required property '${reqKey}'`,
          });
        }
      }
    }
    if (schema['properties'] !== null && typeof schema['properties'] === 'object') {
      const props = schema['properties'] as Record<string, unknown>;
      for (const [propKey, propSchema] of Object.entries(props)) {
        if (propKey in record && propSchema !== null && typeof propSchema === 'object') {
          validateJsonSchemaValue(
            propSchema as Record<string, unknown>,
            record[propKey],
            `${instancePath}/${propKey}`,
            issues,
          );
        }
      }
      if (schema['additionalProperties'] === false) {
        for (const key of Object.keys(record)) {
          if (!(key in props)) {
            issues.push({
              instancePath,
              keyword: 'additionalProperties',
              message: `must NOT have additional property '${key}'`,
            });
          }
        }
      }
    }
  }
}

function validateRouteSchemaOrThrow(
  schema: HttpRouteSchema | undefined,
  req: HttpServerRequest,
): void {
  if (schema === undefined) return;
  const issues: SchemaIssue[] = [];
  if (schema.params !== undefined && typeof schema.params === 'object') {
    validateJsonSchemaValue(schema.params, req.params, '/params', issues);
  }
  if (schema.querystring !== undefined && typeof schema.querystring === 'object') {
    validateJsonSchemaValue(schema.querystring, req.query, '/query', issues);
  }
  if (schema.body !== undefined && typeof schema.body === 'object') {
    validateJsonSchemaValue(schema.body, req.body, '/body', issues);
  }
  if (issues.length > 0) {
    const err = Object.assign(new Error(issues[0]?.message ?? 'Schema validation failed'), {
      statusCode: 400,
      code: 'HTTP_ERR_VALIDATION',
      validation: issues,
    });
    throw err;
  }
}

// ============================================================================
// Query, Header, Body & Hook Utilities
// ============================================================================

function parseQueryString(rawUrl: string): Record<string, string | string[] | undefined> {
  const qIdx = rawUrl.indexOf('?');
  if (qIdx === -1 || qIdx === rawUrl.length - 1) return {};
  const search = rawUrl.slice(qIdx + 1);
  const params = new URLSearchParams(search);
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of params.entries()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }
  return out;
}

function resolveClientIp(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const xff = headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff[0] : xff;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const first = raw.split(',')[0]?.trim();
      if (first !== undefined && first !== '') return first;
    }
  }
  return remoteAddress ?? '127.0.0.1';
}

function toHookArray<T>(input: T | readonly T[] | undefined): T[] {
  if (input === undefined) return [];
  return Array.isArray(input) ? [...(input as readonly T[])] : [input as T];
}

function isReadonlyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value);
}

function createOnceFlag(): () => boolean {
  let settled = false;
  return () => {
    if (settled) return false;
    settled = true;
    return true;
  };
}

function runCallbackOrAsyncHook(
  hook: (req: HttpServerRequest, reply: HttpServerReply, done: HookDoneFunction) => unknown,
  req: HttpServerRequest,
  reply: HttpServerReply,
): Promise<void> {
  if (hook.length >= 3) {
    return new Promise<void>((resolve, reject) => {
      const claim = createOnceFlag();
      const done: HookDoneFunction = (err) => {
        if (!claim()) return;
        if (err != null) reject(err);
        else resolve();
      };
      try {
        const maybePromise = hook(req, reply, done);
        if (maybePromise instanceof Promise) {
          maybePromise.then(
            () => {
              done();
            },
            (err: unknown) => {
              done(err instanceof Error ? err : new Error(String(err)));
            },
          );
        } else if (reply.sent) {
          // A hook that calls reply.send() without calling done() ends the step cleanly.
          done();
        }
      } catch (err) {
        if (claim()) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }

  return Promise.resolve(hook(req, reply, () => undefined)).then(() => undefined);
}

function runPreParsingHook(
  hook: PreParsingHookHandler,
  req: HttpServerRequest,
  reply: HttpServerReply,
  payload: HttpRequestPayload,
): Promise<HttpRequestPayload> {
  if (hook.length >= 4) {
    return new Promise<HttpRequestPayload>((resolve, reject) => {
      const claim = createOnceFlag();
      const done: PreParsingDoneFunction = (err, nextPayload) => {
        if (!claim()) return;
        if (err != null) reject(err);
        else resolve(nextPayload ?? payload);
      };
      try {
        const maybePromise = hook(req, reply, payload, done);
        if (maybePromise instanceof Promise) {
          maybePromise.then(
            (res: unknown) => {
              done(null, res instanceof Readable ? res : payload);
            },
            (err: unknown) => {
              done(err instanceof Error ? err : new Error(String(err)));
            },
          );
        }
      } catch (err) {
        if (claim()) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }

  return Promise.resolve(hook(req, reply, payload, () => undefined)).then((res: unknown) =>
    res instanceof Readable ? res : payload,
  );
}

function runOnSendHook(
  hook: OnSendHookHandler,
  req: HttpServerRequest,
  reply: HttpServerReply,
  payload: unknown,
): Promise<unknown> {
  if (hook.length >= 4) {
    return new Promise<unknown>((resolve, reject) => {
      const claim = createOnceFlag();
      const done: OnSendDoneFunction = (err, nextPayload) => {
        if (!claim()) return;
        if (err != null) reject(err);
        else resolve(nextPayload !== undefined ? nextPayload : payload);
      };
      try {
        const maybePromise = hook(req, reply, payload, done);
        if (maybePromise instanceof Promise) {
          maybePromise.then(
            (res) => {
              done(null, res);
            },
            (err: unknown) => {
              done(err instanceof Error ? err : new Error(String(err)));
            },
          );
        }
      } catch (err) {
        if (claim()) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }

  return Promise.resolve(hook(req, reply, payload, () => undefined));
}

function runOnCloseHook(hook: OnCloseHookHandler, instance: HttpServer): Promise<void> {
  if (hook.length >= 2) {
    return new Promise<void>((resolve, reject) => {
      const claim = createOnceFlag();
      const done: HookDoneFunction = (err) => {
        if (!claim()) return;
        if (err != null) reject(err);
        else resolve();
      };
      try {
        const maybePromise = hook(instance, done);
        if (maybePromise instanceof Promise) {
          maybePromise.then(
            () => {
              done();
            },
            (err: unknown) => {
              done(err instanceof Error ? err : new Error(String(err)));
            },
          );
        }
      } catch (err) {
        if (claim()) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }
  return Promise.resolve(hook(instance, () => undefined)).then(() => undefined);
}

function readStreamWithLimit(stream: Readable, limit: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = (): void => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.off('aborted', onAborted);
      stream.off('close', onClose);
    };

    const fail = (err: Error, pauseOnly = false): void => {
      if (settled) return;
      settled = true;
      cleanup();
      stream.on('error', () => undefined);
      if (pauseOnly) {
        stream.pause();
      }
      reject(err);
    };

    const onData = (rawChunk: Buffer | string | Uint8Array): void => {
      if (settled) return;
      const buf = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : typeof rawChunk === 'string'
          ? Buffer.from(rawChunk, 'utf8')
          : Buffer.from(rawChunk);
      total += buf.length;
      if (total > limit) {
        fail(new BodyTooLargeError(), true);
        return;
      }
      chunks.push(buf);
    };

    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, total));
    };

    const onError = (err: Error): void => {
      fail(err);
    };

    const onAborted = (): void => {
      fail(new RequestTimeoutError('Client aborted request'));
    };

    const onClose = (): void => {
      if (!settled && !stream.readableEnded) {
        fail(new RequestTimeoutError('Connection closed before body completed'));
      }
    };

    if (stream.readableEnded) {
      resolve(Buffer.alloc(0));
      return;
    }

    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    stream.once('aborted', onAborted);
    stream.once('close', onClose);
  });
}

interface RegisteredParser {
  readonly matcher: string | RegExp;
  readonly parseAs: 'string' | 'buffer';
  readonly bodyLimit?: number | undefined;
  readonly fn: ContentTypeStringParser | ContentTypeBufferParser;
}

function runContentTypeParser(
  parser: RegisteredParser,
  req: HttpServerRequest,
  rawBuffer: Buffer,
): Promise<unknown> {
  const input: string | Buffer =
    parser.parseAs === 'string' ? rawBuffer.toString('utf8') : rawBuffer;

  if (parser.fn.length >= 3) {
    return new Promise<unknown>((resolve, reject) => {
      const claim = createOnceFlag();
      const done = (err: Error | null, parsed?: unknown): void => {
        if (!claim()) return;
        if (err !== null) reject(err);
        else resolve(parsed);
      };
      try {
        const maybePromise = (
          parser.fn as (
            r: HttpServerRequest,
            b: string | Buffer,
            d: (e: Error | null, p?: unknown) => void,
          ) => unknown
        )(req, input, done);
        if (maybePromise instanceof Promise) {
          maybePromise.then(
            (res) => {
              done(null, res);
            },
            (err: unknown) => {
              done(err instanceof Error ? err : new Error(String(err)));
            },
          );
        }
      } catch (err) {
        if (claim()) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }

  return Promise.resolve(
    (parser.fn as (r: HttpServerRequest, b: string | Buffer, d: () => void) => unknown)(
      req,
      input,
      () => undefined,
    ),
  );
}

const HTTP_STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

function statusMessageFor(code: number): string {
  return HTTP_STATUS_TEXT[code] ?? http.STATUS_CODES[code] ?? 'OK';
}

const BODY_LESS_STATUS = new Set([204, 304]);

// ============================================================================
// Server Factory (`createHttpServer`)
// ============================================================================

export function createHttpServer(options: CreateHttpServerOptions = {}): HttpServer {
  const defaultBodyLimit = options.bodyLimit ?? 1_048_576;
  const trustProxy = options.trustProxy === true;
  const hasCustomLogger = options.loggerInstance !== undefined;
  const requestLoggingEnabled =
    hasCustomLogger && options.logger !== false && options.disableRequestLogging !== true;
  const baseLog: Logger =
    options.loggerInstance ?? createLogger('silent', { service: 'bslt-http' });

  let reqSequence = 0;
  const nextReqId =
    options.genReqId ??
    ((): string => {
      reqSequence += 1;
      return `req-${String(reqSequence)}`;
    });

  const radixRoot = createRadixNode();
  const exactRouteSet = new Set<string>();
  const registeredOrder: Array<{ readonly method: string; readonly url: string }> = [];

  const onRouteHooks: OnRouteHookHandler[] = [];
  const onRequestHooks: OnRequestHookHandler[] = [];
  const preParsingHooks: PreParsingHookHandler[] = [];
  const preValidationHooks: PreHandlerHookHandler[] = [];
  const preHandlerHooks: PreHandlerHookHandler[] = [];
  const onSendHooks: OnSendHookHandler[] = [];
  const onResponseHooks: OnResponseHookHandler[] = [];
  const onCloseHooks: OnCloseHookHandler[] = [];

  const requestDecorators = new Map<string, unknown>();
  const replyDecorators = new Map<string, unknown>();
  const pendingPlugins: Array<() => Promise<void>> = [];

  const contentTypeParsers: RegisteredParser[] = [
    {
      matcher: 'application/json',
      parseAs: 'string',
      fn: ((_req, body, done) => {
        if (body.trim() === '') {
          done(
            new InvalidJsonBodyError(
              'Body cannot be empty when content-type is set to application/json',
            ),
          );
          return;
        }
        try {
          done(null, JSON.parse(body));
        } catch {
          done(new InvalidJsonBodyError());
        }
      }) satisfies ContentTypeStringParser,
    },
    {
      matcher: 'text/plain',
      parseAs: 'string',
      fn: ((_req, body, done) => {
        done(null, body);
      }) satisfies ContentTypeStringParser,
    },
  ];

  function findContentTypeParser(rawContentType: string): RegisteredParser | undefined {
    const mediaType = rawContentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    for (let i = contentTypeParsers.length - 1; i >= 0; i--) {
      const entry = contentTypeParsers[i];
      if (entry === undefined) continue;
      if (typeof entry.matcher === 'string') {
        if (entry.matcher.toLowerCase() === mediaType) return entry;
        if (entry.matcher === 'application/json' && mediaType.endsWith('+json')) return entry;
      } else if (entry.matcher.test(rawContentType) || entry.matcher.test(mediaType)) {
        return entry;
      }
    }
    return undefined;
  }

  let errorHandler: HttpErrorHandler = (error, _request, reply) => {
    const statusCandidate = (error as { statusCode?: unknown }).statusCode;
    const isClientErr =
      error instanceof HttpFrameworkError && error.statusCode >= 400 && error.statusCode < 500;
    const status = isClientErr
      ? error.statusCode
      : typeof statusCandidate === 'number' && statusCandidate >= 400 && statusCandidate < 500
        ? statusCandidate
        : 500;
    if (status >= 500) {
      baseLog.error({ err: error }, error.message);
    }
    const errCode = (error as { code?: unknown }).code;
    reply.status(status).send({
      statusCode: status,
      ...(typeof errCode === 'string' ? { code: errCode } : {}),
      error: statusMessageFor(status),
      message: error.message,
    });
  };

  let isClosing = false;
  let readyCompleted = false;
  const activeSockets = new Set<Socket>();
  const inFlightRequests = new Set<Promise<void>>();

  async function flushPlugins(): Promise<void> {
    while (pendingPlugins.length > 0) {
      const next = pendingPlugins.shift();
      if (next !== undefined) {
        await next();
      }
    }
  }

  interface ReplyInternalState {
    statusCode: number;
    sent: boolean;
    hasPayload: boolean;
    payload: unknown;
    readonly headerMap: Map<string, string | number | string[]>;
    readonly startNs: bigint;
  }

  function createReplyObject(rawRes: ServerResponse | undefined): {
    readonly reply: HttpServerReply;
    readonly state: ReplyInternalState;
  } {
    const state: ReplyInternalState = {
      statusCode: 200,
      sent: false,
      hasPayload: false,
      payload: undefined,
      headerMap: new Map(),
      startNs: process.hrtime.bigint(),
    };

    const reply: HttpServerReply = {
      get statusCode(): number {
        return state.statusCode;
      },
      set statusCode(val: number) {
        state.statusCode = val;
      },
      get sent(): boolean {
        return state.sent;
      },
      set sent(val: boolean) {
        state.sent = val;
      },
      get elapsedTime(): number {
        return Number(process.hrtime.bigint() - state.startNs) / 1_000_000;
      },
      raw: rawRes,
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      code(code: number) {
        state.statusCode = code;
        return this;
      },
      type(contentType: string) {
        state.headerMap.set('content-type', contentType);
        return this;
      },
      header(key: string, value: string | number | readonly string[] | undefined) {
        const lower = key.toLowerCase();
        if (value === undefined) {
          state.headerMap.delete(lower);
        } else if (isReadonlyStringArray(value)) {
          state.headerMap.set(lower, [...value]);
        } else {
          state.headerMap.set(lower, value);
        }
        return this;
      },
      headers(values: Record<string, string | number | readonly string[] | undefined>) {
        for (const [k, v] of Object.entries(values)) {
          this.header(k, v);
        }
        return this;
      },
      getHeader(key: string) {
        return state.headerMap.get(key.toLowerCase());
      },
      getHeaders() {
        return Object.fromEntries(state.headerMap.entries());
      },
      hasHeader(key: string) {
        return state.headerMap.has(key.toLowerCase());
      },
      removeHeader(key: string) {
        state.headerMap.delete(key.toLowerCase());
        return this;
      },
      send(payload?: unknown) {
        state.sent = true;
        state.hasPayload = true;
        state.payload = payload;
        return this;
      },
      setCookie() {
        throw new Error('registerCookies must be called before reply.setCookie');
      },
      clearCookie() {
        throw new Error('registerCookies must be called before reply.clearCookie');
      },
      generateCsrf() {
        throw new Error('registerCsrf must be called before reply.generateCsrf');
      },
    };

    for (const [key, val] of replyDecorators.entries()) {
      (reply as unknown as Record<string, unknown>)[key] = val;
    }

    return { reply, state };
  }

  function createRequestObject(input: {
    id: string;
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
    raw: IncomingMessage;
    remoteAddress: string | undefined;
    route: StoredRoute | undefined;
    params: Record<string, string | undefined>;
  }): HttpServerRequest {
    const ip = resolveClientIp(input.headers, input.remoteAddress, trustProxy);
    const reqLog = hasCustomLogger ? baseLog.child({ reqId: input.id }) : baseLog;
    const req: HttpServerRequest = {
      id: input.id,
      method: input.method,
      url: input.url,
      headers: input.headers,
      params: input.params,
      query: parseQueryString(input.url),
      body: undefined,
      ip,
      raw: input.raw,
      log: reqLog,
      server: instance,
      routeOptions: {
        ...(input.route !== undefined ? { url: input.route.url } : {}),
        bodyLimit: input.route?.bodyLimit ?? defaultBodyLimit,
        config: input.route?.config ?? {},
      },
      cookies: {},
      unsignCookie: () => ({ valid: false, value: null }),
      correlationId: '',
      requestInfo: { ip, ipAddress: ip },
      requestContext: {
        correlationId: '',
        requestId: input.id,
        method: input.method,
        path: input.url,
        ip,
      },
      locale: 'en-US',
      apiVersion: 1,
      apiVersionInfo: { version: 1, source: 'default' },
    };

    for (const [key, val] of requestDecorators.entries()) {
      if (!(key in req)) {
        (req as unknown as Record<string, unknown>)[key] = val;
      }
    }

    return req;
  }

  function serializePayload(
    reply: HttpServerReply,
    state: ReplyInternalState,
    payload: unknown,
  ): Buffer | string | Readable | null {
    if (payload === undefined || payload === null || BODY_LESS_STATUS.has(state.statusCode)) {
      return null;
    }
    if (Buffer.isBuffer(payload) || payload instanceof Readable || typeof payload === 'string') {
      if (typeof payload === 'string' && !reply.hasHeader('content-type')) {
        reply.header('content-type', 'text/plain; charset=utf-8');
      }
      return payload;
    }
    if (payload instanceof Uint8Array) {
      return Buffer.from(payload);
    }
    if (!reply.hasHeader('content-type')) {
      reply.header('content-type', 'application/json; charset=utf-8');
    }
    return JSON.stringify(payload);
  }

  async function finalizePayload(
    req: HttpServerRequest,
    reply: HttpServerReply,
    state: ReplyInternalState,
    route: StoredRoute | undefined,
    rawPayload: unknown,
  ): Promise<Buffer | Readable> {
    let serialized: unknown = serializePayload(reply, state, rawPayload);
    const allOnSend = [...onSendHooks, ...(route?.onSend ?? [])];
    for (const hook of allOnSend) {
      serialized = await runOnSendHook(hook, req, reply, serialized);
    }

    if (serialized === null || serialized === undefined || BODY_LESS_STATUS.has(state.statusCode)) {
      if (state.statusCode === 204) {
        reply.removeHeader('content-length');
      } else if (!reply.hasHeader('content-length') && state.statusCode !== 304) {
        reply.header('content-length', '0');
      }
      return Buffer.alloc(0);
    }

    if (serialized instanceof Readable) {
      return serialized;
    }

    const buf = Buffer.isBuffer(serialized)
      ? serialized
      : serialized instanceof Uint8Array
        ? Buffer.from(serialized)
        : typeof serialized === 'string'
          ? Buffer.from(serialized, 'utf8')
          : Buffer.from(JSON.stringify(serialized), 'utf8');

    reply.header('content-length', String(buf.length));
    return buf;
  }

  function resetReplyState(state: ReplyInternalState): void {
    state.sent = false;
    state.hasPayload = false;
    state.payload = undefined;
  }

  function isReplySent(state: ReplyInternalState): boolean {
    return state.sent;
  }

  function hasReplyPayload(state: ReplyInternalState): boolean {
    return state.hasPayload;
  }

  async function invokeErrorHandler(
    err: unknown,
    req: HttpServerRequest,
    reply: HttpServerReply,
    state: ReplyInternalState,
    route: StoredRoute | undefined,
  ): Promise<Buffer> {
    const error = err instanceof Error ? err : new Error(String(err));
    resetReplyState(state);

    const returned = await errorHandler(error, req, reply);
    const rawOut = hasReplyPayload(state) ? state.payload : returned;
    const finalized = await finalizePayload(req, reply, state, route, rawOut);
    if (finalized instanceof Readable) {
      return readStreamWithLimit(finalized, Number.MAX_SAFE_INTEGER);
    }
    return finalized;
  }

  async function executeLifecycle(input: {
    id: string;
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
    rawReq: IncomingMessage;
    rawRes: ServerResponse | undefined;
    remoteAddress: string | undefined;
    hasBody: boolean;
  }): Promise<{
    readonly req: HttpServerRequest;
    readonly reply: HttpServerReply;
    readonly state: ReplyInternalState;
    readonly bodyOut: Buffer | Readable;
    readonly route: StoredRoute | undefined;
  }> {
    if (!readyCompleted) {
      await flushPlugins();
      readyCompleted = true;
    }

    const upperMethod = input.method.toUpperCase();
    const rawPathname = input.url.split('?', 1)[0] ?? '/';
    const segments = splitRoutePattern(rawPathname);

    let match: RouteMatch | null = null;
    let urlDecodeError: Error | null = null;
    try {
      match = matchRadixNode(radixRoot, segments, 0, upperMethod, []);
    } catch (err) {
      urlDecodeError = err instanceof Error ? err : new Error(String(err));
    }

    const route = match?.route;
    const req = createRequestObject({
      id: input.id,
      method: upperMethod,
      url: input.url,
      headers: input.headers,
      raw: input.rawReq,
      remoteAddress: input.remoteAddress,
      route,
      params: match?.params ?? {},
    });
    const { reply, state } = createReplyObject(input.rawRes);

    if (requestLoggingEnabled) {
      req.log.info(
        {
          req: {
            method: req.method,
            url: req.url,
            host: req.headers['host'] ?? 'localhost:80',
            remoteAddress: req.ip,
          },
        },
        'incoming request',
      );
    }

    let bodyOut: Buffer | Readable;
    try {
      const allOnRequest = [...onRequestHooks, ...(route?.onRequest ?? [])];
      for (const hook of allOnRequest) {
        await runCallbackOrAsyncHook(hook, req, reply);
        if (isReplySent(state)) break;
      }

      if (urlDecodeError !== null && !isReplySent(state)) {
        throw urlDecodeError;
      }

      if (!isReplySent(state) && route === undefined) {
        for (const hook of preHandlerHooks) {
          await runCallbackOrAsyncHook(hook, req, reply);
          if (isReplySent(state)) break;
        }
        if (!isReplySent(state)) {
          reply.status(404).send({
            message: `Route ${upperMethod}:${input.url} not found`,
            error: 'Not Found',
            statusCode: 404,
          });
        }
      }

      if (!isReplySent(state) && route !== undefined) {
        const ctHeader = req.headers['content-type'];
        const ceHeader = req.headers['content-encoding'];
        const shouldParseBody =
          input.hasBody ||
          (typeof ctHeader === 'string' && ctHeader.trim() !== '') ||
          (typeof ceHeader === 'string' && ceHeader.trim() !== '');

        const allPreParsing = [...preParsingHooks, ...route.preParsing];
        let payloadStream: HttpRequestPayload = req.raw;
        if (shouldParseBody && allPreParsing.length > 0) {
          for (const hook of allPreParsing) {
            payloadStream = await runPreParsingHook(hook, req, reply, payloadStream);
            if (isReplySent(state)) break;
          }
        }

        if (!isReplySent(state) && shouldParseBody) {
          const effectiveCt =
            typeof ctHeader === 'string' && ctHeader.trim() !== '' ? ctHeader : 'text/plain';
          const parser = findContentTypeParser(effectiveCt);
          if (parser === undefined) {
            throw new InvalidMediaTypeError(`Unsupported Media Type: ${effectiveCt}`);
          }
          const limit = parser.bodyLimit ?? route.bodyLimit;
          const rawBytes = await readStreamWithLimit(payloadStream, limit);
          req.body = await runContentTypeParser(parser, req, rawBytes);
        }

        if (!isReplySent(state)) {
          const allPreValidation = [...preValidationHooks, ...route.preValidation];
          for (const hook of allPreValidation) {
            await runCallbackOrAsyncHook(hook, req, reply);
            if (isReplySent(state)) break;
          }
        }

        if (!isReplySent(state)) {
          validateRouteSchemaOrThrow(route.schema, req);
        }

        if (!isReplySent(state)) {
          const allPreHandler = [...preHandlerHooks, ...route.preHandler];
          for (const hook of allPreHandler) {
            await runCallbackOrAsyncHook(hook, req, reply);
            if (isReplySent(state)) break;
          }
        }

        if (!isReplySent(state)) {
          const returned = await route.handler(req, reply);
          if (!hasReplyPayload(state)) {
            state.sent = true;
            state.hasPayload = true;
            state.payload = returned;
          }
        }
      }

      bodyOut = await finalizePayload(req, reply, state, route, state.payload);
    } catch (err) {
      bodyOut = await invokeErrorHandler(err, req, reply, state, route);
    }

    return { req, reply, state, bodyOut, route };
  }

  async function finishResponseHooks(
    req: HttpServerRequest,
    reply: HttpServerReply,
  ): Promise<void> {
    if (requestLoggingEnabled) {
      req.log.info(
        {
          res: { statusCode: reply.statusCode },
          responseTime: reply.elapsedTime,
        },
        'request completed',
      );
    }
    for (const hook of onResponseHooks) {
      await runCallbackOrAsyncHook(hook, req, reply);
    }
  }

  function writeHeaderMapToNodeResponse(res: ServerResponse, state: ReplyInternalState): void {
    for (const [k, v] of state.headerMap.entries()) {
      res.setHeader(k, v);
    }
  }

  const rawHttpServer = http.createServer((rawReq, rawRes) => {
    if (isClosing) {
      rawRes.setHeader('connection', 'close');
    }

    let reqTimer: ReturnType<typeof setTimeout> | undefined;
    if (options.requestTimeout !== undefined && options.requestTimeout > 0) {
      reqTimer = setTimeout(() => {
        if (!rawRes.writableEnded && !rawRes.destroyed) {
          rawRes.setHeader('connection', 'close');
          rawReq.destroy(new RequestTimeoutError());
        }
      }, options.requestTimeout);
      reqTimer.unref();
    }

    const task = (async (): Promise<void> => {
      const contentLength = rawReq.headers['content-length'];
      const hasBody =
        (typeof contentLength === 'string' && contentLength !== '0' && contentLength !== '') ||
        rawReq.headers['transfer-encoding'] !== undefined;

      const { req, reply, state, bodyOut, route } = await executeLifecycle({
        id: nextReqId(rawReq),
        method: rawReq.method ?? 'GET',
        url: rawReq.url ?? '/',
        headers: rawReq.headers,
        rawReq,
        rawRes,
        remoteAddress: rawReq.socket.remoteAddress,
        hasBody,
      });

      if (rawRes.destroyed || rawRes.writableEnded) {
        await finishResponseHooks(req, reply);
        return;
      }

      const isHead = req.method === 'HEAD';

      if (bodyOut instanceof Readable) {
        if (isHead) {
          bodyOut.destroy();
          writeHeaderMapToNodeResponse(rawRes, state);
          rawRes.statusCode = state.statusCode;
          rawRes.end();
        } else {
          await new Promise<void>((resolve) => {
            let headersFlushed = false;
            const flushHeaders = (): void => {
              if (headersFlushed) return;
              headersFlushed = true;
              writeHeaderMapToNodeResponse(rawRes, state);
              rawRes.statusCode = state.statusCode;
            };
            bodyOut.on('data', (chunk: Buffer | string) => {
              flushHeaders();
              if (!rawRes.write(chunk)) {
                bodyOut.pause();
                rawRes.once('drain', () => {
                  bodyOut.resume();
                });
              }
            });
            bodyOut.once('end', () => {
              flushHeaders();
              rawRes.end();
              resolve();
            });
            bodyOut.once('error', (streamErr: Error) => {
              if (!headersFlushed) {
                void invokeErrorHandler(streamErr, req, reply, state, route).then((errBuf) => {
                  writeHeaderMapToNodeResponse(rawRes, state);
                  rawRes.statusCode = state.statusCode;
                  rawRes.end(errBuf);
                  resolve();
                });
              } else {
                rawRes.destroy(streamErr);
                resolve();
              }
            });
          });
        }
      } else {
        writeHeaderMapToNodeResponse(rawRes, state);
        rawRes.statusCode = state.statusCode;
        if (isHead || bodyOut.length === 0) {
          rawRes.end();
        } else {
          rawRes.end(bodyOut);
        }
      }

      await finishResponseHooks(req, reply);
    })();

    inFlightRequests.add(task);
    void task.finally(() => {
      if (reqTimer !== undefined) {
        clearTimeout(reqTimer);
      }
      inFlightRequests.delete(task);
    });
  });

  if (options.requestTimeout !== undefined) {
    rawHttpServer.requestTimeout = options.requestTimeout;
  }
  if (options.keepAliveTimeout !== undefined) {
    rawHttpServer.keepAliveTimeout = options.keepAliveTimeout;
  }

  rawHttpServer.on('timeout', (socket: Socket) => {
    if (socket.writable) {
      const body = JSON.stringify({
        statusCode: 408,
        code: 'HTTP_ERR_REQUEST_TIMEOUT',
        error: 'Request Timeout',
        message: 'Request Timeout',
      });
      socket.end(
        [
          'HTTP/1.1 408 Request Timeout',
          'Content-Type: application/json; charset=utf-8',
          `Content-Length: ${String(Buffer.byteLength(body))}`,
          'Connection: close',
          '',
          body,
        ].join('\r\n'),
      );
    } else {
      socket.destroy();
    }
  });

  rawHttpServer.on('connection', (socket: Socket) => {
    activeSockets.add(socket);
    socket.once('close', () => {
      activeSockets.delete(socket);
    });
  });

  function registerShorthand<RouteGeneric extends RouteGenericInterface>(
    method: string,
    url: string,
    optsOrHandler: HttpShorthandOptions<RouteGeneric> | HttpRouteHandler<RouteGeneric>,
    maybeHandler?: HttpRouteHandler<RouteGeneric>,
  ): HttpServer {
    if (typeof optsOrHandler === 'function') {
      return instance.route({ method, url, handler: optsOrHandler });
    }
    if (maybeHandler === undefined) {
      throw new Error(`Missing route handler for ${method} ${url}`);
    }
    return instance.route({
      ...optsOrHandler,
      method,
      url,
      handler: maybeHandler,
    });
  }

  const instance: HttpServer = {
    server: rawHttpServer,
    log: baseLog,

    route<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
      opts: HttpRouteOptions<RouteGeneric>,
    ): HttpServer {
      const rawMethods = isReadonlyStringArray(opts.method) ? [...opts.method] : [opts.method];
      const upperMethods = rawMethods.map((m) => m.toUpperCase());

      // Match Fastify: every GET route also answers HEAD unless HEAD is already explicitly registered.
      const autoAddHead =
        upperMethods.includes('GET') &&
        !upperMethods.includes('HEAD') &&
        !exactRouteSet.has(`HEAD ${opts.url}`);
      const effectiveMethods = autoAddHead ? [...upperMethods, 'HEAD'] : upperMethods;

      const rawPreHandler: unknown = opts.preHandler;
      const onRoutePayload: OnRoutePayload = {
        method: effectiveMethods.length === 1 ? (effectiveMethods[0] ?? 'GET') : effectiveMethods,
        url: opts.url,
        bodyLimit: opts.bodyLimit ?? defaultBodyLimit,
        config: { ...(opts.config ?? {}) },
        ...(opts.schema !== undefined ? { schema: opts.schema } : {}),
        ...(opts.onRequest !== undefined ? { onRequest: opts.onRequest } : {}),
        ...(opts.preParsing !== undefined ? { preParsing: opts.preParsing } : {}),
        ...(opts.preValidation !== undefined ? { preValidation: opts.preValidation } : {}),
        ...(rawPreHandler !== undefined
          ? {
              preHandler: rawPreHandler as PreHandlerHookHandler | PreHandlerHookHandler[],
            }
          : {}),
        ...(opts.onSend !== undefined ? { onSend: opts.onSend } : {}),
      };

      for (const hook of onRouteHooks) {
        hook(onRoutePayload);
      }

      const paramNames = splitRoutePattern(onRoutePayload.url)
        .filter((seg) => seg.startsWith(':') && seg.length > 1)
        .map((seg) => seg.slice(1));

      for (const method of effectiveMethods) {
        const isAutoHead = autoAddHead && method === 'HEAD';
        const stored: StoredRoute = {
          method,
          url: onRoutePayload.url,
          paramNames,
          isAutoHead,
          bodyLimit: onRoutePayload.bodyLimit,
          config: onRoutePayload.config,
          ...(onRoutePayload.schema !== undefined ? { schema: onRoutePayload.schema } : {}),
          onRequest: toHookArray(onRoutePayload.onRequest),
          preParsing: toHookArray(onRoutePayload.preParsing),
          preValidation: toHookArray(onRoutePayload.preValidation),
          preHandler: toHookArray(onRoutePayload.preHandler),
          onSend: toHookArray(onRoutePayload.onSend),
          handler: (req, reply) =>
            (opts.handler as (r: unknown, s: HttpServerReply) => unknown)(req, reply),
        };
        insertRouteNode(radixRoot, stored);
        const key = `${method} ${onRoutePayload.url}`;
        if (!exactRouteSet.has(key)) {
          exactRouteSet.add(key);
          registeredOrder.push({ method, url: onRoutePayload.url });
        }
      }

      return this;
    },

    get<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
      url: string,
      optsOrHandler: HttpShorthandOptions<RouteGeneric> | HttpRouteHandler<RouteGeneric>,
      maybeHandler?: HttpRouteHandler<RouteGeneric>,
    ): HttpServer {
      return registerShorthand('GET', url, optsOrHandler, maybeHandler);
    },

    post<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
      url: string,
      optsOrHandler: HttpShorthandOptions<RouteGeneric> | HttpRouteHandler<RouteGeneric>,
      maybeHandler?: HttpRouteHandler<RouteGeneric>,
    ): HttpServer {
      return registerShorthand('POST', url, optsOrHandler, maybeHandler);
    },

    put<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
      url: string,
      optsOrHandler: HttpShorthandOptions<RouteGeneric> | HttpRouteHandler<RouteGeneric>,
      maybeHandler?: HttpRouteHandler<RouteGeneric>,
    ): HttpServer {
      return registerShorthand('PUT', url, optsOrHandler, maybeHandler);
    },

    patch<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
      url: string,
      optsOrHandler: HttpShorthandOptions<RouteGeneric> | HttpRouteHandler<RouteGeneric>,
      maybeHandler?: HttpRouteHandler<RouteGeneric>,
    ): HttpServer {
      return registerShorthand('PATCH', url, optsOrHandler, maybeHandler);
    },

    delete<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
      url: string,
      optsOrHandler: HttpShorthandOptions<RouteGeneric> | HttpRouteHandler<RouteGeneric>,
      maybeHandler?: HttpRouteHandler<RouteGeneric>,
    ): HttpServer {
      return registerShorthand('DELETE', url, optsOrHandler, maybeHandler);
    },

    head<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
      url: string,
      optsOrHandler: HttpShorthandOptions<RouteGeneric> | HttpRouteHandler<RouteGeneric>,
      maybeHandler?: HttpRouteHandler<RouteGeneric>,
    ): HttpServer {
      return registerShorthand('HEAD', url, optsOrHandler, maybeHandler);
    },

    options<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
      url: string,
      optsOrHandler: HttpShorthandOptions<RouteGeneric> | HttpRouteHandler<RouteGeneric>,
      maybeHandler?: HttpRouteHandler<RouteGeneric>,
    ): HttpServer {
      return registerShorthand('OPTIONS', url, optsOrHandler, maybeHandler);
    },

    addHook(name: string, hook: (...args: never[]) => unknown): HttpServer {
      switch (name) {
        case 'onRoute':
          onRouteHooks.push(hook as unknown as OnRouteHookHandler);
          break;
        case 'onRequest':
          onRequestHooks.push(hook as unknown as OnRequestHookHandler);
          break;
        case 'preParsing':
          preParsingHooks.push(hook as unknown as PreParsingHookHandler);
          break;
        case 'preValidation':
          preValidationHooks.push(hook as unknown as PreHandlerHookHandler);
          break;
        case 'preHandler':
          preHandlerHooks.push(hook as unknown as PreHandlerHookHandler);
          break;
        case 'onSend':
          onSendHooks.push(hook as unknown as OnSendHookHandler);
          break;
        case 'onResponse':
          onResponseHooks.push(hook as unknown as OnResponseHookHandler);
          break;
        case 'onClose':
          onCloseHooks.push(hook as unknown as OnCloseHookHandler);
          break;
        default:
          throw new Error(`Unsupported HTTP hook "${name}"`);
      }
      return this;
    },

    setErrorHandler(handler: HttpErrorHandler): HttpServer {
      errorHandler = handler;
      return this;
    },

    addContentTypeParser(
      contentType: string | RegExp,
      opts: ContentTypeParserOptions,
      parser: ContentTypeStringParser | ContentTypeBufferParser,
    ): HttpServer {
      contentTypeParsers.push({
        matcher: contentType,
        parseAs: opts.parseAs,
        bodyLimit: opts.bodyLimit,
        fn: parser,
      });
      return this;
    },

    removeContentTypeParser(contentType: string | RegExp): HttpServer {
      for (let i = contentTypeParsers.length - 1; i >= 0; i--) {
        const entry = contentTypeParsers[i];
        if (entry === undefined) continue;
        const same =
          typeof contentType === 'string' && typeof entry.matcher === 'string'
            ? entry.matcher.toLowerCase() === contentType.toLowerCase()
            : String(entry.matcher) === String(contentType);
        if (same) {
          contentTypeParsers.splice(i, 1);
        }
      }
      return this;
    },

    decorate(name: string, value: unknown): HttpServer {
      (this as unknown as Record<string, unknown>)[name] = value;
      return this;
    },

    decorateRequest(name: string, value: unknown): HttpServer {
      requestDecorators.set(name, value);
      return this;
    },

    decorateReply(name: string, value: unknown): HttpServer {
      replyDecorators.set(name, value);
      return this;
    },

    hasRequestDecorator(name: string): boolean {
      return requestDecorators.has(name);
    },

    register<Options = Record<string, unknown>>(
      plugin: HttpPlugin<Options>,
      opts?: Options,
    ): HttpServer {
      const resolvedOpts = (opts ?? {}) as Options;
      pendingPlugins.push(
        () =>
          new Promise<void>((resolve, reject) => {
            if (plugin.length >= 3) {
              const claim = createOnceFlag();
              const done = (err?: Error): void => {
                if (!claim()) return;
                if (err !== undefined) reject(err);
                else resolve();
              };
              try {
                const maybe = plugin(this, resolvedOpts, done);
                if (maybe instanceof Promise) {
                  maybe.then(() => {
                    done();
                  }, reject);
                }
              } catch (err) {
                if (claim()) {
                  reject(err instanceof Error ? err : new Error(String(err)));
                }
              }
              return;
            }
            Promise.resolve(plugin(this, resolvedOpts, () => undefined)).then(() => {
              resolve();
            }, reject);
          }),
      );
      return this;
    },

    async after(): Promise<void> {
      await flushPlugins();
    },

    async ready(): Promise<void> {
      await flushPlugins();
      readyCompleted = true;
    },

    hasRoute(opts: { method: string; url: string }): boolean {
      return exactRouteSet.has(`${opts.method.toUpperCase()} ${opts.url}`);
    },

    printRoutes(): string {
      if (registeredOrder.length === 0) return '';
      const lines: string[] = [];
      const visit = (node: RadixNode, indent: string, isTopLevel: boolean): void => {
        const children: Array<{ readonly label: string; readonly child: RadixNode }> = [];
        for (const [seg, child] of node.staticChildren.entries()) {
          children.push({ label: isTopLevel ? `/${seg}` : seg, child });
        }
        if (node.paramChild !== undefined) {
          children.push({
            label: isTopLevel ? `/:${node.paramChild.name}` : `:${node.paramChild.name}`,
            child: node.paramChild.node,
          });
        }
        if (node.wildcardChild !== undefined) {
          children.push({ label: isTopLevel ? '/*' : '*', child: node.wildcardChild });
        }
        for (let i = 0; i < children.length; i++) {
          const item = children[i];
          if (item === undefined) continue;
          const isLast = i === children.length - 1;
          const branch = isLast ? '└──' : '├──';
          const methods = [...item.child.routesByMethod.keys()];
          const suffix = methods.length > 0 ? ` (${methods.join(', ')})` : '';
          lines.push(`${indent}${branch} ${item.label}${suffix}`);
          const nextIndent = `${indent}${isLast ? '    ' : '│   '}`;
          visit(item.child, nextIndent, false);
        }
      };
      const rootMethods = [...radixRoot.routesByMethod.keys()];
      if (rootMethods.length > 0) {
        lines.push(`└── / (${rootMethods.join(', ')})`);
      }
      visit(radixRoot, '│   ', true);
      return lines.join('\n');
    },

    async inject(optsInput: InjectOptions | string): Promise<InjectResponse> {
      const opts: InjectOptions =
        typeof optsInput === 'string' ? { method: 'GET', url: optsInput } : optsInput;
      const method = (opts.method ?? 'GET').toUpperCase();
      let url = opts.url ?? opts.path ?? '/';
      if (opts.query !== undefined) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(opts.query)) {
          if (Array.isArray(v)) {
            for (const item of v) sp.append(k, item);
          } else {
            sp.append(k, v);
          }
        }
        const qs = sp.toString();
        if (qs !== '') {
          url = url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
        }
      }

      const headers: IncomingHttpHeaders = {};
      if (opts.headers !== undefined) {
        for (const [k, v] of Object.entries(opts.headers)) {
          if (v === undefined) continue;
          headers[k.toLowerCase()] = Array.isArray(v) ? v : String(v);
        }
      }
      if (!('user-agent' in headers)) {
        headers['user-agent'] = 'bslt-inject';
      }

      if (opts.cookies !== undefined && Object.keys(opts.cookies).length > 0) {
        const pairs = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`);
        const existing = headers['cookie'];
        headers['cookie'] =
          typeof existing === 'string' && existing !== ''
            ? `${existing}; ${pairs.join('; ')}`
            : pairs.join('; ');
      }

      const rawInputPayload = opts.payload !== undefined ? opts.payload : opts.body;
      let rawStream: Readable;
      let hasBody = false;

      if (rawInputPayload === undefined) {
        const pt = new PassThrough();
        pt.end();
        rawStream = pt;
      } else if (rawInputPayload instanceof Readable) {
        hasBody = true;
        rawStream = rawInputPayload;
      } else if (Buffer.isBuffer(rawInputPayload)) {
        hasBody = true;
        if (headers['content-length'] === undefined) {
          headers['content-length'] = String(rawInputPayload.length);
        }
        const pt = new PassThrough();
        pt.end(rawInputPayload);
        rawStream = pt;
      } else if (rawInputPayload instanceof Uint8Array) {
        hasBody = true;
        const buf = Buffer.from(rawInputPayload);
        if (headers['content-length'] === undefined) {
          headers['content-length'] = String(buf.length);
        }
        const pt = new PassThrough();
        pt.end(buf);
        rawStream = pt;
      } else if (typeof rawInputPayload === 'string') {
        hasBody = true;
        const buf = Buffer.from(rawInputPayload, 'utf8');
        if (headers['content-length'] === undefined) {
          headers['content-length'] = String(buf.length);
        }
        const pt = new PassThrough();
        pt.end(buf);
        rawStream = pt;
      } else {
        hasBody = true;
        const jsonText = JSON.stringify(rawInputPayload);
        const buf = Buffer.from(jsonText, 'utf8');
        if (headers['content-type'] === undefined) {
          headers['content-type'] = 'application/json';
        }
        if (headers['content-length'] === undefined) {
          headers['content-length'] = String(buf.length);
        }
        const pt = new PassThrough();
        pt.end(buf);
        rawStream = pt;
      }

      const remoteAddress = opts.remoteAddress ?? '127.0.0.1';
      const fakeRawReq = Object.assign(rawStream, {
        method,
        url,
        headers,
        socket: { remoteAddress },
      }) as unknown as IncomingMessage;

      const { req, reply, state, bodyOut, route } = await executeLifecycle({
        id: nextReqId(fakeRawReq),
        method,
        url,
        headers,
        rawReq: fakeRawReq,
        rawRes: undefined,
        remoteAddress,
        hasBody,
      });

      let finalBuffer: Buffer;
      if (bodyOut instanceof Readable) {
        if (method === 'HEAD') {
          bodyOut.destroy();
          finalBuffer = Buffer.alloc(0);
        } else {
          try {
            finalBuffer = await readStreamWithLimit(bodyOut, Number.MAX_SAFE_INTEGER);
          } catch (streamErr) {
            finalBuffer = await invokeErrorHandler(streamErr, req, reply, state, route);
          }
        }
      } else {
        finalBuffer = method === 'HEAD' ? Buffer.alloc(0) : bodyOut;
      }

      await finishResponseHooks(req, reply);

      const responseHeaders: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of state.headerMap.entries()) {
        responseHeaders[k] = Array.isArray(v) ? v : String(v);
      }

      const setCookieRaw = responseHeaders['set-cookie'];
      const setCookieList =
        setCookieRaw === undefined
          ? []
          : Array.isArray(setCookieRaw)
            ? setCookieRaw
            : [setCookieRaw];
      const parsedCookies: InjectCookie[] = setCookieList.map((entry) => {
        const pair = entry.split(';', 1)[0] ?? '';
        const eqIdx = pair.indexOf('=');
        return eqIdx === -1
          ? { name: pair.trim(), value: '' }
          : { name: pair.slice(0, eqIdx).trim(), value: pair.slice(eqIdx + 1).trim() };
      });

      const bodyString = finalBuffer.toString('utf8');

      return {
        statusCode: state.statusCode,
        statusMessage: statusMessageFor(state.statusCode),
        headers: responseHeaders,
        body: bodyString,
        payload: bodyString,
        rawPayload: finalBuffer,
        cookies: parsedCookies,
        json(): unknown {
          return JSON.parse(bodyString);
        },
      };
    },

    async listen(opts: { port: number; host?: string | undefined }): Promise<string> {
      await this.ready();
      const host = opts.host ?? '127.0.0.1';
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => {
          rawHttpServer.off('listening', onListening);
          reject(err);
        };
        const onListening = (): void => {
          rawHttpServer.off('error', onError);
          resolve();
        };
        rawHttpServer.once('error', onError);
        rawHttpServer.once('listening', onListening);
        rawHttpServer.listen({ port: opts.port, host });
      });
      const address = rawHttpServer.address();
      const boundPort = address !== null && typeof address === 'object' ? address.port : opts.port;
      return `http://${host}:${String(boundPort)}`;
    },

    async close(): Promise<void> {
      if (isClosing) return;
      isClosing = true;

      if (rawHttpServer.listening) {
        rawHttpServer.closeIdleConnections();
        const closePromise = new Promise<void>((resolve) => {
          rawHttpServer.close(() => {
            resolve();
          });
        });
        if (inFlightRequests.size > 0) {
          await Promise.allSettled([...inFlightRequests]);
        }
        rawHttpServer.closeIdleConnections();
        rawHttpServer.closeAllConnections();
        await closePromise;
        // Allow loopback client keep-alive pools (http.globalAgent) to process FIN/close
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 15);
        });
      }

      for (const hook of onCloseHooks) {
        await runOnCloseHook(hook, this);
      }
    },
  };

  return instance;
}
