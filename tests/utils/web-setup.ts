// tests/utils/web-setup.ts
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { installBrowserMocks } from '#tests/utils/mocks/browser';
import { installCanvasMock } from '#tests/utils/mocks/canvas';
import { installJsdomNoiseFilter } from '#tests/utils/mocks/console';

const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';

if (hasDom) {
  installBrowserMocks();
  installCanvasMock();
}

const defaultFetchMock = vi.fn(() =>
  Promise.reject(new Error('Fetch not mocked. Please mock fetch in your test.')),
);
vi.stubGlobal('fetch', defaultFetchMock);

if (hasDom && document.getElementById('root') === null) {
  const rootElement = document.createElement('div');
  rootElement.id = 'root';
  document.body.appendChild(rootElement);
}

vi.mock('@bslt/devtools/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/devtools/web')>();
  return {
    ...actual,
    useUILibraryPanes: vi.fn(() => ({
      paneConfig: {
        top: { visible: true, size: 6 },
        left: { visible: true, size: 18 },
        right: { visible: true, size: 25 },
        bottom: { visible: true, size: 8 },
      },
      togglePane: vi.fn(),
      handlePaneResize: vi.fn(),
      resetLayout: vi.fn(),
    })),
  };
});

let restoreConsoleError: (() => void) | undefined;

beforeAll(() => {
  if (hasDom) {
    restoreConsoleError = installJsdomNoiseFilter();
  }
});

beforeEach(() => {
  vi.stubGlobal('fetch', defaultFetchMock);
});

afterEach(() => {
  if (hasDom) {
    cleanup();
  }
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterAll(() => {
  restoreConsoleError?.();
});
