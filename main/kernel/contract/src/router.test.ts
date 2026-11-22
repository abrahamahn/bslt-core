// main/kernel/contract/src/router.test.ts
import { object, string } from '@bslt/schema';
import { describe, expect, it } from 'vitest';

import { endpoint } from './endpoint';
import { emptyBodySchema, errorResponseSchema } from './envelope';
import { defineErrors } from './errors';
import { defineModule } from './module';
import { composeRouter, moduleEndpointsToContract, type ComposedEndpointShape } from './router';

const resSchema = object({ ok: string({ min: 1 }) });
const bodySchema = object({ title: string({ min: 1 }) });
const idParams = object({ id: string({ min: 1 }) });
const routerErrors = defineErrors('items', { ITEM_NOT_FOUND: 404 });

describe('composeRouter and moduleEndpointsToContract', () => {
  it('converts module endpoints into composed router entries sorted by module id', () => {
    const itemsModule = defineModule({
      id: 'items',
      summary: 'Items',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        list: endpoint({
          method: 'GET',
          path: '/api/items',
          auth: 'user',
          response: resSchema,
          summary: 'List items',
        }),
        create: endpoint({
          method: 'POST',
          path: '/api/items/create',
          auth: 'user',
          body: bodySchema,
          response: resSchema,
          summary: 'Create item',
        }),
        delete: endpoint({
          method: 'POST',
          path: '/api/items/:id/delete',
          auth: 'user',
          params: idParams,
          body: emptyBodySchema,
          response: resSchema,
          errors: [routerErrors.ITEM_NOT_FOUND],
          summary: 'Delete item',
        }),
      },
      events: {},
      jobs: {},
      tables: ['items'],
    });

    const statusModule = defineModule({
      id: 'status',
      summary: 'Status',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        health: endpoint({
          method: 'GET',
          path: '/api/status/health',
          auth: 'public',
          response: resSchema,
          summary: 'Health',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });

    const contract = moduleEndpointsToContract(itemsModule);
    const listDef: ComposedEndpointShape | undefined = contract['list'];
    expect(listDef?.responses).toEqual({
      '200': resSchema,
      '401': errorResponseSchema,
    });
    expect(contract['create']?.responses).toEqual({
      '200': resSchema,
      '400': errorResponseSchema,
      '401': errorResponseSchema,
    });
    expect(contract['delete']?.responses).toEqual({
      '200': resSchema,
      '401': errorResponseSchema,
      '404': errorResponseSchema,
    });

    const composed = composeRouter([statusModule, itemsModule]);
    expect(Object.keys(composed)).toEqual(['items', 'status']);
    expect(composed.items.list.path).toBe('/api/items');
    expect(composed.status.health.path).toBe('/api/status/health');
  });

  it('omits endpoint-less shell modules and rejects duplicate module ids', () => {
    const identityShell = defineModule({
      id: 'identity',
      summary: 'Identity shell',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });
    const dupA = defineModule({
      id: 'items',
      summary: 'Items A',
      status: 'stable',
      dependsOn: [identityShell],
      endpoints: {
        create: endpoint({
          method: 'POST',
          path: '/api/items/create',
          auth: 'user',
          response: resSchema,
          summary: 'Create item',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });
    const dupB = defineModule({
      id: 'items',
      summary: 'Items B',
      status: 'stable',
      dependsOn: [identityShell],
      endpoints: {
        list: endpoint({
          method: 'GET',
          path: '/api/items',
          auth: 'user',
          response: resSchema,
          summary: 'List items',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });
    expect(composeRouter([identityShell])).toEqual({});
    expect(() => composeRouter([identityShell, dupA, dupB])).toThrow(/duplicate/i);
  });

  it('rejects duplicate (method, path) routes including renamed :param collisions', () => {
    const modA = defineModule({
      id: 'moda',
      summary: 'Mod A',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        get: endpoint({
          method: 'GET',
          path: '/api/things/:id',
          auth: 'public',
          response: resSchema,
          summary: 'Get by id',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });
    const modB = defineModule({
      id: 'modb',
      summary: 'Mod B',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        get: endpoint({
          method: 'GET',
          path: '/api/things/:thingId',
          auth: 'public',
          response: resSchema,
          summary: 'Get by thingId',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });
    expect(() => composeRouter([modA, modB])).toThrow(/duplicate route/i);
  });

  it('rejects a :param route declared before a static route at the same depth (shadowing)', () => {
    const shadowed = defineModule({
      id: 'shadow',
      summary: 'Shadowed static route',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        byId: endpoint({
          method: 'GET',
          path: '/api/shadow/:id',
          auth: 'public',
          response: resSchema,
          summary: 'By id first',
        }),
        list: endpoint({
          method: 'GET',
          path: '/api/shadow/list',
          auth: 'public',
          response: resSchema,
          summary: 'Static list second',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });
    expect(() => composeRouter([shadowed])).toThrow(/shadows/i);
  });
});
