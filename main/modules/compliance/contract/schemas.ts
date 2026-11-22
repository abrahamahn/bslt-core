// main/modules/compliance/contract/schemas.ts
import {
  array,
  boolean,
  enumOf,
  json,
  literal,
  nullable,
  number,
  object,
  optional,
  record,
  refine,
  string,
  union,
  type Infer,
} from '@bslt/schema';

export const DOCUMENT_TYPES = [
  'terms_of_service',
  'privacy_policy',
  'cookie_policy',
  'acceptable_use',
  'disclaimer',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const PUBLISHABLE_DOCUMENT_TYPES = [
  'terms_of_service',
  'privacy_policy',
] as const satisfies readonly DocumentType[];

export type PublishableDocumentType = (typeof PUBLISHABLE_DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
  cookie_policy: 'Cookie Policy',
  acceptable_use: 'Acceptable Use Policy',
  disclaimer: 'Disclaimer',
};

export const SIGNUP_AGREEMENT_DOCUMENT_TYPES: ReadonlySet<string> = new Set<DocumentType>([
  'terms_of_service',
  'privacy_policy',
]);

export function isConsentConfirmed(value: unknown): value is true {
  return value === true;
}

export const CONSENT_TYPES = [
  'marketing_email',
  'analytics',
  'third_party_sharing',
  'profiling',
] as const;

const DATA_EXPORT_FORMATS = ['json', 'csv'] as const;
export type DataExportFormat = (typeof DATA_EXPORT_FORMATS)[number];

const LEGAL_HOLD_SUBJECT_TYPES = ['user', 'org', 'file', 'case', 'other'] as const;
export type LegalHoldSubjectType = (typeof LEGAL_HOLD_SUBJECT_TYPES)[number];

export const AGE_ASSURANCE_METHODS = [
  'attestation',
  'facial_estimation',
  'document',
  'eid_wallet',
  'credit_card',
  'reusable_token',
] as const;
export type AgeAssuranceMethod = (typeof AGE_ASSURANCE_METHODS)[number];

const AGE_ASSURANCE_LEVELS = ['self_attested', 'standard', 'high'] as const;
export type AgeAssuranceLevel = (typeof AGE_ASSURANCE_LEVELS)[number];

export const DEFAULT_MINIMUM_SIGNUP_AGE = 13;

const validDateStringSchema = refine(
  string({ label: 'effectiveAt', min: 1 }),
  (val) => !Number.isNaN(new Date(val).getTime()),
  'effectiveAt must be a valid ISO date-time string',
);

const legalDocumentWireSchema = object({
  id: string({ min: 1 }),
  type: string({ min: 1 }),
  title: string({ min: 1 }),
  content: string({ min: 1 }),
  version: number({ int: true, min: 1 }),
  effectiveAt: string({ min: 1 }),
  createdAt: string({ min: 1 }),
});
export type LegalDocumentItem = Infer<typeof legalDocumentWireSchema>;

export const legalDocumentsResponseSchema = object({
  documents: array(legalDocumentWireSchema),
});
export type CurrentLegalResponse = Infer<typeof legalDocumentsResponseSchema>;

export const publishLegalDocumentBodySchema = object({
  type: string({ label: 'type', min: 1, max: 120 }),
  title: string({ label: 'title', min: 1, max: 200 }),
  content: string({ label: 'content', min: 1 }),
  version: optional(number({ label: 'version', int: true, min: 1 })),
  effectiveAt: validDateStringSchema,
});
export type PublishLegalDocumentBody = Infer<typeof publishLegalDocumentBodySchema>;

export const legalDocumentResponseSchema = object({
  document: legalDocumentWireSchema,
});
export type PublishLegalDocumentResponse = Infer<typeof legalDocumentResponseSchema>;

const userAgreementWireSchema = object({
  id: string({ min: 1 }),
  userId: string({ min: 1 }),
  documentId: string({ min: 1 }),
  agreedAt: string({ min: 1 }),
  ipAddress: nullable(string()),
});
export type UserAgreementItem = Infer<typeof userAgreementWireSchema>;

export const userAgreementsResponseSchema = object({
  agreements: array(userAgreementWireSchema),
});
export type UserAgreementsResponse = Infer<typeof userAgreementsResponseSchema>;

export const acceptTosBodySchema = object({
  documentId: string({ label: 'documentId', min: 1 }),
});
export type AcceptTosBody = Infer<typeof acceptTosBodySchema>;

export const acceptTosResponseSchema = object({
  agreedAt: string({ min: 1 }),
});
export type AcceptTosResponse = Infer<typeof acceptTosResponseSchema>;

export const tosStatusResponseSchema = object({
  accepted: boolean(),
  requiredVersion: nullable(number({ int: true, min: 1 })),
  documentId: nullable(string({ min: 1 })),
});
export type TosStatusResponse = Infer<typeof tosStatusResponseSchema>;

export const consentPreferencesPayloadSchema = object({
  preferences: record(nullable(boolean()), string({ min: 1 })),
});
export type ConsentPreferencesPayload = Infer<typeof consentPreferencesPayloadSchema>;

export const updateConsentPreferencesBodySchema = refine(
  object({
    analytics: optional(boolean({ label: 'analytics' })),
    marketing_email: optional(boolean({ label: 'marketing_email' })),
    third_party_sharing: optional(boolean({ label: 'third_party_sharing' })),
    profiling: optional(boolean({ label: 'profiling' })),
  }),
  (val) =>
    val.analytics !== undefined ||
    val.marketing_email !== undefined ||
    val.third_party_sharing !== undefined ||
    val.profiling !== undefined,
  'At least one consent preference must be specified',
);
export type UpdateConsentPreferencesBody = Infer<typeof updateConsentPreferencesBodySchema>;

export const consentPreferencesUpdateResponseSchema = object({
  preferences: record(nullable(boolean()), string({ min: 1 })),
  updated: number({ int: true, min: 0 }),
});
export type ConsentPreferencesUpdateResponse = Infer<typeof consentPreferencesUpdateResponseSchema>;

export const requestDataExportBodySchema = object({
  format: optional(enumOf(DATA_EXPORT_FORMATS)),
});
export type RequestDataExportBody = Infer<typeof requestDataExportBodySchema>;

export const complianceIdParamsSchema = object({
  id: string({ label: 'id', min: 1 }),
});

export const complianceUserIdParamsSchema = object({
  userId: string({ label: 'userId', min: 1 }),
});

const dataExportRequestWireSchema = object({
  id: string({ min: 1 }),
  userId: string({ min: 1 }),
  type: string({ min: 1 }),
  status: string({ min: 1 }),
  format: string({ min: 1 }),
  downloadUrl: nullable(string()),
  expiresAt: nullable(string()),
  completedAt: nullable(string()),
  errorMessage: nullable(string()),
  createdAt: string({ min: 1 }),
});
export type DataExportRequestItem = Infer<typeof dataExportRequestWireSchema>;

export const dataExportRequestResponseSchema = object({
  exportRequest: dataExportRequestWireSchema,
});
export type DataExportRequestResponse = Infer<typeof dataExportRequestResponseSchema>;

export const dataExportDownloadResponseSchema = union([
  object({
    export: record(json(), string({ min: 1 })),
  }),
  object({
    status: literal(200),
    wire: string(),
    headers: record(string(), string({ min: 1 })),
  }),
]);
export type DataExportDownloadResponse = Infer<typeof dataExportDownloadResponseSchema>;

const ageAssuranceCheckWireSchema = object({
  id: string({ min: 1 }),
  userId: string({ min: 1 }),
  provider: string({ min: 1 }),
  method: enumOf(AGE_ASSURANCE_METHODS),
  threshold: number({ int: true, min: 13, max: 120 }),
  resultOverThreshold: boolean(),
  assuranceLevel: enumOf(AGE_ASSURANCE_LEVELS),
  jurisdiction: nullable(string()),
  providerRef: nullable(string()),
  checkedAt: string({ min: 1 }),
  expiresAt: nullable(string()),
  createdAt: string({ min: 1 }),
});
export type AgeAssuranceCheckItem = Infer<typeof ageAssuranceCheckWireSchema>;

export const startAgeAssuranceBodySchema = object({
  threshold: optional(number({ label: 'threshold', int: true, min: 13, max: 120 })),
  method: optional(enumOf(AGE_ASSURANCE_METHODS)),
  confirmed: boolean({ label: 'confirmed' }),
  providerRef: optional(string({ label: 'providerRef', min: 1, max: 256 })),
});
export type StartAgeAssuranceBody = Infer<typeof startAgeAssuranceBodySchema>;

export const startAgeAssuranceResponseSchema = object({
  check: ageAssuranceCheckWireSchema,
});

export const ageAssuranceStatusResponseSchema = object({
  ageVerifiedFor: nullable(number({ int: true, min: 13 })),
  minimumAge: number({ int: true, min: 13 }),
  jurisdiction: nullable(string({ min: 2 })),
  requiresAgeAssurance: boolean(),
  serviceAvailable: boolean(),
  checks: array(ageAssuranceCheckWireSchema),
});
export type AgeAssuranceStatusResponse = Infer<typeof ageAssuranceStatusResponseSchema>;

const legalHoldWireSchema = object({
  id: string({ min: 1 }),
  subjectType: enumOf(LEGAL_HOLD_SUBJECT_TYPES),
  subjectId: string({ min: 1 }),
  reason: string({ min: 1 }),
  createdByUserId: nullable(string()),
  heldUntil: nullable(string()),
  releasedAt: nullable(string()),
  releasedByUserId: nullable(string()),
  createdAt: string({ min: 1 }),
  updatedAt: string({ min: 1 }),
});
export type LegalHoldItem = Infer<typeof legalHoldWireSchema>;

export const placeLegalHoldBodySchema = object({
  subjectType: enumOf(LEGAL_HOLD_SUBJECT_TYPES),
  subjectId: string({ label: 'subjectId', min: 1, max: 256 }),
  reason: string({ label: 'reason', min: 3, max: 1000 }),
  heldUntil: optional(validDateStringSchema),
});
export type PlaceLegalHoldBody = Infer<typeof placeLegalHoldBodySchema>;

export const legalHoldResponseSchema = object({
  hold: legalHoldWireSchema,
});

export const listLegalHoldsQuerySchema = object({
  activeOnly: optional(enumOf(['true', 'false'] as const)),
  subjectType: optional(enumOf(LEGAL_HOLD_SUBJECT_TYPES)),
});
export type ListLegalHoldsQuery = Infer<typeof listLegalHoldsQuerySchema>;

export const listLegalHoldsResponseSchema = object({
  holds: array(legalHoldWireSchema),
});

const jurisdictionRuleWireSchema = object({
  jurisdiction: string({ min: 2, max: 16 }),
  minimumAge: number({ int: true, min: 13, max: 120 }),
  requiresAgeAssurance: boolean(),
  allowedMethods: array(enumOf(AGE_ASSURANCE_METHODS)),
  serviceAvailable: boolean(),
  updatedAt: string({ min: 1 }),
});
export type JurisdictionRuleItem = Infer<typeof jurisdictionRuleWireSchema>;

export const upsertJurisdictionRuleBodySchema = object({
  jurisdiction: string({ label: 'jurisdiction', min: 2, max: 16 }),
  minimumAge: number({ label: 'minimumAge', int: true, min: 13, max: 120 }),
  requiresAgeAssurance: boolean({ label: 'requiresAgeAssurance' }),
  allowedMethods: optional(array(enumOf(AGE_ASSURANCE_METHODS), { min: 1 })),
  serviceAvailable: optional(boolean({ label: 'serviceAvailable' })),
});
export type UpsertJurisdictionRuleBody = Infer<typeof upsertJurisdictionRuleBodySchema>;

export const jurisdictionRuleResponseSchema = object({
  rule: jurisdictionRuleWireSchema,
});

export const eraseUserResponseSchema = object({
  userId: string({ min: 1 }),
  erasedModules: array(string({ min: 1 })),
});

export const complianceEnvSchema = object({
  COMPLIANCE_MINIMUM_SIGNUP_AGE: optional(
    number({
      label: 'COMPLIANCE_MINIMUM_SIGNUP_AGE',
      coerce: true,
      int: true,
      min: 13,
      max: 120,
    }),
  ),
  COMPLIANCE_DEFAULT_JURISDICTION: optional(
    string({
      label: 'COMPLIANCE_DEFAULT_JURISDICTION',
      min: 2,
      max: 16,
    }),
  ),
});
export type ComplianceEnv = Infer<typeof complianceEnvSchema>;
