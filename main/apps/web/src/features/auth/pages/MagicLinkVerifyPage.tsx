// main/apps/web/src/features/auth/pages/MagicLinkVerifyPage.tsx

import { useClientEnvironment } from '@app/ClientEnvironment';
import { isEligibilityAttestationRequired } from '@auth/utils/attestation';
import { getPostLoginRedirect } from '@auth/utils/redirects';
import { useNavigate, useSearchParams } from '@bslt/react/router';
import { SIGNUP_ATTESTATION_STATEMENT } from '@bslt/shared/core/users';
import { Alert, AuthLayout, Button, Checkbox, Heading, Spinner, Text } from '@bslt/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReactElement } from 'react';

// ============================================================================
// Local Types (for ESLint type resolution)
// ============================================================================

interface UserLocal {
  role?: string;
}

export const MagicLinkVerifyPage = (): ReactElement => {
  const searchParamsResult = useSearchParams();
  const searchParams: URLSearchParams = searchParamsResult[0];
  const navigate = useNavigate();
  const { auth } = useClientEnvironment();

  const token = searchParams.get('token');

  // A missing token is knowable at first render — no effect, no state transition.
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'attestation'>(
    token === null ? 'error' : 'loading',
  );
  const [message, setMessage] = useState(
    token === null ? 'Invalid or missing magic link token' : '',
  );
  // Unticked. A pre-ticked box is not consent.
  const [eligibilityAttested, setEligibilityAttested] = useState(false);

  const verifyStarted = useRef(false);

  /**
   * Redeem the link. The first attempt carries no attestation: a returning user is
   * signed in and never asked for one. If the server answers
   * ELIGIBILITY_ATTESTATION_REQUIRED, this link would CREATE an account — so it
   * shows the confirmation instead. The server did not consume the link in that
   * case, so ticking the box and calling this again with the same token completes
   * the sign-up.
   */
  /*
   * verify never sets state synchronously: the mount effect calls it while status
   * is already 'loading', and the retry button resets to 'loading' itself before
   * calling. Every setState below happens after an await.
   */
  const verify = useCallback(
    async (attested: boolean): Promise<void> => {
      if (token === null) return;
      try {
        // The one checkbox statement covers eligibility AND accepting the terms,
        // so ticking it sends both confirmations the server requires to create
        // an account (attestation + signup-agreement consent).
        await auth.verifyMagicLink({
          token,
          ...(attested ? { eligibilityAttested: true, tosAccepted: true } : {}),
        });
        const state = auth.getState();
        const user = state.user as UserLocal | null;
        setStatus('success');
        setMessage('You have been signed in successfully.');
        const redirectPath = getPostLoginRedirect(user);
        setTimeout(() => {
          navigate(redirectPath);
        }, 2000);
      } catch (err) {
        if (isEligibilityAttestationRequired(err)) {
          setStatus('attestation');
          setMessage(err instanceof Error ? err.message : '');
          return;
        }
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Magic link verification failed');
      }
    },
    [token, auth, navigate],
  );

  useEffect(() => {
    if (token === null) return;
    if (verifyStarted.current) return;
    verifyStarted.current = true;

    const redeemWithoutAttestation = async (): Promise<void> => {
      await verify(false);
    };
    void redeemWithoutAttestation();
  }, [token, verify]);

  const handleNavigateToLogin = (): void => {
    navigate('/login');
  };

  return (
    <AuthLayout>
      <div className="auth-form">
        <div className="auth-form-content">
          {status === 'loading' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title">
                  Verifying magic link...
                </Heading>
              </div>
              <div className="flex-center">
                <Spinner size="lg" />
              </div>
              <Text tone="muted" className="text-center">
                Please wait while we verify your magic link.
              </Text>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-success">
                  Signed in!
                </Heading>
              </div>
              <Alert tone="success" title="Success">
                {message}
              </Alert>
              <Text tone="muted" className="text-center text-sm">
                Redirecting to your account...
              </Text>
            </>
          )}

          {status === 'attestation' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title">
                  One more thing
                </Heading>
              </div>
              <Text tone="muted" className="text-center">
                This link will create a new account. Please confirm you are eligible to hold one.
              </Text>

              <div className="auth-form-consent">
                <Checkbox
                  id="magic-link-eligibility"
                  checked={eligibilityAttested}
                  onChange={setEligibilityAttested}
                  required
                  aria-label={SIGNUP_ATTESTATION_STATEMENT}
                  aria-describedby="magic-link-eligibility-description"
                />
                <p id="magic-link-eligibility-description" className="auth-form-consent__copy">
                  {SIGNUP_ATTESTATION_STATEMENT}
                </p>
              </div>

              <Button
                className="w-full"
                disabled={!eligibilityAttested}
                onClick={() => {
                  setStatus('loading');
                  void verify(true);
                }}
              >
                Create account
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-danger">
                  Verification failed
                </Heading>
              </div>
              <Alert tone="danger" title="Verification failed">
                The magic link is invalid or has expired.
              </Alert>
              <Text tone="muted" className="text-center">
                {message}
              </Text>
              <Button onClick={handleNavigateToLogin} className="w-full">
                Go to sign in
              </Button>
            </>
          )}
        </div>
      </div>
    </AuthLayout>
  );
};
