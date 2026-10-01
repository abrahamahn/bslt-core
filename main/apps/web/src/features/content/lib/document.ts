// main/apps/web/src/features/content/lib/document.ts
/**
 * Document placeholders.
 *
 * The documents under docs/legal/ carry `[[COMPANY_NAME]]`-style tokens rather
 * than the values themselves, so each operator fact lives in exactly ONE place
 * and changing it is a one-line edit here rather than a hunt through the prose.
 *
 * A placeholder must never reach a reader. An unfilled one renders as a
 * visible gap — "[pending]" — because a page that shows raw `[[…]]` markup
 * reads as broken, and one that silently shows nothing reads as if the fact
 * were deliberately withheld.
 */

/**
 * The operator facts the documents cite. One edit swaps a value everywhere.
 *
 * CONTACT_EMAIL is the operator's personal address for now — no product
 * mailbox exists yet. Replace it here, and only here, when one does.
 */
export const OPERATOR: Readonly<Record<string, string>> = {
  COMPANY_NAME: 'BSLT',
  CONTACT_EMAIL: 'abeahn@engineering.upenn.edu',
  EFFECTIVE_DATE: 'July 15, 2026',
};

/**
 * Replace every `[[TOKEN]]` with its value. Unknown tokens become a visible
 * gap.
 *
 * The body of a token may run over several lines — drafts carry
 * `[[TODO: … ]]` notes that wrap — so this matches lazily across newlines
 * rather than stopping at the first line break, which would leave the tail of
 * the note on the page.
 */
export function fillDocument(body: string): string {
  return body.replace(
    /\[\[([A-Z_]+)[\s\S]*?\]\]/g,
    (_match, token: string) => OPERATOR[token] ?? '[pending]',
  );
}
