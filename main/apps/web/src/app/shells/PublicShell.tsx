// main/apps/web/src/app/shells/PublicShell.tsx
import { Outlet } from '@bslt/react/router';

import { OptionalAnnouncementBanner } from '../../generated/modules';

import { ShellHeader } from './ShellHeader';
import { SiteFooter } from './SiteFooter';
import './Shells.css';

import type { ReactElement, ReactNode } from 'react';

interface PublicShellProps {
  readonly children?: ReactNode;
}

export const PublicShell = ({ children }: PublicShellProps): ReactElement => (
  <div className="shell-public" data-shell="public">
    <ShellHeader variant="public" />
    <OptionalAnnouncementBanner />
    <main id="main-content" className="shell-public__main">
      <div className="shell-public__content">{children ?? <Outlet />}</div>
      <SiteFooter />
    </main>
  </div>
);
