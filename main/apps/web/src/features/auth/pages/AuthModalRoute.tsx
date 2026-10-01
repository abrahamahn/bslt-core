// main/apps/web/src/features/auth/pages/AuthModalRoute.tsx
/**
 * URL-preserving stubs for the auth modal.
 *
 * The old /login, /register, and /auth pages are gone — interactive auth lives
 * in the global AuthModal (mounted in AppLayout). These route elements keep the
 * historical URLs working: they resolve the requested mode, open the modal over
 * the landing page, honor `?returnTo=` after success, and redirect
 * already-authenticated visitors. Email-link landing pages (reset-password,
 * confirm-email, magic-link verify, …) remain real routes — email links must
 * stay URL-addressable.
 */

import { isAdvancedAuthEnabled } from '@app/capabilities';
import { useLocation, useNavigate, useSearchParams } from '@bslt/react/router';
import { LandingPage } from '@pages/LandingPage';
import { useEffect, useRef, type ReactElement } from 'react';

import { closeAuthModal, openAuthModal, useAuthModal } from '../authModalStore';
import { useAuth } from '../hooks';
import { getPostLoginRedirect } from '../utils/redirects';

import type { AuthMode } from '@bslt/react/hooks';

const VALID_MODES: readonly AuthMode[] = [
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'magic-link',
  'email-otp',
];

/** Modes that require the advanced-auth capability to be enabled. */
const ADVANCED_ONLY_MODES: readonly AuthMode[] = ['magic-link', 'email-otp'];

function isValidMode(value: string | null): value is AuthMode {
  return value !== null && (VALID_MODES as readonly string[]).includes(value);
}

const useAuthModalRoute = (mode: AuthMode): ReactElement => {
  const { user, isAuthenticated } = useAuth();
  const { open } = useAuthModal();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const wasOpened = useRef(false);

  useEffect(() => {
    if (isAuthenticated) {
      // Covers both an already-signed-in visitor and a login completing in the
      // modal (the modal closes itself on success).
      navigate(getPostLoginRedirect(user, returnTo), { replace: true });
      return;
    }
    openAuthModal(mode);
  }, [isAuthenticated, mode, navigate, returnTo, user]);

  useEffect(() => closeAuthModal, []);

  useEffect(() => {
    // Opening the store schedules a render. Observe that render before treating
    // a closed snapshot as a dismissal; the first effect still sees open=false.
    if (open) {
      wasOpened.current = true;
      return;
    }
    // Manually dismissed without signing in: don't strand the user on a stub.
    if (wasOpened.current && !isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate, open]);

  return <LandingPage />;
};

export const LoginModalRoute = (): ReactElement => useAuthModalRoute('login');

export const RegisterModalRoute = (): ReactElement => useAuthModalRoute('register');

/** Handles /auth?mode=… — the legacy multi-mode entry point. */
export const AuthQueryModalRoute = (): ReactElement | null => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const modeParam = searchParams.get('mode');
  const advancedAuthEnabled = isAdvancedAuthEnabled();

  const requested: AuthMode =
    isValidMode(modeParam) && (!ADVANCED_ONLY_MODES.includes(modeParam) || advancedAuthEnabled)
      ? modeParam
      : 'login';

  const isResetPassword = requested === 'reset-password';

  useEffect(() => {
    // Reset-password needs the emailed token; its standalone landing page owns
    // that flow (email links must stay URL-addressable).
    if (isResetPassword) {
      const params = new URLSearchParams(search);
      params.delete('mode');
      const query = params.toString();
      navigate(`/auth/reset-password${query === '' ? '' : `?${query}`}`, { replace: true });
    }
  }, [isResetPassword, navigate, search]);

  // The hook order stays stable: mode is data, not a branch.
  const element = useAuthModalRoute(isResetPassword ? 'login' : requested);
  return isResetPassword ? null : element;
};
