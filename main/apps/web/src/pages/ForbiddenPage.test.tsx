// main/apps/web/src/pages/ForbiddenPage.test.tsx
import { MemoryRouter, useLocation } from '@bslt/react/router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n';

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

  it('renders localized Korean copy under ko-KR', () => {
    render(
      <I18nProvider initialLocale="ko-KR">
        <MemoryRouter initialEntries={['/restricted']}>
          <ForbiddenPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByText('접근 거부됨')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '홈으로 이동' })).toBeInTheDocument();
  });
});
