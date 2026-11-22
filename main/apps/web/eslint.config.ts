// main/apps/web/eslint.config.ts
import type { Linter } from 'eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import { baseConfig, exportAllBan } from '@bslt/build-config/eslint';

export default [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', exportAllBan],
    },
  },
  {
    // E2E files use Playwright and have their own tsconfig — exclude from linting.
    // The two public browser scripts (no module system, browser globals) are
    // linted by the root config's dedicated blocks instead.
    ignores: ['e2e/**', 'public/sw.js', 'public/theme-init.js'],
  },
  {
    files: ['**/*.{tsx,jsx,ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off', // Not needed for React 17+
      'react/prop-types': 'off', // We use TypeScript
    },
  },
  // Test files: relax no-restricted-syntax so mock components can use raw HTML elements
  {
    files: ['**/__tests__/**/*', '**/*.{spec,test}.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
] satisfies Linter.Config[];
