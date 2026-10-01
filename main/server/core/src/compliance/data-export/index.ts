// main/server/core/src/compliance/data-export/index.ts
/**
 * Data Export Package
 *
 * Business logic, HTTP handlers, and route definitions for
 * GDPR data export request management and processing.
 */

// Service
export {
  requestDataExport,
  getExportStatus,
  processDataExport,
  buildUserDataExport,
  toDataExportFormat,
  DataExportAlreadyPendingError,
  DataExportNotFoundError,
} from './service';

// Serialization
export { serializeUserDataExport, userDataExportToCsv, CSV_CONTENT_TYPE } from './serialize';

// Handlers
export { handleRequestExport, handleGetExportStatus, handleDownloadExport } from './handlers';

// Routes
export { dataExportRoutes } from './routes';

// Types
export type {
  DataExportAppContext,
  DataExportRepositories,
  DataExportRequest,
  UserDataExport,
} from './types';
