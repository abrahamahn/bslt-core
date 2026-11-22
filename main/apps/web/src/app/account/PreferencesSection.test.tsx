// main/apps/web/src/app/account/PreferencesSection.test.tsx
/**
 * Preferences Section Tests
 *
 * The appearance controls (theme / contrast / density) delegate to the app-wide
 * `useTheme` context from ThemeProvider, so persistence and `data-theme`
 * application are the provider's responsibility (covered in `@bslt/react` /
 * `@bslt/ui`). These tests mock the context hook and verify the component
 * renders the option grids, reflects each current value, and calls the
 * matching setter on selection.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TIMEZONE_STORAGE_KEY } from '../../i18n/format';

import { PreferencesSection } from './PreferencesSection';

import type { ReactNode } from 'react';

// ============================================================================
// Mocks
// ============================================================================

const themeStub = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('@bslt/ui', async () => {
  const actual = await vi.importActual('@bslt/ui');

  const mockButton = ({
    children,
    onClick,
    'aria-pressed': ariaPressed,
    'data-testid': testId,
    className,
  }: {
    children: ReactNode;
    onClick?: () => void;
    'aria-pressed'?: boolean;
    'data-testid'?: string;
    className?: string;
  }) => (
    <button onClick={onClick} aria-pressed={ariaPressed} data-testid={testId} className={className}>
      {children}
    </button>
  );

  const mockHeading = ({ children }: { children: ReactNode }) => <h4>{children}</h4>;

  const mockText = ({
    children,
    className,
    'data-testid': testId,
    as: Tag = 'span',
  }: {
    children: ReactNode;
    className?: string;
    'data-testid'?: string;
    as?: string;
    size?: string;
    tone?: string;
  }) => {
    const Component = Tag as keyof HTMLElementTagNameMap;
    return (
      <Component className={className} data-testid={testId}>
        {children}
      </Component>
    );
  };

  return {
    ...actual,
    Button: mockButton,
    Heading: mockHeading,
    Text: mockText,
    useTheme: () => themeStub.value,
  };
});

vi.mock('./LanguageSelector', () => ({
  LanguageSelector: () => <div data-testid="language-selector">Language Selector</div>,
}));

// ============================================================================
// Helpers
// ============================================================================

const setMode = vi.fn();
const setContrastMode = vi.fn();
const setDensity = vi.fn();

/** Point the mocked theme context at a given current value (setters are spies). */
function stubHooks(
  overrides: {
    mode?: 'light' | 'dark' | 'system';
    resolvedTheme?: 'light' | 'dark';
    contrastMode?: 'normal' | 'high' | 'system';
    density?: 'compact' | 'normal' | 'comfortable';
  } = {},
): void {
  themeStub.value = {
    mode: overrides.mode ?? 'system',
    setMode,
    resolvedTheme: overrides.resolvedTheme ?? 'light',
    contrastMode: overrides.contrastMode ?? 'normal',
    setContrastMode,
    density: overrides.density ?? 'normal',
    setDensity,
  };
}

describe('PreferencesSection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubHooks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Rendering
  // ==========================================================================

  describe('rendering', () => {
    it('renders the theme, contrast, and density headings', () => {
      render(<PreferencesSection />);
      expect(screen.getByText('Theme')).toBeInTheDocument();
      expect(screen.getByText('Contrast')).toBeInTheDocument();
      expect(screen.getByText('Text size & density')).toBeInTheDocument();
    });

    it('renders all three theme options', () => {
      render(<PreferencesSection />);
      expect(screen.getByTestId('theme-option-light')).toBeInTheDocument();
      expect(screen.getByTestId('theme-option-dark')).toBeInTheDocument();
      expect(screen.getByTestId('theme-option-system')).toBeInTheDocument();
    });

    it('renders the contrast and density options', () => {
      render(<PreferencesSection />);
      expect(screen.getByTestId('contrast-option-high')).toBeInTheDocument();
      expect(screen.getByTestId('density-option-compact')).toBeInTheDocument();
      expect(screen.getByTestId('density-option-comfortable')).toBeInTheDocument();
    });

    it('renders the unique theme descriptions', () => {
      render(<PreferencesSection />);
      expect(screen.getByText('Always use light theme')).toBeInTheDocument();
      expect(screen.getByText('Always use dark theme')).toBeInTheDocument();
      // "Match your operating system setting" is shared by the theme + contrast
      // grids, so it appears more than once.
      expect(screen.getAllByText('Match your operating system setting').length).toBeGreaterThan(1);
    });

    it('renders the timezone and language sections', () => {
      render(<PreferencesSection />);
      expect(screen.getByText('Timezone')).toBeInTheDocument();
      expect(screen.getByTestId('language-selector')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Reflecting hook state
  // ==========================================================================

  describe('reflects the current hook value', () => {
    it('marks the system theme pressed by default', () => {
      render(<PreferencesSection />);
      expect(screen.getByTestId('theme-option-system')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('theme-option-dark')).toHaveAttribute('aria-pressed', 'false');
    });

    it('marks the stored theme pressed when the hook reports it', () => {
      stubHooks({ mode: 'dark' });
      render(<PreferencesSection />);

      expect(screen.getByTestId('theme-option-dark')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('theme-option-light')).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows the current theme label', () => {
      stubHooks({ mode: 'dark' });
      render(<PreferencesSection />);
      expect(screen.getByTestId('current-theme')).toHaveTextContent('Dark');
    });

    it('defaults the current selection label to System', () => {
      render(<PreferencesSection />);
      expect(screen.getByTestId('current-theme')).toHaveTextContent('System');
    });

    it('reflects the contrast and density hook values', () => {
      stubHooks({ contrastMode: 'high', density: 'compact' });
      render(<PreferencesSection />);
      expect(screen.getByTestId('contrast-option-high')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('density-option-compact')).toHaveAttribute('aria-pressed', 'true');
    });
  });

  // ==========================================================================
  // Selection delegates to the hook setters
  // ==========================================================================

  describe('selection', () => {
    it('calls setMode when a theme is selected', () => {
      render(<PreferencesSection />);
      fireEvent.click(screen.getByTestId('theme-option-dark'));
      expect(setMode).toHaveBeenCalledWith('dark');
    });

    it('calls setContrastMode when a contrast option is selected', () => {
      render(<PreferencesSection />);
      fireEvent.click(screen.getByTestId('contrast-option-high'));
      expect(setContrastMode).toHaveBeenCalledWith('high');
    });

    it('calls setDensity when a density option is selected', () => {
      render(<PreferencesSection />);
      fireEvent.click(screen.getByTestId('density-option-comfortable'));
      expect(setDensity).toHaveBeenCalledWith('comfortable');
    });

    it('does not write theme storage directly (the hook owns persistence)', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      render(<PreferencesSection />);
      fireEvent.click(screen.getByTestId('theme-option-dark'));
      expect(setItemSpy).not.toHaveBeenCalledWith('app-theme-mode', expect.anything());
    });
  });

  // ==========================================================================
  // Timezone preference (shared key with the i18n date formatters)
  // ==========================================================================

  describe('timezone', () => {
    it('defaults to auto-detect when nothing is stored', () => {
      render(<PreferencesSection />);
      expect(screen.getByTestId('timezone-select')).toHaveTextContent(/Auto-detect/);
    });

    it('initializes the picker from the stored preference', () => {
      window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'Europe/Paris');
      render(<PreferencesSection />);
      expect(screen.getByTestId('timezone-select')).toHaveTextContent(/Europe\/Paris/);
    });

    it('persists the selection under the shared i18n storage key', () => {
      render(<PreferencesSection />);
      fireEvent.click(screen.getByTestId('timezone-select'));
      fireEvent.click(screen.getByRole('option', { name: /Asia\/Tokyo/ }));
      expect(window.localStorage.getItem(TIMEZONE_STORAGE_KEY)).toBe('Asia/Tokyo');
    });
  });
});
