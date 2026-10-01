// main/apps/web/src/features/auth/pages/ReactivatePromptPage.tsx

import { useAuth } from '@auth/hooks';
import { getPostLoginRedirect } from '@auth/utils/redirects';
import { useNavigate } from '@bslt/react/router';
import { getAccountStatus } from '@bslt/shared/core/users';
import { Alert, AuthLayout, Button, Heading, Text } from '@bslt/ui';
import { useReactivateAccount } from '@settings/hooks';
import { useEffect } from 'react';

import type { ReactElement } from 'react';

const toLifecycleDate = (value: string | null | undefined): Date | null =>
  value != null ? new Date(value) : null;

/**
 * Reactivation prompt shown after a deactivated or within-grace pending-deletion
 * user signs in. Login now succeeds for such accounts (so ownership is proven),
 * and this page lets the owner restore the account with one click before
 * continuing to the app.
 */
export const ReactivatePromptPage = (): ReactElement => {
  const navigate = useNavigate();
  const { user, reloadUser, logout } = useAuth();

  const status =
    user !== null
      ? getAccountStatus({
          deactivatedAt: toLifecycleDate(user.deactivatedAt),
          deletedAt: toLifecycleDate(user.deletedAt),
          deletionGracePeriodEnds: toLifecycleDate(user.deletionGracePeriodEnds),
        })
      : 'active';

  // Where to go once the account is active again. Computed from role alone —
  // passing the live (inactive) user would resolve back to '/reactivate' and loop.
  const role = user?.role;
  const destination = getPostLoginRedirect(role != null ? { role } : null);

  // Active users (or a signed-out session) have nothing to reactivate — send
  // them to their normal destination instead of showing the prompt. This also
  // completes the post-reactivation flow once reloadUser() clears the fields.
  useEffect(() => {
    if (user === null) {
      navigate('/login');
      return;
    }
    if (status === 'active') {
      navigate(destination);
    }
  }, [user, status, destination, navigate]);

  const { reactivate, isLoading, error } = useReactivateAccount({
    onSuccess: () => {
      void reloadUser().then(() => {
        navigate(destination);
      });
    },
  });

  const handleSignOut = (): void => {
    void logout().then(() => {
      navigate('/login');
    });
  };

  const isPendingDeletion = status === 'pending_deletion';
  const gracePeriodEnds = toLifecycleDate(user?.deletionGracePeriodEnds);

  return (
    <AuthLayout>
      <div className="auth-form">
        <div className="auth-form-content">
          <div className="auth-form-header">
            <Heading as="h2" size="md" className="auth-form-title">
              {isPendingDeletion ? 'Restore your account' : 'Welcome back'}
            </Heading>
          </div>

          <Alert tone={isPendingDeletion ? 'warning' : 'info'} title="Your account is inactive">
            {isPendingDeletion
              ? 'Your account is scheduled for deletion. Reactivate now to cancel the deletion and keep your data.'
              : 'Your account is deactivated. Reactivate it to restore full access.'}
          </Alert>

          {isPendingDeletion && gracePeriodEnds !== null && (
            <Text tone="muted" className="text-center text-sm">
              Deletion scheduled for {gracePeriodEnds.toLocaleDateString()}.
            </Text>
          )}

          {error !== null && (
            <Alert tone="danger" title="Reactivation failed">
              {error.message}
            </Alert>
          )}

          <Button onClick={reactivate} disabled={isLoading} className="w-full">
            {isLoading ? 'Reactivating…' : 'Reactivate my account'}
          </Button>

          <Button
            variant="secondary"
            onClick={handleSignOut}
            disabled={isLoading}
            className="w-full"
          >
            Not now, sign out
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
};
