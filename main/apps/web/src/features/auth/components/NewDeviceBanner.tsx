// main/apps/web/src/features/auth/components/NewDeviceBanner.tsx
import { useAuth } from '@auth/hooks';
import { toastStore } from '@bslt/react';
import { useEffect, useRef } from 'react';

/**
 * Notifies the user when they sign in from an unrecognised device.
 *
 * Renders nothing itself: it raises a toast in the bottom-right corner. It used to
 * be a full-width `Alert` pinned under the header, which spent the entire width of
 * the app on one sentence and pushed every page down — a lot of the screen for a
 * notice that is usually informational. A toast carries the same message, keeps its
 * dismiss affordance, and costs no layout.
 *
 * Toasts here have no auto-dismiss timer, so a security notice still waits to be
 * acknowledged rather than disappearing while the user is reading something else.
 *
 * @returns null — the message goes to the toast region
 * @complexity O(1)
 */
export function NewDeviceBanner(): null {
  const { isNewDevice, dismissNewDeviceBanner } = useAuth();
  // Raise it once per sign-in. Without this the effect re-fires on every render
  // that happens before the auth flag clears, stacking duplicate toasts.
  const raised = useRef(false);

  useEffect(() => {
    if (!isNewDevice || raised.current) return;
    raised.current = true;

    toastStore().show({
      tone: 'warning',
      title: 'New device detected',
      description:
        "You signed in from a new device or location. If this wasn't you, change your password.",
      action: {
        label: 'Review security',
        onClick: () => {
          window.location.assign('/settings/security');
        },
      },
    });

    // Clear the server-provided flag now that the notice is on screen; the toast
    // owns its own lifetime from here, so a re-render cannot resurrect it.
    dismissNewDeviceBanner();
  }, [isNewDevice, dismissNewDeviceBanner]);

  return null;
}
