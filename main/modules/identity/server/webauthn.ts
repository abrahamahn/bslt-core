// main/modules/identity/server/webauthn.ts
/**
 * Owned WebAuthn Level 3 Relying Party ceremony options and `"none"`-attestation /
 * assertion verification (Decision D11) built on `@bslt/protocols/cbor`,
 * `@bslt/protocols/cose`, and `node:crypto`.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { type CborMap, decodeCbor, decodeCborPrefix } from '@bslt/protocols/cbor';
import {
  COSE_ALGORITHMS,
  parseCosePublicKeyPrefix,
  verifyCoseSignature,
} from '@bslt/protocols/cose';

import type { PasskeyListItem } from '../contract';
import type { IdentityRepository } from './repository';
import type { JsonValue } from '@bslt/schema';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CEREMONY_TIMEOUT_MS = 60_000;
const CHALLENGE_BYTES = 32;
const USER_HANDLE_BYTES = 32;
const MAX_CREDENTIAL_ID_BYTES = 1023;

const AUTH_DATA_FLAG_UP = 0x01;
const AUTH_DATA_FLAG_BE = 0x08;
const AUTH_DATA_FLAG_BS = 0x10;
const AUTH_DATA_FLAG_AT = 0x40;
const AUTH_DATA_FLAG_ED = 0x80;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

interface ChallengeEntry {
  readonly challenge: string;
  readonly expiresAt: number;
}

const challengeStore = new Map<string, ChallengeEntry>();

function pruneExpiredChallenges(now: number): void {
  for (const [key, entry] of challengeStore) {
    if (entry.expiresAt < now) {
      challengeStore.delete(key);
    }
  }
}

function storeChallenge(key: string, challenge: string): void {
  const now = Date.now();
  pruneExpiredChallenges(now);
  challengeStore.set(key, { challenge, expiresAt: now + CHALLENGE_TTL_MS });
}

function consumeChallenge(key: string): string | null {
  const now = Date.now();
  pruneExpiredChallenges(now);
  const entry = challengeStore.get(key);
  if (entry === undefined) return null;
  challengeStore.delete(key);
  if (entry.expiresAt < now) return null;
  return entry.challenge;
}

export function clearChallengeStore(): void {
  challengeStore.clear();
}

export interface WebauthnServiceConfig {
  readonly rpName: string;
  readonly rpId: string;
  readonly origin: string;
  readonly attestation: 'none' | 'direct';
}

function assertNoneAttestationConfig(config: WebauthnServiceConfig): void {
  if (config.attestation !== 'none') {
    throw new Error('Only WebAuthn "none" attestation is supported');
  }
}

function parseTransports(transports: string | null): string[] | undefined {
  if (transports === null || transports === '') return undefined;
  return transports.split(',').filter((item) => item !== '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCborMap(value: unknown): value is CborMap {
  return value instanceof Map || Object.prototype.toString.call(value) === '[object Map]';
}

function isByteArray(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array ||
    Buffer.isBuffer(value) ||
    Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

function decodeBase64Url(input: string, label: string): Buffer {
  if (input === '' || !BASE64URL_PATTERN.test(input)) {
    throw new Error(`Invalid base64url encoding in ${label}`);
  }
  return Buffer.from(input, 'base64url');
}

function readRequiredString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function verifyCredentialEnvelope(credential: Readonly<Record<string, unknown>>): {
  readonly id: string;
  readonly idBytes: Buffer;
  readonly response: Readonly<Record<string, unknown>>;
} {
  if (credential['type'] !== 'public-key') {
    throw new Error('Invalid WebAuthn credential type');
  }
  const id = readRequiredString(credential, 'id', 'WebAuthn credential id');
  const rawId = readRequiredString(credential, 'rawId', 'WebAuthn raw credential id');
  const idBytes = decodeBase64Url(id, 'WebAuthn credential id');
  const rawIdBytes = decodeBase64Url(rawId, 'WebAuthn raw credential id');
  if (!equalBytes(idBytes, rawIdBytes)) {
    throw new Error('Mismatched WebAuthn credential id and rawId');
  }
  const response = credential['response'];
  if (!isRecord(response)) {
    throw new Error('Invalid WebAuthn authenticator response');
  }
  return { id, idBytes, response };
}

function verifyClientDataJson(
  clientDataB64u: string,
  expectedType: 'webauthn.create' | 'webauthn.get',
  expectedChallengeB64u: string,
  expectedOrigin: string,
): Buffer {
  const clientDataBytes = decodeBase64Url(clientDataB64u, 'WebAuthn clientDataJSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(clientDataBytes.toString('utf8'));
  } catch {
    throw new Error('Malformed JSON in WebAuthn clientDataJSON');
  }
  if (!isRecord(parsed)) {
    throw new Error('WebAuthn clientDataJSON must be a JSON object');
  }
  if (parsed['type'] !== expectedType) {
    throw new Error(`Unexpected WebAuthn ceremony type; expected ${expectedType}`);
  }
  const receivedChallenge = readRequiredString(parsed, 'challenge', 'WebAuthn challenge');
  const receivedChallengeBytes = decodeBase64Url(receivedChallenge, 'WebAuthn client challenge');
  const expectedChallengeBytes = decodeBase64Url(
    expectedChallengeB64u,
    'WebAuthn expected challenge',
  );
  if (!equalBytes(receivedChallengeBytes, expectedChallengeBytes)) {
    throw new Error('WebAuthn challenge mismatch');
  }
  if (parsed['origin'] !== expectedOrigin) {
    throw new Error('WebAuthn origin mismatch');
  }
  if (parsed['crossOrigin'] === true) {
    throw new Error('Cross-origin WebAuthn ceremonies are not permitted');
  }
  return clientDataBytes;
}

interface ParsedAuthenticatorData {
  readonly signCount: number;
  readonly deviceType: 'multiDevice' | 'singleDevice';
  readonly backedUp: boolean;
  readonly attestedCredential?: {
    readonly credentialIdBytes: Uint8Array;
    readonly credentialPublicKeyBytes: Uint8Array;
  };
}

function parseAuthenticatorData(
  authDataBytes: Uint8Array,
  expectedRpId: string,
  requireAttestedCredentialData: boolean,
): ParsedAuthenticatorData {
  if (authDataBytes.byteLength < 37) {
    throw new Error('Truncated WebAuthn authenticatorData');
  }
  const expectedRpIdHash = createHash('sha256').update(expectedRpId, 'utf8').digest();
  if (!equalBytes(authDataBytes.subarray(0, 32), expectedRpIdHash)) {
    throw new Error('WebAuthn rpIdHash mismatch');
  }

  const view = new DataView(
    authDataBytes.buffer,
    authDataBytes.byteOffset,
    authDataBytes.byteLength,
  );
  const flags = view.getUint8(32);
  const userPresent = (flags & AUTH_DATA_FLAG_UP) !== 0;
  if (!userPresent) {
    throw new Error('WebAuthn user presence (UP) flag is required');
  }

  const backupEligible = (flags & AUTH_DATA_FLAG_BE) !== 0;
  const backupState = (flags & AUTH_DATA_FLAG_BS) !== 0;
  if (backupState && !backupEligible) {
    throw new Error('Invalid WebAuthn backup state flags (BS=1 requires BE=1)');
  }

  const hasAttestedCredential = (flags & AUTH_DATA_FLAG_AT) !== 0;
  const hasExtensions = (flags & AUTH_DATA_FLAG_ED) !== 0;
  if (requireAttestedCredentialData && !hasAttestedCredential) {
    throw new Error('WebAuthn registration authenticatorData missing AT flag');
  }

  const signCount = view.getUint32(33, false);
  let offset = 37;
  let attestedCredential:
    | {
        readonly credentialIdBytes: Uint8Array;
        readonly credentialPublicKeyBytes: Uint8Array;
      }
    | undefined;

  if (hasAttestedCredential) {
    if (offset + 18 > authDataBytes.byteLength) {
      throw new Error('Truncated WebAuthn attestedCredentialData header');
    }
    // Skip 16-byte AAGUID (`offset .. offset + 16`)
    const credIdLen = view.getUint16(offset + 16, false);
    offset += 18;
    if (
      credIdLen === 0 ||
      credIdLen > MAX_CREDENTIAL_ID_BYTES ||
      offset + credIdLen > authDataBytes.byteLength
    ) {
      throw new Error('Invalid WebAuthn attested credentialId length');
    }
    const credentialIdBytes = authDataBytes.slice(offset, offset + credIdLen);
    offset += credIdLen;

    const parsedKey = parseCosePublicKeyPrefix(authDataBytes, offset);
    const credentialPublicKeyBytes = authDataBytes.slice(offset, offset + parsedKey.bytesRead);
    offset += parsedKey.bytesRead;

    attestedCredential = { credentialIdBytes, credentialPublicKeyBytes };
  }

  if (hasExtensions) {
    const ext = decodeCborPrefix(authDataBytes, offset);
    if (!isCborMap(ext.value)) {
      throw new Error('WebAuthn authenticator extensions must be a CBOR map');
    }
    offset += ext.bytesRead;
  }

  if (offset !== authDataBytes.byteLength) {
    throw new Error('Trailing unparsed bytes in WebAuthn authenticatorData');
  }

  return {
    signCount,
    deviceType: backupEligible ? 'multiDevice' : 'singleDevice',
    backedUp: backupState,
    ...(attestedCredential !== undefined ? { attestedCredential } : {}),
  };
}

export async function getWebauthnRegistrationOptionsInRepo(
  repo: Pick<IdentityRepository, 'listWebauthnCredentialsByUser'>,
  userId: string,
  userEmail: string,
  config: WebauthnServiceConfig,
): Promise<Record<string, JsonValue>> {
  assertNoneAttestationConfig(config);

  const existing = await repo.listWebauthnCredentialsByUser(userId);
  const excludeCredentials: JsonValue[] = existing.map((cred) => {
    const transports = parseTransports(cred.transports);
    return transports !== undefined
      ? { id: cred.credentialId, type: 'public-key', transports }
      : { id: cred.credentialId, type: 'public-key' };
  });

  const challenge = randomBytes(CHALLENGE_BYTES).toString('base64url');
  const userHandle = randomBytes(USER_HANDLE_BYTES).toString('base64url');

  storeChallenge(`reg:${userId}`, challenge);

  return {
    challenge,
    rp: { name: config.rpName, id: config.rpId },
    user: {
      id: userHandle,
      name: userEmail,
      displayName: userEmail,
    },
    pubKeyCredParams: [
      { alg: COSE_ALGORITHMS.EdDSA, type: 'public-key' },
      { alg: COSE_ALGORITHMS.ES256, type: 'public-key' },
      { alg: COSE_ALGORITHMS.RS256, type: 'public-key' },
    ],
    timeout: CEREMONY_TIMEOUT_MS,
    attestation: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      requireResidentKey: false,
    },
    extensions: { credProps: true },
    hints: [],
  };
}

export async function verifyWebauthnRegistrationInRepo(
  repo: Pick<IdentityRepository, 'createWebauthnCredential'>,
  userId: string,
  credential: Readonly<Record<string, unknown>>,
  config: WebauthnServiceConfig,
  credentialName?: string,
): Promise<{ readonly credentialId: string; readonly message: string }> {
  assertNoneAttestationConfig(config);

  const expectedChallenge = consumeChallenge(`reg:${userId}`);
  if (expectedChallenge === null) {
    throw new Error('Registration challenge expired or not found');
  }

  const { idBytes, response } = verifyCredentialEnvelope(credential);
  const clientDataB64u = readRequiredString(
    response,
    'clientDataJSON',
    'WebAuthn registration client data',
  );
  const attestationObjectB64u = readRequiredString(
    response,
    'attestationObject',
    'WebAuthn attestation object',
  );

  verifyClientDataJson(clientDataB64u, 'webauthn.create', expectedChallenge, config.origin);

  const decodedAttObj = decodeCbor(
    decodeBase64Url(attestationObjectB64u, 'WebAuthn attestationObject'),
  );
  if (!isCborMap(decodedAttObj)) {
    throw new Error('WebAuthn attestationObject must be a CBOR map');
  }
  const fmt = decodedAttObj.get('fmt');
  if (fmt !== 'none') {
    throw new Error('Unsupported WebAuthn attestation format; only "none" is supported');
  }
  const attStmt = decodedAttObj.get('attStmt');
  if (!isCborMap(attStmt) || attStmt.size !== 0) {
    throw new Error('Non-empty WebAuthn attestation statement rejected for "none" attestation');
  }
  const authDataBytes = decodedAttObj.get('authData');
  if (!isByteArray(authDataBytes)) {
    throw new Error('WebAuthn attestationObject missing authData bytes');
  }

  const parsedAuth = parseAuthenticatorData(authDataBytes, config.rpId, true);
  const attested = parsedAuth.attestedCredential;
  if (attested === undefined || !equalBytes(attested.credentialIdBytes, idBytes)) {
    throw new Error('WebAuthn attested credential id mismatch');
  }

  const transportsField = response['transports'];
  const transportsCsv =
    Array.isArray(transportsField) &&
    transportsField.every((transport): transport is string => typeof transport === 'string')
      ? transportsField.join(',')
      : null;

  const stored = await repo.createWebauthnCredential({
    userId,
    credentialId: Buffer.from(attested.credentialIdBytes).toString('base64url'),
    publicKey: Buffer.from(attested.credentialPublicKeyBytes).toString('base64url'),
    counter: parsedAuth.signCount,
    transports: transportsCsv,
    deviceType: parsedAuth.deviceType,
    backedUp: parsedAuth.backedUp,
    name: credentialName ?? 'Passkey',
  });

  return { credentialId: stored.id, message: 'Passkey registered successfully' };
}

export async function getWebauthnAuthenticationOptionsInRepo(
  repo: Pick<IdentityRepository, 'findUserByEmail' | 'listWebauthnCredentialsByUser'>,
  config: WebauthnServiceConfig,
  email?: string,
): Promise<{ readonly options: Record<string, JsonValue>; readonly sessionKey: string }> {
  const allowCredentials: JsonValue[] = [];

  if (email !== undefined && email !== '') {
    const user = await repo.findUserByEmail(email);
    if (user !== null) {
      const creds = await repo.listWebauthnCredentialsByUser(user.id);
      for (const c of creds) {
        const transports = parseTransports(c.transports);
        allowCredentials.push(
          transports !== undefined
            ? { id: c.credentialId, type: 'public-key', transports }
            : { id: c.credentialId, type: 'public-key' },
        );
      }
    }
  }

  const challenge = randomBytes(CHALLENGE_BYTES).toString('base64url');
  const sessionKey = `auth:${randomUUID()}`;
  storeChallenge(sessionKey, challenge);

  const options: Record<string, JsonValue> = {
    rpId: config.rpId,
    challenge,
    ...(allowCredentials.length > 0 ? { allowCredentials } : {}),
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: 'preferred',
    sessionKey,
  };

  return { options, sessionKey };
}

export async function verifyWebauthnAuthenticationInRepo(
  repo: Pick<
    IdentityRepository,
    'findWebauthnCredentialByCredentialId' | 'updateWebauthnCredentialCounter'
  >,
  credential: Readonly<Record<string, unknown>>,
  sessionKey: string,
  config: WebauthnServiceConfig,
): Promise<{ readonly userId: string }> {
  const expectedChallenge = consumeChallenge(sessionKey);
  if (expectedChallenge === null) {
    throw new Error('Authentication challenge expired or not found');
  }

  const rawCredentialId = credential['id'];
  if (typeof rawCredentialId !== 'string' || rawCredentialId === '') {
    throw new Error('Credential ID is missing');
  }

  const storedCred = await repo.findWebauthnCredentialByCredentialId(rawCredentialId);
  if (storedCred === null) {
    throw new Error('Credential not found');
  }

  const { idBytes, response } = verifyCredentialEnvelope(credential);
  const storedIdBytes = decodeBase64Url(storedCred.credentialId, 'stored credential id');
  if (!equalBytes(idBytes, storedIdBytes)) {
    throw new Error('WebAuthn credential id mismatch');
  }

  const clientDataB64u = readRequiredString(
    response,
    'clientDataJSON',
    'WebAuthn authentication client data',
  );
  const authDataB64u = readRequiredString(
    response,
    'authenticatorData',
    'WebAuthn authenticator data',
  );
  const signatureB64u = readRequiredString(response, 'signature', 'WebAuthn signature');

  const clientDataBytes = verifyClientDataJson(
    clientDataB64u,
    'webauthn.get',
    expectedChallenge,
    config.origin,
  );
  const authDataBytes = decodeBase64Url(authDataB64u, 'WebAuthn authenticatorData');
  const signatureBytes = decodeBase64Url(signatureB64u, 'WebAuthn signature');

  const parsedAuth = parseAuthenticatorData(authDataBytes, config.rpId, false);

  const clientDataHash = createHash('sha256').update(clientDataBytes).digest();
  const signedPayload = Buffer.concat([authDataBytes, clientDataHash]);
  const storedPublicKeyBytes = decodeBase64Url(storedCred.publicKey, 'stored COSE public key');

  if (!verifyCoseSignature(storedPublicKeyBytes, signedPayload, signatureBytes)) {
    throw new Error('WebAuthn authentication signature verification failed');
  }

  if (storedCred.counter > 0 && parsedAuth.signCount <= storedCred.counter) {
    throw new Error('WebAuthn signature counter rollback detected');
  }

  await repo.updateWebauthnCredentialCounter(storedCred.id, parsedAuth.signCount);

  return { userId: storedCred.userId };
}

export async function listUserPasskeysInRepo(
  repo: Pick<IdentityRepository, 'listWebauthnCredentialsByUser'>,
  userId: string,
): Promise<PasskeyListItem[]> {
  const creds = await repo.listWebauthnCredentialsByUser(userId);
  return creds.map((c) => ({
    id: c.id,
    name: c.name,
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    createdAt: c.createdAt.toISOString(),
    lastUsedAt: c.lastUsedAt !== null ? c.lastUsedAt.toISOString() : null,
  }));
}

export async function renameUserPasskeyInRepo(
  repo: Pick<IdentityRepository, 'listWebauthnCredentialsByUser' | 'renameWebauthnCredential'>,
  userId: string,
  passkeyId: string,
  name: string,
): Promise<
  | { readonly ok: true; readonly value: { readonly message: string } }
  | { readonly ok: false; readonly code: 'PASSKEY_NOT_FOUND'; readonly message: string }
> {
  const creds = await repo.listWebauthnCredentialsByUser(userId);
  if (!creds.some((c) => c.id === passkeyId)) {
    return { ok: false, code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' };
  }
  await repo.renameWebauthnCredential(passkeyId, name);
  return { ok: true, value: { message: 'Passkey renamed successfully' } };
}

export async function deleteUserPasskeyInRepo(
  repo: Pick<IdentityRepository, 'listWebauthnCredentialsByUser' | 'deleteWebauthnCredential'>,
  userId: string,
  passkeyId: string,
): Promise<
  | { readonly ok: true; readonly value: { readonly message: string } }
  | { readonly ok: false; readonly code: 'PASSKEY_NOT_FOUND'; readonly message: string }
> {
  const creds = await repo.listWebauthnCredentialsByUser(userId);
  if (!creds.some((c) => c.id === passkeyId)) {
    return { ok: false, code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' };
  }
  await repo.deleteWebauthnCredential(passkeyId);
  return { ok: true, value: { message: 'Passkey deleted successfully' } };
}
