// main/server/core/src/users/cache.ts

import { MS_PER_MINUTE } from '@bslt/shared/constants/time';

export const CacheKeys = {
  user: (id: string) => `user:${id}`,
  userByEmail: (email: string) => `user:email:${email}`,
} as const;

export const CacheTags = {
  user: (id: string) => `user:${id}`,
} as const;

export const CacheTTL = {
  user: 5 * MS_PER_MINUTE,
} as const;
