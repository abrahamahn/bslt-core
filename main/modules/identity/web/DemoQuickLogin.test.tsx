// main/modules/identity/web/DemoQuickLogin.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
