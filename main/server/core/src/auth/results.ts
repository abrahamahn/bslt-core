// main/server/core/src/auth/results.ts

import type { AuthUser } from './utils/response';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  sessionFamilyId?: string;
  /** Public user shape (includes lifecycle timestamps for reactivation prompts). */
  user: AuthUser;
}

export interface TotpChallengeResult {
  requiresTotp: true;
  challengeToken: string;
  message: string;
}

export interface SmsChallengeResult {
  requiresSms: true;
  challengeToken: string;
  message: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterResult {
  status: 'pending_verification' | 'verified';
  message: string;
  email: string;
}
