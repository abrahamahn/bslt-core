// main/server/comms/src/email/index.ts
export { SmtpClient } from './smtp.client';
export type { SmtpConfig, SmtpMessage, SmtpResult } from './smtp.client';
export { createEmailTemplates, emailTemplates } from './templates';
export type { EmailTemplateOptions } from './templates';
export type { AuthEmailTemplates, EmailOptions, EmailResult, EmailService } from './types';
