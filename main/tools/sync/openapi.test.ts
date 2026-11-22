// main/tools/sync/openapi.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  array,
  bigintString,
  boolean,
  brand,
  createSchema,
  describe as describeSchema,
  discriminated,
  enumOf,
  json,
  literal,
  nullable,
  number,
  object,
  optional,
  record,
  refine,
  sealed,
  string,
  union,
  type Schema,
} from '@bslt/schema';
import { beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/paths';
import {
  composeApi,
  type ApiRoute,
  type ContractEndpoint,
  type RegisteredRoute,
} from '../snapshot/api';

import {
  buildOpenApi,
  OPENAPI_DOCUMENT,
  run,
  toJsonSchema,
  toOpenApiDocument,
  type OpenApiInput,
} from './openapi';

const schemaOf = (schema: Schema): ReturnType<typeof toJsonSchema> =>
  toJsonSchema(describeSchema(schema));

const opaque = createSchema((value) => value);

describe('toJsonSchema', () => {
  it('maps an object, leaving optional properties out of required', () => {
    expect(schemaOf(object({ a: string(), b: optional(number()) }))).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
      additionalProperties: false,
    });
    expect(schemaOf(object({ a: optional(string()) }))).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    });
  });

  it('maps nullable, array, record, union and discriminated', () => {
    expect(schemaOf(nullable(string()))).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
    expect(schemaOf(array(string(), { min: 1, max: 3 }))).toEqual({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
    });
    expect(schemaOf(record(number()))).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
      propertyNames: { type: 'string' },
    });
    expect(schemaOf(union([string(), number()]))).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
    expect(
      schemaOf(
        discriminated('kind', [
          object({ kind: literal('a') }),
          object({ kind: literal('b'), n: number() }),
        ]),
      ),
    ).toEqual({
      oneOf: [
        {
          type: 'object',
          properties: { kind: { const: 'a' } },
          required: ['kind'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { kind: { const: 'b' }, n: { type: 'number' } },
          required: ['kind', 'n'],
          additionalProperties: false,
        },
      ],
      discriminator: { propertyName: 'kind' },
    });
  });

  it('maps literals, enums, numbers and booleans', () => {
    expect(schemaOf(literal('x'))).toEqual({ const: 'x' });
    expect(schemaOf(literal(null))).toEqual({ const: null });
    expect(schemaOf(enumOf(['a', 'b']))).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(schemaOf(number({ int: true, min: 1, max: 10 }))).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 10,
    });
    expect(schemaOf(number({ coerce: true }))).toEqual({ type: 'number', 'x-bslt-coerce': true });
    expect(schemaOf(boolean())).toEqual({ type: 'boolean' });
    expect(schemaOf(boolean({ coerce: true }))).toEqual({
      type: 'boolean',
      'x-bslt-coerce': true,
    });
  });

  it('maps string bounds and patterns, without the regular expression flags', () => {
    expect(schemaOf(string({ min: 1, max: 5, trim: true }))).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 5,
      'x-bslt-trim': true,
    });
    expect(schemaOf(string({ length: 4 }))).toEqual({
      type: 'string',
      minLength: 4,
      maxLength: 4,
    });
    expect(schemaOf(string({ pattern: /^[a-z]+$/iu }))).toEqual({
      type: 'string',
      pattern: '^[a-z]+$',
    });
  });

  it('maps a format to its JSON Schema name only where the check means the same', () => {
    expect(schemaOf(string({ format: 'uuid' }))).toEqual({ type: 'string', format: 'uuid' });
    expect(schemaOf(string({ format: 'url' }))).toEqual({ type: 'string', format: 'uri' });
    // An email is trimmed and lower-cased before it is checked.
    expect(schemaOf(string({ format: 'email' }))).toEqual({
      type: 'string',
      format: 'email',
      'x-bslt-trim': true,
      'x-bslt-lowercase': true,
    });
    // Anything `new Date()` reads is accepted: far looser than RFC 3339 date-time.
    expect(schemaOf(string({ format: 'iso-datetime' }))).toEqual({
      type: 'string',
      'x-bslt-format': 'iso-datetime',
    });
    expect(schemaOf(string({ format: 'ip' }))).toEqual({
      type: 'string',
      anyOf: [{ format: 'ipv4' }, { format: 'ipv6' }],
    });
  });

  it('annotates what JSON Schema cannot check', () => {
    expect(schemaOf(bigintString({ min: 0n, max: 10n }))).toEqual({
      type: 'string',
      pattern: '^(?:0|-?[1-9]\\d*)$',
      'x-bslt-minimum': '0',
      'x-bslt-maximum': '10',
    });
    expect(schemaOf(brand(string(), 'UserId'))).toEqual({
      type: 'string',
      'x-bslt-brand': 'UserId',
    });
    expect(schemaOf(refine(number(), (value) => value > 0, 'must be positive'))).toEqual({
      type: 'number',
      'x-bslt-refine': 'must be positive',
    });
    expect(
      schemaOf(
        refine(
          number(),
          (value) => value > 0,
          (value) => `${String(value)} is not > 0`,
        ),
      ),
    ).toEqual({ type: 'number', 'x-bslt-refine': true });
    expect(schemaOf(sealed(string()))).toEqual({ type: 'string', 'x-bslt-sealed': true });
    expect(schemaOf(json())).toEqual({});
  });

  it('marks an opaque parser, and only it, as not described', () => {
    expect(schemaOf(opaque)).toEqual({ 'x-bslt-opaque': true });
    expect(schemaOf(object({ a: opaque, b: string() }))).toEqual({
      type: 'object',
      properties: { a: { 'x-bslt-opaque': true }, b: { type: 'string' } },
      required: ['a', 'b'],
      additionalProperties: false,
    });
  });
});

// ============================================================================
// toOpenApiDocument
// ============================================================================

function row(overrides: Partial<ApiRoute> = {}): ApiRoute {
  return {
    method: 'GET',
    path: '/api/items',
    registeredBy: 'route-map',
    module: 'items',
    auth: 'public',
    roles: [],
    deprecated: false,
    bodyLimit: null,
    preHandlers: [],
    request: null,
    contract: null,
    ...overrides,
  };
}

function contract(
  id: string,
  schemas: ContractEndpoint['schemas'],
  overrides: Partial<ContractEndpoint> = {},
): ContractEndpoint {
  const name = (schema: unknown): string | null => (schema === undefined ? null : `${id}Schema`);
  return {
    id,
    method: 'GET',
    path: '/api/items',
    schemas,
    source: {
      body: name(schemas.body),
      query: name(schemas.query),
      pathParams: name(schemas.pathParams),
      responses: Object.fromEntries(
        Object.keys(schemas.responses).map((status) => [status, `${id}Response${status}`]),
      ),
    },
    ...overrides,
  };
}

function contracted(endpoint: ContractEndpoint, overrides: Partial<ApiRoute> = {}): ApiRoute {
  return row({
    method: endpoint.method,
    path: endpoint.path,
    contract: {
      endpoint: endpoint.id,
      body: endpoint.source.body,
      query: endpoint.source.query,
      pathParams: endpoint.source.pathParams,
      responses: endpoint.source.responses,
    },
    ...overrides,
  });
}

function input(overrides: Partial<OpenApiInput>): OpenApiInput {
  return {
    title: 'Test API',
    version: '1.0.0',
    rows: [],
    registered: [],
    contracts: [],
    ...overrides,
  };
}

type Operation = Readonly<Record<string, unknown>>;

function operation(
  document: ReturnType<typeof toOpenApiDocument>,
  method: string,
  at: string,
): Operation {
  const found = document.paths[at]?.[method];
  if (found === undefined) throw new Error(`no ${method} ${at}`);
  return found;
}

const listItems = contract(
  'items.list',
  {
    query: object({ cursor: optional(string()), limit: number({ coerce: true }) }),
    responses: { '200': array(string()), '401': object({ code: string() }) },
  },
  { summary: 'List items' },
);

describe('toOpenApiDocument', () => {
  it('describes a contract route: operation id, tag, summary, security, query and responses', () => {
    const document = toOpenApiDocument(
      input({ rows: [contracted(listItems)], contracts: [listItems] }),
    );

    expect(document['x-generated']).toContain('pnpm bslt sync openapi');
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document)[0]).toBe('x-generated');
    expect(operation(document, 'get', '/api/items')).toEqual({
      operationId: 'items.list',
      tags: ['items'],
      summary: 'List items',
      security: [],
      parameters: [
        { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'limit',
          in: 'query',
          required: true,
          schema: { type: 'number', 'x-bslt-coerce': true },
        },
      ],
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { type: 'string' },
                'x-bslt-schema': 'items.listResponse200',
              },
            },
          },
        },
        '401': {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { code: { type: 'string' } },
                required: ['code'],
                additionalProperties: false,
                'x-bslt-schema': 'items.listResponse401',
              },
            },
          },
        },
      },
    });
  });

  it('states the auth requirement of each route', () => {
    const document = toOpenApiDocument(
      input({
        rows: [
          row({ path: '/api/a', auth: 'authenticated' }),
          row({ path: '/api/b', auth: 'role', roles: ['admin', 'owner'] }),
          row({ path: '/api/c', auth: 'undeclared', registeredBy: 'server', module: null }),
        ],
      }),
    );

    expect(operation(document, 'get', '/api/a')['security']).toEqual([{ bearerAuth: [] }]);
    expect(operation(document, 'get', '/api/a')['x-bslt-roles']).toBeUndefined();
    expect(operation(document, 'get', '/api/b')).toMatchObject({
      security: [{ bearerAuth: [] }],
      'x-bslt-roles': ['admin', 'owner'],
    });
    // Whatever a route registered on the server checks, its handler checks.
    expect(operation(document, 'get', '/api/c')).toEqual({ 'x-bslt-auth': 'undeclared' });
    expect(document.components.securitySchemes).toEqual({
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    });
  });

  it('turns path parameters into templates and declares each one', () => {
    const byObject = contract(
      'items.get',
      { pathParams: object({ id: string({ format: 'uuid' }) }), responses: {} },
      { path: '/api/items/:id' },
    );
    const byRecord = contract(
      'items.part',
      { pathParams: { id: number({ coerce: true }) }, responses: {} },
      { path: '/api/items/:id/parts' },
    );
    const byParser = contract(
      'items.owner',
      { pathParams: opaque, responses: {} },
      { path: '/api/items/:id/owner' },
    );
    const document = toOpenApiDocument(
      input({
        rows: [
          contracted(byObject),
          contracted(byRecord),
          contracted(byParser),
          row({ path: '/api/things/:thingId' }),
          row({ path: '/uploads/*', auth: 'undeclared', module: null, registeredBy: 'server' }),
        ],
        contracts: [byObject, byRecord, byParser],
      }),
    );

    expect(operation(document, 'get', '/api/items/{id}')['parameters']).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ]);
    expect(operation(document, 'get', '/api/items/{id}/parts')['parameters']).toEqual([
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'number', 'x-bslt-coerce': true },
      },
    ]);
    // The parser validates the parameters; what it accepts is not described.
    expect(operation(document, 'get', '/api/items/{id}/owner')['parameters']).toEqual([
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', 'x-bslt-opaque': true, 'x-bslt-schema': 'items.ownerSchema' },
      },
    ]);
    expect(operation(document, 'get', '/api/things/{thingId}')['parameters']).toEqual([
      { name: 'thingId', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    expect(operation(document, 'get', '/uploads/{*}')['parameters']).toEqual([
      {
        name: '*',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        'x-bslt-wildcard': true,
      },
    ]);
  });

  it('sends an opaque query as one exploded object parameter', () => {
    const search = contract('items.search', { query: opaque, responses: {} });
    const document = toOpenApiDocument(input({ rows: [contracted(search)], contracts: [search] }));

    expect(operation(document, 'get', '/api/items')['parameters']).toEqual([
      {
        name: 'query',
        in: 'query',
        style: 'form',
        explode: true,
        schema: { type: 'object', 'x-bslt-opaque': true, 'x-bslt-schema': 'items.searchSchema' },
      },
    ]);
  });

  it('describes a request body: JSON when structural, any media type when opaque', () => {
    const create = contract(
      'items.create',
      { body: object({ name: string() }), responses: {} },
      { method: 'POST' },
    );
    const patch = contract(
      'items.patch',
      { body: optional(object({ name: string() })), responses: {} },
      { method: 'PATCH' },
    );
    const upload = contract('items.upload', { body: opaque, responses: {} }, { method: 'PUT' });
    const document = toOpenApiDocument(
      input({
        rows: [contracted(create), contracted(patch), contracted(upload)],
        contracts: [create, patch, upload],
      }),
    );

    expect(operation(document, 'post', '/api/items')['requestBody']).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
            'x-bslt-schema': 'items.createSchema',
          },
        },
      },
    });
    expect(operation(document, 'patch', '/api/items')['requestBody']).toMatchObject({
      required: false,
    });
    // A contract names no media type: an opaque parser may read multipart as well.
    // Nor can it be seen whether the parser accepts no body (`emptyBodySchema`
    // does): `required` is left out, which OpenAPI reads as false.
    expect(operation(document, 'put', '/api/items')['requestBody']).toEqual({
      content: {
        '*/*': { schema: { 'x-bslt-opaque': true, 'x-bslt-schema': 'items.uploadSchema' } },
      },
    });
  });

  it('prefers the schemas Fastify enforces over the contract', () => {
    const login = contract(
      'auth.login',
      { body: opaque, responses: { '200': opaque, '400': object({ code: string() }) } },
      { method: 'POST', path: '/api/auth/login' },
    );
    const enforcedBody = { type: 'object', properties: { identifier: { type: 'string' } } };
    const enforced200 = { type: 'object', additionalProperties: true };
    const registered: RegisteredRoute = {
      method: 'POST',
      path: '/api/auth/login',
      module: 'auth',
      isPublic: true,
      roles: [],
      deprecated: false,
      schema: undefined,
      preHandlers: [],
      bodyLimit: null,
      summary: 'Log in',
      openapi: { body: enforcedBody, response: { 200: enforced200 } },
    };
    const document = toOpenApiDocument(
      input({
        rows: [contracted(login, { module: 'auth' })],
        registered: [registered],
        contracts: [login],
      }),
    );
    const login200 = operation(document, 'post', '/api/auth/login');

    expect(login200['summary']).toBe('Log in');
    expect(login200['requestBody']).toEqual({
      required: true,
      content: { 'application/json': { schema: enforcedBody } },
    });
    expect(login200['responses']).toMatchObject({
      '200': { content: { 'application/json': { schema: enforced200 } } },
      '400': { description: 'Bad Request' },
    });
  });

  it('passes deprecation through and leaves a route without a contract without responses', () => {
    const document = toOpenApiDocument(input({ rows: [row({ deprecated: true })] }));

    expect(operation(document, 'get', '/api/items')).toEqual({
      tags: ['items'],
      deprecated: true,
      security: [],
    });
  });

  it('stops on a row that names a contract it was not given', () => {
    expect(() => toOpenApiDocument(input({ rows: [contracted(listItems)] }))).toThrow(
      /items\.list/u,
    );
  });

  it('stops on two operations with one operation id', () => {
    expect(() =>
      toOpenApiDocument(
        input({
          rows: [contracted(listItems), contracted(listItems, { method: 'POST' })],
          contracts: [listItems],
        }),
      ),
    ).toThrow(/operation id items\.list/u);
  });

  it('stops when the path names a parameter its schema does not', () => {
    const get = contract(
      'items.get',
      { pathParams: object({ itemId: string() }), responses: {} },
      { path: '/api/items/:id' },
    );
    expect(() => toOpenApiDocument(input({ rows: [contracted(get)], contracts: [get] }))).toThrow(
      /:id/u,
    );
  });
});

// ============================================================================
// The composed server
// ============================================================================

interface OpenApiFile {
  readonly 'x-generated': string;
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
}

describe('bslt sync openapi', () => {
  let text: string;
  let file: OpenApiFile;
  let rows: readonly ApiRoute[];

  beforeAll(async () => {
    text = await buildOpenApi();
    file = JSON.parse(text) as OpenApiFile;
    rows = (await composeApi()).rows;
  }, 60_000);

  it('is byte-identical on two runs', async () => {
    expect(await buildOpenApi()).toBe(text);
  }, 60_000);

  it('has one operation per served route, each path parameter declared', () => {
    const operations = Object.entries(file.paths).flatMap(([at, methods]) =>
      Object.entries(methods).map(([method, op]) => ({ at, method, op })),
    );
    expect(operations).toHaveLength(rows.length);
    expect(file['x-generated']).toContain('pnpm bslt sync openapi');

    for (const { at, op } of operations) {
      const templated = [...at.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]);
      const declared = ((op['parameters'] ?? []) as Array<{ name: string; in: string }>)
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name);
      expect(declared).toEqual(templated);
    }
  });

  it('documents no route of the removed docs UI', () => {
    const removedPrefix = ['', 'api', 'docs'].join('/');
    expect(Object.keys(file.paths).filter((at) => at.startsWith(removedPrefix))).toEqual([]);
  });

  it('keeps the login body Fastify validates', () => {
    expect(file.paths['/api/auth/login']?.['post']?.['requestBody']).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              identifier: { type: 'string', minLength: 1, 'x-bslt-trim': true },
              password: { type: 'string', minLength: 8 },
              captchaToken: { type: 'string' },
              rememberMe: { type: 'boolean' },
            },
            required: ['identifier', 'password'],
            'x-bslt-schema': 'loginRequestSchema',
          },
        },
      },
    });
  });

  it('passes the committed document and fails an edited or missing one', async () => {
    expect((await run({ root: REPO_ROOT })).ok).toBe(true);

    const root = mkdtempSync(path.join(tmpdir(), 'openapi-'));
    try {
      const missing = await run({ root });
      expect(missing.ok).toBe(false);
      expect(missing.summary).toContain(OPENAPI_DOCUMENT.file);

      mkdirSync(path.join(root, path.dirname(OPENAPI_DOCUMENT.file)), { recursive: true });
      writeFileSync(path.join(root, OPENAPI_DOCUMENT.file), text.replace('"3.1.0"', '"3.0.3"'));
      const edited = await run({ root });
      expect(edited.ok).toBe(false);
      expect(edited.problems?.join('\n')).toContain('+   "openapi": "3.1.0",');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
