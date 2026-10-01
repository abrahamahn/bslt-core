// main/server/core/src/auth/verification/service.ts
import { and, eq, insert, isNull, update } from '@bslt/db/builder';
import { AUTH_TOKENS_TABLE, USER_COLUMNS, USERS_TABLE, type User } from '@bslt/db/schema';
import { toCamelCase, withTransaction } from '@bslt/db/utils';
import { AUTH_EXPIRY } from '@bslt/shared/constants/core';
import { MS_PER_HOUR } from '@bslt/shared/constants/time';
import { canonicalizeEmail } from '@bslt/shared/helpers';

import { EmailSendError, InvalidTokenError } from '../errors';
import { buildEmailOptions } from '../support/email';
import {
  createAccessToken,
  createAuthResponse,
  createRefreshTokenFamily,
  generateSecureToken,
  hashToken,
} from '../utils';

import type { AuthResult } from '../service';
import type { AuthEmailService, AuthEmailTemplates } from '../types';
import type { DbClient } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';
import type { AuthConfig } from '@bslt/shared/system/config';

const TOKEN_EXPIRY_HOURS = AUTH_EXPIRY.VERIFICATION_TOKEN_HOURS;

export async function createEmailVerificationToken(
  dbOrRepos: DbClient | Repositories,
  userId: string,
): Promise<string> {
  const { plain, hash } = generateSecureToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * MS_PER_HOUR);

  if ('authTokens' in dbOrRepos) {
    await dbOrRepos.authTokens.create({
      type: 'email_verification',
      userId,
      tokenHash: hash,
      expiresAt,
    });
  } else {
    await dbOrRepos.execute(
      insert(AUTH_TOKENS_TABLE)
        .values({
          type: 'email_verification',
          user_id: userId,
          token_hash: hash,
          expires_at: expiresAt,
        })
        .toSql(),
    );
  }

  return plain;
}

export async function resendVerificationEmail(
  db: DbClient,
  repos: Repositories,
  emailService: AuthEmailService,
  emailTemplates: AuthEmailTemplates,
  email: string,
  baseUrl: string,
): Promise<void> {
  const canonicalEmail = canonicalizeEmail(email);
  const user = await repos.users.findByEmail(canonicalEmail);

  if (user === null || user.emailVerified) {
    return;
  }

  const verificationToken = await withTransaction(db, async (tx) => {
    await tx.execute(
      update(AUTH_TOKENS_TABLE)
        .set({ used_at: new Date() })
        .where(and(eq('type', 'email_verification'), eq('user_id', user.id), isNull('used_at')))
        .toSql(),
    );

    return createEmailVerificationToken(tx, user.id);
  });

  const verifyUrl = `${baseUrl}/auth/confirm-email?token=${verificationToken}`;
  const emailTemplate = emailTemplates.emailVerification(verifyUrl);

  try {
    const result = await emailService.send(buildEmailOptions(user.email, emailTemplate));
    if (!result.success) {
      throw new Error(result.error ?? 'Unknown email error');
    }
  } catch (error) {
    throw new EmailSendError(
      'Failed to send verification email',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

export async function verifyEmail(
  db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  token: string,
): Promise<AuthResult> {
  const tokenHash = hashToken(token);
  const tokenRecord = await repos.authTokens.findValidByTokenHash('email_verification', tokenHash);

  if (tokenRecord === null) {
    throw new InvalidTokenError('Invalid or expired verification token');
  }

  if (tokenRecord.userId === null) {
    throw new InvalidTokenError('Token is not associated with a user');
  }

  const verifiedUserId = tokenRecord.userId;

  const { user, refreshToken } = await withTransaction(db, async (tx) => {
    const updatedUserRows = await tx.query(
      update(USERS_TABLE)
        .set({ email_verified: true, email_verified_at: new Date() })
        .where(eq('id', verifiedUserId))
        .returningAll()
        .toSql(),
    );

    if (updatedUserRows[0] === undefined) {
      throw new Error('Failed to verify user');
    }

    const updatedUser = toCamelCase<User>(updatedUserRows[0], USER_COLUMNS);

    const updatedTokens = await tx.query(
      update(AUTH_TOKENS_TABLE)
        .set({ used_at: new Date() })
        .where(and(eq('type', 'email_verification'), eq('id', tokenRecord.id), isNull('used_at')))
        .returningAll()
        .toSql(),
    );

    if (updatedTokens[0] === undefined) {
      throw new InvalidTokenError('Token already used');
    }

    const { token: refreshTok } = await createRefreshTokenFamily(
      tx,
      updatedUser.id,
      config.refreshToken.expiryDays,
    );

    return { user: updatedUser, refreshToken: refreshTok };
  });

  const accessToken = createAccessToken(
    user.id,
    user.email,
    user.role,
    config.jwt.secret,
    config.jwt.accessTokenExpiry,
    user.tokenVersion,
  );

  return createAuthResponse(accessToken, refreshToken, user);
}
