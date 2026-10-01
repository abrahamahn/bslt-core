// main/server/core/src/auth/oauth/token-crypto.ts

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

export function encryptToken(token: string, encryptionKey: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = scryptSync(encryptionKey, salt, 32);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptToken(encryptedData: string, encryptionKey: string): string {
  const [saltB64, ivB64, tagB64, encryptedB64] = encryptedData.split(':');

  if (
    saltB64 === undefined ||
    ivB64 === undefined ||
    tagB64 === undefined ||
    encryptedB64 === undefined
  ) {
    throw new Error('Invalid encrypted token format');
  }

  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  const key = scryptSync(encryptionKey, salt, 32);
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
