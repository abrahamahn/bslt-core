// main/modules/compliance/server/service.ts
import {
  AGE_ASSURANCE_METHODS,
  CONSENT_TYPES,
  DEFAULT_MINIMUM_SIGNUP_AGE,
  PUBLISHABLE_DOCUMENT_TYPES,
  SIGNUP_AGREEMENT_DOCUMENT_TYPES,
  complianceEvents,
  type AcceptTosBody,
  type AcceptTosResponse,
  type AgeAssuranceCheckItem,
  type AgeAssuranceMethod,
  type AgeAssuranceStatusResponse,
  type ComplianceEnv,
  type ConsentPreferencesPayload,
  type ConsentPreferencesUpdateResponse,
  type CurrentLegalResponse,
  type DataExportDownloadResponse,
  type DataExportFormat,
  type DataExportRequestItem,
  type DataExportRequestResponse,
  type JurisdictionRuleItem,
  type LegalDocumentItem,
  type LegalHoldItem,
  type ListLegalHoldsQuery,
  type PlaceLegalHoldBody,
  type PublishLegalDocumentBody,
  type PublishLegalDocumentResponse,
  type RequestDataExportBody,
  type StartAgeAssuranceBody,
  type TosStatusResponse,
  type UpdateConsentPreferencesBody,
  type UpsertJurisdictionRuleBody,
  type UserAgreementItem,
  type UserAgreementsResponse,
} from '../contract';

import { createAttestationAgeAssuranceProvider, type AgeAssuranceProvider } from './age-assurance';
import { createDefaultJurisdictionResolver, type JurisdictionResolver } from './jurisdiction';
import { complianceRepository, type ComplianceRepository } from './repository';
import { serializeUserDataExport, type UserDataExport } from './serialize';

import type {
  ComplianceAgeAssuranceChecksRow,
  ComplianceConsentsRow,
  ComplianceDataRequestsRow,
  ComplianceJurisdictionRulesRow,
  ComplianceLegalDocumentsRow,
  ComplianceLegalHoldsRow,
} from './generated/rows';
import type { CapabilityContribution, Viewer } from '@bslt/contract';
import type { RawDb } from '@bslt/db';
import type {
  ContextRequestMetadata,
  KernelServices,
  RequestContext,
  Tx,
} from '@bslt/server-system/module';

const TOS_DOCUMENT_TYPE = 'terms_of_service';

function toDataExportFormat(value: string | undefined): DataExportFormat {
  return value === 'csv' ? 'csv' : 'json';
}

function formatLegalDoc(doc: ComplianceLegalDocumentsRow): LegalDocumentItem {
  return {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    content: doc.content,
    version: doc.version,
    effectiveAt: doc.effectiveAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
  };
}

function formatAgreement(row: ComplianceConsentsRow): UserAgreementItem {
  return {
    id: row.id,
    userId: row.userId,
    documentId: row.documentId ?? '',
    agreedAt: row.createdAt.toISOString(),
    ipAddress: row.ipAddress,
  };
}

function formatExportRequest(row: ComplianceDataRequestsRow): DataExportRequestItem {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    status: row.status,
    format: row.format,
    downloadUrl: row.downloadUrl,
    expiresAt: row.expiresAt !== null ? row.expiresAt.toISOString() : null,
    completedAt: row.completedAt !== null ? row.completedAt.toISOString() : null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatAgeCheck(row: ComplianceAgeAssuranceChecksRow): AgeAssuranceCheckItem {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    method: row.method,
    threshold: row.threshold,
    resultOverThreshold: row.resultOverThreshold,
    assuranceLevel: row.assuranceLevel,
    jurisdiction: row.jurisdiction,
    providerRef: row.providerRef,
    checkedAt: row.checkedAt.toISOString(),
    expiresAt: row.expiresAt !== null ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatLegalHold(row: ComplianceLegalHoldsRow): LegalHoldItem {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    reason: row.reason,
    createdByUserId: row.createdByUserId,
    heldUntil: row.heldUntil !== null ? row.heldUntil.toISOString() : null,
    releasedAt: row.releasedAt !== null ? row.releasedAt.toISOString() : null,
    releasedByUserId: row.releasedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatJurisdictionRule(row: ComplianceJurisdictionRulesRow): JurisdictionRuleItem {
  const validMethods = new Set<string>(AGE_ASSURANCE_METHODS);
  const allowedMethods = row.allowedMethods.filter((m): m is AgeAssuranceMethod =>
    validMethods.has(m),
  );
  return {
    jurisdiction: row.jurisdiction,
    minimumAge: row.minimumAge,
    requiresAgeAssurance: row.requiresAgeAssurance,
    allowedMethods: allowedMethods.length > 0 ? allowedMethods : ['attestation'],
    serviceAvailable: row.serviceAvailable,
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface ComplianceServiceKernel {
  readonly db: KernelServices['db'];
  readonly jobs: KernelServices['jobs'];
  readonly events: KernelServices['events'];
  readonly privacy?: KernelServices['privacy'] | undefined;
  readonly log: KernelServices['log'];
  readonly clock: KernelServices['clock'];
  readonly env: ComplianceEnv | undefined;
}

interface ComplianceServiceOptions {
  readonly repoFactory?: ((db: RawDb) => ComplianceRepository) | undefined;
  readonly ageAssuranceProvider?: AgeAssuranceProvider | undefined;
  readonly jurisdictionResolver?: JurisdictionResolver | undefined;
}

interface ComplianceModuleApi {
  readonly minimumSignupAge: number;
  hasActiveLegalHold(
    subjectType: 'user' | 'org' | 'file' | 'case' | 'other',
    subjectId: string,
  ): Promise<boolean>;
  eraseUserAcrossModules(
    tx: Tx,
    userId: string,
  ): Promise<{ readonly erasedModules: readonly string[] }>;
}

interface SignupAgreementSummary {
  readonly id: string;
  readonly type: string;
  readonly version: number;
}

interface ComplianceService {
  readonly minimumSignupAge: number;
  resolveContext(
    viewer: Viewer | null,
    req?: ContextRequestMetadata,
  ): Promise<CapabilityContribution>;
  getTosStatus(req: RequestContext<readonly string[], 'user'>): Promise<TosStatusResponse>;
  acceptTos(
    body: AcceptTosBody,
    req: RequestContext<readonly string[], 'user'>,
  ): Promise<AcceptTosResponse>;
  peekSignupAgreements(tx: Tx): Promise<readonly SignupAgreementSummary[]>;
  recordSignupConsents(tx: Tx, input: unknown): Promise<void>;
  getCurrentLegal(): Promise<CurrentLegalResponse>;
  getUserAgreements(
    req: RequestContext<readonly string[], 'user'>,
  ): Promise<UserAgreementsResponse>;
  publishLegal(
    body: PublishLegalDocumentBody,
    req: RequestContext<readonly string[], 'admin'>,
  ): Promise<PublishLegalDocumentResponse>;
  getConsentPreferences(
    req: RequestContext<readonly string[], 'user'>,
  ): Promise<ConsentPreferencesPayload>;
  updateConsentPreferences(
    body: UpdateConsentPreferencesBody,
    req: RequestContext<readonly string[], 'user'>,
  ): Promise<ConsentPreferencesUpdateResponse>;
  requestDataExport(
    body: RequestDataExportBody,
    req: RequestContext<readonly string[], 'user'>,
  ): Promise<DataExportRequestResponse>;
  getDataExportStatus(
    id: string,
    req: RequestContext<readonly string[], 'user'>,
  ): Promise<DataExportRequestResponse>;
  downloadDataExport(
    id: string,
    req: RequestContext<readonly string[], 'user'>,
  ): Promise<DataExportDownloadResponse>;
  startAgeAssurance(
    body: StartAgeAssuranceBody,
    req: RequestContext<readonly string[], 'user'>,
  ): Promise<{ readonly check: AgeAssuranceCheckItem }>;
  getAgeAssuranceStatus(
    req: RequestContext<readonly string[], 'user'>,
  ): Promise<AgeAssuranceStatusResponse>;
  placeLegalHold(
    body: PlaceLegalHoldBody,
    req: RequestContext<readonly string[], 'admin'>,
  ): Promise<{ readonly hold: LegalHoldItem }>;
  listLegalHolds(
    query: ListLegalHoldsQuery,
    req: RequestContext<readonly string[], 'admin'>,
  ): Promise<{ readonly holds: LegalHoldItem[] }>;
  releaseLegalHold(
    id: string,
    req: RequestContext<readonly string[], 'admin'>,
  ): Promise<{ readonly hold: LegalHoldItem }>;
  upsertJurisdictionRule(
    body: UpsertJurisdictionRuleBody,
    req: RequestContext<readonly string[], 'admin'>,
  ): Promise<{ readonly rule: JurisdictionRuleItem }>;
  eraseUserData(
    userId: string,
    req: RequestContext<readonly string[], 'admin'>,
  ): Promise<{ readonly userId: string; readonly erasedModules: string[] }>;
  cleanupExpiredExportsJob(): Promise<void>;
  exportUserPrivacy(userId: string): Promise<Readonly<Record<string, unknown>>>;
  eraseUserPrivacy(tx: Tx, userId: string): Promise<void>;
  toApi(): ComplianceModuleApi;
}

export function createComplianceService(
  k: ComplianceServiceKernel,
  options: ComplianceServiceOptions = {},
): ComplianceService {
  const repoOf = options.repoFactory ?? complianceRepository;
  const minimumSignupAge = k.env?.COMPLIANCE_MINIMUM_SIGNUP_AGE ?? DEFAULT_MINIMUM_SIGNUP_AGE;
  const ageProvider =
    options.ageAssuranceProvider ?? createAttestationAgeAssuranceProvider(() => k.clock.now());
  const jurisdictionResolver =
    options.jurisdictionResolver ??
    createDefaultJurisdictionResolver(k.env?.COMPLIANCE_DEFAULT_JURISDICTION);

  async function buildAggregatedExport(
    userId: string,
    format: DataExportFormat,
  ): Promise<UserDataExport> {
    const { snapshot, consents, moduleExports } = await k.db.system(async (tx) => {
      const repo = repoOf(tx);
      const snap = await repo.readUserExportSnapshot(userId);
      const userConsents = await repo.listConsentsByUserId(userId);
      const modData = k.privacy !== undefined ? await k.privacy.exportUser(userId) : {};
      return { snapshot: snap, consents: userConsents, moduleExports: modData };
    });

    if (snapshot.profile === null) {
      throw new Error(`User not found: ${userId}`);
    }

    const auditMod = moduleExports['audit'];
    const filesMod = moduleExports['files'];
    const notifMod = moduleExports['notifications'];

    const activities = Array.isArray(auditMod?.['activities'])
      ? (auditMod['activities'] as ReadonlyArray<Readonly<Record<string, unknown>>>)
      : [];
    const files = Array.isArray(filesMod?.['files'])
      ? (filesMod['files'] as ReadonlyArray<Readonly<Record<string, unknown>>>)
      : [];
    const notifications = Array.isArray(notifMod?.['notifications'])
      ? (notifMod['notifications'] as ReadonlyArray<Readonly<Record<string, unknown>>>)
      : [];

    return {
      profile: {
        id: snapshot.profile.id,
        email: snapshot.profile.email,
        firstName: snapshot.profile.firstName,
        lastName: snapshot.profile.lastName,
        username: snapshot.profile.username,
        role: snapshot.profile.role,
        createdAt: snapshot.profile.createdAt,
      },
      memberships: snapshot.memberships,
      subscriptions: snapshot.subscriptions,
      activities,
      files,
      notifications,
      sessions: snapshot.sessions,
      consentHistory: consents.map((c) => ({
        consentType: c.consentType ?? '',
        granted: c.granted ?? false,
        createdAt: c.createdAt.toISOString(),
      })),
      modules: moduleExports,
      exportedAt: k.clock.now().toISOString(),
      format,
    };
  }

  return {
    minimumSignupAge,

    async resolveContext(
      viewer: Viewer | null,
      req?: ContextRequestMetadata,
    ): Promise<CapabilityContribution> {
      if (viewer === null) {
        const anonJurisdiction = jurisdictionResolver.resolve({ headers: req?.headers });
        return anonJurisdiction !== null ? { eligibility: { jurisdiction: anonJurisdiction } } : {};
      }

      return k.db.system(async (tx) => {
        const repo = repoOf(tx);
        const declaredCountry = await repo.findUserDeclaredCountry(viewer.userId);
        const jurisdiction = jurisdictionResolver.resolve({
          headers: req?.headers,
          declaredCountry,
        });
        const rule = jurisdiction !== null ? await repo.findJurisdictionRule(jurisdiction) : null;
        const effectiveMinAge = Math.max(minimumSignupAge, rule?.minimumAge ?? minimumSignupAge);

        const latestTos = await repo.findLatestLegalDocumentByType(TOS_DOCUMENT_TYPE);
        let tosAccepted = true;
        if (latestTos !== null) {
          const agreement = await repo.findAgreementByUserAndDocument(viewer.userId, latestTos.id);
          tosAccepted = agreement !== null;
        }

        const ageVerifiedFor = await repo.findMaxVerifiedAgeForUser(viewer.userId);

        return {
          eligibility: {
            tosAccepted,
            ageVerifiedFor,
            jurisdiction,
          },
          requirementDetails: {
            ...(!tosAccepted && latestTos !== null
              ? {
                  TOS_ACCEPTANCE_REQUIRED: {
                    documentId: latestTos.id,
                    requiredVersion: latestTos.version,
                  },
                }
              : {}),
            AGE_ASSURANCE_REQUIRED: {
              minimumAge: effectiveMinAge,
              jurisdiction,
            },
          },
        };
      });
    },

    async getTosStatus(req): Promise<TosStatusResponse> {
      return req.tx(async (tx) => {
        const repo = repoOf(tx);
        const latestTos = await repo.findLatestLegalDocumentByType(TOS_DOCUMENT_TYPE);
        if (latestTos === null) {
          return { accepted: true, requiredVersion: null, documentId: null };
        }
        const agreement = await repo.findAgreementByUserAndDocument(
          req.viewer.userId,
          latestTos.id,
        );
        return {
          accepted: agreement !== null,
          requiredVersion: latestTos.version,
          documentId: latestTos.id,
        };
      });
    },

    async acceptTos(body, req): Promise<AcceptTosResponse> {
      return req.tx(async (tx) => {
        const repo = repoOf(tx);
        const doc = await repo.findLegalDocumentById(body.documentId);
        if (doc === null) {
          req.fail('DOCUMENT_NOT_FOUND', 'Terms of Service document not found');
        }
        const agreement = await repo.recordAgreement({
          userId: req.viewer.userId,
          documentId: body.documentId,
          ipAddress: req.ip ?? null,
          userAgent: req.userAgent ?? null,
        });
        return { agreedAt: agreement.createdAt.toISOString() };
      });
    },

    async peekSignupAgreements(tx: Tx): Promise<readonly SignupAgreementSummary[]> {
      const latest = await repoOf(tx).findAllLatestLegalDocuments();
      return latest
        .filter((doc) => SIGNUP_AGREEMENT_DOCUMENT_TYPES.has(doc.type))
        .map((doc) => ({ id: doc.id, type: doc.type, version: doc.version }));
    },

    async recordSignupConsents(tx: Tx, input: unknown): Promise<void> {
      if (typeof input !== 'object' || input === null) {
        throw new Error('Invalid compliance.recordSignupConsents action input: expected object');
      }
      const record = input as {
        readonly userId?: unknown;
        readonly documentIds?: unknown;
        readonly ipAddress?: unknown;
        readonly userAgent?: unknown;
      };
      if (typeof record.userId !== 'string' || record.userId.trim().length === 0) {
        throw new Error('Invalid compliance.recordSignupConsents action input: userId required');
      }
      if (
        !Array.isArray(record.documentIds) ||
        !record.documentIds.every((id): id is string => typeof id === 'string' && id.length > 0)
      ) {
        throw new Error(
          'Invalid compliance.recordSignupConsents action input: documentIds must be string[]',
        );
      }
      const ipAddress = typeof record.ipAddress === 'string' ? record.ipAddress : null;
      const userAgent = typeof record.userAgent === 'string' ? record.userAgent : null;
      const repo = repoOf(tx);
      for (const documentId of record.documentIds) {
        await repo.recordAgreement({
          userId: record.userId,
          documentId,
          ipAddress,
          userAgent,
        });
      }
    },

    async getCurrentLegal(): Promise<CurrentLegalResponse> {
      const docs =
        k.db.viewer !== undefined
          ? await k.db.viewer(null, (tx) => repoOf(tx).findAllLatestLegalDocuments())
          : await k.db.system((tx) => repoOf(tx).findAllLatestLegalDocuments());
      return { documents: docs.map(formatLegalDoc) };
    },

    async getUserAgreements(req): Promise<UserAgreementsResponse> {
      return req.tx(async (tx) => {
        const rows = await repoOf(tx).listAgreementsByUserId(req.viewer.userId);
        return { agreements: rows.map(formatAgreement) };
      });
    },

    async publishLegal(body, req): Promise<PublishLegalDocumentResponse> {
      if (!PUBLISHABLE_DOCUMENT_TYPES.some((allowed) => allowed === body.type)) {
        req.fail(
          'DOCUMENT_TYPE_INVALID',
          `type '${body.type}' is invalid: publishable types are ${PUBLISHABLE_DOCUMENT_TYPES.join(', ')}`,
        );
      }

      return req.tx(async (tx) => {
        const repo = repoOf(tx);
        const latest = await repo.findLatestLegalDocumentByType(body.type);
        const nextVersion = latest !== null ? latest.version + 1 : 1;
        const created = await repo.insertLegalDocument({
          type: body.type,
          title: body.title,
          content: body.content,
          version: nextVersion,
          effectiveAt: new Date(body.effectiveAt),
        });
        await k.events.publish(
          tx,
          complianceEvents.legalDocumentPublished,
          {
            documentId: created.id,
            type: created.type,
            version: created.version,
            publishedByUserId: req.viewer.userId,
          },
          { actorUserId: req.viewer.userId },
        );
        return { document: formatLegalDoc(created) };
      });
    },

    async getConsentPreferences(req): Promise<ConsentPreferencesPayload> {
      return req.tx(async (tx) => {
        const repo = repoOf(tx);
        const preferences: Record<string, boolean | null> = {};
        for (const consentType of CONSENT_TYPES) {
          const latest = await repo.findLatestConsentByUserAndType(req.viewer.userId, consentType);
          preferences[consentType] = latest !== null ? latest.granted : null;
        }
        return { preferences };
      });
    },

    async updateConsentPreferences(body, req): Promise<ConsentPreferencesUpdateResponse> {
      const updates: Array<{ readonly type: string; readonly granted: boolean }> = [];
      if (body.analytics !== undefined) {
        updates.push({ type: 'analytics', granted: body.analytics });
      }
      if (body.marketing_email !== undefined) {
        updates.push({ type: 'marketing_email', granted: body.marketing_email });
      }
      if (body.third_party_sharing !== undefined) {
        updates.push({ type: 'third_party_sharing', granted: body.third_party_sharing });
      }
      if (body.profiling !== undefined) {
        updates.push({ type: 'profiling', granted: body.profiling });
      }
      if (updates.length === 0) {
        req.fail(
          'CONSENT_PREFERENCES_REQUIRED',
          'At least one consent preference must be specified',
        );
      }

      return req.tx(async (tx) => {
        const repo = repoOf(tx);
        for (const entry of updates) {
          await repo.recordConsent({
            userId: req.viewer.userId,
            consentType: entry.type,
            granted: entry.granted,
            ipAddress: req.ip ?? null,
            userAgent: req.userAgent ?? null,
            metadata: { updatedAt: k.clock.now().toISOString() },
          });
        }
        await k.events.publish(
          tx,
          complianceEvents.consentUpdated,
          {
            userId: req.viewer.userId,
            updated: updates.length,
          },
          { actorUserId: req.viewer.userId },
        );

        const preferences: Record<string, boolean | null> = {};
        for (const consentType of CONSENT_TYPES) {
          const latest = await repo.findLatestConsentByUserAndType(req.viewer.userId, consentType);
          preferences[consentType] = latest !== null ? latest.granted : null;
        }
        return { preferences, updated: updates.length };
      });
    },

    async requestDataExport(body, req): Promise<DataExportRequestResponse> {
      const format = toDataExportFormat(body.format);
      const created = await req.tx(async (tx) => {
        const repo = repoOf(tx);
        const existing = await repo.listDataRequestsByUserId(req.viewer.userId);
        const pending = existing.find((r) => r.status === 'pending' || r.status === 'processing');
        if (pending !== undefined) {
          req.fail(
            'DATA_EXPORT_ALREADY_PENDING',
            `User ${req.viewer.userId} already has a pending data export request`,
          );
        }
        const row = await repo.insertDataRequest({
          userId: req.viewer.userId,
          type: 'export',
          status: 'pending',
          format,
          metadata: { requestedAt: k.clock.now().toISOString() },
        });
        await k.events.publish(
          tx,
          complianceEvents.dataExportRequested,
          {
            requestId: row.id,
            userId: req.viewer.userId,
            format,
          },
          { actorUserId: req.viewer.userId },
        );
        return row;
      });

      try {
        const exportData = await buildAggregatedExport(req.viewer.userId, format);
        const updated = await req.tx((tx) =>
          repoOf(tx).updateDataRequest(created.id, {
            status: 'completed',
            completedAt: k.clock.now(),
            metadata: { exportedAt: exportData.exportedAt },
          }),
        );
        return { exportRequest: formatExportRequest(updated ?? created) };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Data export processing failed';
        k.log.warn(
          { err: err instanceof Error ? err : new Error(message) },
          'Data export processing failed',
        );
        const failed = await req.tx((tx) =>
          repoOf(tx).updateDataRequest(created.id, {
            status: 'failed',
            errorMessage: message,
          }),
        );
        return { exportRequest: formatExportRequest(failed ?? created) };
      }
    },

    async getDataExportStatus(id, req): Promise<DataExportRequestResponse> {
      return req.tx(async (tx) => {
        const row = await repoOf(tx).findDataRequestById(id);
        if (row === null || row.userId !== req.viewer.userId) {
          return req.fail('DATA_EXPORT_NOT_FOUND', `Data export request not found: ${id}`);
        }
        return { exportRequest: formatExportRequest(row) };
      });
    },

    async downloadDataExport(id, req): Promise<DataExportDownloadResponse> {
      const exportRequest = await req.tx(async (tx) => {
        const row = await repoOf(tx).findDataRequestById(id);
        if (row === null || row.userId !== req.viewer.userId) {
          return req.fail('DATA_EXPORT_NOT_FOUND', `Data export request not found: ${id}`);
        }
        return row;
      });

      if (exportRequest.status !== 'completed') {
        req.fail('DATA_EXPORT_NOT_READY', 'Data export is not ready for download');
      }
      if (exportRequest.expiresAt !== null && exportRequest.expiresAt <= k.clock.now()) {
        req.fail('DATA_EXPORT_EXPIRED', 'Data export has expired; request a new export');
      }

      const format = toDataExportFormat(exportRequest.format);
      const data = await buildAggregatedExport(req.viewer.userId, format);
      if (format === 'csv') {
        const { body, contentType, extension } = serializeUserDataExport(data, 'csv');
        return {
          status: 200,
          wire: body,
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="data-export-${exportRequest.id}.${extension}"`,
          },
        };
      }
      return { export: data as unknown as Record<string, never> };
    },

    async startAgeAssurance(body, req): Promise<{ readonly check: AgeAssuranceCheckItem }> {
      if (!body.confirmed) {
        req.fail(
          'AGE_ASSURANCE_ATTESTATION_REQUIRED',
          'Explicit confirmation is required to complete an age-assurance check',
        );
      }

      const jurisdiction = req.caps.eligibility.jurisdiction;
      const rule =
        jurisdiction !== null
          ? await k.db.system((tx) => repoOf(tx).findJurisdictionRule(jurisdiction))
          : null;
      if (rule?.serviceAvailable === false) {
        req.fail(
          'JURISDICTION_UNAVAILABLE',
          `Service is unavailable in jurisdiction ${rule.jurisdiction}`,
        );
      }

      const threshold =
        body.threshold ?? Math.max(minimumSignupAge, rule?.minimumAge ?? minimumSignupAge);
      const method = body.method ?? 'attestation';
      const outcome = await ageProvider.startCheck({
        userId: req.viewer.userId,
        threshold,
        method,
        confirmed: body.confirmed,
        jurisdiction,
        providerRef: body.providerRef,
      });

      return req.tx(async (tx) => {
        const created = await repoOf(tx).insertAgeAssuranceCheck({
          userId: req.viewer.userId,
          provider: outcome.provider,
          method: outcome.method,
          threshold: outcome.threshold,
          resultOverThreshold: outcome.resultOverThreshold,
          assuranceLevel: outcome.assuranceLevel,
          jurisdiction: outcome.jurisdiction,
          providerRef: outcome.providerRef,
          checkedAt: outcome.checkedAt,
          expiresAt: outcome.expiresAt,
        });
        await k.events.publish(
          tx,
          complianceEvents.ageAssuranceCompleted,
          {
            checkId: created.id,
            userId: req.viewer.userId,
            threshold: created.threshold,
            resultOverThreshold: created.resultOverThreshold,
          },
          { actorUserId: req.viewer.userId },
        );
        return { check: formatAgeCheck(created) };
      });
    },

    async getAgeAssuranceStatus(req): Promise<AgeAssuranceStatusResponse> {
      const jurisdiction = req.caps.eligibility.jurisdiction;
      return req.tx(async (tx) => {
        const repo = repoOf(tx);
        const rule = jurisdiction !== null ? await repo.findJurisdictionRule(jurisdiction) : null;
        const checks = await repo.listAgeAssuranceChecksByUserId(req.viewer.userId);
        const ageVerifiedFor = await repo.findMaxVerifiedAgeForUser(req.viewer.userId);
        return {
          ageVerifiedFor,
          minimumAge: Math.max(minimumSignupAge, rule?.minimumAge ?? minimumSignupAge),
          jurisdiction,
          requiresAgeAssurance: rule?.requiresAgeAssurance ?? false,
          serviceAvailable: rule?.serviceAvailable ?? true,
          checks: checks.map(formatAgeCheck),
        };
      });
    },

    async placeLegalHold(body, req): Promise<{ readonly hold: LegalHoldItem }> {
      return k.db.system(async (tx) => {
        const hold = await repoOf(tx).insertLegalHold({
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          reason: body.reason,
          createdByUserId: req.viewer.userId,
          heldUntil: body.heldUntil !== undefined ? new Date(body.heldUntil) : null,
        });
        await k.events.publish(
          tx,
          complianceEvents.legalHoldPlaced,
          {
            holdId: hold.id,
            subjectType: hold.subjectType,
            subjectId: hold.subjectId,
            createdByUserId: hold.createdByUserId,
          },
          { actorUserId: req.viewer.userId },
        );
        return { hold: formatLegalHold(hold) };
      });
    },

    async listLegalHolds(query): Promise<{ readonly holds: LegalHoldItem[] }> {
      return k.db.system(async (tx) => {
        const holds = await repoOf(tx).listLegalHolds({
          activeOnly: query.activeOnly === 'true',
          subjectType: query.subjectType,
        });
        return { holds: holds.map(formatLegalHold) };
      });
    },

    async releaseLegalHold(id, req): Promise<{ readonly hold: LegalHoldItem }> {
      return k.db.system(async (tx) => {
        const repo = repoOf(tx);
        const existing = await repo.findLegalHoldById(id);
        if (existing === null) {
          return req.fail('LEGAL_HOLD_NOT_FOUND', `Legal hold not found: ${id}`);
        }
        if (existing.releasedAt !== null) {
          return req.fail('LEGAL_HOLD_ALREADY_RELEASED', `Legal hold is already released: ${id}`);
        }
        const released = await repo.releaseLegalHold(id, req.viewer.userId);
        if (released === null) {
          return req.fail('LEGAL_HOLD_ALREADY_RELEASED', `Legal hold is already released: ${id}`);
        }
        await k.events.publish(
          tx,
          complianceEvents.legalHoldReleased,
          {
            holdId: released.id,
            releasedByUserId: released.releasedByUserId,
          },
          { actorUserId: req.viewer.userId },
        );
        return { hold: formatLegalHold(released) };
      });
    },

    async upsertJurisdictionRule(body): Promise<{ readonly rule: JurisdictionRuleItem }> {
      return reqSystemWrite(k, async (tx) => {
        const rule = await repoOf(tx).upsertJurisdictionRule({
          jurisdiction: body.jurisdiction,
          minimumAge: body.minimumAge,
          requiresAgeAssurance: body.requiresAgeAssurance,
          allowedMethods: body.allowedMethods ?? ['attestation'],
          serviceAvailable: body.serviceAvailable ?? true,
        });
        return { rule: formatJurisdictionRule(rule) };
      });
    },

    async eraseUserData(
      userId,
      req,
    ): Promise<{ readonly userId: string; readonly erasedModules: string[] }> {
      return k.db.system(async (tx) => {
        const repo = repoOf(tx);
        const held = await repo.hasActiveLegalHold('user', userId);
        if (held) {
          req.fail(
            'LEGAL_HOLD_ACTIVE',
            `Cannot erase user ${userId} while an active legal hold is in effect`,
          );
        }
        const erasedModules = k.privacy !== undefined ? [...k.privacy.modules()] : [];
        if (k.privacy !== undefined) {
          await k.privacy.eraseUser(tx, userId);
        }
        await k.events.publish(
          tx,
          complianceEvents.userDataErased,
          {
            userId,
            erasedModules,
          },
          { actorUserId: req.viewer.userId },
        );
        return { userId, erasedModules };
      });
    },

    async cleanupExpiredExportsJob(): Promise<void> {
      await k.db.system(async (tx) => {
        await repoOf(tx).deleteExpiredDataRequests();
      });
    },

    async exportUserPrivacy(userId: string): Promise<Readonly<Record<string, unknown>>> {
      return k.db.system(async (tx) => {
        const repo = repoOf(tx);
        const [agreements, consents, dataRequests, ageChecks] = await Promise.all([
          repo.listAgreementsByUserId(userId),
          repo.listConsentsByUserId(userId),
          repo.listDataRequestsByUserId(userId),
          repo.listAgeAssuranceChecksByUserId(userId),
        ]);
        return {
          agreements: agreements.map(formatAgreement),
          consents: consents.map((c) => ({
            id: c.id,
            consentType: c.consentType ?? '',
            granted: c.granted ?? false,
            createdAt: c.createdAt.toISOString(),
          })),
          dataRequests: dataRequests.map(formatExportRequest),
          ageAssuranceChecks: ageChecks.map(formatAgeCheck),
        };
      });
    },

    async eraseUserPrivacy(tx: Tx, userId: string): Promise<void> {
      const repo = repoOf(tx);
      await repo.deleteDataRequestsByUserId(userId);
      await repo.deleteAgeAssuranceChecksByUserId(userId);
    },

    toApi(): ComplianceModuleApi {
      return {
        minimumSignupAge,
        hasActiveLegalHold: (subjectType, subjectId) =>
          k.db.system((tx) => repoOf(tx).hasActiveLegalHold(subjectType, subjectId)),
        eraseUserAcrossModules: (tx, userId) =>
          (async () => {
            const held = await repoOf(tx).hasActiveLegalHold('user', userId);
            if (held) {
              throw new Error(
                `Cannot erase user ${userId} while an active legal hold is in effect`,
              );
            }
            const erasedModules = k.privacy !== undefined ? [...k.privacy.modules()] : [];
            if (k.privacy !== undefined) {
              await k.privacy.eraseUser(tx, userId);
            }
            return { erasedModules };
          })(),
      };
    },
  };
}

function reqSystemWrite<T>(k: ComplianceServiceKernel, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return k.db.system(fn);
}
