// main/apps/web/src/features/content/pages/ContentPages.tsx
/**
 * The file-owned legal pages: Cookie Policy, Acceptable Use, Disclaimer.
 *
 * Each renders its Markdown document from docs/legal/, imported with `?raw` so
 * the prose ships in the bundle and prerenders fully at build time — no API,
 * no loading state, no empty state. Terms and Privacy are deliberately NOT
 * here: the ToS acceptance gate keys on their DB version numbers, so they stay
 * published from the database (LegalDocumentPage).
 *
 * Each document carries its own `#` heading, so no `title` is passed — the
 * badge mirrors the meta row of the DB-backed legal pages.
 */

import acceptableUseDoc from '../../../../../../../docs/legal/acceptable-use.md?raw';
import cookiePolicyDoc from '../../../../../../../docs/legal/cookie-policy.md?raw';
import disclaimerDoc from '../../../../../../../docs/legal/disclaimer.md?raw';
import { DocumentPage } from '../components/DocumentPage';

import type { ReactElement } from 'react';

export function CookiePolicyPage(): ReactElement {
  return <DocumentPage body={cookiePolicyDoc} badge="Cookies" />;
}

export function AcceptableUsePage(): ReactElement {
  return <DocumentPage body={acceptableUseDoc} badge="Acceptable use" />;
}

export function DisclaimerPage(): ReactElement {
  return <DocumentPage body={disclaimerDoc} badge="Disclaimer" />;
}
