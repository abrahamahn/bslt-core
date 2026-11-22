// main/apps/web/src/app/command-palette/useCommandPalette.test.ts
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasBillingModule } from '../../generated/modules';

import { useCommandPalette } from './useCommandPalette';

// Mock @bslt/react/router for useNavigate
const mockNavigate = vi.fn();
const mockCycleMode = vi.fn();
const authMocks = vi.hoisted(() => ({
  isAuthenticated: true,
  user: null as { role: string } | null,
}));

vi.mock('@bslt/identity/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/identity/web')>();
  return {
    ...actual,
    useAuth: () => ({
      isAuthenticated: authMocks.isAuthenticated,
      user: authMocks.user,
    }),
  };
});

vi.mock('@bslt/react/router', async () => {
  const actual = await vi.importActual('@bslt/react/router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock @bslt/react/hooks for useKeyboardShortcuts
vi.mock('@bslt/react/hooks', async () => {
  const actual = await vi.importActual('@bslt/react/hooks');
  return {
    ...actual,
    useKeyboardShortcuts: vi.fn(),
  };
});

// Mock @bslt/ui for useTheme (app-wide theme context)
vi.mock('@bslt/ui', async () => {
  const actual = await vi.importActual('@bslt/ui');
  return {
    ...actual,
    useTheme: () => ({
      mode: 'system',
      setMode: vi.fn(),
      cycleMode: mockCycleMode,
      isDark: false,
      isLight: true,
      resolvedTheme: 'light',
    }),
  };
});

describe('useCommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.isAuthenticated = true;
    authMocks.user = null;
  });

  it('should start with the palette closed', () => {
    const { result } = renderHook(() => useCommandPalette());
    expect(result.current.isOpen).toBe(false);
  });

  it('should open the palette', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(true);
  });

  it('should close the palette', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('should toggle the palette', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.toggle();
    });
    expect(result.current.isOpen).toBe(true);
    act(() => {
      result.current.toggle();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('should start with empty query', () => {
    const { result } = renderHook(() => useCommandPalette());
    expect(result.current.query).toBe('');
  });

  it('should update query', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.setQuery('dashboard');
    });
    expect(result.current.query).toBe('dashboard');
  });

  it('should return all commands when query is empty', () => {
    const { result } = renderHook(() => useCommandPalette());
    expect(result.current.filteredCommands.length).toBeGreaterThan(0);
  });

  it('should include admin commands only for admin users', () => {
    const defaultResult = renderHook(() => useCommandPalette());
    expect(defaultResult.result.current.filteredCommands.some((c) => c.id === 'nav-admin')).toBe(
      false,
    );

    authMocks.user = { role: 'admin' };
    const adminResult = renderHook(() => useCommandPalette());
    expect(adminResult.result.current.filteredCommands.some((c) => c.id === 'nav-admin')).toBe(
      true,
    );
  });

  it('gates billing commands on runtime capabilities while keeping installed audit command active', () => {
    const defaultResult = renderHook(() => useCommandPalette());
    expect(defaultResult.result.current.filteredCommands.some((c) => c.id === 'nav-billing')).toBe(
      false,
    );
    expect(
      defaultResult.result.current.filteredCommands.some((c) => c.id === 'nav-audit-activities'),
    ).toBe(true);

    const enabledContext = {
      ...EMPTY_CAPABILITY_CONTEXT,
      flags: { 'flags.billing': true },
    };
    const enabledResult = renderHook(() => useCommandPalette(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(CapabilityProvider, { initialContext: enabledContext }, children),
    });
    expect(enabledResult.result.current.filteredCommands.some((c) => c.id === 'nav-billing')).toBe(
      hasBillingModule,
    );
  });

  it('should filter commands based on query', () => {
    const { result } = renderHook(() => useCommandPalette());
    const unfilteredCount = result.current.filteredCommands.length;
    act(() => {
      result.current.setQuery('dashboard');
    });
    expect(result.current.filteredCommands.some((c) => c.id === 'nav-dashboard')).toBe(true);
    // Should not include unrelated commands
    expect(result.current.filteredCommands.some((c) => c.id === 'nav-settings')).toBe(false);
    expect(result.current.filteredCommands.length).toBeLessThan(unfilteredCount);
  });

  it('should reset selected index when query changes', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.setSelectedIndex(3);
    });
    act(() => {
      result.current.setQuery('dash');
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('should start with selectedIndex at 0', () => {
    const { result } = renderHook(() => useCommandPalette());
    expect(result.current.selectedIndex).toBe(0);
  });

  it('should move selection down', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.moveDown();
    });
    expect(result.current.selectedIndex).toBe(1);
  });

  it('should move selection up with wrapping', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.moveUp();
    });
    // Should wrap to last item
    expect(result.current.selectedIndex).toBe(result.current.filteredCommands.length - 1);
  });

  it('should wrap selection down to beginning', () => {
    const { result } = renderHook(() => useCommandPalette());
    const lastIndex = result.current.filteredCommands.length - 1;
    act(() => {
      result.current.setSelectedIndex(lastIndex);
    });
    act(() => {
      result.current.moveDown();
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('should execute the selected command', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
    });
    // First command should be nav-dashboard
    act(() => {
      result.current.executeSelected();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    // Should close after execution
    expect(result.current.isOpen).toBe(false);
  });

  it('should execute a specific command by index', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
    });
    // Execute the second command (settings)
    act(() => {
      result.current.executeCommand(1);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
    expect(result.current.isOpen).toBe(false);
  });

  it('should reset query and selectedIndex when opening', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.setQuery('test');
      result.current.setSelectedIndex(3);
    });
    act(() => {
      result.current.open();
    });
    expect(result.current.query).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('should reset query and selectedIndex when closing', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.setQuery('test');
      result.current.setSelectedIndex(2);
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.query).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('should not crash when executing with no filtered results', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.setQuery('xyznonexistent');
    });
    expect(result.current.filteredCommands.length).toBe(0);
    // Should not throw
    act(() => {
      result.current.executeSelected();
    });
  });

  it('refuses to open, toggle, or expose commands when signed out', () => {
    authMocks.isAuthenticated = false;
    const { result } = renderHook(() => useCommandPalette());

    expect(result.current.filteredCommands).toEqual([]);
    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(false);
    act(() => {
      result.current.toggle();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('immediately hides an open palette when the user signs out', () => {
    const { result, rerender } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(true);

    authMocks.isAuthenticated = false;
    rerender();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.filteredCommands).toEqual([]);
  });
});
