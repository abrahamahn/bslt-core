// main/kernel/ui/eslint.config.ts
import type { Linter } from 'eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import { baseConfig, exportAllBan } from '@bslt/build-config/eslint';

export default [
  ...baseConfig,
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
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',
    },
  },
  // The design system implements the form primitives — raw <input>/<select>/
  // <textarea>/<img> are its job. Keep only the raw-<button> ban (ui composes
  // its own Button) and the wildcard-export ban.
  {
    files: ['src/**/*.{tsx,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="button"]',
          message: 'Use <Button> from @bslt/ui instead of raw <Button>.',
        },
        exportAllBan,
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', exportAllBan],
    },
  },
  // Test files in the UI library legitimately use raw <button> elements to verify
  // focus management, keyboard interactions, and ARIA semantics of composed components.
  {
    files: ['**/*.{spec,test}.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
] satisfies Linter.Config[];
