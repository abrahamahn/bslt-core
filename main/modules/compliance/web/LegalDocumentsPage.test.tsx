// main/modules/compliance/web/LegalDocumentsPage.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOCUMENT_TYPE_LABELS, PUBLISHABLE_DOCUMENT_TYPES, type DocumentType } from '../contract';

import { LegalDocumentsPage } from './LegalDocumentsPage';

const h = vi.hoisted(() => ({
  publish: vi.fn(),
  refresh: vi.fn(),
  currentError: null as Error | null,
  publishError: null as Error | null,
}));

vi.mock('./hooks', () => ({
  useCurrentLegal: () => ({
    documents: [],
    isLoading: false,
    isPending: false,
    error: h.currentError,
    refresh: h.refresh,
  }),
  usePublishLegal: () => ({
    publish: h.publish,
    isPublishing: false,
    error: h.publishError,
  }),
}));

const openTypePicker = (): void => {
  fireEvent.click(screen.getByRole('button', { expanded: false }));
};

const submitForm = (): void => {
  const form = screen.getByRole('button', { name: 'Publish' }).closest('form');
  if (form === null) throw new Error('publish form did not render');
  fireEvent.submit(form);
};

describe('LegalDocumentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.currentError = null;
    h.publishError = null;
    h.publish.mockResolvedValue({ document: { title: 'Published', version: 2 } });
  });

  afterEach(() => {
    cleanup();
  });

  it('offers every DB-owned document type and excludes all file-owned types', () => {
    render(<LegalDocumentsPage />);
    openTypePicker();

    expect(screen.getAllByRole('option')).toHaveLength(PUBLISHABLE_DOCUMENT_TYPES.length);
    for (const documentType of PUBLISHABLE_DOCUMENT_TYPES) {
      expect(
        screen.getByRole('option', { name: DOCUMENT_TYPE_LABELS[documentType] }),
      ).toBeInTheDocument();
    }

    for (const fileOwned of ['cookie_policy', 'acceptable_use', 'disclaimer'] as const) {
      expect(
        screen.queryByRole('option', { name: DOCUMENT_TYPE_LABELS[fileOwned] }),
      ).not.toBeInTheDocument();
    }
  });

  it.each([
    { field: 'title', title: '   ', content: '# Body' },
    { field: 'content', title: 'Version 2', content: '   ' },
  ])('does not publish a document whose $field is only whitespace', ({ title, content }) => {
    render(<LegalDocumentsPage />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } });
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: content } });

    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    submitForm();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('displays query and mutation error alerts and hides preview until non-blank content exists', () => {
    h.currentError = new Error('Cannot fetch documents');
    h.publishError = new Error('Publish forbidden');

    render(<LegalDocumentsPage />);
    expect(screen.getByText('Cannot fetch documents')).toBeInTheDocument();
    expect(screen.getByText('Publish forbidden')).toBeInTheDocument();
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Content'), { target: { value: '   ' } });
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
  });

  it.each([...PUBLISHABLE_DOCUMENT_TYPES])(
    'publishes the requested document version and renders live preview: %s',
    async (documentType: DocumentType) => {
      const { container } = render(<LegalDocumentsPage />);

      openTypePicker();
      fireEvent.click(screen.getByRole('option', { name: DOCUMENT_TYPE_LABELS[documentType] }));
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Version 2' } });
      fireEvent.change(screen.getByLabelText('Content'), {
        target: { value: '## Refunds\n\nThere are **none**.' },
      });

      const preview = container.querySelector('.legal-documents-preview');
      expect(preview?.querySelector('h2')).toHaveTextContent('Refunds');
      expect(preview?.querySelector('strong')).toHaveTextContent('none');

      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      await waitFor(() => {
        expect(h.publish).toHaveBeenCalledWith(
          expect.objectContaining({
            type: documentType,
            title: 'Version 2',
            content: '## Refunds\n\nThere are **none**.',
          }),
        );
      });
    },
  );
});
