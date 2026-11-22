// main/kernel/client/src/transport/index.ts
export {
  clearCsrfTokenCache,
  clearRequirementHandlers,
  createTransport,
  getTransportCsrfToken,
  isHttpStatusError,
  registerRequirementHandler,
  setDefaultOnUnauthorized,
  setDefaultTenantIdGetter,
  type RequirementInterceptor,
  type RequirementInterceptorHandler,
  type Transport,
  type TransportConfig,
  type TransportErrorBody,
  type TransportRequestOptions,
} from './transport';
export {
  createEndpointClient,
  createPersistAllowlist,
  type EndpointCall,
  type EndpointCallMeta,
  type EndpointClient,
  type EndpointClientInput,
} from './endpoint-client';
export { requestRealtimeTicket } from './realtime-ticket';

export {
  ApiError,
  createApiError,
  getErrorMessage,
  isApiError,
  isAuthenticationError,
  isNetworkError,
  isTimeoutError,
  NetworkError,
  TimeoutError,
} from './errors';
export { addAuthHeader, createTokenStore, tokenStore, type TokenStore } from './token-store';
