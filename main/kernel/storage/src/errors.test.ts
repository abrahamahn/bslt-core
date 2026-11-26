// main/kernel/storage/src/errors.test.ts
import { HTTP_STATUS } from '@bslt/contract';
import { describe, expect, it } from 'vitest';

import { StorageError, StorageNotFoundError, StorageUploadError, toStorageError } from './errors';

describe('storage errors', () => {
  it('constructs typed storage errors and normalizes unknown causes via toStorageError', () => {
    const rootCause = new Error('disk full');
    const notFound = new StorageNotFoundError('avatars/1.png', rootCause);
    expect(notFound.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    expect(notFound.code).toBe('STORAGE_NOT_FOUND');
    expect(notFound.key).toBe('avatars/1.png');
    expect(notFound.storageErrorCause).toBe(rootCause);

    const uploadErr = new StorageUploadError('uploads/2.bin', rootCause);
    expect(uploadErr.statusCode).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(uploadErr.code).toBe('STORAGE_UPLOAD_ERROR');

    // Pass-through for existing StorageError
    expect(toStorageError(notFound)).toBe(notFound);

    // Wraps generic Error
    const wrapped = toStorageError(new Error('timeout'));
    expect(wrapped).toBeInstanceOf(StorageError);
    expect(wrapped.message).toBe('timeout');

    // Uses default message for non-Error values
    const unknownWrapped = toStorageError('raw-failure', 'Fallback message');
    expect(unknownWrapped).toBeInstanceOf(StorageError);
    expect(unknownWrapped.message).toBe('Fallback message');
  });
});
