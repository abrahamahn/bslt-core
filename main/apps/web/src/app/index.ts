// main/apps/web/src/app/index.ts
export type { ClientConfig } from '#app/config';
export { App } from './App';
export { AppShell, AuthShell, ConsoleShell, PublicShell, SiteFooter } from './shells';
export { ClientEnvironmentProvider, useClientEnvironment } from './ClientEnvironment';
export type { ClientEnvironment } from './ClientEnvironment';
export { PRODUCT_TAGLINE, SITE_MAP, SITE_SECTIONS, livePages, liveSiteSections } from './siteMap';
export type { SitePage, SiteSection, SiteSectionId } from './siteMap';
