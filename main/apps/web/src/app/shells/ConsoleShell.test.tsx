// main/apps/web/src/app/shells/ConsoleShell.test.tsx
import { useAppRightSidebar } from '@bslt/web-platform';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockEnvironment, mockAdminUser, renderWithProviders } from '../../__tests__/utils';

import { ConsoleShell } from './ConsoleShell';

import type { ReactElement } from 'react';

const InspectorConsumer = ({ show }: { show: boolean }): ReactElement => {
  useAppRightSidebar(show ? <div data-testid="console-inspector">Inspector Details</div> : null);
  return <div>Console Page</div>;
};

describe('ConsoleShell', () => {
  it('omits right resizable pane when no route supplies inspector content and mounts it when useAppRightSidebar is active', async () => {
    const environment = createMockEnvironment({ user: mockAdminUser, isAuthenticated: true });
    const first = renderWithProviders(
      <ConsoleShell>
        <InspectorConsumer show={false} />
      </ConsoleShell>,
      { environment, route: '/admin' },
    );

    expect(first.container.querySelector('[data-shell="console"]')).toBeInTheDocument();
    expect(first.container.querySelector('.resizable-panel-group')).not.toBeNull();
    expect(screen.queryByTestId('console-inspector')).toBeNull();
    first.unmount();

    renderWithProviders(
      <ConsoleShell>
        <InspectorConsumer show={true} />
      </ConsoleShell>,
      { environment, route: '/admin' },
    );

    await waitFor(() => {
      expect(screen.getByTestId('console-inspector')).toBeInTheDocument();
    });
  });
});
