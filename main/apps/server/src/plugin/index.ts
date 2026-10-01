// main/apps/server/src/plugin/index.ts

export {
  API_VERSIONS,
  apiVersioningPlugin,
  CURRENT_API_VERSION,
  extractApiVersion,
  SUPPORTED_API_VERSIONS,
  type ApiVersion,
  type ApiVersionInfo,
  type ApiVersionSource,
} from './api.versioning';
export { registerCorrelationIdHook, type CorrelationIdOptions } from './correlation-id';
export { errorHandlerPlugin } from './errors';
export { loggerPlugin, type LoggerPluginOptions } from './logger';
export { registerMultipartFormParser } from './multipart';
export { registerPrototypePollutionProtection } from './prototype-pollution';
export { registerRawBodyCapture } from './raw-body';
export { registerRequestInfoHook, type RequestInfo } from './request-info';
