// main/modules/compliance/contract/events.ts
import { event } from '@bslt/contract';
import { array, boolean, nullable, number, object, string } from '@bslt/schema';

export const complianceEvents = {
  legalDocumentPublished: event(
    'compliance.legal_document.published',
    object({
      documentId: string({ min: 1 }),
      type: string({ min: 1 }),
      version: number({ int: true, min: 1 }),
      publishedByUserId: string({ min: 1 }),
    }),
    {
      audit: { category: 'compliance', severity: 'info' },
    },
  ),
  consentUpdated: event(
    'compliance.consent.updated',
    object({
      userId: string({ min: 1 }),
      updated: number({ int: true, min: 1 }),
    }),
    {
      audit: { category: 'compliance', severity: 'info' },
    },
  ),
  dataExportRequested: event(
    'compliance.data_export.requested',
    object({
      requestId: string({ min: 1 }),
      userId: string({ min: 1 }),
      format: string({ min: 1 }),
    }),
    {
      audit: { category: 'compliance', severity: 'info' },
    },
  ),
  userDataErased: event(
    'compliance.user_data.erased',
    object({
      userId: string({ min: 1 }),
      erasedModules: array(string({ min: 1 })),
    }),
    {
      audit: { category: 'compliance', severity: 'warn' },
    },
  ),
  legalHoldPlaced: event(
    'compliance.legal_hold.placed',
    object({
      holdId: string({ min: 1 }),
      subjectType: string({ min: 1 }),
      subjectId: string({ min: 1 }),
      createdByUserId: nullable(string()),
    }),
    {
      audit: { category: 'compliance', severity: 'warn' },
    },
  ),
  legalHoldReleased: event(
    'compliance.legal_hold.released',
    object({
      holdId: string({ min: 1 }),
      releasedByUserId: nullable(string()),
    }),
    {
      audit: { category: 'compliance', severity: 'info' },
    },
  ),
  ageAssuranceCompleted: event(
    'compliance.age_assurance.completed',
    object({
      checkId: string({ min: 1 }),
      userId: string({ min: 1 }),
      threshold: number({ int: true, min: 13 }),
      resultOverThreshold: boolean(),
    }),
    {
      audit: { category: 'compliance', severity: 'info' },
    },
  ),
} as const;
