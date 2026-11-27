// main/apps/web/src/app/command-palette/CommandPalette.tsx
/**
 * Command Palette Component
 *
 * A Ctrl+K / Cmd+K overlay for searching and executing commands.
 * Uses the Dialog compound component for accessible modal behavior
 * and provides keyboard navigation (arrow keys + Enter).
 */

import { Dialog, Input, Kbd, Text } from '@bslt/ui';
import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';

import { useCommandPalette } from './useCommandPalette';

import type { Command } from './commands';

import './CommandPalette.css';

import { useChromeTranslation } from '#app/i18n/chromeLabels';

// ============================================================================
// Sub-components
// ============================================================================

interface CommandItemProps {
  command: Command;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}

function CommandItem({ command, isSelected, onSelect, onHover }: CommandItemProps): ReactElement {
  const itemRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view when navigating with keyboard
  useEffect(() => {
    if (
      isSelected &&
      itemRef.current !== null &&
      typeof itemRef.current.scrollIntoView === 'function'
    ) {
      itemRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected]);

  return (
    <div
      ref={itemRef}
      role="option"
      tabIndex={-1}
      aria-selected={isSelected}
      className="command-palette-item"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={onHover}
    >
      <Text size="sm" className="command-palette-item__label">
        {command.label}
      </Text>
      <Text size="xs" tone="muted">
        {command.description}
      </Text>
    </div>
  );
}

// ============================================================================
// Category Header
// ============================================================================

function CategoryHeader({ label }: { label: string }): ReactElement {
  return (
    <Text size="xs" tone="muted" className="command-palette-category">
      {label}
    </Text>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CommandPalette(): ReactElement {
  const { t } = useChromeTranslation();
  const {
    isOpen,
    close,
    query,
    setQuery,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    moveUp,
    moveDown,
    executeSelected,
    executeCommand,
  } = useCommandPalette();

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search input when the palette opens
  useEffect((): (() => void) | undefined => {
    if (isOpen) {
      // Small delay to ensure the DOM is ready after portal render
      const timer = setTimeout((): void => {
        inputRef.current?.focus();
      }, 0);
      return (): void => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [isOpen]);

  // Handle keyboard navigation within the input
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveDown();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveUp();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeSelected();
      }
    },
    [moveDown, moveUp, executeSelected],
  );

  // Group commands by category for display
  const navigationCommands = filteredCommands.filter((c) => c.category === 'navigation');
  const actionCommands = filteredCommands.filter((c) => c.category === 'action');

  // Build flat indexed list for tracking selection across categories
  const flatList: { command: Command; globalIndex: number }[] = [];
  let currentIndex = 0;
  for (const cmd of navigationCommands) {
    flatList.push({ command: cmd, globalIndex: currentIndex });
    currentIndex++;
  }
  for (const cmd of actionCommands) {
    flatList.push({ command: cmd, globalIndex: currentIndex });
    currentIndex++;
  }

  return (
    <Dialog.Root
      open={isOpen}
      onChange={(open: boolean): void => {
        if (!open) close();
      }}
    >
      <Dialog.Content title={t('palette.title')} className="command-palette-content">
        <div className="command-palette-search">
          <Input
            ref={inputRef}
            type="text"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            aria-label={t('palette.searchAria')}
            aria-activedescendant={
              filteredCommands[selectedIndex] !== undefined
                ? `command-${filteredCommands[selectedIndex].id}`
                : undefined
            }
            role="combobox"
            aria-expanded={true}
            aria-controls="command-palette-listbox"
            aria-autocomplete="list"
          />
        </div>

        <div
          id="command-palette-listbox"
          role="listbox"
          aria-label={t('palette.listAria')}
          className="command-palette-listbox"
        >
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty">
              <Text tone="muted" size="sm">
                {t('palette.empty')}
              </Text>
            </div>
          ) : (
            <>
              {navigationCommands.length > 0 && (
                <div>
                  <CategoryHeader label={t('palette.category.navigation')} />
                  {navigationCommands.map((command) => {
                    const entry = flatList.find((f) => f.command.id === command.id);
                    const globalIdx = entry?.globalIndex ?? 0;
                    return (
                      <div key={command.id} id={`command-${command.id}`}>
                        <CommandItem
                          command={command}
                          isSelected={selectedIndex === globalIdx}
                          onSelect={() => {
                            executeCommand(globalIdx);
                          }}
                          onHover={() => {
                            setSelectedIndex(globalIdx);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {actionCommands.length > 0 && (
                <div>
                  <CategoryHeader label={t('palette.category.actions')} />
                  {actionCommands.map((command) => {
                    const entry = flatList.find((f) => f.command.id === command.id);
                    const globalIdx = entry?.globalIndex ?? 0;
                    return (
                      <div key={command.id} id={`command-${command.id}`}>
                        <CommandItem
                          command={command}
                          isSelected={selectedIndex === globalIdx}
                          onSelect={() => {
                            executeCommand(globalIdx);
                          }}
                          onHover={() => {
                            setSelectedIndex(globalIdx);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="command-palette-footer">
          <Text size="xs" tone="muted">
            <Kbd>↑↓</Kbd> {t('palette.hint.navigate')}
          </Text>
          <Text size="xs" tone="muted">
            <Kbd>Enter</Kbd> {t('palette.hint.select')}
          </Text>
          <Text size="xs" tone="muted">
            <Kbd>Esc</Kbd> {t('palette.hint.close')}
          </Text>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
