// main/apps/web/src/features/settings/components/DataExportSection.tsx
/**
 * Data Export Section
 *
 * Allows users to request a personal data export and view export status.
 * Displays pending/ready/expired states with appropriate actions.
 */

import { formatDateTime } from '@bslt/shared/helpers/date';
import { Alert, Badge, Button, Heading, Select, Text } from '@bslt/ui';
import { useState } from 'react';

import { useDataExport } from '../hooks/useDataExport';

import type { ExportStatus } from '../hooks/useDataExport';
import type { DataExportFormat } from '@bslt/shared/core/compliance';
import type { ReactElement } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface DataExportSectionProps {
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function getStatusBadgeTone(status: ExportStatus): 'success' | 'warning' | 'info' {
  switch (status) {
    case 'ready':
      return 'success';
    case 'pending':
      return 'warning';
    default:
      return 'info';
  }
}

function getStatusLabel(status: ExportStatus): string {
  switch (status) {
    case 'pending':
      return 'Processing';
    case 'ready':
      return 'Ready';
    case 'expired':
      return 'Expired';
    default:
      return 'No Export';
  }
}

// ============================================================================
// Component
// ============================================================================

export const DataExportSection = ({ className }: DataExportSectionProps): ReactElement => {
  const {
    exportInfo,
    isLoading,
    error,
    requestExport,
    isRequesting,
    requestError,
    downloadExport,
    isDownloading,
  } = useDataExport();

  const [format, setFormat] = useState<DataExportFormat>('json');

  const handleRequestExport = (): void => {
    void requestExport(format);
  };

  const handleDownloadExport = (): void => {
    void downloadExport().catch(() => {
      // Error is surfaced through requestError.
    });
  };

  const currentError = error ?? requestError;
  const status = exportInfo?.status ?? 'none';
  const hasPendingExport = status === 'pending';
  const hasReadyExport = status === 'ready';
  const rootClassName =
    className === undefined ? 'settings-data-export' : `settings-data-export ${className}`.trim();

  if (isLoading) {
    return (
      <section className={rootClassName}>
        <Text tone="muted">Loading export status...</Text>
      </section>
    );
  }

  return (
    <section className={rootClassName} data-testid="data-export-section">
      <div className="settings-action-panel__header">
        <div className="settings-action-panel__copy">
          <Heading as="h4" size="sm">
            Export Your Data
          </Heading>
          <Text size="sm" tone="muted">
            Download a copy of all your personal data in a portable format.
          </Text>
        </div>
        {status !== 'none' && (
          <Badge tone={getStatusBadgeTone(status)} data-testid="export-status-badge">
            {getStatusLabel(status)}
          </Badge>
        )}
      </div>

      {currentError !== null && (
        <Alert tone="danger" data-testid="export-error">
          {currentError.message}
        </Alert>
      )}

      {hasPendingExport && exportInfo !== null && (
        <Alert tone="info" data-testid="export-pending-alert">
          Your data export is being prepared.
          {exportInfo.estimatedReadyAt !== null && (
            <> Estimated ready by {formatDateTime(exportInfo.estimatedReadyAt)}.</>
          )}
          {exportInfo.requestedAt !== null && (
            <> Requested on {formatDateTime(exportInfo.requestedAt)}.</>
          )}
        </Alert>
      )}

      {hasReadyExport && exportInfo !== null && (
        <Alert tone="success" data-testid="export-ready-alert">
          Your data export is ready for download.
          {exportInfo.expiresAt !== null && (
            <> The link expires on {formatDateTime(exportInfo.expiresAt)}.</>
          )}
        </Alert>
      )}

      {status === 'expired' && (
        <Alert tone="warning" data-testid="export-expired-alert">
          Your previous export has expired. Request a new one to download your data.
        </Alert>
      )}

      <div className="settings-action-panel__actions">
        {hasReadyExport && (
          <Button
            type="button"
            variant="primary"
            onClick={handleDownloadExport}
            disabled={isDownloading}
            data-testid="download-export-button"
          >
            {isDownloading ? 'Downloading...' : 'Download Export'}
          </Button>
        )}
        <Select
          value={format}
          onChange={(value) => {
            setFormat(value as DataExportFormat);
          }}
          disabled={isRequesting || hasPendingExport}
          aria-label="Export format"
          data-testid="export-format-select"
        >
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </Select>
        <Button
          type="button"
          variant="secondary"
          onClick={handleRequestExport}
          disabled={isRequesting || hasPendingExport}
          data-testid="request-export-button"
        >
          {isRequesting
            ? 'Requesting...'
            : hasPendingExport
              ? 'Export in Progress'
              : 'Request Export'}
        </Button>
      </div>
    </section>
  );
};
