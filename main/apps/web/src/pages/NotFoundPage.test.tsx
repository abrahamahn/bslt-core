// main/apps/web/src/pages/NotFoundPage.test.tsx
import { MemoryRouter, useLocation } from '@bslt/react/router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n';

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

  it('renders localized Korean copy under ko-KR', () => {
    render(
      <I18nProvider initialLocale="ko-KR">
        <MemoryRouter initialEntries={['/missing']}>
          <NotFoundPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByText('페이지를 찾을 수 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '홈으로 이동' })).toBeInTheDocument();
  });
});
