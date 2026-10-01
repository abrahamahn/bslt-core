// main/server/core/src/compliance/data-export/serialize.ts
/**
 * Data Export Serialization
 *
 * Renders an aggregated {@link UserDataExport} into a downloadable payload.
 * JSON is handled by the transport layer directly; this module owns the CSV
 * representation so the HTTP handler stays thin.
 */

import type { UserDataExport } from './types';
import type { DataExportFormat } from '@bslt/shared/core/compliance';

// ============================================================================
// CSV Primitives
// ============================================================================

/** MIME type for a CSV export download. */
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

/**
 * Escape a single CSV field per RFC 4180: wrap in quotes when it contains a
 * comma, quote, or newline, doubling any embedded quotes. Dates render as
 * ISO strings and other objects as JSON (never '[object Object]').
 */
function csvField(value: unknown): string {
  const text = csvText(value);
  return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Render an export value as plain text: ISO dates, JSON objects, bare scalars. */
function csvText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** Join a row of values into a single CSV line. */
function csvRow(values: readonly unknown[]): string {
  return values.map(csvField).join(',');
}

/** Coerce an unknown export record into an indexable object. */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Render one labelled section: a `# section` comment, a header row derived from
 * the first record's keys, then one line per record. Empty sections are marked
 * explicitly so the structure is unambiguous.
 */
function csvSection(title: string, rows: readonly unknown[]): string {
  const records = rows.map(asRecord);
  const header = records[0];
  if (header === undefined) {
    return `# ${title}\n(no records)`;
  }

  const columns = Object.keys(header);
  const lines = [`# ${title}`, csvRow(columns)];
  for (const record of records) {
    lines.push(csvRow(columns.map((column) => record[column])));
  }
  return lines.join('\n');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize a user data export to CSV.
 *
 * The payload aggregates several heterogeneous entity lists, so a single flat
 * table cannot represent it. Instead each category is emitted as its own
 * labelled block (`# profile`, `# files`, ...) separated by a blank line —
 * a spreadsheet-friendly, lossless, human-readable layout.
 *
 * @param data - Aggregated user data export
 * @returns CSV document as a string
 * @complexity O(n) where n is total records across all categories
 */
export function userDataExportToCsv(data: UserDataExport): string {
  const blocks = [
    csvSection('profile', [data.profile]),
    csvSection('memberships', data.memberships ?? []),
    csvSection('subscriptions', data.subscriptions ?? []),
    csvSection('activities', data.activities ?? []),
    csvSection('files', data.files ?? []),
    csvSection('notifications', data.notifications ?? []),
    csvSection('sessions', data.sessions ?? []),
    csvSection('consentHistory', data.consentHistory ?? []),
    csvSection('meta', [{ exportedAt: data.exportedAt, format: data.format }]),
  ];
  return `${blocks.join('\n\n')}\n`;
}

/**
 * Serialize a user data export in the requested format.
 *
 * @param data - Aggregated user data export
 * @param format - Target serialization format
 * @returns The rendered body plus its content type and file extension
 * @complexity O(n) where n is total records across all categories
 */
export function serializeUserDataExport(
  data: UserDataExport,
  format: DataExportFormat,
): { body: string; contentType: string; extension: 'json' | 'csv' } {
  if (format === 'csv') {
    return { body: userDataExportToCsv(data), contentType: CSV_CONTENT_TYPE, extension: 'csv' };
  }
  return {
    body: JSON.stringify({ export: data }, null, 2),
    contentType: 'application/json; charset=utf-8',
    extension: 'json',
  };
}
