// main/apps/web/src/app/command-palette/useCommandPalette.ts
/**
 * Command Palette Hook
 *
 * Manages open/close state, search query, filtered results, and keyboard navigation
 * for the command palette overlay. Hidden and inert when signed out (plan §11.1).
 */

import { isAdmin } from '@bslt/identity/contract';
import { useAuth } from '@bslt/identity/web';
import { useKeyboardShortcuts } from '@bslt/react/hooks';
import { useNavigate } from '@bslt/react/router';
import { useTheme } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createCommands, filterCommands } from './commands';

import type { Command } from './commands';

import { useChromeTranslation } from '#app/i18n/chromeLabels';

const openListeners = new Set<() => void>();

/** Imperatively opens any mounted CommandPalette instance (e.g. from the header trigger). */
export function openCommandPalette(): void {
  for (const listener of openListeners) {
    listener();
  }
}

// ============================================================================
// Types
// ============================================================================

export interface UseCommandPaletteResult {
  /** Whether the palette is currently open */
  isOpen: boolean;
  /** Opens the palette */
  open: () => void;
  /** Closes the palette and resets state */
  close: () => void;
  /** Toggles open/close */
  toggle: () => void;
  /** Current search query */
  query: string;
  /** Updates the search query */
  setQuery: (query: string) => void;
  /** Filtered list of matching commands */
  filteredCommands: Command[];
  /** Index of the currently highlighted command */
  selectedIndex: number;
  /** Sets the selected index */
  setSelectedIndex: (index: number) => void;
  /** Moves selection up by one */
  moveUp: () => void;
  /** Moves selection down by one */
  moveDown: () => void;
  /** Executes the currently selected command */
  executeSelected: () => void;
  /** Executes a specific command by index */
  executeCommand: (index: number) => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useCommandPalette(): UseCommandPaletteResult {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const navigate = useNavigate();
  const { translatePaletteEntry } = useChromeTranslation();
  // App-wide theme state from ThemeProvider — a standalone useThemeMode() here
  // would read/write the wrong storage key and desync the rest of the app.
  const { cycleMode } = useTheme();
  const { isFlagEnabled } = useCapabilities();
  const { user, isAuthenticated } = useAuth();
  const signedOut = !isAuthenticated;
  const billingEnabled = isFlagEnabled('flags.billing');
  const teamsEnabled = isFlagEnabled('orgs.teams');

  // Build commands with injected dependencies and active locale labels
  const commands = useMemo(() => {
    if (signedOut) return [];
    return createCommands(
      {
        navigate,
        cycleTheme: cycleMode,
      },
      {
        adminEnabled: user !== null && isAdmin(user.role),
        billingEnabled,
        teamsEnabled,
      },
    ).map((command): Command => {
      const translated = translatePaletteEntry(command.id, command.label, command.description);
      if (translated.label === command.label && translated.description === command.description) {
        return command;
      }
      return {
        ...command,
        label: translated.label,
        description: translated.description,
        keywords: [...command.keywords, command.label, command.description],
      };
    });
  }, [signedOut, navigate, cycleMode, user, billingEnabled, teamsEnabled, translatePaletteEntry]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => filterCommands(commands, query), [commands, query]);

  const open = useCallback((): void => {
    if (signedOut) return;
    setIsOpen(true);
    setQuery('');
    setSelectedIndex(0);
  }, [signedOut]);

  useEffect((): (() => void) => {
    openListeners.add(open);
    return (): void => {
      openListeners.delete(open);
    };
  }, [open]);

  const close = useCallback((): void => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const visibleOpen = !signedOut && isOpen;

  const toggle = useCallback((): void => {
    if (signedOut) return;
    if (visibleOpen) {
      close();
    } else {
      open();
    }
  }, [signedOut, visibleOpen, close, open]);

  const moveUp = useCallback((): void => {
    setSelectedIndex((prev) => (prev <= 0 ? filteredCommands.length - 1 : prev - 1));
  }, [filteredCommands.length]);

  const moveDown = useCallback((): void => {
    setSelectedIndex((prev) => (prev >= filteredCommands.length - 1 ? 0 : prev + 1));
  }, [filteredCommands.length]);

  const executeCommand = useCallback(
    (index: number): void => {
      if (signedOut) return;
      const command = filteredCommands[index];
      if (command !== undefined) {
        command.action();
        close();
      }
    },
    [signedOut, filteredCommands, close],
  );

  const executeSelected = useCallback((): void => {
    executeCommand(selectedIndex);
  }, [executeCommand, selectedIndex]);

  // Reset selected index when query changes (filtered results change)
  const handleSetQuery = useCallback((newQuery: string): void => {
    setQuery(newQuery);
    setSelectedIndex(0);
  }, []);

  // Register Ctrl+K / Cmd+K global shortcut (disabled when signed out)
  useKeyboardShortcuts(
    [
      {
        key: 'K',
        ctrlKey: true,
        handler: toggle,
        description: 'Toggle command palette',
      },
    ],
    { skipInputs: false, enabled: !signedOut },
  );

  return {
    isOpen: visibleOpen,
    open,
    close,
    toggle,
    query,
    setQuery: handleSetQuery,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    moveUp,
    moveDown,
    executeSelected,
    executeCommand,
  };
}
