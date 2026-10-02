// Core account shell. Auth and account dialogs are shared with all editions.
import { closeAuthModal, openAuthModal, useAuthModal } from '@auth/authModalStore';
import { AuthModal, NewDeviceBanner } from '@auth/components';
import { useAuth } from '@auth/hooks';
import { Link, Outlet } from '@bslt/react/router';
import { AccountModal } from '@features/settings';
import type { ReactElement, ReactNode } from 'react';
import { featureNavigation } from '../../extensions';
import { AppFooter } from './AppFooter';
export interface AppLayoutProps {
  children?: ReactNode;
}
export function AppLayout({ children }: AppLayoutProps): ReactElement {
  const { open, mode } = useAuthModal();
  const { isAuthenticated, logout } = useAuth();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-4 border-b">
        <nav aria-label="Main navigation" className="flex gap-4">
          <Link to="/">Home</Link>
          {isAuthenticated ? (
            <>
              <Link to="/profile">Account</Link>
              <Link to="/settings">Settings</Link>
              {featureNavigation.map(({ to, label }) => <Link key={to} to={to}>{label}</Link>)}
              <button
                type="button"
                onClick={() => {
                  void logout();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link to="/register">Create account</Link>
            </>
          )}
        </nav>
      </header>
      <NewDeviceBanner />
      <main id="main-content" className="flex-1 p-6">
        {children ?? <Outlet />}
      </main>
      <AppFooter />
      <AuthModal
        open={open}
        initialMode={mode}
        onOpenChange={(value) => {
          if (value) openAuthModal();
          else closeAuthModal();
        }}
      />
      <AccountModal />
    </div>
  );
}
