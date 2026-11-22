// main/apps/web/src/app/command-palette/commands.ts
/**
 * Command Palette Commands
 *
 * Aggregates installed `WebModule` `slot: 'palette'` contributions and
 * app-frame palette entries via `webApp.getPaletteEntries`.
 */

import { routeFlagsToCapabilities } from '../routeFlags';
import { webApp } from '../webApp';

import type { NavigateFunction } from '@bslt/react/router';

// ============================================================================
// Types
// ============================================================================

type CommandCategory = 'navigation' | 'action';

export interface Command {
  /** Unique identifier for the command */
  id: string;
  /** Display label shown in the palette */
  label: string;
  /** Brief description of what the command does */
  description: string;
  /** Category for grouping commands */
  category: CommandCategory;
  /** Function to execute when the command is selected */
  action: () => void;
  /** Additional keywords for search matching */
  keywords: string[];
}

// ============================================================================
// Command Factory
// ============================================================================

export interface CommandDependencies {
  navigate: NavigateFunction;
  cycleTheme: () => void;
}

interface CommandOptions {
  adminEnabled?: boolean;
  billingEnabled?: boolean;
  teamsEnabled?: boolean;
}

/**
 * Creates the full list of available commands.
 *
 * Commands are built with injected dependencies (navigate, cycleTheme)
 * so they can be tested and composed without side effects.
 */
export function createCommands(deps: CommandDependencies, options: CommandOptions = {}): Command[] {
  const { navigate, cycleTheme } = deps;
  const adminEnabled = options.adminEnabled ?? false;
  const billingEnabled = options.billingEnabled ?? false;
  const teamsEnabled = options.teamsEnabled ?? false;
  const flags = {
    advancedAdminEnabled: false,
    advancedAuthEnabled: false,
    billingEnabled,
    developerToolsEnabled: false,
    teamsEnabled,
  };

  const entries = webApp.getPaletteEntries({
    admin: adminEnabled,
    flags,
    capabilities: routeFlagsToCapabilities(flags),
  });

  return entries.map((entry): Command => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    category: entry.category,
    action: (): void => {
      if (entry.to !== undefined) {
        navigate(entry.to);
      } else if (entry.actionId === 'change-theme') {
        cycleTheme();
      }
    },
    keywords: [...entry.keywords],
  }));
}

/**
 * Filters commands by matching the query against label, description, and keywords.
 * Uses case-insensitive substring matching.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  if (query.trim() === '') {
    return commands;
  }

  const lowerQuery = query.toLowerCase();

  return commands.filter((command) => {
    const searchableText = [command.label, command.description, ...command.keywords]
      .join(' ')
      .toLowerCase();

    return searchableText.includes(lowerQuery);
  });
}
