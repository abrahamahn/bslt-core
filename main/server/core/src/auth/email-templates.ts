// main/server/core/src/auth/email-templates.ts
import type { AuthEmailTemplates, EmailTemplateResult } from './types';

export interface AuthEmailTemplateOptions {
  appName?: string | undefined;
}

function resolveAppName(value: string | undefined): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'Your App';
}

function template(subject: string, text: string): EmailTemplateResult {
  const body = text.trim();
  return {
    to: '',
    subject,
    text: body,
    html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
  };
}

export function createAuthEmailTemplates(
  options: AuthEmailTemplateOptions = {},
): AuthEmailTemplates {
  const appName = resolveAppName(options.appName);

  return {
    passwordReset(resetUrl, expiresInMinutes = 15) {
      return template(
        'Reset your password',
        `Reset your ${appName} password:\n${resetUrl}\n\nThis link expires in ${String(expiresInMinutes)} minutes.`,
      );
    },
    magicLink(loginUrl, expiresInMinutes = 15) {
      return template(
        `Sign in to ${appName}`,
        `Use this link to sign in to ${appName}:\n${loginUrl}\n\nThis link expires in ${String(expiresInMinutes)} minutes.`,
      );
    },
    emailOtp(code, expiresInMinutes = 10) {
      return template(
        `Your ${appName} security code`,
        `Your ${appName} security code is:\n\n${code}\n\nEnter this code to sign in. It expires in ${String(expiresInMinutes)} minutes.\nIf you didn't request this, you can safely ignore this email.`,
      );
    },
    emailVerification(verifyUrl, expiresInMinutes = 60) {
      return template(
        'Verify your email',
        `Verify your ${appName} email address:\n${verifyUrl}\n\nThis link expires in ${String(expiresInMinutes)} minutes.`,
      );
    },
    existingAccountRegistrationAttempt(email) {
      return template(
        'Account registration attempted',
        `A registration attempt was made for ${email}. If this was not you, no action is needed.`,
      );
    },
    tokenReuseAlert(ipAddress, userAgent, timestamp) {
      return template(
        'Security alert',
        `A reused authentication token was detected.\nIP: ${ipAddress}\nDevice: ${userAgent}\nTime: ${timestamp.toISOString()}`,
      );
    },
    newLoginAlert(ipAddress, userAgent, timestamp) {
      return template(
        'New login',
        `A new login was detected.\nIP: ${ipAddress}\nDevice: ${userAgent}\nTime: ${timestamp.toISOString()}`,
      );
    },
    passwordChangedAlert(ipAddress, userAgent, timestamp) {
      return template(
        'Password changed',
        `Your password was changed.\nIP: ${ipAddress}\nDevice: ${userAgent}\nTime: ${timestamp.toISOString()}`,
      );
    },
    emailChangedAlert(newEmail, ipAddress, userAgent, timestamp, revertUrl) {
      const revertLine =
        revertUrl !== undefined && revertUrl !== '' ? `\nRevert this change: ${revertUrl}` : '';
      return template(
        'Email changed',
        `Your email was changed to ${newEmail}.\nIP: ${ipAddress}\nDevice: ${userAgent}\nTime: ${timestamp.toISOString()}${revertLine}`,
      );
    },
    securityNotification(type, details, actionUrl) {
      return template(type, `${details}\n\nReview your account:\n${actionUrl}`);
    },
  };
}
