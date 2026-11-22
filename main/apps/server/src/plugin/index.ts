// main/apps/server/src/plugin/index.ts

export { registerCorrelationIdHook, type CorrelationIdOptions } from './correlation-id';
export { errorHandlerPlugin } from './errors';
export { loggerPlugin } from './logger';
export { registerMultipartFormParser } from './multipart';
export { registerPrototypePollutionProtection } from './prototype-pollution';
export { registerRawBodyCapture } from './raw-body';
export { registerRequestInfoHook } from './request-info';
