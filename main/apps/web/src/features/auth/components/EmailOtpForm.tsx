// main/apps/web/src/features/auth/components/EmailOtpForm.tsx

import { isEligibilityAttestationRequired } from '@auth/utils/attestation';
import { Link } from '@bslt/react/router';
import { SIGNUP_ATTESTATION_STATEMENT } from '@bslt/shared/core/users';
import { Alert, AuthFormLayout, Button, Checkbox, Input, Text } from '@bslt/ui';
import { useState } from 'react';

import type { AuthMode } from '@bslt/react/hooks';
import type {
  CompleteOnboardingRequest,
  EmailOtpRequest,
  EmailOtpVerifyRequest,
} from '@bslt/shared/core/auth';
import type { ChangeEvent, ReactElement, SyntheticEvent } from 'react';

export interface EmailOtpFormProps {
  onRequestEmailOtp?: (data: EmailOtpRequest) => Promise<void>;
  onVerifyEmailOtp?: (data: EmailOtpVerifyRequest) => Promise<{ isNewUser: boolean }>;
  onCompleteOnboarding?: (data: CompleteOnboardingRequest) => Promise<void>;
  onModeChange?: (mode: AuthMode) => void;
  isLoading?: boolean;
  error?: string | null;
}

type Step = 'email' | 'code' | 'onboarding';

export const EmailOtpForm = ({
  onRequestEmailOtp,
  onVerifyEmailOtp,
  onCompleteOnboarding,
  onModeChange,
  isLoading,
  error,
}: EmailOtpFormProps): ReactElement => {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  /**
   * The code entered belongs to an email with no account, so redeeming it would
   * sign the person up. Only then do we ask them to confirm they are eligible —
   * a returning user is never made to re-attest. The server has NOT consumed the
   * code, so the same one is re-submitted once the box is ticked.
   */
  const [attestationRequired, setAttestationRequired] = useState(false);
  // Unticked. A pre-ticked box is not consent.
  const [eligibilityAttested, setEligibilityAttested] = useState(false);

  const handleRequest = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onRequestEmailOtp === undefined) return;
    try {
      await onRequestEmailOtp({ email });
      setStep('code');
    } catch {
      // Error surfaced by parent via the error prop
    }
  };

  const handleVerify = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onVerifyEmailOtp === undefined) return;
    try {
      // The one checkbox statement covers eligibility AND accepting the terms,
      // so ticking it sends both confirmations the server requires to create
      // an account (attestation + signup-agreement consent).
      const { isNewUser } = await onVerifyEmailOtp({
        email,
        code,
        ...(eligibilityAttested ? { eligibilityAttested: true, tosAccepted: true } : {}),
      });
      // New users must finish onboarding before they are fully signed in;
      // existing users are authenticated here and the page redirects.
      if (isNewUser) setStep('onboarding');
    } catch (err) {
      if (isEligibilityAttestationRequired(err)) {
        setAttestationRequired(true);
        return;
      }
      // Any other error is surfaced by parent via the error prop
    }
  };

  const handleCompleteOnboarding = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onCompleteOnboarding === undefined) return;
    try {
      await onCompleteOnboarding({ firstName, lastName, username, password });
      // On success the auth state changes and the page redirects.
    } catch {
      // Error surfaced by parent via the error prop
    }
  };

  const resend = async (): Promise<void> => {
    if (onRequestEmailOtp === undefined) return;
    setCode('');
    try {
      await onRequestEmailOtp({ email });
    } catch {
      // Error surfaced by parent via the error prop
    }
  };

  const errorBlock =
    error !== undefined && error !== null && error.length > 0 ? (
      <AuthFormLayout.Error>{error}</AuthFormLayout.Error>
    ) : null;

  const subtitle =
    step === 'email'
      ? "Enter your email and we'll send you a 6-digit security code"
      : step === 'code'
        ? 'Enter the 6-digit code we sent to your email'
        : 'Set up your profile to finish creating your account';

  const onboardingComplete =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    username.trim().length >= 2 &&
    password.length > 0;

  return (
    <AuthFormLayout>
      <AuthFormLayout.Content>
        <AuthFormLayout.Header>
          <AuthFormLayout.Title>
            {step === 'onboarding' ? 'Complete your profile' : 'Sign in with email'}
          </AuthFormLayout.Title>
          <AuthFormLayout.Subtitle>{subtitle}</AuthFormLayout.Subtitle>
        </AuthFormLayout.Header>

        {step === 'email' && (
          <form
            onSubmit={(e) => {
              void handleRequest(e);
            }}
            className="auth-form-fields"
          >
            <Input.Field
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setEmail(e.target.value);
              }}
              required
              disabled={isLoading}
              placeholder="Enter your email address"
            />

            {errorBlock}

            <Button type="submit" className="w-full mt-2" disabled={isLoading}>
              {isLoading === true ? 'Sending...' : 'Send code'}
            </Button>
          </form>
        )}

        {step === 'code' && (
          <form
            onSubmit={(e) => {
              void handleVerify(e);
            }}
            className="auth-form-fields"
          >
            <Alert tone="success" title="Check your email">
              We sent a 6-digit code to <strong>{email}</strong>.
            </Alert>

            <Input.Field
              label="Security code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setCode(e.target.value.replace(/\D/g, ''));
              }}
              required
              disabled={isLoading}
              placeholder="123456"
            />

            {attestationRequired && (
              <div className="auth-form-consent">
                <Checkbox
                  id="otp-eligibility"
                  checked={eligibilityAttested}
                  onChange={setEligibilityAttested}
                  required
                  disabled={isLoading}
                  aria-label={SIGNUP_ATTESTATION_STATEMENT}
                  aria-describedby="otp-eligibility-description"
                />
                <p id="otp-eligibility-description" className="auth-form-consent__copy">
                  {SIGNUP_ATTESTATION_STATEMENT}
                </p>
              </div>
            )}

            {errorBlock}

            <Button
              type="submit"
              className="w-full mt-2"
              disabled={
                isLoading || code.length !== 6 || (attestationRequired && !eligibilityAttested)
              }
            >
              {isLoading === true
                ? 'Verifying...'
                : attestationRequired
                  ? 'Create account'
                  : 'Verify and sign in'}
            </Button>

            <div className="flex items-center justify-between gap-3">
              <Button
                variant="text"
                size="inline"
                disabled={isLoading}
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setAttestationRequired(false);
                  setEligibilityAttested(false);
                }}
              >
                Use a different email
              </Button>
              <Button
                variant="text"
                size="inline"
                disabled={isLoading}
                onClick={() => {
                  void resend();
                }}
              >
                Resend code
              </Button>
            </div>

            <Text size="sm" tone="muted" className="text-center">
              Didn&apos;t get it? Check your spam folder.
            </Text>
          </form>
        )}

        {step === 'onboarding' && (
          <form
            onSubmit={(e) => {
              void handleCompleteOnboarding(e);
            }}
            className="auth-form-fields"
          >
            <Input.Field
              label="First name"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setFirstName(e.target.value);
              }}
              required
              autoFocus
              disabled={isLoading}
              placeholder="Jane"
            />

            <Input.Field
              label="Last name"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setLastName(e.target.value);
              }}
              required
              disabled={isLoading}
              placeholder="Doe"
            />

            <Input.Field
              label="Username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setUsername(e.target.value);
              }}
              required
              minLength={2}
              disabled={isLoading}
              placeholder="janedoe"
            />

            <Input.Field
              label="Password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setPassword(e.target.value);
              }}
              required
              disabled={isLoading}
              placeholder="Create a password"
              description="You'll use this to sign in with a password later."
            />

            {errorBlock}

            <Button
              type="submit"
              className="w-full mt-2"
              disabled={isLoading || !onboardingComplete}
            >
              {isLoading === true ? 'Creating account...' : 'Create account'}
            </Button>
          </form>
        )}

        {step !== 'onboarding' && (
          <AuthFormLayout.Footer>
            Prefer to use a password?{' '}
            {onModeChange !== undefined ? (
              <Button
                variant="text"
                size="inline"
                onClick={() => {
                  onModeChange('login');
                }}
              >
                Sign in
              </Button>
            ) : (
              <Link to="/auth?mode=login">Sign in</Link>
            )}
          </AuthFormLayout.Footer>
        )}
      </AuthFormLayout.Content>
    </AuthFormLayout>
  );
};
