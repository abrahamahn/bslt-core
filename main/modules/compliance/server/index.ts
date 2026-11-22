// main/modules/compliance/server/index.ts
import { implementServer, type AnyServerModule } from '@bslt/server-system/module';

import { complianceModule } from '../module';

import { createComplianceService } from './service';

export { complianceRepository, type ComplianceRepository } from './repository';
export { createAttestationAgeAssuranceProvider, type AgeAssuranceProvider } from './age-assurance';
export { createDefaultJurisdictionResolver, type JurisdictionResolver } from './jurisdiction';

export const complianceServer: AnyServerModule<typeof complianceModule> = implementServer(
  complianceModule,
  {
    migrations: new URL('./migrations', import.meta.url),
    create: (k) => createComplianceService(k),
    api: (s) => s.toApi(),
    context: (s, viewer, req) => s.resolveContext(viewer, req),
    handlers: {
      getTosStatus: (_input, req, s) => s.getTosStatus(req),
      acceptTos: (input, req, s) => s.acceptTos(input.body, req),
      getCurrentLegal: (_input, _req, s) => s.getCurrentLegal(),
      getUserAgreements: (_input, req, s) => s.getUserAgreements(req),
      publishLegal: (input, req, s) => s.publishLegal(input.body, req),
      getConsentPreferences: (_input, req, s) => s.getConsentPreferences(req),
      updateConsentPreferences: (input, req, s) => s.updateConsentPreferences(input.body, req),
      requestDataExport: (input, req, s) => s.requestDataExport(input.body, req),
      getDataExportStatus: (input, req, s) => s.getDataExportStatus(input.params.id, req),
      downloadDataExport: (input, req, s) => s.downloadDataExport(input.params.id, req),
      startAgeAssurance: (input, req, s) => s.startAgeAssurance(input.body, req),
      getAgeAssuranceStatus: (_input, req, s) => s.getAgeAssuranceStatus(req),
      placeLegalHold: (input, req, s) => s.placeLegalHold(input.body, req),
      listLegalHolds: (input, req, s) => s.listLegalHolds(input.query, req),
      releaseLegalHold: (input, req, s) => s.releaseLegalHold(input.params.id, req),
      upsertJurisdictionRule: (input, req, s) => s.upsertJurisdictionRule(input.body, req),
      eraseUserData: (input, req, s) => s.eraseUserData(input.params.userId, req),
    },
    jobs: {
      cleanupExpiredExports: (_payload, s) => s.cleanupExpiredExportsJob(),
    },
    cron: [
      {
        job: 'cleanupExpiredExports',
        schedule: '55 2 * * *',
        catchUp: false,
      },
    ],
    privacy: {
      exportUser: (s, userId) => s.exportUserPrivacy(userId),
      eraseUser: (s, tx, userId) => s.eraseUserPrivacy(tx, userId),
    },
    actions: {
      'compliance.peekSignupAgreements': (s, tx) => s.peekSignupAgreements(tx),
      'compliance.recordSignupConsents': (s, tx, input) => s.recordSignupConsents(tx, input),
    },
  },
);
