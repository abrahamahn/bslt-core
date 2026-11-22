// main/kernel/ui/src/elements/PasswordInput.tsx
import { useId, useState, type ComponentPropsWithRef, type ReactElement } from 'react';

import { cn } from '../utils/cn';

import { Button } from './Button';
import { Text } from './Text';

import '../styles/elements.css';

type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

interface PasswordStrengthEvaluation {
  readonly score: PasswordStrengthScore;
  readonly label: string;
  readonly warning?: string | undefined;
}

const DEFAULT_STRENGTH_LABELS: readonly [string, string, string, string, string] = [
  'Very Weak',
  'Weak',
  'Fair',
  'Strong',
  'Very Strong',
];

function evaluateDefaultPasswordStrength(
  password: string,
  userInputs: readonly string[],
  labels: readonly [string, string, string, string, string],
): PasswordStrengthEvaluation {
  const lower = password.toLowerCase();
  const containsInput = userInputs.some((input) => {
    const trimmed = input.trim().toLowerCase();
    return trimmed.length >= 3 && lower.includes(trimmed);
  });
  const hasRepeats = /(.)\1{2,}/u.test(password);

  let points = 0;
  if (password.length >= 8) points += 1;
  if (password.length >= 12) points += 1;
  if (/[a-z]/u.test(password) && /[A-Z]/u.test(password)) points += 1;
  if (/\d/u.test(password)) points += 1;
  if (/[^a-zA-Z0-9]/u.test(password)) points += 1;

  if (containsInput) points = Math.max(0, points - 2);
  if (hasRepeats) points = Math.max(0, points - 1);

  const clamped = Math.min(4, Math.max(0, points > 0 ? points - 1 : 0)) as PasswordStrengthScore;
  const warning = containsInput
    ? 'Avoid personal details in passwords'
    : hasRepeats
      ? 'Avoid repeated characters'
      : '';

  return {
    score: clamped,
    label: labels[clamped],
    ...(warning !== '' ? { warning } : {}),
  };
}

type PasswordInputProps = Omit<ComponentPropsWithRef<'input'>, 'type'> & {
  label?: string;
  description?: string;
  error?: string;
  showStrength?: boolean;
  showToggle?: boolean;
  userInputs?: string[];
  evaluateStrength?: (
    password: string,
    userInputs: readonly string[],
  ) => PasswordStrengthEvaluation;
  strengthLabels?: readonly [string, string, string, string, string];
  showPasswordAriaLabel?: string;
  hidePasswordAriaLabel?: string;
  showText?: string;
  hideText?: string;
};

export function PasswordInput({
  label,
  description,
  error,
  showStrength = false,
  showToggle = true,
  userInputs = [],
  evaluateStrength,
  strengthLabels = DEFAULT_STRENGTH_LABELS,
  showPasswordAriaLabel = 'Show password',
  hidePasswordAriaLabel = 'Hide password',
  showText = 'Show',
  hideText = 'Hide',
  className,
  id,
  value,
  onChange,
  ref,
  ...rest
}: PasswordInputProps): ReactElement {
  const [isVisible, setIsVisible] = useState(false);
  const [internalValue, setInternalValue] = useState('');

  const generatedId = useId();
  const inputId = id ?? `password-${generatedId}`;
  const descId = description != null && description !== '' ? `${inputId}-desc` : undefined;
  const errorId = error != null && error !== '' ? `${inputId}-err` : undefined;

  const passwordValue = value !== undefined ? String(value) : internalValue;

  const strength =
    showStrength && passwordValue.length > 0
      ? evaluateStrength !== undefined
        ? evaluateStrength(passwordValue, userInputs)
        : evaluateDefaultPasswordStrength(passwordValue, userInputs, strengthLabels)
      : null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (value === undefined) {
      setInternalValue(e.target.value);
    }
    onChange?.(e);
  };

  const toggleVisibility = (): void => {
    setIsVisible(!isVisible);
  };

  return (
    <div className="input-field">
      {label != null && label !== '' ? (
        <label htmlFor={inputId} className="input-label">
          {label}
        </label>
      ) : null}

      <div className="password-input-wrapper">
        <input
          ref={ref}
          id={inputId}
          type={isVisible ? 'text' : 'password'}
          className={cn('input', 'password-input', className)}
          aria-describedby={error != null && error !== '' ? errorId : descId}
          aria-invalid={error != null && error !== ''}
          value={passwordValue}
          onChange={handleChange}
          {...rest}
        />

        {showToggle && (
          <Button
            type="button"
            variant="text"
            size="small"
            className="password-toggle"
            onClick={toggleVisibility}
            aria-label={isVisible ? hidePasswordAriaLabel : showPasswordAriaLabel}
          >
            {isVisible ? hideText : showText}
          </Button>
        )}
      </div>

      {showStrength && strength != null && (
        <div className="password-strength">
          <div className="password-strength-bar">
            <div className="password-strength-fill" data-score={strength.score} />
          </div>
          <Text tone="muted" className="password-strength-label">
            {strength.label}
            {strength.warning !== undefined && strength.warning !== '' && ` - ${strength.warning}`}
          </Text>
        </div>
      )}

      {description != null && description !== '' && !showStrength ? (
        <Text id={descId} tone="muted" className="input-description">
          {description}
        </Text>
      ) : null}

      {error != null && error !== '' ? (
        <Text id={errorId} tone="danger" className="input-error">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
