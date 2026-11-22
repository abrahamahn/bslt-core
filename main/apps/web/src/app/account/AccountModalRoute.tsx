// main/apps/web/src/app/account/AccountModalRoute.tsx
import { useLocation, useNavigate } from '@bslt/react/router';
import { useCapabilities } from '@bslt/web-platform';
import { useEffect, type ReactElement } from 'react';

import { hasBillingModule } from '../../generated/modules';

import { closeAccountModal, isAccountModalSection, openAccountModal } from './accountModalStore';
import { getActiveSettingsTab, getSettingsNavItems } from './settingsTabs';

const Backdrop = (): ReactElement => (
  <div className="account-modal-route-backdrop" aria-hidden="true" />
);

export const SettingsModalRoute = (): ReactElement => {
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  const { isFlagEnabled, status } = useCapabilities();
  const billingEnabled = isFlagEnabled('flags.billing');

  const section = getActiveSettingsTab({ hash, pathname, search });

  useEffect(() => {
    const matched = getSettingsNavItems({ billingEnabled }).find((item) => item.id === section);
    if (section === 'billing') {
      if (status === 'loading') return;
      navigate(hasBillingModule && billingEnabled ? '/settings/billing' : '/settings', {
        replace: true,
      });
      return;
    }
    if (matched?.kind === 'route' && matched.to !== undefined) {
      navigate(matched.to, { replace: true });
      return;
    }
    if (isAccountModalSection(section)) {
      openAccountModal(section);
    }
  }, [billingEnabled, navigate, section, status]);

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
