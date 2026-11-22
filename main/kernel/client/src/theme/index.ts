// main/kernel/client/src/theme/index.ts

export const THEME_STORAGE_KEYS = {
  mode: 'app-theme-mode',
  density: 'app-density',
  contrast: 'app-contrast',
} as const;

export {
  DEFAULT_CONTRAST_MODE,
  getContrastCssVariables,
  highContrastDarkOverrides,
  highContrastLightOverrides,
  type ContrastMode,
} from './contrast';

export {
  DEFAULT_DENSITY,
  densityMultipliers,
  getDensityCssVariables,
  getSpacingForDensity,
  type Density,
} from './density';
