// main/modules/compliance/server/service.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createComplianceService } from './service';

import type { ComplianceRepository } from './repository';
import type { DbClient } from '@bslt/db';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '33333333-3333-4333-8333-333333333333';
const REQ_ID = '44444444-4444-4444-8444-444444444444';
const HOLD_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-19T00:00:00.000Z');

function makeFixture(overrides: Partial<ComplianceRepository> = {}) {
  const fakeDb = {} as DbClient;
  const repo: ComplianceRepository = {
    insertLegalDocument: vi.fn(async (data) =>
      Promise.resolve({
        id: DOC_ID,
        type: data.type,
        title: data.title,
        content: data.content,
        version: data.version ?? 1,
        effectiveAt: data.effectiveAt,
        createdAt: NOW,
      }),
    ),
    findLegalDocumentById: vi.fn(async () => Promise.resolve(null)),
    findLatestLegalDocumentByType: vi.fn(async () => Promise.resolve(null)),
    findAllLatestLegalDocuments: vi.fn(async () => Promise.resolve([])),
    recordAgreement: vi.fn(async (data) =>
      Promise.resolve({
        id: '66666666-6666-4666-8666-666666666666',
        userId: data.userId,
        recordType: 'legal_document' as const,
        documentId: data.documentId,
        consentType: null,
        granted: null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        metadata: {},
        createdAt: NOW,
      }),
    ),
    listAgreementsByUserId: vi.fn(async () => Promise.resolve([])),
    findAgreementByUserAndDocument: vi.fn(async () => Promise.resolve(null)),
    recordConsent: vi.fn(async (data) =>
      Promise.resolve({
        id: '77777777-7777-4777-8777-777777777777',
        userId: data.userId,
        recordType: 'consent_preference' as const,
        documentId: null,
        consentType: data.consentType,
        granted: data.granted,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        metadata: {},
        createdAt: NOW,
      }),
    ),
    listConsentsByUserId: vi.fn(async () => Promise.resolve([])),
    findLatestConsentByUserAndType: vi.fn(async () => Promise.resolve(null)),
    insertDataRequest: vi.fn(async (data) =>
      Promise.resolve({
        id: REQ_ID,
        userId: data.userId,
        type: data.type,
        status: 'pending' as const,
        format: data.format ?? 'json',
        downloadUrl: null,
        expiresAt: null,
        completedAt: null,
        errorMessage: null,
        metadata: {},
        createdAt: NOW,
      }),
    ),
    findDataRequestById: vi.fn(async () => Promise.resolve(null)),
    listDataRequestsByUserId: vi.fn(async () => Promise.resolve([])),
    updateDataRequest: vi.fn(async (_id, patch) =>
      Promise.resolve({
        id: REQ_ID,
        userId: USER_ID,
        type: 'export' as const,
        status: patch.status ?? ('completed' as const),
        format: 'json',
        downloadUrl: null,
        expiresAt: null,
        completedAt: patch.completedAt ?? NOW,
        errorMessage: patch.errorMessage ?? null,
        metadata: patch.metadata ?? {},
        createdAt: NOW,
      }),
    ),
    deleteExpiredDataRequests: vi.fn(async () => Promise.resolve(0)),
    deleteDataRequestsByUserId: vi.fn(async () => Promise.resolve(1)),
    insertAgeAssuranceCheck: vi.fn(async (data) =>
      Promise.resolve({
        id: '88888888-8888-4888-8888-888888888888',
        userId: data.userId,
        provider: data.provider,
        method: data.method,
        threshold: data.threshold,
        resultOverThreshold: data.resultOverThreshold,
        assuranceLevel: data.assuranceLevel,
        jurisdiction: data.jurisdiction ?? null,
        providerRef: data.providerRef ?? null,
        checkedAt: NOW,
        expiresAt: null,
        createdAt: NOW,
      }),
    ),
    listAgeAssuranceChecksByUserId: vi.fn(async () => Promise.resolve([])),
    findMaxVerifiedAgeForUser: vi.fn(async () => Promise.resolve(null)),
    deleteAgeAssuranceChecksByUserId: vi.fn(async () => Promise.resolve(1)),
    insertLegalHold: vi.fn(async (data) =>
      Promise.resolve({
        id: HOLD_ID,
        subjectType: data.subjectType,
        subjectId: data.subjectId,
        reason: data.reason,
        createdByUserId: data.createdByUserId ?? null,
        heldUntil: data.heldUntil ?? null,
        releasedAt: null,
        releasedByUserId: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ),
    findLegalHoldById: vi.fn(async () => Promise.resolve(null)),
    listLegalHolds: vi.fn(async () => Promise.resolve([])),
    releaseLegalHold: vi.fn(async () => Promise.resolve(null)),
    hasActiveLegalHold: vi.fn(async () => Promise.resolve(false)),
    findJurisdictionRule: vi.fn(async () => Promise.resolve(null)),
    upsertJurisdictionRule: vi.fn(async (data) =>
      Promise.resolve({
        jurisdiction: data.jurisdiction.toUpperCase(),
        minimumAge: data.minimumAge ?? 18,
        requiresAgeAssurance: data.requiresAgeAssurance ?? true,
        allowedMethods: data.allowedMethods ?? ['attestation'],
        serviceAvailable: data.serviceAvailable ?? true,
        updatedAt: NOW,
      }),
    ),
    findUserDeclaredCountry: vi.fn(async () => Promise.resolve(null)),
    listRetentionPolicies: vi.fn(async () => Promise.resolve([])),
    readUserExportSnapshot: vi.fn(async () =>
      Promise.resolve({
        profile: {
          id: USER_ID,
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          username: 'ada',
          role: 'user',
          country: 'GB',
          createdAt: NOW.toISOString(),
        },
        memberships: [],
        subscriptions: [],
        sessions: [],
      }),
    ),
    ...overrides,
  };

  const publish = vi.fn(async () => Promise.resolve());
  const privacy = {
    exportUser: vi.fn(async () =>
      Promise.resolve({
        tasks: { tasks: [{ id: 't-1', title: 'Item' }] },
      }),
    ),
    eraseUser: vi.fn(async () => Promise.resolve()),
    modules: vi.fn(() => ['tasks', 'compliance']),
  };

  const service = createComplianceService(
    {
      db: {
        system: <T>(fn: (tx: DbClient) => Promise<T>) => fn(fakeDb),
        viewer: <T>(_v: unknown, fn: (tx: DbClient) => Promise<T>) => fn(fakeDb),
      },
      jobs: { enqueue: vi.fn(async () => Promise.resolve('j-1')) },
      events: { publish },
      privacy,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
      } as never,
      clock: { now: () => NOW },
      env: { COMPLIANCE_MINIMUM_SIGNUP_AGE: 16, COMPLIANCE_DEFAULT_JURISDICTION: undefined },
    },
    { repoFactory: () => repo },
  );

  return { service, repo, fakeDb, publish, privacy };
}

describe('createComplianceService', () => {
  it('refuses non-publishable document types, duplicate pending exports, held user erasure, and unavailable jurisdictions', async () => {
    const { service, repo } = makeFixture({
      listDataRequestsByUserId: vi.fn(async () =>
        Promise.resolve([
          {
            id: REQ_ID,
            userId: USER_ID,
            type: 'export' as const,
            status: 'pending' as const,
            format: 'json',
            downloadUrl: null,
            expiresAt: null,
            completedAt: null,
            errorMessage: null,
            metadata: {},
            createdAt: NOW,
          },
        ]),
      ),
      hasActiveLegalHold: vi.fn(async () => Promise.resolve(true)),
      findJurisdictionRule: vi.fn(async () =>
        Promise.resolve({
          jurisdiction: 'KP',
          minimumAge: 18,
          requiresAgeAssurance: true,
          allowedMethods: ['document'],
          serviceAvailable: false,
          updatedAt: NOW,
        }),
      ),
    });

    const fail = (code: string, message?: string): never => {
      throw new Error(`${code}:${message ?? ''}`);
    };

    await expect(
      service.publishLegal(
        {
          type: 'cookie_policy',
          title: 'Cookies',
          content: '# Cookies',
          effectiveAt: NOW.toISOString(),
        },
        {
          viewer: { userId: ADMIN_ID, role: 'admin' },
          caps: {} as never,
          tx: (fn) => fn({} as never),
          fail,
        },
      ),
    ).rejects.toThrow(/DOCUMENT_TYPE_INVALID/);

    await expect(
      service.requestDataExport(
        { format: 'json' },
        {
          viewer: { userId: USER_ID, role: 'user' },
          caps: {} as never,
          tx: (fn) => fn({} as never),
          fail,
        },
      ),
    ).rejects.toThrow(/DATA_EXPORT_ALREADY_PENDING/);

    await expect(
      service.eraseUserData(USER_ID, {
        viewer: { userId: ADMIN_ID, role: 'admin' },
        caps: {} as never,
        tx: (fn) => fn({} as never),
        fail,
      }),
    ).rejects.toThrow(/LEGAL_HOLD_ACTIVE/);

    await expect(
      service.startAgeAssurance(
        { threshold: 18, method: 'attestation', confirmed: true },
        {
          viewer: { userId: USER_ID, role: 'user' },
          caps: {
            eligibility: {
              tosAccepted: true,
              emailVerified: true,
              ageVerifiedFor: null,
              jurisdiction: 'KP',
            },
          } as never,
          tx: (fn) => fn({} as never),
          fail,
        },
      ),
    ).rejects.toThrow(/JURISDICTION_UNAVAILABLE/);

    expect(repo.insertLegalDocument).not.toHaveBeenCalled();
  });

  it('contributes ToS + ageVerifiedFor + jurisdiction to CapabilityContext and orchestrates export & erase over k.privacy', async () => {
    const { service, privacy, publish } = makeFixture({
      findLatestLegalDocumentByType: vi.fn(async () =>
        Promise.resolve({
          id: DOC_ID,
          type: 'terms_of_service',
          title: 'Terms',
          content: '# Terms',
          version: 2,
          effectiveAt: NOW,
          createdAt: NOW,
        }),
      ),
      findAgreementByUserAndDocument: vi.fn(async () => Promise.resolve(null)),
      findMaxVerifiedAgeForUser: vi.fn(async () => Promise.resolve(21)),
    });

    const contrib = await service.resolveContext(
      { userId: USER_ID, role: 'user' },
      { headers: { 'cf-ipcountry': 'gb' } },
    );
    expect(contrib).toEqual({
      eligibility: {
        tosAccepted: false,
        ageVerifiedFor: 21,
        jurisdiction: 'GB',
      },
      requirementDetails: {
        TOS_ACCEPTANCE_REQUIRED: {
          documentId: DOC_ID,
          requiredVersion: 2,
        },
        AGE_ASSURANCE_REQUIRED: {
          minimumAge: 16,
          jurisdiction: 'GB',
        },
      },
    });

    const fail = (code: string): never => {
      throw new Error(code);
    };
    const erased = await service.eraseUserData(USER_ID, {
      viewer: { userId: ADMIN_ID, role: 'admin' },
      caps: {} as never,
      tx: (fn) => fn({} as never),
      fail,
    });
    expect(erased).toEqual({ userId: USER_ID, erasedModules: ['tasks', 'compliance'] });
    expect(privacy.eraseUser).toHaveBeenCalledWith(expect.anything(), USER_ID);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('enforces ToS status/acceptance and signup agreement actions with failure-first checks', async () => {
    const fail = (code: string, message?: string): never => {
      throw new Error(`${code}:${message ?? ''}`);
    };

    // 1. Missing ToS document -> acceptTos refuses with DOCUMENT_NOT_FOUND and writes nothing
    const missingFixture = makeFixture();
    await expect(
      missingFixture.service.acceptTos(
        { documentId: DOC_ID },
        {
          viewer: { userId: USER_ID, role: 'user' },
          caps: {} as never,
          ip: '203.0.113.5',
          userAgent: 'Vitest/1.0',
          tx: (fn) => fn({} as never),
          fail,
        },
      ),
    ).rejects.toThrow(/DOCUMENT_NOT_FOUND/);
    expect(missingFixture.repo.recordAgreement).not.toHaveBeenCalled();

    // 2. Malformed recordSignupConsents inputs throw before any write
    await expect(missingFixture.service.recordSignupConsents({} as never, null)).rejects.toThrow(
      /Invalid compliance.recordSignupConsents/,
    );
    await expect(
      missingFixture.service.recordSignupConsents({} as never, {
        userId: '',
        documentIds: [DOC_ID],
      }),
    ).rejects.toThrow(/userId/);
    await expect(
      missingFixture.service.recordSignupConsents({} as never, {
        userId: USER_ID,
        documentIds: 'not-an-array',
      }),
    ).rejects.toThrow(/documentIds/);
    expect(missingFixture.repo.recordAgreement).not.toHaveBeenCalled();

    // 3. No published ToS -> getTosStatus reports accepted fail-open
    const noTosStatus = await missingFixture.service.getTosStatus({
      viewer: { userId: USER_ID, role: 'user' },
      caps: {} as never,
      tx: (fn) => fn({} as never),
      fail,
    });
    expect(noTosStatus).toEqual({ accepted: true, requiredVersion: null, documentId: null });

    // 4. Published ToS + Privacy + Cookie -> peekSignupAgreements returns ONLY signup agreements;
    //    getTosStatus reports unaccepted -> acceptTos records agreement with IP/UA
    const PRIVACY_ID = '99999999-9999-4999-8999-999999999999';
    const activeFixture = makeFixture({
      findAllLatestLegalDocuments: vi.fn(async () =>
        Promise.resolve([
          {
            id: DOC_ID,
            type: 'terms_of_service',
            title: 'Terms',
            content: '# Terms',
            version: 2,
            effectiveAt: NOW,
            createdAt: NOW,
          },
          {
            id: PRIVACY_ID,
            type: 'privacy_policy',
            title: 'Privacy',
            content: '# Privacy',
            version: 1,
            effectiveAt: NOW,
            createdAt: NOW,
          },
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            type: 'cookie_policy',
            title: 'Cookies',
            content: '# Cookies',
            version: 1,
            effectiveAt: NOW,
            createdAt: NOW,
          },
        ]),
      ),
      findLatestLegalDocumentByType: vi.fn(async () =>
        Promise.resolve({
          id: DOC_ID,
          type: 'terms_of_service',
          title: 'Terms',
          content: '# Terms',
          version: 2,
          effectiveAt: NOW,
          createdAt: NOW,
        }),
      ),
      findLegalDocumentById: vi.fn(async (id) =>
        id === DOC_ID
          ? Promise.resolve({
              id: DOC_ID,
              type: 'terms_of_service',
              title: 'Terms',
              content: '# Terms',
              version: 2,
              effectiveAt: NOW,
              createdAt: NOW,
            })
          : Promise.resolve(null),
      ),
      findAgreementByUserAndDocument: vi.fn(async () => Promise.resolve(null)),
    });

    const peeked = await activeFixture.service.peekSignupAgreements({} as never);
    expect(peeked).toEqual([
      { id: DOC_ID, type: 'terms_of_service', version: 2 },
      { id: PRIVACY_ID, type: 'privacy_policy', version: 1 },
    ]);

    const gatedStatus = await activeFixture.service.getTosStatus({
      viewer: { userId: USER_ID, role: 'user' },
      caps: {} as never,
      tx: (fn) => fn({} as never),
      fail,
    });
    expect(gatedStatus).toEqual({ accepted: false, requiredVersion: 2, documentId: DOC_ID });

    const accepted = await activeFixture.service.acceptTos(
      { documentId: DOC_ID },
      {
        viewer: { userId: USER_ID, role: 'user' },
        caps: {} as never,
        ip: '203.0.113.5',
        userAgent: 'Vitest/1.0',
        tx: (fn) => fn({} as never),
        fail,
      },
    );
    expect(accepted).toEqual({ agreedAt: NOW.toISOString() });
    expect(activeFixture.repo.recordAgreement).toHaveBeenCalledWith({
      userId: USER_ID,
      documentId: DOC_ID,
      ipAddress: '203.0.113.5',
      userAgent: 'Vitest/1.0',
    });

    await activeFixture.service.recordSignupConsents({} as never, {
      userId: USER_ID,
      documentIds: [DOC_ID, PRIVACY_ID],
      ipAddress: '198.51.100.7',
      userAgent: 'Signup/1.0',
    });
    expect(activeFixture.repo.recordAgreement).toHaveBeenCalledTimes(3);
  });
});
