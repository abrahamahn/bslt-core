// main/apps/web/src/features/auth/components/RegisterForm.tsx

import { useAuth } from '@auth/hooks';
import { getPostLoginRedirect } from '@auth/utils/redirects';
import { useResendCooldown } from '@bslt/react/hooks';
import { Link, useNavigate } from '@bslt/react/router';
import { SIGNUP_ATTESTATION_STATEMENT } from '@bslt/shared/core/users';
import { AuthFormLayout, Button, Checkbox, Input, PasswordInput, Spinner, Text } from '@bslt/ui';
import { useCallback, useState } from 'react';

import { OAuthButtons } from './OAuthButtons';
import { TurnstileWidget } from './TurnstileWidget';

import type { AuthMode } from '@bslt/react/hooks';
import type {
  RegisterRequest,
  RegisterResponse,
  ResendVerificationRequest,
} from '@bslt/shared/core/auth';
import type { ChangeEvent, ReactElement } from 'react';

// ============================================================================
// Local Types (for ESLint type resolution)
// ============================================================================

type RegisterRequestLocal = RegisterRequest;
type RegisterResponseLocal = RegisterResponse;
type ResendVerificationRequestLocal = ResendVerificationRequest;

// ============================================================================
// Types
// ============================================================================

export interface RegisterFormProps {
  onRegister?: (data: RegisterRequestLocal) => Promise<RegisterResponseLocal>;
  onResendVerification?: (data: ResendVerificationRequestLocal) => Promise<void>;
  onSuccess?: () => void;
  onModeChange?: (mode: AuthMode) => void;
  isLoading?: boolean;
  error?: string | null;
}

export const RegisterForm = ({
  onRegister,
  onResendVerification,
  onModeChange,
  isLoading,
  error,
}: RegisterFormProps): ReactElement => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  // Unticked. A pre-ticked box is not consent — the user must act.
  const [eligibilityAttested, setEligibilityAttested] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
  const [registrationResult, setRegistrationResult] = useState<RegisterResponseLocal | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const { cooldown, isOnCooldown, startCooldown } = useResendCooldown();
  const { login, user } = useAuth();
  const navigate = useNavigate();

  const handleCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onRegister === undefined) return;

    try {
      const result: RegisterResponseLocal = await onRegister({
        email,
        username,
        firstName,
        lastName,
        password,
        tosAccepted,
        eligibilityAttested,
        ...(captchaToken !== undefined ? { captchaToken } : {}),
      });

      // Demo auto-verify: the account is already verified, so sign in immediately
      // with the credentials already in scope instead of showing the check-email
      // screen. Any login failure falls back to the standard success message.
      if (result.status === 'verified') {
        try {
          await login({ identifier: email, password });
          navigate(getPostLoginRedirect(user));
          return;
        } catch {
          // Auto-login failed — fall through to the success message below.
        }
      }

      setRegistrationResult(result);
    } catch {
      // Error handled by parent component via onRegister callback
    }
  };

  const handleResend = async (): Promise<void> => {
    if (
      onResendVerification === undefined ||
      registrationResult === null ||
      registrationResult.email.length === 0 ||
      isOnCooldown
    )
      return;

    setResendLoading(true);
    setResendMessage(null);
    try {
      const resultEmail: string = registrationResult.email;
      await onResendVerification({ email: resultEmail });
      setResendMessage('Verification email resent! Check your inbox.');
      startCooldown();
    } catch {
      setResendMessage('Failed to resend. Please try again later.');
    } finally {
      setResendLoading(false);
    }
  };

  // Show success message after registration
  if (registrationResult !== null) {
    return (
      <AuthFormLayout>
        <AuthFormLayout.Content>
          <AuthFormLayout.Header>
            <AuthFormLayout.Title>Check your email</AuthFormLayout.Title>
          </AuthFormLayout.Header>

          <div className="status-icon bg-success-muted mx-auto">
            <svg
              className="icon-lg text-success"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>

          <Text tone="muted" className="text-center">
            {registrationResult.message.length > 0
              ? registrationResult.message
              : 'Please check your email to verify your account.'}
          </Text>

          <Text tone="muted" className="text-xs text-center">
            Sent to:{' '}
            <Text as="strong">
              {registrationResult.email.length > 0 ? registrationResult.email : email}
            </Text>
          </Text>

          {resendMessage !== null && resendMessage.length > 0 && (
            <Text
              tone={resendMessage.includes('Failed') ? 'danger' : 'success'}
              className="text-sm text-center"
            >
              {resendMessage}
            </Text>
          )}

          {onResendVerification !== undefined && (
            <div className="text-center">
              <Button
                variant="text"
                onClick={() => {
                  void handleResend();
                }}
                disabled={resendLoading || isOnCooldown}
              >
                {resendLoading
                  ? 'Resending...'
                  : isOnCooldown
                    ? `Resend in ${cooldown.toString()}s`
                    : "Didn't receive it? Resend email"}
              </Button>
            </div>
          )}

          <AuthFormLayout.Footer>
            Already verified?{' '}
            {onModeChange !== undefined ? (
              <Button
                variant="text"
                onClick={() => {
                  onModeChange('login');
                }}
                size="inline"
                disabled={isLoading === true}
              >
                Sign in
              </Button>
            ) : (
              <Link to="/auth?mode=login">Sign in</Link>
            )}
          </AuthFormLayout.Footer>
        </AuthFormLayout.Content>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout>
      <AuthFormLayout.Content>
        <AuthFormLayout.Header>
          <AuthFormLayout.Title>Create account</AuthFormLayout.Title>
          <AuthFormLayout.Subtitle>Sign up for a new account</AuthFormLayout.Subtitle>
        </AuthFormLayout.Header>

        {/* Signing up with a provider creates an account too, so BOTH boxes
            below (agreements consent + eligibility) gate it. The single flag
            carries attested+consented to the server, so it is only claimed
            once both are actually ticked. */}
        <OAuthButtons
          mode="register"
          eligibilityAttested={tosAccepted && eligibilityAttested}
          {...((isLoading === true || !tosAccepted || !eligibilityAttested) && { disabled: true })}
        />

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="auth-form-fields"
        >
          <Input.Field
            label="Email"
            id="register-email"
            name="email"
            type="email"
            value={email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setEmail(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder="Enter your email address"
            autoComplete="email"
          />

          <Input.Field
            label="Username"
            id="register-username"
            name="username"
            type="text"
            value={username}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setUsername(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder="Choose a unique username"
            autoComplete="username"
          />

          <Input.Field
            label="First Name"
            id="register-first-name"
            name="given-name"
            type="text"
            value={firstName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setFirstName(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder="Jane"
            autoComplete="given-name"
          />

          <Input.Field
            label="Last Name"
            id="register-last-name"
            name="family-name"
            type="text"
            value={lastName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setLastName(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder="Doe"
            autoComplete="family-name"
          />

          <PasswordInput
            label="Password"
            id="register-password"
            name="new-password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setPassword(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder="Create a password"
            autoComplete="new-password"
          />

          <div className="auth-form-consent">
            <Checkbox
              id="register-tos"
              checked={tosAccepted}
              onChange={setTosAccepted}
              required
              disabled={isLoading}
              aria-label="Agree to Terms of Service and Privacy Policy"
              aria-describedby="register-tos-description"
            />
            <p id="register-tos-description" className="auth-form-consent__copy">
              I agree to the <Link to="/terms">Terms of Service</Link> and{' '}
              <Link to="/privacy">Privacy Policy</Link>.
            </p>
          </div>

          <div className="auth-form-consent">
            <Checkbox
              id="register-eligibility"
              checked={eligibilityAttested}
              onChange={setEligibilityAttested}
              required
              disabled={isLoading}
              aria-label={SIGNUP_ATTESTATION_STATEMENT}
              aria-describedby="register-eligibility-description"
            />
            <p id="register-eligibility-description" className="auth-form-consent__copy">
              {SIGNUP_ATTESTATION_STATEMENT}
            </p>
          </div>

          {error !== undefined && error !== null && (
            <AuthFormLayout.Error>{error}</AuthFormLayout.Error>
          )}

          <TurnstileWidget onToken={handleCaptchaToken} />

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !tosAccepted || !eligibilityAttested}
          >
            {isLoading === true ? (
              <Text as="span" className="flex items-center gap-2">
                <Spinner size="0.875rem" /> Creating account...
              </Text>
            ) : (
              'Create account'
            )}
          </Button>
        </form>

        <AuthFormLayout.Footer>
          Already have an account?{' '}
          {onModeChange !== undefined ? (
            <Button
              variant="text"
              onClick={() => {
                onModeChange('login');
              }}
              size="inline"
              disabled={isLoading === true}
            >
              Sign in
            </Button>
          ) : (
            <Link to="/auth?mode=login">Sign in</Link>
          )}
        </AuthFormLayout.Footer>
      </AuthFormLayout.Content>
    </AuthFormLayout>
  );
};
