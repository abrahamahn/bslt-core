// main/modules/compliance/server/repository.ts
import {
  and,
  deleteFrom,
  eq,
  lt,
  ne,
  select,
  toCamelCase,
  toSnakeCase,
  update,
  type RawDb,
} from '@bslt/db';

import {
  COMPLIANCE_AGE_ASSURANCE_CHECKS_COLUMNS,
  COMPLIANCE_AGE_ASSURANCE_CHECKS_TABLE,
  COMPLIANCE_CONSENTS_COLUMNS,
  COMPLIANCE_CONSENTS_TABLE,
  COMPLIANCE_DATA_REQUESTS_COLUMNS,
  COMPLIANCE_DATA_REQUESTS_TABLE,
  COMPLIANCE_JURISDICTION_RULES_COLUMNS,
  COMPLIANCE_JURISDICTION_RULES_TABLE,
  COMPLIANCE_LEGAL_DOCUMENTS_COLUMNS,
  COMPLIANCE_LEGAL_DOCUMENTS_TABLE,
  COMPLIANCE_LEGAL_HOLDS_COLUMNS,
  COMPLIANCE_LEGAL_HOLDS_TABLE,
  COMPLIANCE_RETENTION_POLICIES_COLUMNS,
  type ComplianceAgeAssuranceChecksInsert,
  type ComplianceAgeAssuranceChecksRow,
  type ComplianceConsentsRow,
  type ComplianceDataRequestsInsert,
  type ComplianceDataRequestsRow,
  type ComplianceDataRequestsUpdate,
  type ComplianceJurisdictionRulesInsert,
  type ComplianceJurisdictionRulesRow,
  type ComplianceLegalDocumentsInsert,
  type ComplianceLegalDocumentsRow,
  type ComplianceLegalHoldsInsert,
  type ComplianceLegalHoldsRow,
  type ComplianceRetentionPoliciesRow,
} from './generated/rows';

import type { LegalHoldSubjectType } from '../contract';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function transformLegalDoc(row: Record<string, unknown>): ComplianceLegalDocumentsRow {
  return toCamelCase<ComplianceLegalDocumentsRow>(row, COMPLIANCE_LEGAL_DOCUMENTS_COLUMNS);
}

function transformConsent(row: Record<string, unknown>): ComplianceConsentsRow {
  const mapped = toCamelCase<ComplianceConsentsRow>(row, COMPLIANCE_CONSENTS_COLUMNS);
  if (typeof mapped.metadata === 'string') {
    mapped.metadata = JSON.parse(mapped.metadata) as ComplianceConsentsRow['metadata'];
  }
  return mapped;
}

function transformDataRequest(row: Record<string, unknown>): ComplianceDataRequestsRow {
  const mapped = toCamelCase<ComplianceDataRequestsRow>(row, COMPLIANCE_DATA_REQUESTS_COLUMNS);
  if (typeof mapped.metadata === 'string') {
    mapped.metadata = JSON.parse(mapped.metadata) as ComplianceDataRequestsRow['metadata'];
  }
  return mapped;
}

function transformAgeCheck(row: Record<string, unknown>): ComplianceAgeAssuranceChecksRow {
  return toCamelCase<ComplianceAgeAssuranceChecksRow>(row, COMPLIANCE_AGE_ASSURANCE_CHECKS_COLUMNS);
}

function transformLegalHold(row: Record<string, unknown>): ComplianceLegalHoldsRow {
  return toCamelCase<ComplianceLegalHoldsRow>(row, COMPLIANCE_LEGAL_HOLDS_COLUMNS);
}

function transformJurisdictionRule(row: Record<string, unknown>): ComplianceJurisdictionRulesRow {
  return toCamelCase<ComplianceJurisdictionRulesRow>(row, COMPLIANCE_JURISDICTION_RULES_COLUMNS);
}

function transformRetentionPolicy(row: Record<string, unknown>): ComplianceRetentionPoliciesRow {
  return toCamelCase<ComplianceRetentionPoliciesRow>(row, COMPLIANCE_RETENTION_POLICIES_COLUMNS);
}

interface UserExportSnapshot {
  readonly profile: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly username: string | null;
    readonly role: string;
    readonly country: string | null;
    readonly createdAt: string;
  } | null;
  readonly memberships: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly subscriptions: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly sessions: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface ComplianceRepository {
  insertLegalDocument(data: ComplianceLegalDocumentsInsert): Promise<ComplianceLegalDocumentsRow>;
  findLegalDocumentById(id: string): Promise<ComplianceLegalDocumentsRow | null>;
  findLatestLegalDocumentByType(type: string): Promise<ComplianceLegalDocumentsRow | null>;
  findAllLatestLegalDocuments(): Promise<ComplianceLegalDocumentsRow[]>;

  recordAgreement(data: {
    readonly userId: string;
    readonly documentId: string;
    readonly ipAddress?: string | null | undefined;
    readonly userAgent?: string | null | undefined;
    readonly metadata?: Record<string, unknown> | undefined;
  }): Promise<ComplianceConsentsRow>;
  listAgreementsByUserId(userId: string): Promise<ComplianceConsentsRow[]>;
  findAgreementByUserAndDocument(
    userId: string,
    documentId: string,
  ): Promise<ComplianceConsentsRow | null>;
  recordConsent(data: {
    readonly userId: string;
    readonly consentType: string;
    readonly granted: boolean;
    readonly ipAddress?: string | null | undefined;
    readonly userAgent?: string | null | undefined;
    readonly metadata?: Record<string, unknown> | undefined;
  }): Promise<ComplianceConsentsRow>;
  listConsentsByUserId(userId: string): Promise<ComplianceConsentsRow[]>;
  findLatestConsentByUserAndType(
    userId: string,
    consentType: string,
  ): Promise<ComplianceConsentsRow | null>;

  insertDataRequest(data: ComplianceDataRequestsInsert): Promise<ComplianceDataRequestsRow>;
  findDataRequestById(id: string): Promise<ComplianceDataRequestsRow | null>;
  listDataRequestsByUserId(userId: string): Promise<ComplianceDataRequestsRow[]>;
  updateDataRequest(
    id: string,
    patch: ComplianceDataRequestsUpdate,
  ): Promise<ComplianceDataRequestsRow | null>;
  deleteExpiredDataRequests(): Promise<number>;
  deleteDataRequestsByUserId(userId: string): Promise<number>;

  insertAgeAssuranceCheck(
    data: ComplianceAgeAssuranceChecksInsert,
  ): Promise<ComplianceAgeAssuranceChecksRow>;
  listAgeAssuranceChecksByUserId(userId: string): Promise<ComplianceAgeAssuranceChecksRow[]>;
  findMaxVerifiedAgeForUser(userId: string): Promise<number | null>;
  deleteAgeAssuranceChecksByUserId(userId: string): Promise<number>;

  insertLegalHold(data: ComplianceLegalHoldsInsert): Promise<ComplianceLegalHoldsRow>;
  findLegalHoldById(id: string): Promise<ComplianceLegalHoldsRow | null>;
  listLegalHolds(options?: {
    readonly activeOnly?: boolean | undefined;
    readonly subjectType?: LegalHoldSubjectType | undefined;
  }): Promise<ComplianceLegalHoldsRow[]>;
  releaseLegalHold(
    id: string,
    releasedByUserId: string | null,
  ): Promise<ComplianceLegalHoldsRow | null>;
  hasActiveLegalHold(subjectType: LegalHoldSubjectType, subjectId: string): Promise<boolean>;

  findJurisdictionRule(jurisdiction: string): Promise<ComplianceJurisdictionRulesRow | null>;
  upsertJurisdictionRule(
    data: ComplianceJurisdictionRulesInsert,
  ): Promise<ComplianceJurisdictionRulesRow>;
  findUserDeclaredCountry(userId: string): Promise<string | null>;

  listRetentionPolicies(): Promise<ComplianceRetentionPoliciesRow[]>;
  readUserExportSnapshot(userId: string): Promise<UserExportSnapshot>;
}

export function complianceRepository(db: RawDb): ComplianceRepository {
  return {
    async insertLegalDocument(
      data: ComplianceLegalDocumentsInsert,
    ): Promise<ComplianceLegalDocumentsRow> {
      const rows =
        data.id !== undefined
          ? await db.raw(
              `INSERT INTO ${COMPLIANCE_LEGAL_DOCUMENTS_TABLE} (id, type, title, content, version, effective_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *`,
              [data.id, data.type, data.title, data.content, data.version ?? 1, data.effectiveAt],
            )
          : await db.raw(
              `INSERT INTO ${COMPLIANCE_LEGAL_DOCUMENTS_TABLE} (type, title, content, version, effective_at)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *`,
              [data.type, data.title, data.content, data.version ?? 1, data.effectiveAt],
            );
      const first = rows[0];
      if (first === undefined) {
        throw new Error('Failed to create legal document');
      }
      return transformLegalDoc(first);
    },

    async findLegalDocumentById(id: string): Promise<ComplianceLegalDocumentsRow | null> {
      if (!isUuid(id)) return null;
      const row = await db.queryOne(
        select(COMPLIANCE_LEGAL_DOCUMENTS_TABLE).where(eq('id', id)).toSql(),
      );
      return row !== null ? transformLegalDoc(row) : null;
    },

    async findLatestLegalDocumentByType(type: string): Promise<ComplianceLegalDocumentsRow | null> {
      const row = await db.queryOne(
        select(COMPLIANCE_LEGAL_DOCUMENTS_TABLE)
          .where(eq('type', type))
          .orderBy('version', 'desc')
          .limit(1)
          .toSql(),
      );
      return row !== null ? transformLegalDoc(row) : null;
    },

    async findAllLatestLegalDocuments(): Promise<ComplianceLegalDocumentsRow[]> {
      const rows = await db.raw(
        `SELECT DISTINCT ON ("type") * FROM "${COMPLIANCE_LEGAL_DOCUMENTS_TABLE}" ORDER BY "type", "version" DESC`,
      );
      return rows.map(transformLegalDoc);
    },

    async recordAgreement(data): Promise<ComplianceConsentsRow> {
      const rows = await db.raw(
        `INSERT INTO ${COMPLIANCE_CONSENTS_TABLE}
           (user_id, record_type, document_id, ip_address, user_agent, metadata)
         VALUES ($1::uuid, 'legal_document', $2::uuid, $3, $4, $5::text::jsonb)
         RETURNING *`,
        [
          data.userId,
          data.documentId,
          data.ipAddress ?? null,
          data.userAgent ?? null,
          JSON.stringify(data.metadata ?? {}),
        ],
      );
      const first = rows[0];
      if (first === undefined) {
        throw new Error('Failed to record user agreement');
      }
      return transformConsent(first);
    },

    async listAgreementsByUserId(userId: string): Promise<ComplianceConsentsRow[]> {
      if (!isUuid(userId)) return [];
      const rows = await db.query(
        select(COMPLIANCE_CONSENTS_TABLE)
          .where(and(eq('user_id', userId), eq('record_type', 'legal_document')))
          .orderBy('created_at', 'desc')
          .toSql(),
      );
      return rows.map(transformConsent);
    },

    async findAgreementByUserAndDocument(
      userId: string,
      documentId: string,
    ): Promise<ComplianceConsentsRow | null> {
      if (!isUuid(userId) || !isUuid(documentId)) return null;
      const row = await db.queryOne(
        select(COMPLIANCE_CONSENTS_TABLE)
          .where(
            and(
              eq('user_id', userId),
              eq('record_type', 'legal_document'),
              eq('document_id', documentId),
            ),
          )
          .toSql(),
      );
      return row !== null ? transformConsent(row) : null;
    },

    async recordConsent(data): Promise<ComplianceConsentsRow> {
      const rows = await db.raw(
        `INSERT INTO ${COMPLIANCE_CONSENTS_TABLE}
           (user_id, record_type, consent_type, granted, ip_address, user_agent, metadata)
         VALUES ($1::uuid, 'consent_preference', $2, $3, $4, $5, $6::text::jsonb)
         RETURNING *`,
        [
          data.userId,
          data.consentType,
          data.granted,
          data.ipAddress ?? null,
          data.userAgent ?? null,
          JSON.stringify(data.metadata ?? {}),
        ],
      );
      const first = rows[0];
      if (first === undefined) {
        throw new Error('Failed to record consent preference');
      }
      return transformConsent(first);
    },

    async listConsentsByUserId(userId: string): Promise<ComplianceConsentsRow[]> {
      if (!isUuid(userId)) return [];
      const rows = await db.query(
        select(COMPLIANCE_CONSENTS_TABLE)
          .where(and(eq('user_id', userId), eq('record_type', 'consent_preference')))
          .orderBy('created_at', 'desc')
          .toSql(),
      );
      return rows.map(transformConsent);
    },

    async findLatestConsentByUserAndType(
      userId: string,
      consentType: string,
    ): Promise<ComplianceConsentsRow | null> {
      if (!isUuid(userId)) return null;
      const row = await db.queryOne(
        select(COMPLIANCE_CONSENTS_TABLE)
          .where(
            and(
              eq('user_id', userId),
              eq('record_type', 'consent_preference'),
              eq('consent_type', consentType),
            ),
          )
          .orderBy('created_at', 'desc')
          .limit(1)
          .toSql(),
      );
      return row !== null ? transformConsent(row) : null;
    },

    async insertDataRequest(
      data: ComplianceDataRequestsInsert,
    ): Promise<ComplianceDataRequestsRow> {
      const rows = await db.raw(
        `INSERT INTO ${COMPLIANCE_DATA_REQUESTS_TABLE}
           (user_id, type, status, format, download_url, expires_at, completed_at, error_message, metadata)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb)
         RETURNING *`,
        [
          data.userId,
          data.type,
          data.status ?? 'pending',
          data.format ?? 'json',
          data.downloadUrl ?? null,
          data.expiresAt ?? null,
          data.completedAt ?? null,
          data.errorMessage ?? null,
          JSON.stringify(data.metadata ?? {}),
        ],
      );
      const first = rows[0];
      if (first === undefined) {
        throw new Error('Failed to create compliance data request');
      }
      return transformDataRequest(first);
    },

    async findDataRequestById(id: string): Promise<ComplianceDataRequestsRow | null> {
      if (!isUuid(id)) return null;
      const row = await db.queryOne(
        select(COMPLIANCE_DATA_REQUESTS_TABLE).where(eq('id', id)).toSql(),
      );
      return row !== null ? transformDataRequest(row) : null;
    },

    async listDataRequestsByUserId(userId: string): Promise<ComplianceDataRequestsRow[]> {
      if (!isUuid(userId)) return [];
      const rows = await db.query(
        select(COMPLIANCE_DATA_REQUESTS_TABLE)
          .where(eq('user_id', userId))
          .orderBy('created_at', 'desc')
          .toSql(),
      );
      return rows.map(transformDataRequest);
    },

    async updateDataRequest(
      id: string,
      patch: ComplianceDataRequestsUpdate,
    ): Promise<ComplianceDataRequestsRow | null> {
      if (!isUuid(id)) return null;
      const { metadata, ...rest } = patch;
      if (metadata !== undefined) {
        const rows = await db.raw(
          `UPDATE ${COMPLIANCE_DATA_REQUESTS_TABLE}
              SET status = COALESCE($2, status),
                  completed_at = COALESCE($3, completed_at),
                  error_message = COALESCE($4, error_message),
                  metadata = $5::text::jsonb
            WHERE id = $1::uuid
            RETURNING *`,
          [
            id,
            rest.status ?? null,
            rest.completedAt ?? null,
            rest.errorMessage ?? null,
            JSON.stringify(metadata),
          ],
        );
        return rows[0] !== undefined ? transformDataRequest(rows[0]) : null;
      }
      const snake = toSnakeCase(rest, COMPLIANCE_DATA_REQUESTS_COLUMNS);
      const row = await db.queryOne(
        update(COMPLIANCE_DATA_REQUESTS_TABLE)
          .set(snake)
          .where(eq('id', id))
          .returningAll()
          .toSql(),
      );
      return row !== null ? transformDataRequest(row) : null;
    },

    async deleteExpiredDataRequests(): Promise<number> {
      return db.execute(
        deleteFrom(COMPLIANCE_DATA_REQUESTS_TABLE)
          .where(and(lt('expires_at', new Date()), ne('status', 'completed')))
          .toSql(),
      );
    },

    async deleteDataRequestsByUserId(userId: string): Promise<number> {
      if (!isUuid(userId)) return 0;
      return db.execute(
        deleteFrom(COMPLIANCE_DATA_REQUESTS_TABLE).where(eq('user_id', userId)).toSql(),
      );
    },

    async insertAgeAssuranceCheck(
      data: ComplianceAgeAssuranceChecksInsert,
    ): Promise<ComplianceAgeAssuranceChecksRow> {
      const rows = await db.raw(
        `INSERT INTO ${COMPLIANCE_AGE_ASSURANCE_CHECKS_TABLE}
           (user_id, provider, method, threshold, result_over_threshold, assurance_level, jurisdiction, provider_ref, checked_at, expires_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10)
         RETURNING *`,
        [
          data.userId,
          data.provider,
          data.method,
          data.threshold,
          data.resultOverThreshold,
          data.assuranceLevel,
          data.jurisdiction ?? null,
          data.providerRef ?? null,
          data.checkedAt ?? null,
          data.expiresAt ?? null,
        ],
      );
      const first = rows[0];
      if (first === undefined) {
        throw new Error('Failed to insert age-assurance check');
      }
      return transformAgeCheck(first);
    },

    async listAgeAssuranceChecksByUserId(
      userId: string,
    ): Promise<ComplianceAgeAssuranceChecksRow[]> {
      if (!isUuid(userId)) return [];
      const rows = await db.query(
        select(COMPLIANCE_AGE_ASSURANCE_CHECKS_TABLE)
          .where(eq('user_id', userId))
          .orderBy('checked_at', 'desc')
          .limit(50)
          .toSql(),
      );
      return rows.map(transformAgeCheck);
    },

    async findMaxVerifiedAgeForUser(userId: string): Promise<number | null> {
      if (!isUuid(userId)) return null;
      const rows = await db.raw<{ max_threshold: number | null }>(
        `SELECT MAX(threshold)::int AS max_threshold
           FROM ${COMPLIANCE_AGE_ASSURANCE_CHECKS_TABLE}
          WHERE user_id = $1::uuid
            AND result_over_threshold = true
            AND (expires_at IS NULL OR expires_at > now())`,
        [userId],
      );
      return rows[0]?.max_threshold ?? null;
    },

    async deleteAgeAssuranceChecksByUserId(userId: string): Promise<number> {
      if (!isUuid(userId)) return 0;
      return db.execute(
        deleteFrom(COMPLIANCE_AGE_ASSURANCE_CHECKS_TABLE).where(eq('user_id', userId)).toSql(),
      );
    },

    async insertLegalHold(data: ComplianceLegalHoldsInsert): Promise<ComplianceLegalHoldsRow> {
      const rows = await db.raw(
        `INSERT INTO ${COMPLIANCE_LEGAL_HOLDS_TABLE}
           (subject_type, subject_id, reason, created_by_user_id, held_until)
         VALUES ($1, $2, $3, $4::uuid, $5)
         RETURNING *`,
        [
          data.subjectType,
          data.subjectId,
          data.reason,
          data.createdByUserId ?? null,
          data.heldUntil ?? null,
        ],
      );
      const first = rows[0];
      if (first === undefined) {
        throw new Error('Failed to create legal hold');
      }
      return transformLegalHold(first);
    },

    async findLegalHoldById(id: string): Promise<ComplianceLegalHoldsRow | null> {
      if (!isUuid(id)) return null;
      const row = await db.queryOne(
        select(COMPLIANCE_LEGAL_HOLDS_TABLE).where(eq('id', id)).toSql(),
      );
      return row !== null ? transformLegalHold(row) : null;
    },

    async listLegalHolds(options): Promise<ComplianceLegalHoldsRow[]> {
      const params: unknown[] = [];
      const conditions: string[] = [];
      if (options?.activeOnly === true) {
        conditions.push('released_at IS NULL AND (held_until IS NULL OR held_until > now())');
      }
      if (options?.subjectType !== undefined) {
        params.push(options.subjectType);
        conditions.push(`subject_type = $${String(params.length)}`);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.raw(
        `SELECT * FROM ${COMPLIANCE_LEGAL_HOLDS_TABLE} ${whereClause} ORDER BY created_at DESC LIMIT 200`,
        params,
      );
      return rows.map(transformLegalHold);
    },

    async releaseLegalHold(
      id: string,
      releasedByUserId: string | null,
    ): Promise<ComplianceLegalHoldsRow | null> {
      if (!isUuid(id)) return null;
      const rows = await db.raw(
        `UPDATE ${COMPLIANCE_LEGAL_HOLDS_TABLE}
            SET released_at = now(),
                released_by_user_id = $2::uuid
          WHERE id = $1::uuid
            AND released_at IS NULL
          RETURNING *`,
        [id, releasedByUserId !== null && isUuid(releasedByUserId) ? releasedByUserId : null],
      );
      return rows[0] !== undefined ? transformLegalHold(rows[0]) : null;
    },

    async hasActiveLegalHold(
      subjectType: LegalHoldSubjectType,
      subjectId: string,
    ): Promise<boolean> {
      const rows = await db.raw<{ active: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM ${COMPLIANCE_LEGAL_HOLDS_TABLE}
            WHERE subject_type = $1
              AND subject_id = $2
              AND released_at IS NULL
              AND (held_until IS NULL OR held_until > now())
         ) AS active`,
        [subjectType, subjectId],
      );
      return rows[0]?.active === true;
    },

    async findJurisdictionRule(
      jurisdiction: string,
    ): Promise<ComplianceJurisdictionRulesRow | null> {
      const row = await db.queryOne(
        select(COMPLIANCE_JURISDICTION_RULES_TABLE)
          .where(eq('jurisdiction', jurisdiction.toUpperCase()))
          .toSql(),
      );
      return row !== null ? transformJurisdictionRule(row) : null;
    },

    async upsertJurisdictionRule(
      data: ComplianceJurisdictionRulesInsert,
    ): Promise<ComplianceJurisdictionRulesRow> {
      const rows = await db.raw(
        `INSERT INTO ${COMPLIANCE_JURISDICTION_RULES_TABLE}
           (jurisdiction, minimum_age, requires_age_assurance, allowed_methods, service_available)
         VALUES ($1, $2, $3, $4::text[], $5)
         ON CONFLICT (jurisdiction) DO UPDATE
           SET minimum_age = EXCLUDED.minimum_age,
               requires_age_assurance = EXCLUDED.requires_age_assurance,
               allowed_methods = EXCLUDED.allowed_methods,
               service_available = EXCLUDED.service_available,
               updated_at = now()
         RETURNING *`,
        [
          data.jurisdiction.toUpperCase(),
          data.minimumAge ?? 13,
          data.requiresAgeAssurance ?? false,
          data.allowedMethods ?? ['attestation'],
          data.serviceAvailable ?? true,
        ],
      );
      const first = rows[0];
      if (first === undefined) {
        throw new Error('Failed to upsert jurisdiction rule');
      }
      return transformJurisdictionRule(first);
    },

    async findUserDeclaredCountry(userId: string): Promise<string | null> {
      if (!isUuid(userId)) return null;
      const rows = await db.raw<{ country: string | null }>(
        `SELECT country FROM identity_profiles WHERE user_id = $1::uuid`,
        [userId],
      );
      return rows[0]?.country ?? null;
    },

    async listRetentionPolicies(): Promise<ComplianceRetentionPoliciesRow[]> {
      const rows = await db.raw(`SELECT * FROM compliance_retention_policies ORDER BY category`);
      return rows.map(transformRetentionPolicy);
    },

    async readUserExportSnapshot(userId: string): Promise<UserExportSnapshot> {
      if (!isUuid(userId)) {
        return { profile: null, memberships: [], subscriptions: [], sessions: [] };
      }
      const userRows = await db.raw<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        username: string | null;
        role: string;
        country: string | null;
        created_at: Date | string;
      }>(
        `SELECT u.id, u.email, p.first_name, p.last_name, u.username, u.role, p.country, u.created_at
           FROM identity_users u
           LEFT JOIN identity_profiles p ON p.user_id = u.id
          WHERE u.id = $1::uuid`,
        [userId],
      );
      const u = userRows[0];
      if (u === undefined) {
        return { profile: null, memberships: [], subscriptions: [], sessions: [] };
      }

      const sessions = await db.raw<{
        id: string;
        device_name: string | null;
        last_active_at: Date | string;
        created_at: Date | string;
      }>(
        `SELECT id, device_name, last_active_at, created_at
           FROM identity_sessions
          WHERE user_id = $1::uuid AND revoked_at IS NULL
          ORDER BY last_active_at DESC
          LIMIT 100`,
        [userId],
      );

      return {
        profile: {
          id: u.id,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          username: u.username,
          role: u.role,
          country: u.country,
          createdAt: u.created_at instanceof Date ? u.created_at.toISOString() : u.created_at,
        },
        memberships: [],
        subscriptions: [],
        sessions: sessions.map((s) => ({
          id: s.id,
          deviceName: s.device_name,
          lastActiveAt:
            s.last_active_at instanceof Date ? s.last_active_at.toISOString() : s.last_active_at,
          createdAt: s.created_at instanceof Date ? s.created_at.toISOString() : s.created_at,
        })),
      };
    },
  };
}
