// main/modules/identity/web/ApiKeysSection.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiKeysSection } from './ApiKeysSection';

import type { ApiKey, CreateApiKeyResponse, CreatedApiKey } from '../contract';
import type { UseApiKeysResult, UseCreateApiKeyResult, UseDeleteApiKeyResult } from './hooks';

const mockRefetch = vi.fn();
const mockRevoke = vi.fn();
let capturedOnSuccess: ((res: CreateApiKeyResponse) => void) | undefined;
const mockCreate = vi.fn();

vi.mock('./hooks', () => ({
  useApiKeys: vi.fn(),
  useCreateApiKey: vi.fn((opts?: { onSuccess?: (res: CreateApiKeyResponse) => void }) => {
    capturedOnSuccess = opts?.onSuccess;
    return {
      create: mockCreate,
      isPending: false,
      isError: false,
      error: null,
    } satisfies UseCreateApiKeyResult;
  }),
  useDeleteApiKey: vi.fn(),
}));

const { useApiKeys, useCreateApiKey, useDeleteApiKey } = await import('./hooks');

const mockKey: ApiKey = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: null,
  scopes: [],
  name: 'CI deploy bot',
  keyPrefix: 'bslt_abc',
  last4: 'wxyz',
  lastUsedAt: null,
  expiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const createdKey: CreatedApiKey = {
  ...mockKey,
  token: 'bslt_abc_plaintext_secret_wxyz',
};

const emptyListResult: UseApiKeysResult = {
  data: [],
  isLoading: false,
  isError: false,
  error: null,
  refetch: mockRefetch,
};

afterEach(() => {
  cleanup();
});

describe('ApiKeysSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnSuccess = undefined;
    vi.mocked(useApiKeys).mockReturnValue(emptyListResult);
    vi.mocked(useCreateApiKey).mockImplementation((opts) => {
      capturedOnSuccess = opts?.onSuccess;
      return {
        create: mockCreate,
        isPending: false,
        isError: false,
        error: null,
      };
    });
    vi.mocked(useDeleteApiKey).mockReturnValue({
      revoke: mockRevoke,
      revokeAsync: vi.fn(),
      isPending: false,
      error: null,
    } satisfies UseDeleteApiKeyResult);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('renders loading and empty states and existing masked keys without plaintext tokens', () => {
    vi.mocked(useApiKeys).mockReturnValueOnce({ ...emptyListResult, isLoading: true });
    const { rerender } = render(<ApiKeysSection />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    vi.mocked(useApiKeys).mockReturnValueOnce(emptyListResult);
    rerender(<ApiKeysSection />);
    expect(screen.getByText('You have no API keys yet.')).toBeInTheDocument();

    vi.mocked(useApiKeys).mockReturnValueOnce({ ...emptyListResult, data: [mockKey] });
    rerender(<ApiKeysSection />);
    expect(screen.getByText('CI deploy bot')).toBeInTheDocument();
    expect(screen.getByText('bslt_abc…wxyz')).toBeInTheDocument();
    expect(screen.queryByText(createdKey.token)).not.toBeInTheDocument();
  });

  it('creates a key, displays the plaintext token once with clipboard copy, and clears it on Done', async () => {
    mockCreate.mockImplementation(() => {
      capturedOnSuccess?.({ key: createdKey });
    });

    render(<ApiKeysSection />);

    fireEvent.change(screen.getByLabelText('Key name'), { target: { value: 'Short lived' } });
    fireEvent.click(screen.getByRole('button', { name: 'API key expiration' }));
    fireEvent.click(screen.getByRole('option', { name: '30 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Short lived',
        expiresInDays: 30,
      });
    });

    expect(await screen.findByText(createdKey.token)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(createdKey.token);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(createdKey.token)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Key name')).toHaveValue('');
  });

  it('blocks submission of a whitespace-only name with a validation alert', () => {
    render(<ApiKeysSection />);

    fireEvent.change(screen.getByLabelText('Key name'), { target: { value: '   ' } });
    const form = screen.getByLabelText('Key name').closest('form');
    if (form === null) throw new Error('Form not found');
    fireEvent.submit(form);

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('renders server error alert and disables submit while creation is pending', () => {
    vi.mocked(useCreateApiKey).mockReturnValueOnce({
      create: mockCreate,
      isPending: true,
      isError: true,
      error: new Error('Rate limit exceeded'),
    });

    render(<ApiKeysSection />);

    expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  });

  it('surfaces clipboard failure alert instead of swallowing clipboard write rejections', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard permission denied')) },
      configurable: true,
    });
    mockCreate.mockImplementation(() => {
      capturedOnSuccess?.({ key: createdKey });
    });

    render(<ApiKeysSection />);
    fireEvent.change(screen.getByLabelText('Key name'), { target: { value: 'CI bot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));
    expect(await screen.findByText(createdKey.token)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Failed to copy key to clipboard.')).toBeInTheDocument();
  });

  it('requires confirmation before revoking and supports cancelling confirmation', () => {
    vi.mocked(useApiKeys).mockReturnValue({ ...emptyListResult, data: [mockKey] });

    render(<ApiKeysSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(mockRevoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockRevoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(mockRevoke).toHaveBeenCalledWith(mockKey.id);
  });
});
