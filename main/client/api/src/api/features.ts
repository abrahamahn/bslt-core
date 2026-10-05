// main/client/api/src/api/features.ts
import { createCsrfRequestClient } from '../utils';

import type { BaseClientConfig } from '../utils';

/** Extension requests use Core's token, refresh, and HTTP error handling. */
export function createFeatureClient(
  id: string,
  config: BaseClientConfig,
): {
  get: <T>(resource: string) => Promise<T>;
  post: <T>(resource: string, body: unknown) => Promise<T>;
} {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid feature ID');
  const { request } = createCsrfRequestClient(config);
  const route = (resource: string): string => {
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(resource))
      throw new Error('Feature resources must be relative paths');
    return `/extensions/${id}/${resource}`;
  };
  return {
    get<T>(resource: string): Promise<T> {
      return request<T>(route(resource));
    },
    post<T>(resource: string, body: unknown): Promise<T> {
      return request<T>(route(resource), { method: 'POST', body: JSON.stringify(body) });
    },
  };
}
