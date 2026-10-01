// main/server/comms/src/email/templates/templates.ts
/**
 * Email Templates
 *
 * Pre-built email templates for common use cases.
 * Uses a responsive base layout with header/footer branding.
 *
 * Layout structure:
 * - Outer wrapper table (background color, centering)
 * - Inner content table (max-width 600px, white background)
 * - Header with product branding
 * - Content section (template-specific)
 * - Footer with company info and optional unsubscribe
 *
 * All styles are inline for maximum email client compatibility.
 */

import { escapeHtml } from '@bslt/shared/helpers';

import type { EmailOptions } from '../types';

const DEFAULT_APP_NAME = 'Your App';

export interface EmailTemplateOptions {
  appName?: string | undefined;
}

// ============================================================================
// Styles
// ============================================================================

const styles = {
  body: "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background-color: #ffffff;",
  heading: 'color: #333333; font-size: 24px; font-weight: 600; margin-bottom: 16px;',
  text: 'color: #4b5563; font-size: 16px; line-height: 1.5; margin-bottom: 16px;',
  button:
    'display: inline-block; padding: 12px 24px; background-color: #0066cc; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; text-align: center;',
  buttonSuccess:
    'display: inline-block; padding: 12px 24px; background-color: #16a34a; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; text-align: center;',
  subtext: 'color: #6b7280; font-size: 14px; margin-top: 24px;',
  footer: 'color: #9ca3af; font-size: 12px; margin-top: 12px;',
  alert: 'color: #dc2626; font-weight: 500; margin-top: 12px;',
} as const;

// ============================================================================
// Responsive Base Layout
// ============================================================================

/**
 * Render a responsive HTML email layout with header and footer branding.
 *
 * Uses table-based layout for maximum email client compatibility
 * (Outlook, Gmail, Yahoo, Apple Mail, etc.).
 *
 * @param title - Email title (used in `<title>` and preheader)
 * @param content - Inner HTML content for the email body
 * @param options - Optional footer customization
 * @returns Complete HTML email string
 * @complexity O(1)
 */
function renderLayout(
  title: string,
  content: string,
  options?: { unsubscribeUrl?: string; appName?: string },
): string {
  const appName = resolveAppName(options?.appName);
  const unsubscribeLink =
    options?.unsubscribeUrl !== undefined && options.unsubscribeUrl !== ''
      ? `<a href="${options.unsubscribeUrl}" style="color: #9ca3af; text-decoration: underline;">Unsubscribe</a>`
      : '';

  const footerSeparator = unsubscribeLink !== '' ? ' &middot; ' : '';

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; display: block; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-content { padding: 24px 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; -webkit-font-smoothing: antialiased;">
  <!-- Preheader text (hidden, shows in inbox preview) -->
  <div style="display: none; max-height: 0px; overflow: hidden;">${title}</div>
  <div style="display: none; max-height: 0px; overflow: hidden;">&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f5f7;">
    <tr>
      <td align="center" style="padding: 24px 12px;">

        <!-- Email container -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="padding: 28px 40px 20px 40px; border-bottom: 1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.025em;">
                    ${appName}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td class="email-content" style="padding: 32px 40px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 28px 40px; border-top: 1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #9ca3af; line-height: 1.6; text-align: center;">
                    &copy; ${String(new Date().getFullYear())} ${appName}. All rights reserved.${footerSeparator}${unsubscribeLink}
                    <br>
                    <span style="color: #d1d5db;">This is an automated message. Please do not reply directly.</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Email container -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->
</body>
</html>
  `.trim();
}

function resolveAppName(value: string | undefined): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : DEFAULT_APP_NAME;
}

// ============================================================================
// Templates
// ============================================================================

export function createEmailTemplates(options: EmailTemplateOptions = {}) {
  const appName = resolveAppName(options.appName);
  const renderBrandedLayout = (
    title: string,
    content: string,
    layoutOptions?: { unsubscribeUrl?: string },
  ): string => renderLayout(title, content, { ...layoutOptions, appName });

  return {
    /**
     * Password reset email
     */
    passwordReset(resetUrl: string, expiresInMinutes = 15): EmailOptions & { to: '' } {
      const expiry = String(expiresInMinutes);
      return {
        to: '',
        subject: 'Reset Your Password',
        text: `
You requested to reset your password.

Click the link below to reset your password:
${resetUrl}

This link will expire in ${expiry} minutes.

If you did not request this, please ignore this email.
      `.trim(),
        html: renderBrandedLayout(
          'Reset Your Password',
          `
        <h2 style="${styles.heading}">Reset Your Password</h2>
        <p style="${styles.text}">You requested to reset your password. Click the button below to choose a new one.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #0066cc;">
              <a href="${resetUrl}" target="_blank" style="${styles.button}">
                Reset Password
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.subtext}">This link will expire in ${expiry} minutes.</p>
        <p style="${styles.text}; font-size: 14px;">If you can't click the button, copy and paste this URL into your browser:</p>
        <p style="color: #6b7280; font-size: 13px; word-break: break-all;">${resetUrl}</p>
        <p style="${styles.footer}">If you did not request this, please ignore this email.</p>
        `,
        ),
      };
    },

    /**
     * Magic link email
     */
    magicLink(loginUrl: string, expiresInMinutes = 15): EmailOptions & { to: '' } {
      const expiry = String(expiresInMinutes);
      return {
        to: '',
        subject: 'Sign in to your account',
        text: `
Click the link below to sign in to your account:
${loginUrl}

This link will expire in ${expiry} minutes and can only be used once.

If you did not request this, please ignore this email.
      `.trim(),
        html: renderBrandedLayout(
          'Sign In',
          `
        <h2 style="${styles.heading}">Sign in to your account</h2>
        <p style="${styles.text}">Click the button below to sign in:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #0066cc;">
              <a href="${loginUrl}" target="_blank" style="${styles.button}">
                Sign In
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.subtext}">This link will expire in ${expiry} minutes and can only be used once.</p>
        <p style="${styles.footer}">If you did not request this, please ignore this email.</p>
        `,
        ),
      };
    },

    /**
     * Email OTP (one-time 6-digit login code)
     */
    emailOtp(code: string, expiresInMinutes = 10): EmailOptions & { to: '' } {
      const expiry = String(expiresInMinutes);
      return {
        to: '',
        subject: 'Your security code',
        text: `
Your security code is:

${code}

Enter this code to sign in. It will expire in ${expiry} minutes and can only be used once.

If you did not request this, please ignore this email.
      `.trim(),
        html: renderBrandedLayout(
          'Security Code',
          `
        <h2 style="${styles.heading}">Your security code</h2>
        <p style="${styles.text}">Enter this code to sign in:</p>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; text-align: center; margin: 24px 0; font-family: monospace;">${code}</p>
        <p style="${styles.subtext}">This code will expire in ${expiry} minutes and can only be used once.</p>
        <p style="${styles.footer}">If you did not request this, please ignore this email.</p>
        `,
        ),
      };
    },

    /**
     * Email verification
     */
    emailVerification(verifyUrl: string, expiresInMinutes = 60): EmailOptions & { to: '' } {
      const expiry = String(expiresInMinutes);
      return {
        to: '',
        subject: 'Verify Your Email Address',
        text: `
Welcome! Please verify your email address.

Click the link below to verify your email:
${verifyUrl}

This link will expire in ${expiry} minutes.

If you did not create an account, please ignore this email.
      `.trim(),
        html: renderBrandedLayout(
          'Verify Your Email',
          `
        <h2 style="${styles.heading}">Verify Your Email Address</h2>
        <p style="${styles.text}">Welcome! Please verify your email address to complete your registration.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #16a34a;">
              <a href="${verifyUrl}" target="_blank" style="${styles.buttonSuccess}">
                Verify Email
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.subtext}">This link will expire in ${expiry} minutes.</p>
        <p style="${styles.text}; font-size: 14px;">If you can't click the button, copy and paste this URL into your browser:</p>
        <p style="color: #6b7280; font-size: 13px; word-break: break-all;">${verifyUrl}</p>
        <p style="${styles.footer}">If you did not create an account, please ignore this email.</p>
        `,
        ),
      };
    },

    /**
     * Password changed notification
     */
    passwordChanged(): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: 'Your Password Was Changed',
        text: `
Your password was recently changed.

If you made this change, you can ignore this email.

If you did not change your password, please contact support immediately.
      `.trim(),
        html: renderBrandedLayout(
          'Password Changed',
          `
        <h2 style="${styles.heading}">Your Password Was Changed</h2>
        <p style="${styles.text}">Your password was recently changed.</p>
        <p style="${styles.text}">If you made this change, you can ignore this email.</p>
        <p style="${styles.alert}">If you did not change your password, please contact support immediately.</p>
        `,
        ),
      };
    },

    /**
     * Existing account registration attempt notification
     * Sent when someone tries to register with an email that already has an account
     */
    existingAccountRegistrationAttempt(email: string): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: 'Sign-in Attempt on Your Account',
        text: `
Someone attempted to create a new account using your email address (${email}).

If this was you, you may already have an account. Try signing in instead, or use the "Forgot Password" option if you don't remember your password.

If you did not attempt to create a new account, you can safely ignore this email. Your account remains secure.
      `.trim(),
        html: renderBrandedLayout(
          'Sign-in Attempt',
          `
        <h2 style="${styles.heading}">Sign-in Attempt on Your Account</h2>
        <p style="${styles.text}">Someone attempted to create a new account using your email address.</p>
        <p style="${styles.text}">If this was you, you may already have an account. Try signing in instead, or use the "Forgot Password" option if you don't remember your password.</p>
        <p style="${styles.footer}">If you did not attempt to create a new account, you can safely ignore this email. Your account remains secure.</p>
        `,
        ),
      };
    },

    /**
     * New login "Was this you?" alert
     * Sent after a successful login to notify the user.
     */
    newLoginAlert(
      ipAddress: string,
      userAgent: string,
      timestamp: Date,
    ): EmailOptions & { to: '' } {
      const formattedDate = timestamp.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      return {
        to: '',
        subject: 'New Sign-In to Your Account',
        text: `
New Sign-In Detected

We noticed a new sign-in to your account.

Details:
- Time: ${formattedDate}
- IP Address: ${ipAddress}
- Device/Browser: ${userAgent !== '' ? userAgent : 'Unknown'}

Was this you?
If yes, you can ignore this email.

If no, your account may be compromised. Please:
1. Change your password immediately
2. Enable two-factor authentication (2FA) if not already enabled
3. Review your recent account activity
      `.trim(),
        html: renderBrandedLayout(
          'New Sign-In',
          `
        <h2 style="${styles.heading}">New Sign-In to Your Account</h2>
        <p style="${styles.text}">We noticed a new sign-in to your account.</p>

        <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <h3 style="color: #374151; margin: 0 0 12px 0; font-size: 16px;">Details:</h3>
          <table style="color: #4b5563; font-size: 14px;">
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">Time:</td><td>${formattedDate}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">IP Address:</td><td>${ipAddress}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">Device/Browser:</td><td>${userAgent !== '' ? userAgent : 'Unknown'}</td></tr>
          </table>
        </div>

        <p style="${styles.text}"><strong>Was this you?</strong></p>
        <p style="${styles.text}">If yes, you can safely ignore this email.</p>
        <p style="${styles.alert}">If no, your account may be compromised. Change your password immediately and enable two-factor authentication (2FA).</p>
        `,
        ),
      };
    },

    /**
     * Password changed "Was this you?" alert
     * Sent after a user's password is changed.
     */
    passwordChangedAlert(
      ipAddress: string,
      userAgent: string,
      timestamp: Date,
    ): EmailOptions & { to: '' } {
      const formattedDate = timestamp.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      return {
        to: '',
        subject: 'Your Password Was Changed',
        text: `
Your Password Was Changed

Your account password was recently changed.

Details:
- Time: ${formattedDate}
- IP Address: ${ipAddress}
- Device/Browser: ${userAgent !== '' ? userAgent : 'Unknown'}

Was this you?
If yes, you can ignore this email.

If no, your account may be compromised. Please:
1. Use "Forgot Password" to regain access immediately
2. Contact support if you cannot access your account
      `.trim(),
        html: renderBrandedLayout(
          'Password Changed',
          `
        <h2 style="${styles.heading}">Your Password Was Changed</h2>
        <p style="${styles.text}">Your account password was recently changed.</p>

        <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <h3 style="color: #374151; margin: 0 0 12px 0; font-size: 16px;">Details:</h3>
          <table style="color: #4b5563; font-size: 14px;">
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">Time:</td><td>${formattedDate}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">IP Address:</td><td>${ipAddress}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">Device/Browser:</td><td>${userAgent !== '' ? userAgent : 'Unknown'}</td></tr>
          </table>
        </div>

        <p style="${styles.text}"><strong>Was this you?</strong></p>
        <p style="${styles.text}">If yes, you can safely ignore this email.</p>
        <p style="${styles.alert}">If no, use "Forgot Password" to regain access immediately and contact support.</p>
        `,
        ),
      };
    },

    /**
     * Email changed "Was this you?" alert
     * Sent to the OLD email address after an email change.
     */
    emailChangedAlert(
      newEmail: string,
      ipAddress: string,
      userAgent: string,
      timestamp: Date,
      revertUrl?: string,
    ): EmailOptions & { to: '' } {
      const formattedDate = timestamp.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      const revertText =
        revertUrl !== undefined && revertUrl !== ''
          ? `\nIf this wasn't you, revert the change immediately:\n${revertUrl}\n`
          : '';
      const revertHtml =
        revertUrl !== undefined && revertUrl !== ''
          ? `
        <p style="${styles.alert}">
          If this wasn't you, revert the change immediately:
        </p>
        <p><a href="${revertUrl}" style="${styles.button}">Revert email change</a></p>
        `
          : '';

      return {
        to: '',
        subject: 'Your Email Address Was Changed',
        text: `
Your Email Address Was Changed

The email address on your account was recently changed to ${newEmail}.

Details:
- Time: ${formattedDate}
- IP Address: ${ipAddress}
- Device/Browser: ${userAgent !== '' ? userAgent : 'Unknown'}

Was this you?
If yes, you can ignore this email.

If no, your account may be compromised. Please contact support immediately to recover your account.
${revertText}
      `.trim(),
        html: renderBrandedLayout(
          'Email Changed',
          `
        <h2 style="${styles.heading}">Your Email Address Was Changed</h2>
        <p style="${styles.text}">The email address on your account was recently changed to <strong>${newEmail}</strong>.</p>

        <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <h3 style="color: #374151; margin: 0 0 12px 0; font-size: 16px;">Details:</h3>
          <table style="color: #4b5563; font-size: 14px;">
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">Time:</td><td>${formattedDate}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">IP Address:</td><td>${ipAddress}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">Device/Browser:</td><td>${userAgent !== '' ? userAgent : 'Unknown'}</td></tr>
          </table>
        </div>

        <p style="${styles.text}"><strong>Was this you?</strong></p>
        <p style="${styles.text}">If yes, you can safely ignore this email.</p>
        <p style="${styles.alert}">If no, your account may be compromised. Contact support immediately to recover your account.</p>
        ${revertHtml}
        `,
        ),
      };
    },

    /**
     * Token reuse security alert
     * Sent when a refresh token is used after it has already been rotated,
     * indicating a potential token theft/replay attack.
     */
    tokenReuseAlert(
      ipAddress: string,
      userAgent: string,
      timestamp: Date,
    ): EmailOptions & { to: '' } {
      const formattedTime = timestamp.toISOString();
      const formattedDate = timestamp.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      return {
        to: '',
        subject: 'Security Alert: Suspicious Activity on Your Account',
        text: `
SECURITY ALERT: Suspicious Activity Detected

We detected suspicious activity on your account that may indicate unauthorized access.

What happened:
- A previously used authentication token was reused, which is a sign of a potential security breach
- As a precaution, all your active sessions have been terminated

Details:
- Time: ${formattedDate}
- IP Address: ${ipAddress}
- Device/Browser: ${userAgent !== '' ? userAgent : 'Unknown'}

Recommended actions:
1. Change your password immediately
2. Enable two-factor authentication (2FA) if not already enabled
3. Review your recent account activity for any unauthorized actions
4. If you did not attempt to sign in, your credentials may have been compromised

If you recognize this activity, you can safely ignore this email and sign in again.

If you need assistance, please contact our support team immediately.
      `.trim(),
        html: renderBrandedLayout(
          'Security Alert',
          `
        <h2 style="${styles.heading}; color: #dc2626;">Security Alert: Suspicious Activity Detected</h2>
        <p style="${styles.text}">We detected suspicious activity on your account that may indicate unauthorized access.</p>

        <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <h3 style="color: #991b1b; margin: 0 0 12px 0; font-size: 16px;">What happened:</h3>
          <ul style="color: #7f1d1d; margin: 0; padding-left: 20px;">
            <li>A previously used authentication token was reused, which is a sign of a potential security breach</li>
            <li>As a precaution, <strong>all your active sessions have been terminated</strong></li>
          </ul>
        </div>

        <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <h3 style="color: #374151; margin: 0 0 12px 0; font-size: 16px;">Details:</h3>
          <table style="color: #4b5563; font-size: 14px;">
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">Time:</td><td>${formattedDate}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">IP Address:</td><td>${ipAddress}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; font-weight: 500;">Device/Browser:</td><td>${userAgent !== '' ? userAgent : 'Unknown'}</td></tr>
          </table>
          <p style="color: #6b7280; font-size: 12px; margin: 8px 0 0 0;">Timestamp: ${formattedTime}</p>
        </div>

        <h3 style="color: #374151; margin: 24px 0 12px 0; font-size: 16px;">Recommended actions:</h3>
        <ol style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
          <li><strong>Change your password immediately</strong></li>
          <li>Enable two-factor authentication (2FA) if not already enabled</li>
          <li>Review your recent account activity for any unauthorized actions</li>
          <li>If you did not attempt to sign in, your credentials may have been compromised</li>
        </ol>

        <p style="${styles.text}; margin-top: 24px;">If you recognize this activity, you can safely ignore this email and sign in again.</p>
        <p style="${styles.alert}">If you need assistance, please contact our support team immediately.</p>
        `,
        ),
      };
    },

    /**
     * Welcome email sent after successful email verification.
     * Includes greeting with name, brief product intro, and CTA to log in.
     */
    welcome(firstName: string, loginUrl: string): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: `Welcome to ${appName}!`,
        text: `
Hi ${firstName}, welcome to ${appName}!

Your email has been verified and your account is ready to go.

Your account includes secure authentication, profile settings, notifications, and billing-ready foundations.

Sign in to get started:
${loginUrl}

If you have any questions, reply to this email. We're happy to help.
      `.trim(),
        html: renderBrandedLayout(
          'Welcome',
          `
        <h2 style="${styles.heading}">Welcome to ${appName}!</h2>
        <p style="${styles.text}">Hi <strong>${firstName}</strong>, your email has been verified and your account is ready to go.</p>
        <p style="${styles.text}">Your account includes secure authentication, profile settings, notifications, and billing-ready foundations.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #16a34a;">
              <a href="${loginUrl}" target="_blank" style="${styles.buttonSuccess}">
                Get Started
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.footer}">If you have any questions, reply to this email. We're happy to help.</p>
        `,
        ),
      };
    },

    /**
     * Generic security notification email
     * Used for: password changed from new device, 2FA disabled, new device login, etc.
     */
    securityNotification(
      type: string,
      details: string,
      actionUrl: string,
    ): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: `Security Alert: ${type}`,
        text: `
Security Alert: ${type}

${details}

If this was you, no action is needed.

If you did not perform this action, please secure your account immediately:
${actionUrl}
      `.trim(),
        html: renderBrandedLayout(
          'Security Alert',
          `
        <h2 style="${styles.heading}">Security Alert: ${type}</h2>
        <p style="${styles.text}">${details}</p>

        <div style="background-color: #fef3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="color: #856404; margin: 0;">If this was you, no action is needed.</p>
        </div>

        <p style="${styles.alert}">If you did not perform this action, please secure your account immediately:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #0066cc;">
              <a href="${actionUrl}" target="_blank" style="${styles.button}">
                Secure My Account
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.footer}">If you need help, please contact our support team.</p>
        `,
        ),
      };
    },

    /**
     * Subscription created/activated confirmation.
     */
    subscriptionCreated(planName: string, manageUrl: string): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: `Your ${planName} subscription is active`,
        text: `
Your subscription to the ${planName} plan is now active.

Manage your subscription, payment method, and invoices any time:
${manageUrl}

Thank you for your support.
      `.trim(),
        html: renderBrandedLayout(
          'Subscription Active',
          `
        <h2 style="${styles.heading}">You're all set</h2>
        <p style="${styles.text}">Your subscription to the <strong>${planName}</strong> plan is now active.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #0066cc;">
              <a href="${manageUrl}" target="_blank" style="${styles.button}">
                Manage Subscription
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.subtext}">Thank you for your support.</p>
        `,
        ),
      };
    },

    /**
     * Subscription canceled — access continues until the period ends.
     */
    subscriptionCanceled(
      planName: string,
      accessUntil: string,
      resubscribeUrl: string,
    ): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: `Your ${planName} subscription has been canceled`,
        text: `
Your ${planName} subscription has been canceled.

You'll keep access until ${accessUntil}. After that, your plan reverts to the free tier.

Changed your mind? You can resubscribe any time:
${resubscribeUrl}
      `.trim(),
        html: renderBrandedLayout(
          'Subscription Canceled',
          `
        <h2 style="${styles.heading}">Subscription Canceled</h2>
        <p style="${styles.text}">Your <strong>${planName}</strong> subscription has been canceled.</p>
        <p style="${styles.text}">You'll keep access until <strong>${accessUntil}</strong>. After that, your plan reverts to the free tier.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #0066cc;">
              <a href="${resubscribeUrl}" target="_blank" style="${styles.button}">
                Resubscribe
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.subtext}">Changed your mind? You can resubscribe any time.</p>
        `,
        ),
      };
    },

    /**
     * Payment failed — prompt to update the payment method within the grace window.
     */
    paymentFailed(amount: string, updateUrl: string): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: 'Payment failed - action required',
        text: `
We were unable to process your payment of ${amount}.

Please update your payment method to avoid service interruption. Your account remains active during a 14-day grace period.

Update your payment method:
${updateUrl}
      `.trim(),
        html: renderBrandedLayout(
          'Payment Failed',
          `
        <h2 style="${styles.heading}">Payment Failed</h2>
        <p style="${styles.text}">We were unable to process your payment of <strong>${amount}</strong>.</p>
        <p style="${styles.text}">Please update your payment method to avoid service interruption.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #0066cc;">
              <a href="${updateUrl}" target="_blank" style="${styles.button}">
                Update Payment Method
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.alert}">Your account remains active during a 14-day grace period.</p>
        `,
        ),
      };
    },

    /**
     * Payment receipt — confirms a successful charge.
     */
    paymentSucceeded(amount: string, invoiceUrl: string): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: `Payment received - ${amount}`,
        text: `
We've received your payment of ${amount}. Thank you!

View your invoice:
${invoiceUrl}
      `.trim(),
        html: renderBrandedLayout(
          'Payment Received',
          `
        <h2 style="${styles.heading}">Payment Received</h2>
        <p style="${styles.text}">We've received your payment of <strong>${amount}</strong>. Thank you!</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #16a34a;">
              <a href="${invoiceUrl}" target="_blank" style="${styles.buttonSuccess}">
                View Invoice
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.subtext}">Keep this email for your records.</p>
        `,
        ),
      };
    },

    /**
     * Payment recovered — a past-due payment succeeded and the subscription is active again.
     */
    paymentRecovered(updateUrl: string): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: 'Payment successful - subscription restored',
        text: `
Good news — your payment went through and your subscription is active again.

All features are fully available. Manage your billing any time:
${updateUrl}
      `.trim(),
        html: renderBrandedLayout(
          'Subscription Restored',
          `
        <h2 style="${styles.heading}">Subscription Restored</h2>
        <p style="${styles.text}">Good news — your payment went through and your subscription is <strong>active again</strong>.</p>
        <p style="${styles.text}">All features are fully available.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #16a34a;">
              <a href="${updateUrl}" target="_blank" style="${styles.buttonSuccess}">
                Manage Billing
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.subtext}">Thank you for your continued support.</p>
        `,
        ),
      };
    },

    /**
     * Account suspended — the subscription was canceled after the grace period lapsed.
     */
    accountSuspended(reason: string, resubscribeUrl: string): EmailOptions & { to: '' } {
      return {
        to: '',
        subject: 'Account suspended - subscription canceled',
        text: `
Your subscription has been canceled due to non-payment (${reason}).

Your account has been downgraded to the free tier. To restore your subscription, update your payment method and re-subscribe:
${resubscribeUrl}
      `.trim(),
        html: renderBrandedLayout(
          'Account Suspended',
          `
        <h2 style="${styles.heading}">Account Suspended</h2>
        <p style="${styles.text}">Your subscription has been <strong>canceled</strong> due to non-payment (${reason}).</p>
        <p style="${styles.text}">Your account has been downgraded to the free tier.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #0066cc;">
              <a href="${resubscribeUrl}" target="_blank" style="${styles.button}">
                Re-subscribe
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.alert}">If you believe this is an error, contact support.</p>
        `,
        ),
      };
    },

    /**
     * Workspace invitation — invites a person to join a tenant/organization.
     * Workspace, inviter, and role are user-controlled text and MUST stay escaped.
     */
    workspaceInvitation(
      acceptUrl: string,
      workspaceName: string,
      inviterName: string,
      role: string,
      expiresInDays = 7,
    ): EmailOptions & { to: '' } {
      const safeWorkspace = escapeHtml(workspaceName);
      const safeInviter = escapeHtml(inviterName);
      const safeRole = escapeHtml(role);
      const expiry = String(expiresInDays);
      return {
        to: '',
        subject: `You're invited to join ${workspaceName} on ${appName}`,
        text: `
${inviterName} invited you to join ${workspaceName} as ${role}.

Accept the invitation:
${acceptUrl}

This invitation expires in ${expiry} days.

If you were not expecting this invitation, you can ignore this email.
      `.trim(),
        html: renderBrandedLayout(
          'Workspace Invitation',
          `
        <h2 style="${styles.heading}">You're invited to join ${safeWorkspace}</h2>
        <p style="${styles.text}"><strong>${safeInviter}</strong> invited you to join <strong>${safeWorkspace}</strong> as <strong>${safeRole}</strong>.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="border-radius: 6px; background-color: #0066cc;">
              <a href="${acceptUrl}" target="_blank" style="${styles.button}">
                Accept Invitation
              </a>
            </td>
          </tr>
        </table>
        <p style="${styles.subtext}">This invitation expires in ${expiry} days.</p>
        <p style="${styles.footer}">If you were not expecting this invitation, you can ignore this email.</p>
        `,
        ),
      };
    },
  };
}

export const emailTemplates = createEmailTemplates();
