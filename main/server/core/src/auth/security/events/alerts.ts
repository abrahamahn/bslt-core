// main/server/core/src/auth/security/events/alerts.ts

import type { AuthEmailService, AuthEmailTemplates } from '../../types';

export interface SendTokenReuseAlertParams {
  email: string;
  ipAddress: string;
  userAgent: string | undefined;
  timestamp: Date;
}

export interface SendSecurityAlertParams {
  email: string;
  ipAddress: string;
  userAgent: string | undefined;
  timestamp: Date;
}

export interface SendEmailChangedAlertParams extends SendSecurityAlertParams {
  newEmail: string;
  revertUrl?: string | undefined;
}

async function sendSecurityEmail(
  emailService: AuthEmailService,
  email: string,
  template: { subject: string; html?: string | undefined; text?: string | undefined },
): Promise<void> {
  await emailService.send({
    to: email,
    subject: template.subject,
    ...(template.html !== undefined && { html: template.html }),
    ...(template.text !== undefined && { text: template.text }),
  });
}

export async function sendTokenReuseAlert(
  emailService: AuthEmailService,
  emailTemplates: AuthEmailTemplates,
  params: SendTokenReuseAlertParams,
): Promise<void> {
  const { email, ipAddress, userAgent, timestamp } = params;
  const template = emailTemplates.tokenReuseAlert(ipAddress, userAgent ?? 'Unknown', timestamp);
  await sendSecurityEmail(emailService, email, template);
}

export async function sendNewLoginAlert(
  emailService: AuthEmailService,
  emailTemplates: AuthEmailTemplates,
  params: SendSecurityAlertParams,
): Promise<void> {
  const { email, ipAddress, userAgent, timestamp } = params;
  const template = emailTemplates.newLoginAlert(ipAddress, userAgent ?? 'Unknown', timestamp);
  await sendSecurityEmail(emailService, email, template);
}

export async function sendPasswordChangedAlert(
  emailService: AuthEmailService,
  emailTemplates: AuthEmailTemplates,
  params: SendSecurityAlertParams,
): Promise<void> {
  const { email, ipAddress, userAgent, timestamp } = params;
  const template = emailTemplates.passwordChangedAlert(
    ipAddress,
    userAgent ?? 'Unknown',
    timestamp,
  );
  await sendSecurityEmail(emailService, email, template);
}

export async function sendEmailChangedAlert(
  emailService: AuthEmailService,
  emailTemplates: AuthEmailTemplates,
  params: SendEmailChangedAlertParams,
): Promise<void> {
  const { email, newEmail, ipAddress, userAgent, timestamp, revertUrl } = params;
  const template = emailTemplates.emailChangedAlert(
    newEmail,
    ipAddress,
    userAgent ?? 'Unknown',
    timestamp,
    revertUrl,
  );
  await sendSecurityEmail(emailService, email, template);
}
