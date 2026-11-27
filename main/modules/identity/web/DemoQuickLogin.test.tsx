// main/modules/identity/web/DemoQuickLogin.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModuleLocaleProvider } from '@bslt/web-platform';

import koKrMessages from '../i18n/ko-KR.json';

import { DemoQuickLogin } from './DemoQuickLogin';

describe('DemoQuickLogin', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when demo mode is disabled', () => {
    const onSelect = vi.fn();
    const { container } = render(<DemoQuickLogin enabled={false} onSelect={onSelect} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('demo-quick-login')).toBeNull();
  });

  it('populates credentials for each demo persona when enabled', () => {
    const onSelect = vi.fn();
    render(<DemoQuickLogin enabled onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Platform Admin' }));
    expect(onSelect).toHaveBeenCalledWith('admin@example.com', 'password123');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace Admin' }));
    expect(onSelect).toHaveBeenCalledWith('user@example.com', 'password123');

    fireEvent.click(screen.getByRole('button', { name: 'Demo Member' }));
    expect(onSelect).toHaveBeenCalledWith('demo@example.com', 'password123');
  });

  it('renders localized Korean persona buttons under ModuleLocaleProvider', () => {
    const onSelect = vi.fn();
    render(
      <ModuleLocaleProvider messages={koKrMessages}>
        <DemoQuickLogin enabled onSelect={onSelect} />
      </ModuleLocaleProvider>,
    );

    expect(screen.getByText('데모 빠른 로그인')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '플랫폼 관리자' }));
    expect(onSelect).toHaveBeenCalledWith('admin@example.com', 'password123');

    fireEvent.click(screen.getByRole('button', { name: '워크스페이스 관리자' }));
    expect(onSelect).toHaveBeenCalledWith('user@example.com', 'password123');

    fireEvent.click(screen.getByRole('button', { name: '데모 멤버' }));
    expect(onSelect).toHaveBeenCalledWith('demo@example.com', 'password123');
  });
});
