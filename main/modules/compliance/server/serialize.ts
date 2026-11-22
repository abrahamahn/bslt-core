// main/modules/compliance/server/serialize.ts
import type { DataExportFormat } from '../contract';

export interface UserDataExport {
  readonly profile: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly username: string | null;
    readonly role: string;
    readonly createdAt: string;
  };
  readonly memberships?: ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  readonly subscriptions?: ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  readonly activities?: ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  readonly files?: ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  readonly notifications?: ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  readonly sessions?: ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  readonly consentHistory?: ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  readonly modules?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
  readonly exportedAt: string;
  readonly format: DataExportFormat;
}

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

function csvText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function csvField(value: unknown): string {
  const text = csvText(value);
  return /["\n\r,]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function csvRow(values: readonly unknown[]): string {
  return values.map(csvField).join(',');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

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

export function userDataExportToCsv(data: UserDataExport): string {
  const blocks: string[] = [
    csvSection('profile', [data.profile]),
    csvSection('memberships', data.memberships ?? []),
    csvSection('subscriptions', data.subscriptions ?? []),
    csvSection('activities', data.activities ?? []),
    csvSection('files', data.files ?? []),
    csvSection('notifications', data.notifications ?? []),
    csvSection('sessions', data.sessions ?? []),
    csvSection('consentHistory', data.consentHistory ?? []),
  ];

  if (data.modules !== undefined) {
    for (const [moduleId, payload] of Object.entries(data.modules)) {
      for (const [key, value] of Object.entries(payload)) {
        if (Array.isArray(value)) {
          blocks.push(csvSection(`${moduleId}.${key}`, value));
        }
      }
    }
  }

  blocks.push(csvSection('meta', [{ exportedAt: data.exportedAt, format: data.format }]));
  return `${blocks.join('\n\n')}\n`;
}

export function serializeUserDataExport(
  data: UserDataExport,
  format: DataExportFormat,
): { readonly body: string; readonly contentType: string; readonly extension: 'json' | 'csv' } {
  if (format === 'csv') {
    return { body: userDataExportToCsv(data), contentType: CSV_CONTENT_TYPE, extension: 'csv' };
  }
  return {
    body: JSON.stringify({ export: data }, null, 2),
    contentType: 'application/json; charset=utf-8',
    extension: 'json',
  };
}
