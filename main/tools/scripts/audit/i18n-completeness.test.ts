// main/tools/scripts/audit/i18n-completeness.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../lib/paths';

import { auditWorkspaceI18n, run } from './i18n-completeness';

const tempDirs: string[] = [];

function createFixtureWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bslt-i18n-audit-'));
  tempDirs.push(dir);

  fs.mkdirSync(path.join(dir, 'main/apps/web/src/i18n/locales'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'main/apps/web/src/pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'main/modules/tasks/i18n'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'main/modules/tasks/web'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'main/apps/web/src/pages/HomePage.tsx'),
    `export const HomePage = () => <span>{t('common.save')}</span>;\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'main/modules/tasks/i18n/en-US.json'),
    JSON.stringify({ 'tasks.title': 'Tasks ({count})' }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'main/modules/tasks/web/TasksPage.tsx'),
    `export const TasksPage = () => <h1>{t('tasks.title')}</h1>;\n`,
    'utf8',
  );

  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('i18n-completeness (multi-locale parity & key-usage check)', () => {
  it('fails when the en-US translation map is empty', () => {
    const root = createFixtureWorkspace();
    const result = auditWorkspaceI18n({
      root,
      locales: ['en-US'],
      enUsTranslations: {},
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('empty');
  });

  it('fails when an advertised secondary locale is missing its app or module bundle', () => {
    const root = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/en-US.ts'),
      'export const enUS = {};\n',
      'utf8',
    );
    const result = auditWorkspaceI18n({
      root,
      locales: ['en-US', 'ko-KR'],
      enUsTranslations: { 'common.save': 'Save' },
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('problem');
  });

  it('fails when a secondary locale has missing keys, extra keys, or mismatched placeholders', () => {
    const root = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/en-US.ts'),
      'export const enUS = {};\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/ko-KR.ts'),
      'export const koKR = {};\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/modules/tasks/i18n/ko-KR.json'),
      JSON.stringify({ 'tasks.title': '할 일 ({wrong})', 'tasks.extra': '초과' }, null, 2),
      'utf8',
    );
    const result = auditWorkspaceI18n({
      root,
      locales: ['en-US', 'ko-KR'],
      enUsTranslations: { 'common.save': 'Save', 'common.cancel': 'Cancel' },
      localeTranslations: {
        'en-US': { 'common.save': 'Save', 'common.cancel': 'Cancel' },
        'ko-KR': { 'common.save': '저장' },
      },
    });
    expect(result.ok).toBe(false);
  });

  it('fails when an undeclared locale file exists in main/apps/web/src/i18n/locales', () => {
    const root = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/en-US.ts'),
      'export const enUS = {};\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/fr.ts'),
      'export const fr = {};\n',
      'utf8',
    );
    const result = auditWorkspaceI18n({
      root,
      locales: ['en-US'],
      enUsTranslations: { 'common.save': 'Save' },
    });
    expect(result.ok).toBe(false);
  });

  it('fails when en-US contains an empty or whitespace-only string value', () => {
    const root = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/en-US.ts'),
      'export const enUS = {};\n',
      'utf8',
    );
    const result = auditWorkspaceI18n({
      root,
      locales: ['en-US'],
      enUsTranslations: { 'common.save': 'Save', 'common.cancel': '   ' },
    });
    expect(result.ok).toBe(false);
  });

  it('fails when main/apps/web/src calls t() with an unknown key', () => {
    const root = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/en-US.ts'),
      'export const enUS = {};\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/pages/HomePage.tsx'),
      `export const HomePage = () => <span>{t('missing.web.key')}</span>;\n`,
      'utf8',
    );
    const result = auditWorkspaceI18n({
      root,
      locales: ['en-US'],
      enUsTranslations: { 'common.save': 'Save' },
    });
    expect(result.ok).toBe(false);
  });

  it('fails when a module web file calls t() with a key absent from its i18n/en-US.json', () => {
    const root = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/en-US.ts'),
      'export const enUS = {};\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/modules/tasks/web/TasksPage.tsx'),
      `export const TasksPage = () => <h1>{t('tasks.unknown')}</h1>;\n`,
      'utf8',
    );
    const result = auditWorkspaceI18n({
      root,
      locales: ['en-US'],
      enUsTranslations: { 'common.save': 'Save' },
    });
    expect(result.ok).toBe(false);
  });

  it('fails when a module i18n/en-US.json has an empty value or wrong prefix', () => {
    const root = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/en-US.ts'),
      'export const enUS = {};\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/modules/tasks/i18n/en-US.json'),
      JSON.stringify({ 'tasks.title': '', 'wrong.key': 'Nope' }, null, 2),
      'utf8',
    );
    const result = auditWorkspaceI18n({
      root,
      locales: ['en-US'],
      enUsTranslations: { 'common.save': 'Save' },
    });
    expect(result.ok).toBe(false);
  });

  it('passes on a clean multi-locale fixture workspace (en-US + ko-KR) and ignores test files', () => {
    const root = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/en-US.ts'),
      'export const enUS = {};\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/ko-KR.ts'),
      'export const koKR = {};\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/i18n/locales/ko-KR.test.ts'),
      'export {};\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/modules/tasks/i18n/ko-KR.json'),
      JSON.stringify({ 'tasks.title': '할 일 ({count})' }, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'main/apps/web/src/pages/HomePage.test.tsx'),
      `export const TestOnly = () => <span>{t('nonexistent.test.key')}</span>;\n`,
      'utf8',
    );
    const result = auditWorkspaceI18n({
      root,
      locales: ['en-US', 'ko-KR'],
      enUsTranslations: { 'common.save': 'Save' },
      localeTranslations: {
        'en-US': { 'common.save': 'Save' },
        'ko-KR': { 'common.save': '저장' },
      },
    });
    expect(result.ok).toBe(true);
  });

  it('passes against the live repository across all supported locales (en-US + ko-KR)', async () => {
    expect(path.isAbsolute(REPO_ROOT)).toBe(true);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('en-US, ko-KR');
  });
});
