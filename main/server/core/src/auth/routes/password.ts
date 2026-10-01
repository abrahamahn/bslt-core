// main/server/core/src/auth/routes/password.ts
/**
 * Password Route Entries
 *
 * Password reset and password lifecycle routes.
 */

import {
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  setPasswordRequestSchema,
  type ForgotPasswordRequest,
  type ResetPasswordRequest,
  type SetPasswordRequest,
} from '@bslt/shared/core/auth';

import { handleForgotPassword, handleResetPassword, handleSetPassword } from '../handlers';

import { authProtectedRoute, authPublicRoute, defineAuthRouteEntries } from './helpers';

export const passwordRouteEntries = defineAuthRouteEntries([
  [
    'auth/forgot-password',
    authPublicRoute<ForgotPasswordRequest>(
      'POST',
      handleForgotPassword,
      forgotPasswordRequestSchema,
      { summary: 'Request password reset', tags: ['Auth'] },
    ),
  ],

  [
    'auth/reset-password',
    authPublicRoute<ResetPasswordRequest>('POST', handleResetPassword, resetPasswordRequestSchema, {
      summary: 'Reset password with token',
      tags: ['Auth'],
    }),
  ],

  [
    'auth/set-password',
    authProtectedRoute<SetPasswordRequest>(
      'POST',
      handleSetPassword,
      'user',
      setPasswordRequestSchema,
      { summary: 'Set password', tags: ['Auth'] },
    ),
  ],
]);
