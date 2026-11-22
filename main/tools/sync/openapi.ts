// main/tools/sync/openapi.ts
/**
 * `bslt sync openapi [--check]`: the OpenAPI 3.1 document of the API,
 * `docs/reference/openapi.json` (restructure plan, section 13 A6; a rung-3
 * file of section 14.2, for consumers that do not read TypeScript).
 *
 * It is written from the composition the API surface snapshot is written from
 * (`composeApi`, ../snapshot/api.ts): one operation per snapshot row, with the
 * row's auth requirement, module and deprecation, and the schemas of its
 * contract. The schemas Fastify itself validates and serializes with (a
 * route's `openapi` body, params, querystring and response) come first: they
 * are what the server enforces.
 *
 * A schema is described by what `describe()` of `@bslt/schema` exposes, mapped
 * node by node to JSON Schema 2020-12. Nothing is inferred from a TypeScript
 * type or from parser code, which would state checks nothing enforces. A
 * hand-written `createSchema(fn)` parser is `{"x-bslt-opaque": true}`: not
 * described, which is not "anything". What JSON Schema cannot say (trimming,
 * coercion, refinements, brands, secret fields) becomes an `x-bslt-*` keyword.
 *
 * The `generated` header of a snapshot is `x-generated` here: OpenAPI allows
 * only `x-` keys of its own at the root.
 */
import { readFileSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import path from 'node:path';

import { describe, type Schema, type SchemaNode, type StringFormat } from '@bslt/schema';

import { REPO_ROOT } from '../lib/paths';
import {
  composeApi,
  type ApiRoute,
  type ContractEndpoint,
  type RegisteredRoute,
} from '../snapshot/api';
import {
  checkSnapshot,
  snapshotHeader,
  writeSnapshot,
  type SnapshotSpec,
} from '../snapshot/snapshot-file';

import type { CheckResult } from '../gates/types';

export const OPENAPI_DOCUMENT: SnapshotSpec = {
  id: 'openapi',
  file: 'docs/reference/openapi.json',
  title: 'The OpenAPI document',
  sources: 'the API contracts and the server composed by buildApp()',
  command: 'pnpm bslt sync openapi',
};

/** A JSON Schema object. */
export type JsonSchema = Readonly<Record<string, unknown>>;

type Operation = Readonly<Record<string, unknown>>;

export interface OpenApiDocument {
  readonly 'x-generated': string;
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  readonly components: { readonly securitySchemes: Readonly<Record<string, JsonSchema>> };
}

export interface OpenApiInput {
  readonly title: string;
  readonly version: string;
  /** The API surface snapshot rows: one operation each. */
  readonly rows: readonly ApiRoute[];
  readonly registered: readonly RegisteredRoute[];
  readonly contracts: readonly ContractEndpoint[];
}

const DESCRIPTION = [
  'Generated from the API contracts by `pnpm bslt sync openapi`; do not edit.',
  '',
  'Schemas state only what the validators expose. `x-bslt-opaque: true` marks a schema a',
  'hand-written parser checks and nothing describes; `x-bslt-schema` names the contract schema.',
  '`x-bslt-trim`, `x-bslt-lowercase` and `x-bslt-coerce` mark values normalized before the check;',
  '`x-bslt-refine`, `x-bslt-brand`, `x-bslt-sealed` (a secret, redacted in logs),',
  '`x-bslt-format` and `x-bslt-minimum`/`x-bslt-maximum` (integer strings) mark checks JSON',
  'Schema cannot express. Patterns are emitted without their regular expression flags.',
  '`x-bslt-roles` lists the roles a route admits; `x-bslt-auth: undeclared` marks a route',
  'whose handler checks the caller itself. `x-bslt-wildcard` marks a parameter that matches',
  'the rest of the path, slashes included.',
].join('\n');

/** The integer strings `bigintString` accepts. */
const CANONICAL_INTEGER = '^(?:0|-?[1-9]\\d*)$';

/** A format becomes the JSON Schema format only where the check means the same. */
const FORMATS: Readonly<Record<StringFormat, JsonSchema>> = {
  uuid: { format: 'uuid' },
  url: { format: 'uri' },
  // Trimmed and lower-cased before it is checked.
  email: { format: 'email', 'x-bslt-trim': true, 'x-bslt-lowercase': true },
  // Whatever `new Date()` reads: far looser than RFC 3339 `date-time`.
  'iso-datetime': { 'x-bslt-format': 'iso-datetime' },
  ip: { anyOf: [{ format: 'ipv4' }, { format: 'ipv6' }] },
};

const OPAQUE = { 'x-bslt-opaque': true } as const;

/** The JSON Schema 2020-12 of a `describe()` node. */
export function toJsonSchema(node: SchemaNode): JsonSchema {
  switch (node.kind) {
    case 'opaque':
      return OPAQUE;
    case 'json':
      return {};
    case 'string':
      return {
        type: 'string',
        ...(node.length !== undefined || node.min !== undefined
          ? { minLength: node.length ?? node.min }
          : {}),
        ...(node.length !== undefined || node.max !== undefined
          ? { maxLength: node.length ?? node.max }
          : {}),
        // `describe()` keeps the source of a pattern, not its flags.
        ...(node.pattern !== undefined ? { pattern: node.pattern } : {}),
        ...(node.trim === true ? { 'x-bslt-trim': true } : {}),
        ...(node.format !== undefined ? FORMATS[node.format] : {}),
      };
    case 'number':
      return {
        type: node.int === true ? 'integer' : 'number',
        ...(node.min !== undefined ? { minimum: node.min } : {}),
        ...(node.max !== undefined ? { maximum: node.max } : {}),
        ...(node.coerce === true ? { 'x-bslt-coerce': true } : {}),
      };
    case 'boolean':
      return { type: 'boolean', ...(node.coerce === true ? { 'x-bslt-coerce': true } : {}) };
    case 'literal':
      return { const: node.value };
    case 'enum':
      return { type: 'string', enum: [...node.values] };
    case 'bigintString':
      return {
        type: 'string',
        pattern: CANONICAL_INTEGER,
        ...(node.min !== undefined ? { 'x-bslt-minimum': node.min } : {}),
        ...(node.max !== undefined ? { 'x-bslt-maximum': node.max } : {}),
      };
    case 'optional':
      // Optional is a property of the place, not of the value: see `object`.
      return toJsonSchema(node.inner);
    case 'nullable':
      return { anyOf: [toJsonSchema(node.inner), { type: 'null' }] };
    case 'array':
      return {
        type: 'array',
        items: toJsonSchema(node.items),
        ...(node.min !== undefined ? { minItems: node.min } : {}),
        ...(node.max !== undefined ? { maxItems: node.max } : {}),
      };
    case 'record':
      return {
        type: 'object',
        additionalProperties: toJsonSchema(node.values),
        propertyNames: toJsonSchema(node.keys),
      };
    case 'object':
      return {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(node.properties).map(([key, value]) => [key, toJsonSchema(value)]),
        ),
        ...(node.required.length > 0 ? { required: [...node.required] } : {}),
        additionalProperties: node.additionalProperties,
      };
    case 'union':
      return { anyOf: node.anyOf.map((branch) => toJsonSchema(branch)) };
    case 'discriminated':
      return {
        oneOf: Object.values(node.mapping).map((variant) => toJsonSchema(variant)),
        discriminator: { propertyName: node.discriminator },
      };
    case 'brand':
      return { ...toJsonSchema(node.inner), 'x-bslt-brand': node.brand };
    case 'refine':
      return { ...toJsonSchema(node.inner), 'x-bslt-refine': node.description ?? true };
    case 'sealed':
      return { ...toJsonSchema(node.inner), 'x-bslt-sealed': true };
  }
}

function isSchema(value: unknown): value is Schema {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function'
  );
}

/** A contract schema with the expression that names it, the way the snapshot names it. */
function named(schema: Schema, expression: string | null | undefined): JsonSchema {
  return {
    ...toJsonSchema(describe(schema)),
    ...(expression === null || expression === undefined ? {} : { 'x-bslt-schema': expression }),
  };
}

function propertiesOf(schema: JsonSchema): Readonly<Record<string, JsonSchema>> | undefined {
  const { properties } = schema as { properties?: Readonly<Record<string, JsonSchema>> };
  return properties;
}

function requiredOf(schema: JsonSchema): readonly string[] {
  return (schema as { required?: readonly string[] }).required ?? [];
}

/** `:id` is `{id}`; the wildcard `*` is `{*}`. */
function templateOf(fastifyPath: string): string {
  return fastifyPath
    .split('/')
    .map((segment) =>
      segment === '*' ? '{*}' : segment.startsWith(':') ? `{${segment.slice(1)}}` : segment,
    )
    .join('/');
}

function pathParameterNames(fastifyPath: string): string[] {
  return fastifyPath
    .split('/')
    .filter((segment) => segment === '*' || segment.startsWith(':'))
    .map((segment) => (segment === '*' ? '*' : segment.slice(1)));
}

/** One schema for every path parameter, from a schema or from one schema per parameter. */
function pathParamsSchema(contract: ContractEndpoint | undefined): JsonSchema | undefined {
  const declared = contract?.schemas.pathParams;
  if (declared === undefined) return undefined;
  if (isSchema(declared)) return named(declared, contract?.source.pathParams);
  const perParameter = Object.entries(declared as Readonly<Record<string, Schema>>);
  return {
    type: 'object',
    properties: Object.fromEntries(
      perParameter.map(([name, schema]) => [name, toJsonSchema(describe(schema))]),
    ),
    required: perParameter.map(([name]) => name),
  };
}

function pathParameters(
  route: ApiRoute,
  declared: JsonSchema | undefined,
): Array<Record<string, unknown>> {
  const names = pathParameterNames(route.path);
  const properties = declared === undefined ? undefined : propertiesOf(declared);
  if (properties !== undefined) {
    const declaredNames = Object.keys(properties).sort();
    if (declaredNames.join() !== [...names].sort().join()) {
      throw new Error(
        `${route.method} ${route.path}: the path names ${names.map((name) => `:${name}`).join(', ')}, its path parameter schema names ${declaredNames.join(', ')}`,
      );
    }
  }
  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    // A path segment is a string on the wire; an opaque parser's flag goes with it.
    schema: properties?.[name] ?? { type: 'string', ...declared },
    ...(name === '*' ? { 'x-bslt-wildcard': true } : {}),
  }));
}

function queryParameters(declared: JsonSchema | undefined): Array<Record<string, unknown>> {
  if (declared === undefined) return [];
  const properties = propertiesOf(declared);
  if (properties === undefined) {
    // A query string reaches the handler as a map; exploded, its name is never sent.
    return [
      {
        name: 'query',
        in: 'query',
        style: 'form',
        explode: true,
        schema: { type: 'object', ...declared },
      },
    ];
  }
  const required = requiredOf(declared);
  return Object.entries(properties).map(([name, schema]) => ({
    name,
    in: 'query',
    required: required.includes(name),
    schema,
  }));
}

function requestBody(
  contract: ContractEndpoint | undefined,
  enforced: JsonSchema | undefined,
): Record<string, unknown> | undefined {
  if (enforced !== undefined) {
    return { required: true, content: { 'application/json': { schema: enforced } } };
  }
  const body = contract?.schemas.body;
  if (!isSchema(body)) return undefined;
  const node = describe(body);
  const value = node.kind === 'optional' ? node.inner : node;
  const schema = named(body, contract?.source.body);
  // A contract names no media type: an opaque parser may read multipart as well
  // as JSON. Whether it accepts no body cannot be seen, so nothing is claimed.
  if (value.kind === 'opaque') return { content: { '*/*': { schema } } };
  return {
    required: node.kind !== 'optional',
    content: { 'application/json': { schema } },
  };
}

function responses(
  contract: ContractEndpoint | undefined,
  enforced: Readonly<Record<number, JsonSchema>> | undefined,
): Record<string, unknown> | undefined {
  const declared: Record<string, JsonSchema> = {};
  for (const [status, schema] of Object.entries(contract?.schemas.responses ?? {})) {
    if (isSchema(schema)) declared[status] = named(schema, contract?.source.responses[status]);
  }
  for (const [status, schema] of Object.entries(enforced ?? {})) declared[status] = schema;
  if (Object.keys(declared).length === 0) return undefined;
  return Object.fromEntries(
    Object.entries(declared).map(([status, schema]) => [
      status,
      {
        description: STATUS_CODES[Number(status)] ?? status,
        content: { 'application/json': { schema } },
      },
    ]),
  );
}

function security(route: ApiRoute): Record<string, unknown> {
  switch (route.auth) {
    case 'public':
      return { security: [] };
    case 'authenticated':
      return { security: [{ bearerAuth: [] }] };
    case 'role':
      return { security: [{ bearerAuth: [] }], 'x-bslt-roles': [...route.roles] };
    case 'undeclared':
      return { 'x-bslt-auth': 'undeclared' };
  }
}

function operationOf(
  route: ApiRoute,
  contract: ContractEndpoint | undefined,
  registered: RegisteredRoute | undefined,
): Operation {
  const enforced = registered?.openapi;
  const parameters = [
    ...pathParameters(route, enforced?.params ?? pathParamsSchema(contract)),
    ...queryParameters(
      enforced?.querystring ??
        (isSchema(contract?.schemas.query)
          ? named(contract.schemas.query, contract.source.query)
          : undefined),
    ),
  ];
  const body = requestBody(contract, enforced?.body);
  const answers = responses(contract, enforced?.response);
  const summary = contract?.summary ?? registered?.summary;
  return {
    ...(contract === undefined ? {} : { operationId: contract.id }),
    ...(route.module === null ? {} : { tags: [route.module] }),
    ...(summary === undefined ? {} : { summary }),
    ...(route.deprecated ? { deprecated: true } : {}),
    ...security(route),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(body === undefined ? {} : { requestBody: body }),
    ...(answers === undefined ? {} : { responses: answers }),
  };
}

/**
 * The OpenAPI document of the composed API.
 *
 * @throws {Error} When a row names a contract endpoint that is not in
 *   `contracts`, when two operations share an operation id, or when a path
 *   names parameters its path parameter schema does not.
 */
export function toOpenApiDocument(input: OpenApiInput): OpenApiDocument {
  const contracts = new Map(input.contracts.map((contract) => [contract.id, contract]));
  const registered = new Map(
    input.registered.map((route) => [`${route.method} ${route.path}`, route]),
  );
  const operationIds = new Set<string>();
  const paths: Record<string, Record<string, Operation>> = {};

  for (const route of input.rows) {
    const id = route.contract?.endpoint;
    const contract = id === undefined ? undefined : contracts.get(id);
    if (id !== undefined && contract === undefined) {
      throw new Error(
        `${route.method} ${route.path} names contract endpoint ${id}, which is not given`,
      );
    }
    if (id !== undefined) {
      if (operationIds.has(id))
        throw new Error(`duplicate operation id ${id} (${route.method} ${route.path})`);
      operationIds.add(id);
    }
    const template = templateOf(route.path);
    paths[template] = {
      ...paths[template],
      [route.method.toLowerCase()]: operationOf(
        route,
        contract,
        registered.get(`${route.method} ${route.path}`),
      ),
    };
  }

  return {
    'x-generated': snapshotHeader(OPENAPI_DOCUMENT),
    openapi: '3.1.0',
    info: { title: input.title, version: input.version, description: DESCRIPTION },
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
  };
}

/** Compose the server and return the content of the OpenAPI document. */
export async function buildOpenApi(): Promise<string> {
  const { config, rows, registered, contracts } = await composeApi();
  const { version } = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'main/apps/server/package.json'), 'utf8'),
  ) as { version: string };
  const document = toOpenApiDocument({
    title: `${config.app.name} API`,
    version,
    rows,
    registered,
    contracts,
  });
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** The `generated-openapi` gate: the committed document equals what the code gives now. */
export async function run(options: { readonly root?: string } = {}): Promise<CheckResult> {
  return checkSnapshot(OPENAPI_DOCUMENT, await buildOpenApi(), options.root ?? REPO_ROOT);
}

/**
 * Write the document.
 *
 * @returns Whether the file changed.
 */
export async function syncOpenApi(): Promise<boolean> {
  return writeSnapshot(OPENAPI_DOCUMENT, await buildOpenApi());
}
