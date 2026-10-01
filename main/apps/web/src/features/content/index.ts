// main/apps/web/src/features/content/index.ts
/**
 * Content Feature
 *
 * The reading surface for file-owned documents: markdown under docs/legal/,
 * imported with `?raw`, filled by `fillDocument`, rendered by `DocumentPage`.
 * Terms and Privacy stay DB-owned (LegalDocumentPage); everything else static.
 */

export { DocumentPage, type DocumentPageProps } from './components/DocumentPage';
export { fillDocument, OPERATOR } from './lib/document';
export { AcceptableUsePage, CookiePolicyPage, DisclaimerPage } from './pages';
