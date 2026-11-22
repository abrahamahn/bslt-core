// main/modules/compliance/web/public-routes.tsx
import {
  definePublicRoute,
  type AnonymousSdkForModules,
  type PublicRoute,
} from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';
import { complianceModule } from '../module';

import { AcceptableUsePage, CookiePolicyPage, DisclaimerPage } from './ContentPages';
import { PrivacyPolicyPage, TermsPage } from './LegalDocumentPage';

import type { LegalDocumentItem } from '../contract';

type ComplianceAnonymousSdk = AnonymousSdkForModules<readonly [typeof complianceModule]>;

interface LegalPublicData {
  readonly documents: readonly LegalDocumentItem[] | null;
}

async function loadCurrentLegalOrNull(sdk: ComplianceAnonymousSdk): Promise<LegalPublicData> {
  try {
    const res = await sdk.compliance.getCurrentLegal();
    return { documents: res.documents };
  } catch {
    return { documents: null };
  }
}

export const compliancePublicRoutes: readonly PublicRoute<unknown, ComplianceAnonymousSdk>[] = [
  definePublicRoute<LegalPublicData, ComplianceAnonymousSdk>({
    path: '/terms',
    cacheSeconds: 60,
    load: ({ sdk }) => loadCurrentLegalOrNull(sdk),
    head: (data) => {
      const doc = data.documents?.find((d) => d.type === 'terms_of_service');
      return {
        title: doc?.title ?? enUsMessages['compliance.termsTitle'],
        description: enUsMessages['compliance.termsDescription'],
      };
    },
    Component: () => <TermsPage />,
  }),
  definePublicRoute<LegalPublicData, ComplianceAnonymousSdk>({
    path: '/privacy',
    cacheSeconds: 60,
    load: ({ sdk }) => loadCurrentLegalOrNull(sdk),
    head: (data) => {
      const doc = data.documents?.find((d) => d.type === 'privacy_policy');
      return {
        title: doc?.title ?? enUsMessages['compliance.privacyTitle'],
        description: enUsMessages['compliance.privacyDescription'],
      };
    },
    Component: () => <PrivacyPolicyPage />,
  }),
  definePublicRoute<Record<string, never>, ComplianceAnonymousSdk>({
    path: '/cookies',
    cacheSeconds: Infinity,
    load: () => Promise.resolve({}),
    head: () => ({
      title: enUsMessages['compliance.cookiesTitle'],
      description: enUsMessages['compliance.cookiesDescription'],
    }),
    Component: () => <CookiePolicyPage />,
  }),
  definePublicRoute<Record<string, never>, ComplianceAnonymousSdk>({
    path: '/acceptable-use',
    cacheSeconds: Infinity,
    load: () => Promise.resolve({}),
    head: () => ({
      title: enUsMessages['compliance.acceptableUseTitle'],
      description: enUsMessages['compliance.acceptableUseDescription'],
    }),
    Component: () => <AcceptableUsePage />,
  }),
  definePublicRoute<Record<string, never>, ComplianceAnonymousSdk>({
    path: '/disclaimer',
    cacheSeconds: Infinity,
    load: () => Promise.resolve({}),
    head: () => ({
      title: enUsMessages['compliance.disclaimerTitle'],
    }),
    Component: () => <DisclaimerPage />,
  }),
];
