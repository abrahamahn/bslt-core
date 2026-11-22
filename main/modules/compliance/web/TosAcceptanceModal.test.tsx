// main/modules/compliance/web/TosAcceptanceModal.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TosAcceptanceModal } from './TosAcceptanceModal';

const DOC_ID = '11111111-2222-4333-8444-555555555555';

describe('TosAcceptanceModal', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders nothing when closed', () => {
    const { container } = render(
      <TosAcceptanceModal
        open={false}
        documentId={DOC_ID}
        requiredVersion={2}
        onAccept={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without a documentId — there is nothing to accept', () => {
    const { container } = render(
      <TosAcceptanceModal open documentId={null} requiredVersion={2} onAccept={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces a failed accept Error and keeps the modal up for a retry', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn().mockRejectedValue(new Error('accept endpoint unavailable'));
    render(<TosAcceptanceModal open documentId={DOC_ID} requiredVersion={2} onAccept={onAccept} />);

    await user.click(screen.getByRole('button', { name: /accept terms of service/i }));

    await waitFor(() => {
      expect(screen.getByText('accept endpoint unavailable')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /accept terms of service/i })).toBeEnabled();
  });

  it('surfaces a fallback error message when onAccept rejects with a non-Error value', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn().mockRejectedValue('network down');
    render(
      <TosAcceptanceModal open documentId={DOC_ID} requiredVersion={null} onAccept={onAccept} />,
    );

    await user.click(screen.getByRole('button', { name: /accept terms of service/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to accept Terms of Service')).toBeInTheDocument();
    });
  });

  it('names the required version and accepts THAT document', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn().mockResolvedValue(undefined);
    render(<TosAcceptanceModal open documentId={DOC_ID} requiredVersion={4} onAccept={onAccept} />);

    expect(screen.getByText(/version 4/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /accept terms of service/i }));

    expect(onAccept).toHaveBeenCalledWith(DOC_ID);
  });
});
