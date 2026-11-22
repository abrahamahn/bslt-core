// main/tools/catalog/names.test.ts
import { describe, expect, it } from 'vitest';

import { attributedTo, fn, soundCatalog, table } from './fixtures';
import { carriesPrefix, legacyNames, prefixOf } from './names';

describe('the name prefix rule', () => {
  it('gives the kernel sys and every other source its id', () => {
    expect(prefixOf('kernel')).toBe('sys');
    expect(prefixOf('billing')).toBe('billing');
  });

  it('accepts <prefix> and <prefix>_<entity>, and nothing that only starts alike', () => {
    expect(carriesPrefix('tasks', 'tasks')).toBe(true);
    expect(carriesPrefix('tasks_labels', 'tasks')).toBe(true);
    expect(carriesPrefix('sys_jobs', 'kernel')).toBe(true);
    expect(carriesPrefix('orgs_current_user_role(_org_id uuid)', 'orgs')).toBe(true);
    expect(carriesPrefix('tasksboard', 'tasks')).toBe(false);
    expect(carriesPrefix('users', 'identity')).toBe(false);
    expect(carriesPrefix('update_updated_at_column()', 'kernel')).toBe(false);
    // An argument that names the prefix does not make the function carry it.
    expect(carriesPrefix('touch(sys_jobs regclass)', 'kernel')).toBe(false);
  });

  it('lists the objects of a catalog that do not carry the prefix of their source', () => {
    const sound = soundCatalog();
    const catalog = {
      ...sound,
      functions: [
        ...sound.functions,
        attributedTo('identity', fn('users_guard()')),
        attributedTo('identity', fn('identity_guard()')),
      ],
      tables: [...sound.tables, attributedTo('tasks', table('tasks_labels'))],
    };

    expect(legacyNames(catalog)).toEqual([
      { kind: 'function', name: 'users_guard()', source: 'identity' },
      { kind: 'table', name: 'users', source: 'identity' },
    ]);
  });
});
