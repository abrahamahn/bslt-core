// main/apps/web/src/__tests__/webauthn-fixtures.ts
/**
 * Passkey options as the server sends them, credential stubs as a browser
 * resolves them, and the wire JSON the replaced browser library produced for
 * those stubs (recorded from its 14.0.0 release). Key order is part of the
 * recording, so tests compare `JSON.stringify` output.
 */

export const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

/** Bytes 0..255 encoded: every base64url character, padding dropped. */
export const ALL_BYTES_BASE64URL =
  'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn-AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq-wsbKztLW2t7i5uru8vb6_wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t_g4eLj5OXm5-jp6uvs7e7v8PHy8_T19vf4-fr7_P3-_w';

export const ALL_BYTES = bytes(...Array.from({ length: 256 }, (_, index) => index));

/** Shaped like the server's registration options (service.ts, generateRegistrationOptions). */
export const REGISTRATION_OPTIONS = {
  challenge: 'AQIDBA',
  rp: { name: 'BSLT', id: 'localhost' },
  user: { id: '-_8', name: 'ada@example.com', displayName: 'ada@example.com' },
  pubKeyCredParams: [
    { alg: -8, type: 'public-key' },
    { alg: -7, type: 'public-key' },
    { alg: -257, type: 'public-key' },
  ],
  timeout: 60000,
  attestation: 'none',
  excludeCredentials: [{ id: 'AQ', type: 'public-key', transports: ['usb', 'smart-card'] }],
  authenticatorSelection: {
    residentKey: 'preferred',
    userVerification: 'preferred',
    requireResidentKey: false,
  },
  extensions: { credProps: true },
  hints: [],
};

/** Shaped like the server's login options, `sessionKey` appended. */
export const AUTHENTICATION_OPTIONS = {
  rpId: '127.0.0.1',
  challenge: 'AQIDBA',
  allowCredentials: [{ id: '-_8', type: 'public-key', transports: ['internal', 'hybrid'] }],
  timeout: 60000,
  userVerification: 'preferred',
  sessionKey: 'auth:k',
};

export const FULL_REGISTRATION_CREDENTIAL = {
  id: 'cred-id',
  rawId: bytes(0xfb, 0xff, 0xbf),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: {
    attestationObject: ALL_BYTES,
    clientDataJSON: bytes(0x7b, 0x7d),
    getTransports: (): string[] => ['internal', 'hybrid'],
    getPublicKeyAlgorithm: (): number => -7,
    getPublicKey: (): ArrayBuffer => bytes(1),
    getAuthenticatorData: (): ArrayBuffer => bytes(1, 2),
  },
  getClientExtensionResults: (): AuthenticationExtensionsClientOutputs => ({
    credProps: { rk: true },
  }),
};

export const FULL_REGISTRATION_JSON = {
  id: 'cred-id',
  rawId: '-_-_',
  response: {
    attestationObject: ALL_BYTES_BASE64URL,
    clientDataJSON: 'e30',
    transports: ['internal', 'hybrid'],
    publicKeyAlgorithm: -7,
    publicKey: 'AQ',
    authenticatorData: 'AQI',
  },
  type: 'public-key',
  clientExtensionResults: { credProps: { rk: true } },
  authenticatorAttachment: 'platform',
};

/** The plain-object credential tests/e2e/specs/auth/passkey-login.e2e.ts resolves. */
export const E2E_AUTHENTICATION_CREDENTIAL = {
  id: 'mock-credential-id',
  rawId: bytes(1, 2, 3, 4),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: {
    clientDataJSON: bytes(5, 6, 7),
    authenticatorData: bytes(8, 9, 10),
    signature: bytes(11, 12, 13),
    userHandle: null,
  },
  getClientExtensionResults: (): AuthenticationExtensionsClientOutputs => ({}),
};

export const E2E_AUTHENTICATION_JSON = {
  id: 'mock-credential-id',
  rawId: 'AQIDBA',
  response: { authenticatorData: 'CAkK', clientDataJSON: 'BQYH', signature: 'CwwN' },
  type: 'public-key',
  clientExtensionResults: {},
  authenticatorAttachment: 'platform',
};
