// main/apps/web/src/features/settings/components/PhoneManagement.tsx
/**
 * PhoneManagement — Add, verify, and remove a phone number for SMS 2FA.
 */

import { usePhone } from '@bslt/react';
import { Alert, Badge, Button, Card, Input, Text } from '@bslt/ui';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import {
  formatInternationalPhoneInput,
  normalizeInternationalPhoneInput,
} from '../utils/phoneFormatting';

import type { User } from '@bslt/shared/core/users';

// ============================================================================
// Types
// ============================================================================

interface PhoneManagementProps {
  user: User;
  baseUrl: string;
  getToken?: () => string | null;
  onStatusChange?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const PhoneManagement = ({
  user,
  baseUrl,
  getToken,
  onStatusChange,
}: PhoneManagementProps): ReactElement => {
  const clientConfig = useMemo(() => {
    const config: { baseUrl: string; getToken?: () => string | null } = { baseUrl };
    if (getToken !== undefined) {
      config.getToken = getToken;
    }
    return config;
  }, [baseUrl, getToken]);
  const { isLoading, error, setPhone, verifyPhone, removePhone } = usePhone({ clientConfig });

  const [phone, setPhoneInput] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'idle' | 'verify' | 'success'>('idle');
  const [localError, setLocalError] = useState<string | null>(null);

  const phoneValue = typeof user.phone === 'string' ? user.phone : '';
  const hasPhone = phoneValue !== '';
  const isVerified = user.phoneVerified === true;

  // Mask phone: show last 4 digits
  const maskedPhone = hasPhone ? `***${phoneValue.slice(-4)}` : null;

  const handleSetPhone = useCallback(async () => {
    const normalizedPhone = normalizeInternationalPhoneInput(phone);
    if (normalizedPhone === '') return;
    setLocalError(null);
    try {
      await setPhone(normalizedPhone);
      setStep('verify');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to set phone');
    }
  }, [phone, setPhone]);

  const handleVerify = useCallback(async () => {
    if (code.trim().length < 6) return;
    setLocalError(null);
    try {
      await verifyPhone(code.trim());
      setStep('success');
      onStatusChange?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Verification failed');
    }
  }, [code, verifyPhone, onStatusChange]);

  const handleRemove = useCallback(async () => {
    setLocalError(null);
    try {
      await removePhone();
      setStep('idle');
      setPhoneInput('');
      setCode('');
      onStatusChange?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to remove phone');
    }
  }, [removePhone, onStatusChange]);

  const displayError = localError ?? (error !== null ? error.message : null);

  // Phone verified — show status + remove option
  if (isVerified) {
    return (
      <Card className="settings-phone-card">
        <div className="settings-phone-card__header">
          <div>
            <div className="flex items-center gap-2">
              <Text>Phone Number</Text>
              <Badge tone="success">Verified</Badge>
            </div>
            <Text tone="muted" size="sm">
              {maskedPhone}
            </Text>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => {
              void handleRemove();
            }}
            disabled={isLoading}
          >
            Remove
          </Button>
        </div>
        {displayError !== null && (
          <Alert tone="danger" className="mt-3">
            {displayError}
          </Alert>
        )}
      </Card>
    );
  }

  // Verify step — code entry
  if (step === 'verify') {
    return (
      <Card className="settings-phone-card">
        <Text>Enter verification code</Text>
        <Text tone="muted" size="sm">
          A code was sent to the phone number you provided.
        </Text>
        <form
          className="settings-phone-card__form-row"
          onSubmit={(e) => {
            e.preventDefault();
            void handleVerify();
          }}
        >
          <Input
            type="text"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <Button type="submit" disabled={isLoading || code.trim().length < 6}>
            Verify
          </Button>
        </form>
        {displayError !== null && <Alert tone="danger">{displayError}</Alert>}
      </Card>
    );
  }

  // Success step
  if (step === 'success') {
    return (
      <Card className="settings-phone-card">
        <Alert tone="success">Phone number verified! SMS 2FA is now active.</Alert>
      </Card>
    );
  }

  // Idle — add phone number
  return (
    <Card className="settings-phone-card">
      <Text>SMS Two-Factor Authentication</Text>
      <Text tone="muted" size="sm">
        Add a phone number to receive SMS verification codes during login. When enabled, you will
        need to enter a code sent to your phone after entering your password.
      </Text>
      <form
        className="settings-phone-card__form-row"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSetPhone();
        }}
      >
        <Input
          type="tel"
          placeholder="+1 (555) 123-4567"
          value={phone}
          onChange={(e) => {
            setPhoneInput(formatInternationalPhoneInput(e.target.value));
          }}
          autoComplete="tel"
          inputMode="tel"
          maxLength={24}
        />
        <Button
          type="submit"
          disabled={isLoading || normalizeInternationalPhoneInput(phone) === ''}
        >
          Send Code
        </Button>
      </form>
      {displayError !== null && <Alert tone="danger">{displayError}</Alert>}
    </Card>
  );
};
