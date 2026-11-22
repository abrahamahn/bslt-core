// main/apps/web/src/app/tosHandler.ts
/**
 * ToS Handler - Module-level bridge for ToS acceptance flow.
 *
 * Bridges the `@bslt/client-engine` generic 403 requirement interceptor
 * (`registerRequirementHandler('TOS_ACCEPTANCE_REQUIRED', ...)`) and the
 * `onTosRequired` callback to `App.tsx`'s `TosAcceptanceModal`.
 */

import { registerRequirementHandler } from '@bslt/client-engine';

export interface TosRequiredPayload {
  readonly documentId: string;
  readonly requiredVersion: number;
}

type TosHandler = (payload: TosRequiredPayload) => Promise<boolean>;

let handler: TosHandler | null = null;

/**
 * Set the ToS handler (called from App.tsx on mount).
 * Returns a cleanup function to unset the handler.
 */
export function setTosHandler(fn: TosHandler): () => void {
  handler = fn;
  const unregister = registerRequirementHandler('TOS_ACCEPTANCE_REQUIRED', async (details) => {
    const documentId = typeof details['documentId'] === 'string' ? details['documentId'] : '';
    const requiredVersion =
      typeof details['requiredVersion'] === 'number' ? details['requiredVersion'] : 0;
    if (documentId === '' || handler === null) {
      return false;
    }
    return handler({ documentId, requiredVersion });
  });
  return () => {
    handler = null;
    unregister();
  };
}

/**
 * Called when a 403 TOS_ACCEPTANCE_REQUIRED response is received directly.
 * Delegates to the handler set by the App component.
 */
export async function onTosRequired(payload: TosRequiredPayload): Promise<void> {
  if (handler !== null) {
    const accepted = await handler(payload);
    if (accepted) {
      return;
    }
    throw new Error('Terms of Service acceptance dismissed');
  }
  // No handler set yet - reject so the error propagates normally
  throw new Error('Terms of Service acceptance required');
}
