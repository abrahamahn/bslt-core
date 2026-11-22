// eslint.config.ts
/**
 * The repository ESLint config. The preset lives in `@bslt/build-config/eslint`
 * (main/build-config/src/eslint.ts); the React packages extend the same preset.
 */
import { baseConfig } from '@bslt/build-config/eslint';

export { baseConfig, exportAllBan, rawFormElementBans } from '@bslt/build-config/eslint';

export default baseConfig;
