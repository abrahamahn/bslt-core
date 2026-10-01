// main/server/core/src/auth/password/service.ts
import { and, eq, insert, isNull, update } from '@bslt/db/builder';
import { AUTH_TOKENS_TABLE, USERS_TABLE } from '@bslt/db/schema';
import { withTransaction } from '@bslt/db/utils';
import { AUTH_EXPIRY } from '@bslt/shared/constants/core';
import { MS_PER_HOUR } from '@bslt/shared/constants/time';
import { validatePassword } from '@bslt/shared/core/auth';
import { canonicalizeEmail } from '@bslt/shared/helpers';

import { record } from '../../audit/service';
import { notifyAdmins } from '../../notifications/admin-alerts';
import {
  EmailSendError,
  InvalidCredentialsError,
  InvalidTokenError,
  WeakPasswordError,
} from '../errors';
import { buildEmailOptions } from '../support/email';
import { generateSecureToken, hashPassword, hashToken, revokeAllUserTokens } from '../utils';

import type { AuthEmailService, AuthEmailTemplates } from '../types';
import type { DbClient } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';
import type { AuthConfig } from '@bslt/shared/system/config';

const TOKEN_EXPIRY_HOURS = AUTH_EXPIRY.VERIFICATION_TOKEN_HOURS;

export async function requestPasswordReset(
  db: DbClient,
  repos: Pick<Repositories, 'users'>,
  emailService: AuthEmailService,
  emailTemplates: AuthEmailTemplates,
  email: string,
  baseUrl: string,
): Promise<void> {
  const canonicalEmail = canonicalizeEmail(email);
  const user = await repos.users.findByEmail(canonicalEmail);

  if (user === null) {
    return;
  }

  const { plain, hash } = generateSecureToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * MS_PER_HOUR);

  await withTransaction(db, async (tx) => {
    await tx.execute(
      update(AUTH_TOKENS_TABLE)
        .set({ used_at: new Date() })
        .where(and(eq('type', 'password_reset'), eq('user_id', user.id), isNull('used_at')))
        .toSql(),
    );

    await tx.execute(
      insert(AUTH_TOKENS_TABLE)
        .values({
          type: 'password_reset',
          user_id: user.id,
          token_hash: hash,
          expires_at: expiresAt,
        })
        .toSql(),
    );
  });

  const resetUrl = `${baseUrl}/auth/reset-password?token=${plain}`;
  const emailTemplate = emailTemplates.passwordReset(resetUrl);

  try {
    const result = await emailService.send(buildEmailOptions(user.email, emailTemplate));
    if (!result.success) {
      throw new Error(result.error ?? 'Unknown email error');
    }
  } catch (error) {
    throw new EmailSendError(
      'Failed to send password reset email',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

export async function resetPassword(
  db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  token: string,
  newPassword: string,
): Promise<string> {
  const tokenHash = hashToken(token);
  const tokenRecord = await repos.authTokens.findValidByTokenHash('password_reset', tokenHash);

  if (tokenRecord === null) {
    throw new InvalidTokenError('Invalid or expired reset token');
  }

  if (tokenRecord.userId === null) {
    throw new InvalidTokenError('Token is not associated with a user');
  }

  const user = await repos.users.findById(tokenRecord.userId);

  if (user === null) {
    throw new InvalidTokenError('User not found for the given token');
  }

  const passwordValidation = validatePassword(
    newPassword,
    [user.email, user.username, user.firstName, user.lastName].filter(
      (value): value is string => value !== null,
    ),
  );
  if (!passwordValidation.isValid) {
    throw new WeakPasswordError({ errors: passwordValidation.errors });
  }

  const passwordHash = await hashPassword(newPassword, config.argon2);

  await withTransaction(db, async (tx) => {
    await tx.execute(
      update(USERS_TABLE)
        .set({ password_hash: passwordHash })
        .where(eq('id', tokenRecord.userId))
        .toSql(),
    );

    await tx.execute(
      update(AUTH_TOKENS_TABLE)
        .set({ used_at: new Date() })
        .where(eq('id', tokenRecord.id))
        .toSql(),
    );
  });

  await revokeAllUserTokens(db, tokenRecord.userId);

  // Fire-and-forget audit logging so the admin audit log reflects password resets,
  // mirroring the authenticated password-change flow (users/handlers/account.ts).
  record(
    { auditEvents: repos.auditEvents },
    {
      actorId: user.id,
      action: 'user.password_reset',
      resource: 'user',
      resourceId: user.id,
      severity: 'warn',
      category: 'security',
    },
  ).catch(() => {});

  // Fire-and-forget: alert admins/moderators of the completed password reset
  void notifyAdmins(
    { repos },
    {
      type: 'password_reset',
      subject: { userId: user.id, email: user.email, username: user.username },
    },
  );

  return user.email;
}

/**
 * Sentinel prefixes for accounts created without a real password (magic link,
 * email OTP, OAuth). The stored hash is random and unusable, so these users have
 * no password and may set one.
 */
const PASSWORDLESS_HASH_PREFIXES = ['magiclink:', 'emailotp:', 'oauth:'] as const;

export function hasPassword(passwordHash: string): boolean {
  return !PASSWORDLESS_HASH_PREFIXES.some((prefix) => passwordHash.startsWith(prefix));
}

export async function setPassword(
  _db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  userId: string,
  newPassword: string,
): Promise<void> {
  const user = await repos.users.findById(userId);

  if (user === null) {
    throw new InvalidCredentialsError();
  }

  if (hasPassword(user.passwordHash)) {
    const error = new Error('User already has a password set');
    error.name = 'PasswordAlreadySetError';
    throw error;
  }

  const passwordValidation = validatePassword(
    newPassword,
    [user.email, user.username, user.firstName, user.lastName].filter(
      (value): value is string => value !== null,
    ),
  );
  if (!passwordValidation.isValid) {
    throw new WeakPasswordError({ errors: passwordValidation.errors });
  }

  const passwordHashValue = await hashPassword(newPassword, config.argon2);
  await repos.users.update(userId, { passwordHash: passwordHashValue });
}
