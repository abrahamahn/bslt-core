// main/shared/src/modules/core/auth/passwords/auth.password.ts
import { DEFAULT_PASSWORD_CONFIG as SHARED_DEFAULT_PASSWORD_CONFIG } from '../../../../constants/core/auth';

import { estimatePasswordStrength } from './auth.password.strength';

/**
 * Password validation configuration
 */
export interface PasswordConfig {
  minLength: number;
  maxLength: number;
  minScore: 0 | 1 | 2 | 3 | 4;
}

/**
 * Default password configuration (NIST guidelines)
 */
export const DEFAULT_PASSWORD_CONFIG: PasswordConfig = SHARED_DEFAULT_PASSWORD_CONFIG;

/**
 * Password validation result
 */
export interface PasswordValidationResult {
  isValid: boolean;
  score: number;
  errors: string[];
  feedback: {
    warning: string;
    suggestions: string[];
  };
  crackTimeDisplay: string;
}

/**
 * Validate password strength using custom entropy-based estimation
 * @param password - Password to validate
 * @param userInputs - Optional array of user-specific words to penalize (email, name, etc.)
 * @param config - Password configuration
 * @returns PasswordValidationResult
 */
export function validatePassword(
  password: string,
  userInputs: string[] = [],
  config: PasswordConfig = DEFAULT_PASSWORD_CONFIG,
): PasswordValidationResult {
  const errors: string[] = [];

  // Length checks
  if (password.length < config.minLength) {
    errors.push(`Password must be at least ${String(config.minLength)} characters`);
  }

  if (password.length > config.maxLength) {
    errors.push(`Password must be at most ${String(config.maxLength)} characters`);
  }

  // If basic length checks fail, return early
  if (errors.length > 0) {
    return {
      isValid: false,
      score: 0,
      errors,
      feedback: {
        warning: '',
        suggestions: [],
      },
      crackTimeDisplay: 'instant',
    };
  }

  // Use custom strength estimation
  const result = estimatePasswordStrength(password, userInputs);

  // Check score
  if (result.score < config.minScore) {
    errors.push(
      `Password is too weak (score: ${String(result.score)}/${String(config.minScore)} required)`,
    );
  }

  return {
    isValid: errors.length === 0,
    score: result.score,
    errors,
    feedback: {
      warning: result.feedback.warning,
      suggestions: result.feedback.suggestions,
    },
    crackTimeDisplay: result.crackTimeDisplay,
  };
}

/**
 * Synchronous password validation (basic checks only)
 * Use for quick client-side validation before full strength check
 */
export function validatePasswordBasic(
  password: string,
  config: PasswordConfig = DEFAULT_PASSWORD_CONFIG,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < config.minLength) {
    errors.push(`Password must be at least ${String(config.minLength)} characters`);
  }

  if (password.length > config.maxLength) {
    errors.push(`Password must be at most ${String(config.maxLength)} characters`);
  }

  // Check for common weak patterns (not comprehensive, just quick checks)
  if (/^(.)\1+$/.test(password)) {
    errors.push('Password cannot be all the same character');
  }

  if (/^(012|123|234|345|456|567|678|789|890)+$/.test(password)) {
    errors.push('Password cannot be a simple sequence');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get a human-readable strength label
 */
export function getStrengthLabel(score: number): string {
  switch (score) {
    case 0:
      return 'Very Weak';
    case 1:
      return 'Weak';
    case 2:
      return 'Fair';
    case 3:
      return 'Strong';
    case 4:
      return 'Very Strong';
    default:
      return 'Unknown';
  }
}
