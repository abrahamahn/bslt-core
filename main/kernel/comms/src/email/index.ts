// main/kernel/comms/src/email/index.ts
export { SmtpClient } from './smtp.client';
export type { SmtpConfig, SmtpMessage } from './smtp.client';
export { createEmailTemplates } from './templates';
export type { EmailOptions, EmailResult, EmailService } from './types';
