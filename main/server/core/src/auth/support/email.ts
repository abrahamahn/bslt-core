// main/server/core/src/auth/support/email.ts
import type { EmailOptions } from '@bslt/shared/contracts';

/**
 * Build EmailOptions from template output without leaking `undefined`
 * into exact-optional-property call sites.
 */
export function buildEmailOptions(
  to: string,
  template: {
    readonly subject: string;
    readonly html?: string | undefined;
    readonly text?: string | undefined;
  },
): EmailOptions {
  const options: EmailOptions = { to, subject: template.subject };

  if (template.html !== undefined) {
    options.html = template.html;
  }
  if (template.text !== undefined) {
    options.text = template.text;
  }

  return options;
}
