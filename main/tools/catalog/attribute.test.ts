// main/tools/catalog/attribute.test.ts
import { describe, expect, it } from 'vitest';

import { attributeCatalog, withoutAttribution } from './attribute';
import { fn, reading, table } from './fixtures';

const SOURCES = [
  { id: 'kernel', dependsOn: [] },
  { id: 'identity', dependsOn: [] },
  { id: 'tasks', dependsOn: ['identity'] },
];

const kernel = reading({ functions: [fn('sys_current_user_id()')], tables: [table('sys_jobs')] });
const identity = reading({ ...kernel, tables: [...kernel.tables, table('users')] });
const tasks = reading({ ...identity, tables: [...identity.tables, table('tasks')] });

function attribute(
  steps: ReadonlyArray<ReturnType<typeof reading>>,
  initial = reading(),
): ReturnType<typeof attributeCatalog> {
  return attributeCatalog({
    initial,
    steps: steps.map((catalog, index) => ({ source: SOURCES[index]?.id ?? '', catalog })),
    sources: SOURCES.slice(0, steps.length),
  });
}

describe('attributeCatalog', () => {
  it('attributes every object to the source whose step created it', () => {
    const { catalog, problems } = attribute([kernel, identity, tasks]);

    expect(problems).toEqual([]);
    expect(catalog.tables.map((entry) => [entry.name, entry.source])).toEqual([
      ['sys_jobs', 'kernel'],
      ['users', 'identity'],
      ['tasks', 'tasks'],
    ]);
    expect(catalog.functions.map((entry) => [entry.name, entry.source])).toEqual([
      ['sys_current_user_id()', 'kernel'],
    ]);
    expect(catalog.sources).toEqual(SOURCES);
    // `source` reads as part of the identity: right after the name.
    expect(Object.keys(catalog.tables[0] ?? {}).slice(0, 3)).toEqual(['schema', 'name', 'source']);
  });

  it('is the last reading with the attribution added, and nothing else', () => {
    const { catalog } = attribute([kernel, identity, tasks]);

    expect(withoutAttribution(catalog)).toEqual(tasks);
  });

  it('reports a source that alters an object another source created, with what changed', () => {
    const altered = reading({
      ...tasks,
      tables: [
        table('sys_jobs'),
        table('users', {
          columns: [...table('users').columns, 'plan_id uuid'],
          indexes: [
            ...table('users').indexes,
            'CREATE INDEX idx_users_plan ON public.users (plan_id)',
          ],
        }),
        table('tasks'),
      ],
      functions: [fn('sys_current_user_id()', 'another body')],
    });

    const { problems, catalog } = attribute([kernel, identity, altered]);

    expect(problems).toEqual([
      'tasks alters function public.sys_current_user_id(), which kernel created (bodySha256): a source changes only its own objects',
      'tasks alters table public.users, which identity created (columns, indexes): a source changes only its own objects',
    ]);
    // The object stays with the source that created it.
    expect(catalog.tables.find((entry) => entry.name === 'users')?.source).toBe('identity');
  });

  it('reports a policy, a grant, a trigger and the class comment another source changes', () => {
    const altered = reading({
      ...tasks,
      tables: [
        table('sys_jobs'),
        table('users', {
          comment: 'rls:system',
          grants: ['authenticated: SELECT'],
          policies: [],
          triggers: [
            'CREATE TRIGGER t BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION f()',
          ],
        }),
        table('tasks'),
      ],
    });

    expect(attribute([kernel, identity, altered]).problems).toEqual([
      'tasks alters table public.users, which identity created (comment, grants, policies, triggers): a source changes only its own objects',
    ]);
  });

  it('reports a source that drops an object another source created', () => {
    const dropped = reading({
      ...tasks,
      tables: [table('sys_jobs'), table('tasks')],
      functions: [],
    });

    expect(attribute([kernel, identity, dropped]).problems).toEqual([
      'tasks drops function public.sys_current_user_id(), which kernel created: a source drops only its own objects',
      'tasks drops table public.users, which identity created: a source drops only its own objects',
    ]);
  });

  it('reports an object that was there before any source ran as unattributed', () => {
    const { problems, catalog } = attribute(
      [reading({ ...kernel, tables: [table('left_behind'), ...kernel.tables] })],
      reading({ tables: [table('left_behind')] }),
    );

    expect(problems).toEqual([
      'table public.left_behind exists before any source ran: it is unattributed (the scratch database was not empty)',
    ]);
    expect(catalog.tables.find((entry) => entry.name === 'left_behind')?.source).toBe('');
  });

  it('refuses steps that are not the sources, and no step at all', () => {
    expect(() =>
      attributeCatalog({
        initial: reading(),
        steps: [{ source: 'identity', catalog: kernel }],
        sources: [{ id: 'kernel', dependsOn: [] }],
      }),
    ).toThrow(/the steps \(identity\) are not the sources \(kernel\)/u);
    expect(() => attributeCatalog({ initial: reading(), steps: [], sources: [] })).toThrow(
      /no source was applied/u,
    );
  });
});
