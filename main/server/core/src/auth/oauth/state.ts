// main/server/core/src/auth/oauth/state.ts

import { randomBytes } from 'node:crypto';

import { AUTH_EXPIRY } from '@bslt/shared/constants/core';
import { MS_PER_MINUTE } from '@bslt/shared/constants/time';

import { OAuthStateMismatchError } from '../errors';

import { decryptToken, encryptToken } from './token-crypto';

import type { OAuthState } from './types';
import type { OAuthProvider } from '@bslt/db/schema';

const STATE_EXPIRY_MS = AUTH_EXPIRY.OAUTH_STATE_MINUTES * MS_PER_MINUTE;

export function createOAuthState(
  provider: OAuthProvider,
  redirectUri: string,
  isLinking: boolean,
  userId?: string,
  eligibilityAttested?: boolean,
  tosAccepted?: boolean,
): OAuthState {
  return {
    state: randomBytes(32).toString('hex'),
    provider,
    redirectUri,
    isLinking,
    userId,
    eligibilityAttested,
    tosAccepted,
    createdAt: Date.now(),
  };
}

export function encodeOAuthState(state: OAuthState, encryptionKey: string): string {
  return encryptToken(JSON.stringify(state), encryptionKey);
}

export function decodeOAuthState(encoded: string, encryptionKey: string): OAuthState {
  try {
    const state = JSON.parse(decryptToken(encoded, encryptionKey)) as OAuthState;

    if (Date.now() - state.createdAt > STATE_EXPIRY_MS) {
      throw new OAuthStateMismatchError(state.provider);
    }

    return state;
  } catch (error) {
    if (error instanceof OAuthStateMismatchError) {
      throw error;
    }
    throw new OAuthStateMismatchError('unknown');
  }
}
