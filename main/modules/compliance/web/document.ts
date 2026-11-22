// main/modules/compliance/web/document.ts
/**
 * Document placeholders for file-owned legal seeds (`main/modules/compliance/seeds/legal/*.md`).
 *
 * Unknown tokens render as `[pending]` rather than leaking raw `[[...]]` markup
 * or silently disappearing.
 */

export const OPERATOR: Readonly<Record<string, string>> = {
  COMPANY_NAME: 'BSLT',
  CONTACT_EMAIL: 'abeahn@engineering.upenn.edu',
  EFFECTIVE_DATE: 'July 15, 2026',
};

export function fillDocument(body: string): string {
  return body.replace(
    /\[\[([A-Z_]+)[\s\S]*?\]\]/g,
    (_match, token: string) => OPERATOR[token] ?? '[pending]',
  );
}
