// main/apps/web/src/pages/ForbiddenPage.test.tsx
import { MemoryRouter, useLocation } from '@bslt/react/router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ForbiddenPage } from './ForbiddenPage';

import type { ReactElement } from 'react';

function PathEcho(): ReactElement {
  const { pathname } = useLocation();
  return <output data-testid="path">{pathname}</output>;
}

describe('ForbiddenPage', () => {
  it('renders the access denied state and navigates home on action click', () => {
    render(
      <MemoryRouter initialEntries={['/restricted']}>
        <ForbiddenPage />
        <PathEcho />
      </MemoryRouter>,
    );

    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to view this page.")).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/restricted');

    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });
});
