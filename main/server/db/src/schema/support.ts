// main/server/db/src/schema/support.ts
/**
 * Support Requests Schema Types
 *
 * TypeScript interfaces for the support_requests table (customer contact-form
 * submissions). Maps to migration 0910_support_requests.sql.
 */

export const SUPPORT_REQUESTS_TABLE = 'support_requests';

export type SupportRequestStatus = 'open' | 'resolved';

export interface SupportRequestRecord {
  id: string;
  userId: string | null;
  email: string;
  subject: string;
  message: string;
  category: string;
  status: SupportRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSupportRequestRecord {
  id?: string;
  userId?: string | null;
  email: string;
  subject: string;
  message: string;
  category: string;
  status?: SupportRequestStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export const SUPPORT_REQUEST_COLUMNS = {
  id: 'id',
  userId: 'user_id',
  email: 'email',
  subject: 'subject',
  message: 'message',
  category: 'category',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
} as const;
