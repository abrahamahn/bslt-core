// main/apps/web/src/features/settings/components/PasswordSetupForm.tsx
/**
 * Password setup form for accounts that do not have a local password.
 */

import { getAccessToken } from '@app/authToken';
import { useClientEnvironment } from '@app/ClientEnvironment';
import { getApiClient } from '@bslt/api';
import { validatePasswordBasic } from '@bslt/shared/core/auth';
import { Alert, Button, FormField, PasswordInput, Text } from '@bslt/ui';
import { useMemo, useState, type ReactElement, type SyntheticEvent } from 'react';

export const PasswordSetupForm = (): ReactElement => {
  const { config } = useClientEnvironment();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const api = useMemo(
    () =>
      getApiClient({
        baseUrl: config.apiUrl,
        getToken: getAccessToken,
      }),
    [config.apiUrl],
  );

  const handleSubmit = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password !== confirmPassword) {
      setError(new Error('Passwords do not match'));
      return;
    }

    const validation = validatePasswordBasic(password);
    if (!validation.isValid) {
      setError(new Error(validation.errors[0] ?? 'Invalid password'));
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.setPassword({ password });
      setMessage(response.message);
      setPassword('');
      setConfirmPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setIsLoading(false);
    }
  };

  const canSubmit =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <Text tone="muted" size="sm">
        Add a local password to an account that currently signs in through passwordless or OAuth.
      </Text>

      <FormField label="Password" htmlFor="setPassword" required>
        <PasswordInput
          id="setPassword"
          name="new-password"
          value={password}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setPassword(event.target.value);
          }}
          autoComplete="new-password"
          showStrength
        />
      </FormField>

      <FormField label="Confirm Password" htmlFor="setPasswordConfirm" required>
        <PasswordInput
          id="setPasswordConfirm"
          name="confirm-password"
          value={confirmPassword}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setConfirmPassword(event.target.value);
          }}
          autoComplete="new-password"
        />
      </FormField>

      {error !== null && <Alert tone="danger">{error.message}</Alert>}
      {message !== null && <Alert tone="success">{message}</Alert>}

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit || isLoading}>
          {isLoading ? 'Setting...' : 'Set Password'}
        </Button>
      </div>
    </form>
  );
};
