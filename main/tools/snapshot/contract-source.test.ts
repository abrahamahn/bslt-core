// main/tools/snapshot/contract-source.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { composeRouter } from '@bslt/contract';
import { devOnlyModules, installedModules } from '@bslt/server/generated/modules';
import { afterEach, describe, expect, it } from 'vitest';

import { readContractSources } from './contract-source';

const roots: string[] = [];

function moduleFixture(
  modules: Readonly<Record<string, { readonly endpoints: string; readonly errors?: string }>>,
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-contract-source-'));
  roots.push(root);
  for (const [moduleId, spec] of Object.entries(modules)) {
    const contractDir = path.join(root, 'main/modules', moduleId, 'contract');
    mkdirSync(contractDir, { recursive: true });
    writeFileSync(path.join(contractDir, 'endpoints.ts'), spec.endpoints);
    if (spec.errors !== undefined) {
      writeFileSync(path.join(contractDir, 'errors.ts'), spec.errors);
    }
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const TASKS_ENDPOINTS = [
  'export const tasksEndpoints = {',
  '  list: endpoint({',
  "    method: 'GET',",
  "    path: '/api/tasks',",
  "    auth: 'public',",
  '    query: listQuerySchema,',
  '    response: successResponseSchema(',
  '      itemListSchema, // the page',
  '    ),',
  "    summary: 'List tasks',",
  '  }),',
  '  update: endpoint({',
  "    method: 'POST',",
  "    path: '/api/tasks/:id/update',",
  "    auth: 'user',",
  '    params: object({',
  '      id: uuidSchema,',
  '    }),',
  '    body: updateTaskRequestSchema,',
  '    response: taskMutationResponseSchema,',
  "    errors: ['tasks.TASK_NOT_FOUND'],",
  "    summary: 'Update task',",
  '  }),',
  '};',
  '',
].join('\n');

const TASKS_ERRORS = "export const tasksErrors = defineErrors('tasks', { TASK_NOT_FOUND: 404 });\n";

describe('readContractSources', () => {
  it('reads each schema slot of each module endpoint as the expression the contract declares', () => {
    const sources = readContractSources(
      moduleFixture({ tasks: { endpoints: TASKS_ENDPOINTS, errors: TASKS_ERRORS } }),
    );

    expect([...sources.keys()]).toEqual(['tasks.list', 'tasks.update']);
    expect(sources.get('tasks.list')).toEqual({
      body: null,
      query: 'listQuerySchema',
      pathParams: null,
      responses: {
        '200': 'successResponseSchema(itemListSchema)',
        '400': 'errorResponseSchema',
      },
    });
    expect(sources.get('tasks.update')).toEqual({
      body: 'updateTaskRequestSchema',
      query: null,
      pathParams: '{ id: uuidSchema }',
      responses: {
        '200': 'taskMutationResponseSchema',
        '400': 'errorResponseSchema',
        '401': 'errorResponseSchema',
        '404': 'errorResponseSchema',
      },
    });
  });

  it('does not depend on how the contract file is formatted', () => {
    const reformatted = TASKS_ENDPOINTS.replace(
      /successResponseSchema\(\n\s+itemListSchema, \/\/ the page\n\s+\)/u,
      'successResponseSchema(itemListSchema)',
    ).replace(
      /params: object\(\{\n\s+id: uuidSchema,\n\s+\}\)/u,
      'params: object({ id: uuidSchema })',
    );
    expect(reformatted).not.toBe(TASKS_ENDPOINTS);

    expect(
      readContractSources(
        moduleFixture({ tasks: { endpoints: reformatted, errors: TASKS_ERRORS } }),
      ),
    ).toEqual(
      readContractSources(
        moduleFixture({ tasks: { endpoints: TASKS_ENDPOINTS, errors: TASKS_ERRORS } }),
      ),
    );
  });

  it('stops when an endpoint entry is not an endpoint({...}) call or omits response', () => {
    expect(() =>
      readContractSources(
        moduleFixture({
          tasks: { endpoints: 'export const tasksEndpoints = { bad: build() };\n' },
        }),
      ),
    ).toThrow(/tasks\.bad.*endpoint/u);

    expect(() =>
      readContractSources(
        moduleFixture({
          tasks: {
            endpoints:
              "export const tasksEndpoints = { bad: endpoint({ method: 'GET', path: '/api/tasks' }) };\n",
          },
        }),
      ),
    ).toThrow(/tasks\.bad.*missing `response`/u);
  });

  it('covers every schema slot of the real composed router', () => {
    const sources = readContractSources();
    const composedRouter = composeRouter([...installedModules, ...devOnlyModules]);
    const missing: string[] = [];
    let endpoints = 0;

    for (const [domain, contract] of Object.entries(composedRouter)) {
      for (const [key, endpoint] of Object.entries(
        contract as Record<
          string,
          { body?: unknown; query?: unknown; pathParams?: unknown; responses: object }
        >,
      )) {
        endpoints += 1;
        const id = `${domain}.${key}`;
        const source = sources.get(id);
        if (source === undefined) {
          missing.push(id);
          continue;
        }
        if ((endpoint.body !== undefined) !== (source.body !== null)) missing.push(`${id} body`);
        if ((endpoint.query !== undefined) !== (source.query !== null)) missing.push(`${id} query`);
        if ((endpoint.pathParams !== undefined) !== (source.pathParams !== null)) {
          missing.push(`${id} pathParams`);
        }
        if (Object.keys(endpoint.responses).join() !== Object.keys(source.responses).join()) {
          missing.push(`${id} responses`);
        }
      }
    }

    expect(missing).toEqual([]);
    expect(sources.size).toBe(endpoints);
    expect(endpoints).toBeGreaterThan(80);
  });
});
