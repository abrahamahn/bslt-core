// main/server/core/src/auth/handlers/strategies.ts
import { AUTH_STRATEGIES } from '@bslt/shared/constants';
import { type AuthStrategy } from '@bslt/shared/core/auth';

import type { AppContext } from '../types';

export interface AuthStrategiesResponse {
  enabled: AuthStrategy[];
  disabled: AuthStrategy[];
}

export function handleGetAuthStrategies(ctx: AppContext): {
  status: 200;
  body: AuthStrategiesResponse;
} {
  const enabledRaw = Array.isArray(ctx.config.auth.strategies) ? ctx.config.auth.strategies : [];
  const enabled = enabledRaw.filter((s): s is AuthStrategy => AUTH_STRATEGIES.includes(s));
  const disabled = AUTH_STRATEGIES.filter((s) => !enabled.includes(s));

  return {
    status: 200,
    body: { enabled, disabled },
  };
}
