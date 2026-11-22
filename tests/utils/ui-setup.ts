// tests/utils/ui-setup.ts
/**
 * Global test setup for @bslt/ui package tests.
 *
 * This file is loaded before each test file and provides:
 * - Jest DOM matchers for vitest (via /vitest entry point)
 * - Global browser API mocks (matchMedia, ResizeObserver, IntersectionObserver, scrollTo)
 * - DOM cleanup after each test
 * - Mock and timer state reset after each test
 *
 * @module test-setup
 */
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { installBrowserMocks } from '#tests/utils/mocks/browser';

// ============================================================================
// Browser API Mocks
// ============================================================================

installBrowserMocks();

// ============================================================================
// DOM Setup
// ============================================================================

/**
 * Create root element for rendering tests.
 * This must exist before any component is imported that needs a root.
 */
if (document.getElementById('root') === null) {
  const rootElement = document.createElement('div');
  rootElement.id = 'root';
  document.body.appendChild(rootElement);
}

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

afterEach(() => {
  // Clean up React Testing Library DOM
  cleanup();

  // Clear all mocks to prevent state leakage between tests
  vi.clearAllMocks();

  // Reset timers if any test used fake timers
  vi.useRealTimers();
});
