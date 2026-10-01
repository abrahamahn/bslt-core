// main/shared/src/modules/core/auth/passwords/index.ts
export {
  DEFAULT_PASSWORD_CONFIG,
  getStrengthLabel,
  validatePassword,
  validatePasswordBasic,
  type PasswordConfig,
  type PasswordValidationResult,
} from './auth.password';
export { estimatePasswordStrength, type StrengthResult } from './auth.password.strength';
export {
  calculateEntropy,
  calculateScore,
  estimateCrackTime,
  generateFeedback,
  getCharsetSize,
  type PasswordPenalties,
} from './auth.password.scoring';
export {
  COMMON_PASSWORDS,
  KEYBOARD_PATTERNS,
  containsUserInput,
  hasKeyboardPattern,
  hasRepeatedChars,
  hasSequentialChars,
  isCommonPassword,
} from './auth.password.patterns';
