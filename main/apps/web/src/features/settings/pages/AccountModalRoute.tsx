// main/apps/web/src/features/settings/pages/AccountModalRoute.tsx
/**
 * URL-preserving stubs for the account modal.
 *
 * The old /settings and /profile pages are gone — the surface is the
 * AccountModal (mounted once in AppLayout). These route elements keep every
 * historical deep link working (`/settings?tab=security`, `/settings/legal`,
 * `#data-controls` hashes, `/profile`) by resolving the section from the URL
 * and opening the modal, while the URL stays put for refresh/bookmark/e2e.
 * Leaving the route (back button, in-modal navigation) closes the modal.
 */

import { isBillingEnabled } from '@app/capabilities';
import { useLocation, useNavigate } from '@bslt/react/router';
import { useEffect, type ReactElement } from 'react';

import { closeAccountModal, openAccountModal } from '../accountModalStore';
import { getActiveSettingsTab } from '../settingsTabs';

const Backdrop = (): ReactElement => (
  // The modal overlays this; it only exists so the route has a body.
  <div className="account-modal-route-backdrop" aria-hidden="true" />
);

export const SettingsModalRoute = (): ReactElement => {
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  const billingEnabled = isBillingEnabled();

  const section = getActiveSettingsTab({ hash, pathname, search });

  useEffect(() => {
    if (section === 'billing') {
      // Billing is a real page, not a modal section (mirrors the old redirect).
      navigate(billingEnabled ? '/settings/billing' : '/settings', { replace: true });
      return;
    }
    openAccountModal(section);
  }, [billingEnabled, navigate, section]);

  useEffect(() => closeAccountModal, []);

  return <Backdrop />;
};

export const ProfileModalRoute = (): ReactElement => {
  useEffect(() => {
    openAccountModal('profile');
    return closeAccountModal;
  }, []);

  return <Backdrop />;
};
