// main/build-config/src/jsx-a11y.d.ts
declare module 'eslint-plugin-jsx-a11y' {
  import type { ESLint, Linter } from 'eslint';

  const plugin: ESLint.Plugin & {
    readonly configs: {
      readonly recommended: Linter.LegacyConfig;
      readonly strict: Linter.LegacyConfig;
    };
    readonly flatConfigs: {
      readonly recommended: Linter.Config;
      readonly strict: Linter.Config;
    };
  };

  export default plugin;
}
