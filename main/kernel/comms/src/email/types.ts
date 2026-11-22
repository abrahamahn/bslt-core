// main/kernel/comms/src/email/types.ts
/**
 * Email Service Types
 *
 * Re-exports shared email types and the canonical EmailService port contract.
 */

import type { EmailOptions, EmailService, SendResult } from '@bslt/contract';

export type { EmailOptions, EmailService };

/** Alias for shared SendResult — maintains engine-local naming */
export type EmailResult = SendResult;
