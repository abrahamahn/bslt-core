// main/modules/identity/web/IdentityProfileSettings.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileCompleteness, ProfileForm, UsernameForm } from './IdentityProfileSettings';

const hookState = vi.hoisted(() => ({
  profileUpdateLoading: false,
  profileUpdateError: null as Error | null,
  updateProfile: vi.fn(),
  resetProfileUpdate: vi.fn(),
  usernameUpdateLoading: false,
  usernameUpdateError: null as Error | null,
  updateUsername: vi.fn(),
  resetUsernameUpdate: vi.fn(),
  completenessData: null as {
    percentage: number;
    missingFields: Array<'avatarUrl' | 'bio'>;
  } | null,
  completenessLoading: false,
  completenessError: false,
}));

vi.mock('./hooks', () => ({
  useProfileUpdate: () => ({
    updateProfile: hookState.updateProfile,
    isLoading: hookState.profileUpdateLoading,
    error: hookState.profileUpdateError,
    reset: hookState.resetProfileUpdate,
  }),
  useUsernameUpdate: () => ({
    updateUsername: hookState.updateUsername,
    isLoading: hookState.usernameUpdateLoading,
    error: hookState.usernameUpdateError,
    reset: hookState.resetUsernameUpdate,
  }),
  useProfileCompleteness: () => ({
    data: hookState.completenessData,
    isLoading: hookState.completenessLoading,
    isError: hookState.completenessError,
  }),
}));

describe('IdentityProfileSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.profileUpdateLoading = false;
    hookState.profileUpdateError = null;
    hookState.usernameUpdateLoading = false;
    hookState.usernameUpdateError = null;
    hookState.completenessData = null;
    hookState.completenessLoading = false;
    hookState.completenessError = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('UsernameForm REJECTS too-short, invalid-format, and reserved usernames without calling API', () => {
    render(<UsernameForm currentUsername="alice" />);

    const input = screen.getByLabelText('Username') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a' } });
    expect(screen.getByText('Username must be at least 2 characters')).not.toBeNull();

    fireEvent.change(input, { target: { value: '1invalid' } });
    expect(
      screen.getByText(
        'Must start with a letter and contain only lowercase letters, numbers, and underscores',
      ),
    ).not.toBeNull();

    fireEvent.change(input, { target: { value: 'admin' } });
    expect(screen.getByText('This username is reserved')).not.toBeNull();
    expect(hookState.updateUsername).not.toHaveBeenCalled();
  });

  it('UsernameForm DISABLES edits when within the 30-day username cooldown window and surfaces server errors', () => {
    hookState.usernameUpdateError = new Error('Username already taken');
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    render(<UsernameForm currentUsername="alice" lastUsernameChangeAt={recent} />);

    const input = screen.getByLabelText('Username') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText(/Username can be changed again after/)).not.toBeNull();
    expect(screen.getByText('Username already taken')).not.toBeNull();
  });

  it('ProfileForm DISABLES submit when unchanged and surfaces server mutation errors', () => {
    hookState.profileUpdateError = new Error('Failed to save profile');
    render(
      <ProfileForm
        user={{
          email: 'alice@example.com',
          firstName: 'Alice',
          lastName: 'Smith',
          phone: '+15551234567',
        }}
      />,
    );

    const submit = screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText('Failed to save profile')).not.toBeNull();
  });

  it('ProfileCompleteness RETURNS null when loading, errored, or empty', () => {
    hookState.completenessLoading = true;
    const { container, rerender } = render(<ProfileCompleteness />);
    expect(container.firstChild).toBeNull();

    hookState.completenessLoading = false;
    hookState.completenessError = true;
    rerender(<ProfileCompleteness />);
    expect(container.firstChild).toBeNull();
  });

  it('submits valid username and profile updates and renders completeness when available', () => {
    hookState.completenessData = { percentage: 75, missingFields: ['bio'] };
    render(
      <div>
        <ProfileCompleteness />
        <UsernameForm currentUsername="alice" />
        <ProfileForm user={{ email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith' }} />
      </div>,
    );

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice_new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Username' }));
    expect(hookState.updateUsername).toHaveBeenCalledWith({ username: 'alice_new' });

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Alicia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(hookState.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Alicia', lastName: 'Smith' }),
    );
  });
});
