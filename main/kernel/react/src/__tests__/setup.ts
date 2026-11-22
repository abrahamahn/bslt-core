// main/kernel/react/src/__tests__/setup.ts
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});
