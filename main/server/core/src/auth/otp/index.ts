// main/server/core/src/auth/otp/index.ts
/**
 * Email OTP Module
 *
 * Passwordless authentication via a one-time 6-digit email code.
 *
 * @module otp
 */

// Routes
export { emailOtpRouteEntries, emailOtpRoutes } from './routes';

// Handlers
export { handleEmailOtpRequest, handleEmailOtpVerify } from './handlers';

// Service
export {
  requestEmailOtp,
  verifyEmailOtp,
  type EmailOtpRequestOptions,
  type EmailOtpResult,
  type RequestEmailOtpResult,
} from './service';
