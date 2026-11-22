// main/apps/web/src/app/command-palette/commands.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasBillingModule, hasFilesModule, installedModules } from '../../generated/modules';

import { createCommands, filterCommands } from './commands';

import type { Command, CommandDependencies } from './commands';

const HAS_TASKS = installedModules.some((m) => m.id === 'tasks');

describe('commands', () => {
  let deps: CommandDependencies;
  let commands: Command[];

  beforeEach(() => {
    deps = {
      navigate: vi.fn(),
      cycleTheme: vi.fn(),
    };
    commands = createCommands(deps);
  });

  describe('createCommands', () => {
    it('should return an array of commands', () => {
      expect(commands.length).toBeGreaterThan(0);
    });

    it('should include navigation commands', () => {
      const navCommands = commands.filter((c) => c.category === 'navigation');
      expect(navCommands.length).toBeGreaterThan(0);
    });

    it('should include action commands', () => {
      const actionCommands = commands.filter((c) => c.category === 'action');
      expect(actionCommands.length).toBeGreaterThan(0);
    });

    it('should have unique ids for each command', () => {
      const ids = commands.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should include dashboard navigation', () => {
      const dashboard = commands.find((c) => c.id === 'nav-dashboard');
      expect(dashboard).toBeDefined();
      expect(dashboard?.label).toBe('Go to Dashboard');
    });

    it('should include settings navigation', () => {
      const settings = commands.find((c) => c.id === 'nav-settings');
      expect(settings).toBeDefined();
    });

    it.runIf(hasFilesModule)('should include files navigation', () => {
      const files = commands.find((c) => c.id === 'nav-files');
      expect(files).toBeDefined();
      expect(files?.label).toBe('Go to Files');
    });

    it.runIf(HAS_TASKS)('should include installed tasks module palette navigation', () => {
      const tasks = commands.find((c) => c.id === 'nav-tasks');
      expect(tasks).toBeDefined();
      expect(tasks?.label).toBe('Go to Tasks');
      tasks?.action();
      expect(deps.navigate).toHaveBeenCalledWith('/tasks');
    });

    it('should omit admin navigation by default', () => {
      const admin = commands.find((c) => c.id === 'nav-admin');
      expect(admin).toBeUndefined();
    });

    it('should include admin navigation when admin is enabled', () => {
      const adminCommands = createCommands(deps, { adminEnabled: true });
      const admin = adminCommands.find((c) => c.id === 'nav-admin');
      expect(admin).toBeDefined();
    });

    it('should omit billing navigation by default', () => {
      const billing = commands.find((c) => c.id === 'nav-billing');
      expect(billing).toBeUndefined();
    });

    it.runIf(hasBillingModule)('should include billing navigation when billing is enabled', () => {
      const billingCommands = createCommands(deps, { billingEnabled: true });
      const billing = billingCommands.find((c) => c.id === 'nav-billing');
      expect(billing).toBeDefined();
    });

    it('should include installed audit module activity feed palette navigation', () => {
      const activities = commands.find((c) => c.id === 'nav-audit-activities');
      expect(activities).toBeDefined();
      expect(activities?.label).toBe('Go to Activity Feed');
      activities?.action();
      expect(deps.navigate).toHaveBeenCalledWith('/activities');
    });

    it('should include change theme action', () => {
      const theme = commands.find((c) => c.id === 'action-change-theme');
      expect(theme).toBeDefined();
    });

    it('should call navigate when a navigation command action is executed', () => {
      const dashboard = commands.find((c) => c.id === 'nav-dashboard');
      dashboard?.action();
      expect(deps.navigate).toHaveBeenCalledWith('/dashboard');
    });

    it('should call navigate with /settings for settings command', () => {
      const settings = commands.find((c) => c.id === 'nav-settings');
      settings?.action();
      expect(deps.navigate).toHaveBeenCalledWith('/settings');
    });

    it.runIf(hasFilesModule)('should call navigate with /files for files command', () => {
      const files = commands.find((c) => c.id === 'nav-files');
      files?.action();
      expect(deps.navigate).toHaveBeenCalledWith('/files');
    });

    it('should call cycleTheme when change theme action is executed', () => {
      const theme = commands.find((c) => c.id === 'action-change-theme');
      theme?.action();
      expect(deps.cycleTheme).toHaveBeenCalled();
    });

    it('should have keywords for every command', () => {
      for (const command of commands) {
        expect(command.keywords.length).toBeGreaterThan(0);
      }
    });

    it('should have non-empty descriptions for every command', () => {
      for (const command of commands) {
        expect(command.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('filterCommands', () => {
    it('should return all commands when query is empty', () => {
      const result = filterCommands(commands, '');
      expect(result.length).toBe(commands.length);
    });

    it('should return all commands when query is whitespace', () => {
      const result = filterCommands(commands, '   ');
      expect(result.length).toBe(commands.length);
    });

    it('should filter commands by label', () => {
      const result = filterCommands(commands, 'Dashboard');
      expect(result.some((c) => c.id === 'nav-dashboard')).toBe(true);
    });

    it('should filter commands by description', () => {
      const result = filterCommands(commands, 'account settings');
      expect(result.some((c) => c.id === 'nav-settings')).toBe(true);
    });

    it('should filter commands by keywords', () => {
      const result = filterCommands(commands, 'dark');
      expect(result.some((c) => c.id === 'action-change-theme')).toBe(true);
    });

    it.runIf(hasFilesModule)('should filter files by storage keywords', () => {
      const result = filterCommands(commands, 'documents');
      expect(result.some((c) => c.id === 'nav-files')).toBe(true);
    });

    it('should be case insensitive', () => {
      const result = filterCommands(commands, 'DASHBOARD');
      expect(result.some((c) => c.id === 'nav-dashboard')).toBe(true);
    });

    it('should return empty array when no commands match', () => {
      const result = filterCommands(commands, 'xyznonexistent');
      expect(result.length).toBe(0);
    });

    it('should match partial words', () => {
      const result = filterCommands(commands, 'dash');
      expect(result.some((c) => c.id === 'nav-dashboard')).toBe(true);
    });

    it('does not match billing keywords unless billing commands are enabled', () => {
      const result = filterCommands(commands, 'subscription');
      expect(result.some((c) => c.id === 'nav-billing')).toBe(false);
    });

    it.runIf(hasBillingModule)(
      'matches keywords like subscription when billing commands are enabled',
      () => {
        const result = filterCommands(
          createCommands(deps, { billingEnabled: true }),
          'subscription',
        );
        expect(result.some((c) => c.id === 'nav-billing')).toBe(true);
      },
    );
  });
});
