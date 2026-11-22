// main/apps/web/src/app/shells/AuthShell.tsx
import { Outlet } from '@bslt/react/router';

import { ShellHeader } from './ShellHeader';
import './Shells.css';

import type { ReactElement, ReactNode } from 'react';

interface AuthShellProps {
  readonly children?: ReactNode;
}

export const AuthShell = ({ children }: AuthShellProps): ReactElement => (
  <div className="shell-auth" data-shell="auth">
    <ShellHeader variant="auth" />
    <main id="main-content" className="shell-auth__main">
      <div className="shell-auth__content">{children ?? <Outlet />}</div>
    </main>
  </div>
);
