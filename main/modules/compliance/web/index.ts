// main/modules/compliance/web/index.ts
import { implementWeb, lazyModulePage } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';
import { complianceModule } from '../module';

export { AnonymousDoNotSellControl } from './AnonymousDoNotSellControl';
export {
  ConsentPreferences,
  CookieConsentBanner,
  DataControlsSection,
  DataExportSection,
  DoNotSellControl,
  LegalDocumentsSection,
  type CookieConsentBannerProps,
  type DataControlsSectionProps,
  type DataExportSectionProps,
  type DoNotSellControlProps,
} from './ComplianceSettings';
export {
  consentAllows,
  loadConsentedScript,
  resetConsentedScripts,
  type ConsentedScriptOptions,
} from './consent/gate';
export {
  CONSENT_CATEGORIES,
  CONSENT_STATUSES,
  consentDecisionSchema,
  fromServerConsent,
  toServerConsent,
  type ConsentCategory,
  type ConsentDecision,
  type ConsentStatus,
  type ConsentStatuses,
  type ServerConsentInput,
  type ServerConsentPreferences,
} from './consent/model';
export {
  CONSENT_STORAGE_KEY,
  honourGlobalPrivacyControl,
  hydrateConsent,
  readConsent,
  readGlobalPrivacyControl,
  resetConsentCache,
  startConsentSync,
  subscribeConsent,
  writeConsent,
} from './consent/store';
export { fillDocument, OPERATOR } from './document';
export { compliancePublicRoutes } from './public-routes';
export { TosAcceptanceModal, type TosAcceptanceModalProps } from './TosAcceptanceModal';
export {
  useAcceptTos,
  useConsent,
  useCurrentLegal,
  useDataExport,
  usePublishLegal,
  useTosStatus,
  useUpdateConsent,
  useUserAgreements,
  type ExportStatus,
  type UpdateConsentInput,
  type UseDataExportResult,
} from './hooks';

export const complianceWeb = implementWeb(complianceModule, {
  routes: [
    {
      path: '/terms',
      shell: 'public',
      auth: 'public',
      page: lazyModulePage(() => import('./LegalDocumentPage'), 'TermsPage'),
      title: 'compliance.termsTitle',
    },
    {
      path: '/terms-of-service',
      shell: 'public',
      auth: 'public',
      page: lazyModulePage(() => import('./LegalDocumentPage'), 'TermsPage'),
      title: 'compliance.termsTitle',
      unlisted: true,
    },
    {
      path: '/privacy',
      shell: 'public',
      auth: 'public',
      page: lazyModulePage(() => import('./LegalDocumentPage'), 'PrivacyPolicyPage'),
      title: 'compliance.privacyTitle',
    },
    {
      path: '/privacy-policy',
      shell: 'public',
      auth: 'public',
      page: lazyModulePage(() => import('./LegalDocumentPage'), 'PrivacyPolicyPage'),
      title: 'compliance.privacyTitle',
      unlisted: true,
    },
    {
      path: '/cookies',
      shell: 'public',
      auth: 'public',
      page: lazyModulePage(() => import('./ContentPages'), 'CookiePolicyPage'),
      title: 'compliance.cookiesTitle',
    },
    {
      path: '/cookie-policy',
      shell: 'public',
      auth: 'public',
      page: lazyModulePage(() => import('./ContentPages'), 'CookiePolicyPage'),
      title: 'compliance.cookiesTitle',
      unlisted: true,
    },
    {
      path: '/acceptable-use',
      shell: 'public',
      auth: 'public',
      page: lazyModulePage(() => import('./ContentPages'), 'AcceptableUsePage'),
      title: 'compliance.acceptableUseTitle',
    },
    {
      path: '/disclaimer',
      shell: 'public',
      auth: 'public',
      page: lazyModulePage(() => import('./ContentPages'), 'DisclaimerPage'),
      title: 'compliance.disclaimerTitle',
    },
    {
      path: '/admin/legal',
      shell: 'console',
      auth: 'admin',
      page: lazyModulePage(() => import('./LegalDocumentsPage'), 'LegalDocumentsPage'),
      title: 'compliance.adminTitle',
    },
    {
      path: '/admin/compliance',
      shell: 'console',
      auth: 'admin',
      page: lazyModulePage(() => import('./ComplianceAdminPage'), 'ComplianceAdminPage'),
      title: 'compliance.adminComplianceTitle',
    },
  ],
  settings: [
    {
      id: 'data-controls',
      label: 'compliance.settings.dataControlsNav',
      kind: 'section',
      aliases: ['data', 'privacy'],
      order: 70,
    },
    {
      id: 'legal',
      label: 'compliance.settings.legalNav',
      kind: 'section',
      order: 100,
    },
  ],
  admin: [
    {
      id: 'legal',
      label: 'compliance.adminNav',
      href: '/admin/legal',
      routePath: 'legal',
      order: 130,
    },
    {
      id: 'compliance',
      label: 'compliance.adminComplianceNav',
      href: '/admin/compliance',
      routePath: 'compliance',
      order: 132,
    },
  ],
  sitePages: [
    {
      path: '/terms',
      title: 'compliance.termsTitle',
      description: 'compliance.termsDescription',
      section: 'legal',
      document: 'terms_of_service',
      live: true,
      order: 20,
    },
    {
      path: '/privacy',
      title: 'compliance.privacyTitle',
      description: 'compliance.privacyDescription',
      section: 'legal',
      document: 'privacy_policy',
      live: true,
      order: 30,
    },
    {
      path: '/cookies',
      title: 'compliance.cookiesTitle',
      description: 'compliance.cookiesDescription',
      section: 'legal',
      live: true,
      order: 40,
    },
    {
      path: '/acceptable-use',
      title: 'compliance.acceptableUseTitle',
      description: 'compliance.acceptableUseDescription',
      section: 'legal',
      live: true,
      order: 50,
    },
    {
      path: '/disclaimer',
      title: 'compliance.disclaimerTitle',
      section: 'legal',
      live: true,
      order: 60,
    },
  ],
  messages: enUsMessages,
  locales: {
    'ko-KR': () => import('../i18n/ko-KR.json'),
  },
});
