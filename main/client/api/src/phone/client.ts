// main/client/api/src/phone/client.ts
/**
 * Phone/SMS Management API Client
 *
 * Framework-agnostic client for phone verification and SMS 2FA endpoints.
 */

import {
  removePhoneResponseSchema,
  setPhoneRequestSchema,
  setPhoneResponseSchema,
  verifyPhoneRequestSchema,
  verifyPhoneResponseSchema,
} from '@bslt/shared/core/auth';

import { apiRequest, createRequestFactory } from '../utils';

import type { BaseClientConfig } from '../utils';
import type {
  RemovePhoneResponse,
  SetPhoneResponse,
  VerifyPhoneResponse,
} from '@bslt/shared/core/auth';

// ============================================================================
// Types
// ============================================================================

export type PhoneClientConfig = BaseClientConfig;

export interface PhoneClient {
  setPhone(phone: string): Promise<SetPhoneResponse>;
  verifyPhone(code: string): Promise<VerifyPhoneResponse>;
  removePhone(): Promise<RemovePhoneResponse>;
}

// ============================================================================
// Client Factory
// ============================================================================

export function createPhoneClient(config: PhoneClientConfig): PhoneClient {
  const factory = createRequestFactory(config);

  return {
    setPhone: (phone): Promise<SetPhoneResponse> => {
      const validated = setPhoneRequestSchema.parse({ phone });
      return apiRequest(
        factory,
        '/users/me/phone',
        {
          method: 'POST',
          body: JSON.stringify(validated),
        },
        true,
        setPhoneResponseSchema,
      );
    },

    verifyPhone: (code): Promise<VerifyPhoneResponse> => {
      const validated = verifyPhoneRequestSchema.parse({ code });
      return apiRequest(
        factory,
        '/users/me/phone/verify',
        {
          method: 'POST',
          body: JSON.stringify(validated),
        },
        true,
        verifyPhoneResponseSchema,
      );
    },

    removePhone: (): Promise<RemovePhoneResponse> =>
      apiRequest(
        factory,
        '/users/me/phone/delete',
        { method: 'DELETE' },
        true,
        removePhoneResponseSchema,
      ),
  };
}
