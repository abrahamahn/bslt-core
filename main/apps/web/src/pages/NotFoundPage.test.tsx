// main/apps/web/src/pages/NotFoundPage.test.tsx
import { MemoryRouter, useLocation } from '@bslt/react/router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NotFoundPage } from './NotFoundPage';

import type { ReactElement } from 'react';

function PathEcho(): ReactElement {
  const { pathname } = useLocation();
  return <output data-testid="path">{pathname}</output>;
}

describe('NotFoundPage', () => {
  it('renders the not found state and navigates home on action click', () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <NotFoundPage />
        <PathEcho />
      </MemoryRouter>,
    );

    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(
      screen.getByText("The page you're looking for doesn't exist or has been moved."),
    ).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/does-not-exist');

    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });
});
