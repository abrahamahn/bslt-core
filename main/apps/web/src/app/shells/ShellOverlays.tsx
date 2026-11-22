// main/apps/web/src/app/shells/ShellOverlays.tsx
import {
  AuthModal,
  closeAuthModal,
  openAuthModal,
  useAuth,
  useAuthModal,
} from '@bslt/identity/web';
import { useSidePeek } from '@bslt/react/hooks';
import { useCapabilities } from '@bslt/web-platform';
import { Suspense, lazy, useCallback, type ReactElement } from 'react';

const SidePeekUILibraryLayout = lazy(async () => {
  const mod = await import('@bslt/devtools/web');
  return { default: mod.SidePeekUILibraryLayout };
});

export const ShellOverlays = (): ReactElement => {
  const { open: authModalOpen, mode: authMode } = useAuthModal();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { isOpen: sidePeekOpen, close: closeSidePeek } = useSidePeek();
  const { isFlagEnabled } = useCapabilities();
  const devEnv: { readonly DEV?: boolean } = import.meta.env;
  const showDeveloperChrome = devEnv.DEV === true || isFlagEnabled('flags.dev_chrome');

  const handleAuthModalOpenChange = useCallback((open: boolean): void => {
    if (open) openAuthModal();
    else closeAuthModal();
  }, []);

  return (
    <>
      <AuthModal
        open={authModalOpen}
        onOpenChange={handleAuthModalOpenChange}
        initialMode={authMode}
      />
      {showDeveloperChrome && !isAuthLoading && !isAuthenticated ? (
        <Suspense fallback={null}>
          <SidePeekUILibraryLayout open={sidePeekOpen} onClose={closeSidePeek} />
        </Suspense>
      ) : null}
    </>
  );
};
