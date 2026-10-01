// main/client/api/src/api-keys/client.ts
/**
 * API Keys client — typed wrapper over the user-owned API key endpoints.
 */

import { createCsrfRequestClient } from '../utils';

import type { BaseClientConfig } from '../utils';
import type {
  ApiKeysListResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  DeleteApiKeyResponse,
} from '@bslt/shared/core/api-keys';

export type ApiKeysClientConfig = BaseClientConfig;

export interface ApiKeysClient {
  listApiKeys: () => Promise<ApiKeysListResponse>;
  createApiKey: (data: CreateApiKeyRequest) => Promise<CreateApiKeyResponse>;
  deleteApiKey: (id: string) => Promise<DeleteApiKeyResponse>;
}

export function createApiKeysClient(config: ApiKeysClientConfig): ApiKeysClient {
  const { request } = createCsrfRequestClient(config);

  return {
    listApiKeys: () => request<ApiKeysListResponse>('/api-keys', { method: 'GET' }),
    createApiKey: (data) =>
      request<CreateApiKeyResponse>('/api-keys/create', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deleteApiKey: (id) =>
      request<DeleteApiKeyResponse>(`/api-keys/${id}/delete`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  };
}
