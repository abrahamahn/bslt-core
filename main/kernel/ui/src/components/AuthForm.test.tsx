// main/kernel/ui/src/components/AuthForm.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthFormLayout } from './AuthForm';

describe('AuthFormLayout', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders every compound section with canonical class names and merged custom classes', () => {
    const { container } = render(
      <AuthFormLayout className="custom-root" data-testid="auth-root">
        <AuthFormLayout.Content className="custom-content">
          <AuthFormLayout.Header className="custom-header">
            <AuthFormLayout.Title className="custom-title">Sign in</AuthFormLayout.Title>
            <AuthFormLayout.Subtitle className="custom-subtitle">
              Enter your credentials
            </AuthFormLayout.Subtitle>
          </AuthFormLayout.Header>
          <AuthFormLayout.Fields className="custom-fields">
            <input aria-label="Email" />
          </AuthFormLayout.Fields>
          <AuthFormLayout.Error role="alert" className="custom-error">
            Invalid password
          </AuthFormLayout.Error>
          <AuthFormLayout.Divider className="custom-divider">or</AuthFormLayout.Divider>
          <AuthFormLayout.Footer className="custom-footer">Need an account?</AuthFormLayout.Footer>
        </AuthFormLayout.Content>
      </AuthFormLayout>,
    );

    const root = screen.getByTestId('auth-root');
    expect(root.tagName).toBe('DIV');
    expect(root.className).toContain('auth-form');
    expect(root.className).toContain('custom-root');

    const title = screen.getByRole('heading', { level: 2, name: 'Sign in' });
    expect(title.className).toContain('auth-form-title');
    expect(title.className).toContain('custom-title');

    expect(screen.getByText('Enter your credentials').className).toContain('auth-form-subtitle');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid password');
    expect(screen.getByRole('alert').className).toContain('auth-form-error');
    expect(screen.getByText('Need an account?').className).toContain('auth-form-footer');

    const dividerText = container.querySelector('.auth-form-divider-text');
    expect(dividerText?.textContent).toBe('or');
    expect(dividerText?.parentElement?.className).toContain('auth-form-divider');
    expect(dividerText?.parentElement?.className).toContain('custom-divider');
  });

  it('supports polymorphic root rendering via the as prop and forwards refs', () => {
    const ref = createRef<HTMLElement>();
    render(
      <AuthFormLayout as="section" ref={ref} aria-label="Authentication form">
        <AuthFormLayout.Title>Reset Password</AuthFormLayout.Title>
      </AuthFormLayout>,
    );

    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('SECTION');
    expect(ref.current?.getAttribute('aria-label')).toBe('Authentication form');
  });

  it('handles empty optional sub-components without crashing', () => {
    const { container } = render(
      <AuthFormLayout>
        <AuthFormLayout.Error />
        <AuthFormLayout.Footer />
        <AuthFormLayout.Divider />
      </AuthFormLayout>,
    );

    expect(container.querySelector('.auth-form-error')?.textContent).toBe('');
    expect(container.querySelector('.auth-form-footer')?.textContent).toBe('');
    expect(container.querySelector('.auth-form-divider-text')?.textContent).toBe('');
  });
});
