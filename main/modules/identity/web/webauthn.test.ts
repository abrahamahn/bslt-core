// main/modules/identity/web/webauthn.test.ts
/**
 * The passkey codec must hand the server the same JSON, and the screens the same
 * error messages, as the browser library it replaced. Expected values are that
 * library's recorded output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  base64UrlToBytes,
  bytesToBase64Url,
  createPasskey,
  getPasskey,
  type PasskeyCreationOptionsJSON,
  type PasskeyRequestOptionsJSON,
} from './webauthn';

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

const ALL_BYTES_BASE64URL =
  'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn-AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq-wsbKztLW2t7i5uru8vb6_wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t_g4eLj5OXm5-jp6uvs7e7v8PHy8_T19vf4-fr7_P3-_w';

const ALL_BYTES = bytes(...Array.from({ length: 256 }, (_, index) => index));

const REGISTRATION_OPTIONS = {
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

const AUTHENTICATION_OPTIONS = {
  rpId: '127.0.0.1',
  challenge: 'AQIDBA',
  allowCredentials: [{ id: '-_8', type: 'public-key', transports: ['internal', 'hybrid'] }],
  timeout: 60000,
  userVerification: 'preferred',
  sessionKey: 'auth:k',
};

const FULL_REGISTRATION_CREDENTIAL = {
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

const FULL_REGISTRATION_JSON = {
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

const E2E_AUTHENTICATION_CREDENTIAL = {
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

const E2E_AUTHENTICATION_JSON = {
  id: 'mock-credential-id',
  rawId: 'AQIDBA',
  response: { authenticatorData: 'CAkK', clientDataJSON: 'BQYH', signature: 'CwwN' },
  type: 'public-key',
  clientExtensionResults: {},
  authenticatorAttachment: 'platform',
};

type Ceremony = (options: CredentialCreationOptions | CredentialRequestOptions) => Promise<unknown>;

let create = vi.fn<Ceremony>();
let get = vi.fn<Ceremony>();

beforeEach(() => {
  create = vi.fn<Ceremony>();
  get = vi.fn<Ceremony>();
  vi.stubGlobal('PublicKeyCredential', vi.fn());
  Object.defineProperty(navigator, 'credentials', {
    value: { create, get },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const register = (overrides: Record<string, unknown> = {}): Promise<unknown> =>
  createPasskey({ ...REGISTRATION_OPTIONS, ...overrides } as PasskeyCreationOptionsJSON);

const authenticate = (overrides: Record<string, unknown> = {}): Promise<unknown> =>
  getPasskey({ ...AUTHENTICATION_OPTIONS, ...overrides } as PasskeyRequestOptionsJSON);

/** The `publicKey` dictionary handed to the first browser call. */
function publicKeyOf(mock: typeof create): Record<string, unknown> {
  const options = mock.mock.calls[0]?.[0];
  if (options?.publicKey === undefined) throw new Error('the browser was not called');
  return options.publicKey as unknown as Record<string, unknown>;
}

const wire = (value: unknown): string => JSON.stringify(value);
const NATIVE = 'native failure';

const BARE_REGISTRATION_CREDENTIAL = {
  id: 'i',
  rawId: bytes(1),
  type: 'public-key',
  authenticatorAttachment: null,
  response: { attestationObject: bytes(2), clientDataJSON: bytes(3) },
  getClientExtensionResults: (): AuthenticationExtensionsClientOutputs => ({}),
};

const BARE_REGISTRATION_JSON =
  '{"id":"i","rawId":"AQ","response":{"attestationObject":"Ag","clientDataJSON":"Aw"},"type":"public-key","clientExtensionResults":{}}';

const broken = (): never => {
  throw new Error('broken getter');
};

describe('bytesToBase64Url', () => {
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes the RFC 4648 vector %j as %j, unpadded', (text, encoded) => {
    expect(bytesToBase64Url(new TextEncoder().encode(text).buffer)).toBe(encoded);
  });

  it('uses the url alphabet', () => {
    expect(bytesToBase64Url(bytes(0xfb, 0xff, 0xbf))).toBe('-_-_');
  });

  it('encodes every byte value', () => {
    expect(bytesToBase64Url(ALL_BYTES)).toBe(ALL_BYTES_BASE64URL);
  });
});

describe('base64UrlToBytes', () => {
  it.each(['', 'Zg', 'Zm8', 'Zm9v', 'Zm9vYg', 'Zm9vYmE', 'Zm9vYmFy', '-_-_'])(
    'inverts %j',
    (encoded) => {
      expect(bytesToBase64Url(base64UrlToBytes(encoded).buffer)).toBe(encoded);
    },
  );

  it('decodes the url alphabet', () => {
    expect(base64UrlToBytes('-_8')).toEqual(new Uint8Array([0xfb, 0xff]));
  });

  it('round-trips every byte value', () => {
    expect(base64UrlToBytes(ALL_BYTES_BASE64URL)).toEqual(new Uint8Array(ALL_BYTES));
  });

  it.each(['A', 'A*', 'AAAAA'])('rejects the malformed input %j', (encoded) => {
    expect(() => base64UrlToBytes(encoded)).toThrow();
  });
});

describe('createPasskey', () => {
  it('decodes the binary members and passes every other member through', async () => {
    create.mockResolvedValueOnce(FULL_REGISTRATION_CREDENTIAL);

    await register();

    expect(create.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(publicKeyOf(create)).toStrictEqual({
      ...REGISTRATION_OPTIONS,
      challenge: new Uint8Array([1, 2, 3, 4]),
      user: { ...REGISTRATION_OPTIONS.user, id: new Uint8Array([0xfb, 0xff]) },
      excludeCredentials: [
        { id: new Uint8Array([1]), type: 'public-key', transports: ['usb', 'smart-card'] },
      ],
    });
  });

  it('keeps an empty excludeCredentials list: a first passkey still registers', async () => {
    create.mockResolvedValueOnce(BARE_REGISTRATION_CREDENTIAL);

    await register({ excludeCredentials: [] });

    expect(publicKeyOf(create)['excludeCredentials']).toStrictEqual([]);
  });

  it('encodes a full credential exactly as the replaced library did', async () => {
    create.mockResolvedValueOnce(FULL_REGISTRATION_CREDENTIAL);

    expect(wire(await register())).toBe(wire(FULL_REGISTRATION_JSON));
  });

  it('leaves out what a bare credential does not report', async () => {
    create.mockResolvedValueOnce(BARE_REGISTRATION_CREDENTIAL);

    expect(wire(await register())).toBe(BARE_REGISTRATION_JSON);
  });

  it('completes when an extension breaks the optional getters', async () => {
    create.mockResolvedValueOnce({
      ...BARE_REGISTRATION_CREDENTIAL,
      authenticatorAttachment: 'cross-platform',
      response: {
        ...BARE_REGISTRATION_CREDENTIAL.response,
        getTransports: (): string[] => [],
        getPublicKeyAlgorithm: broken,
        getPublicKey: broken,
        getAuthenticatorData: broken,
      },
    });

    expect(wire(await register())).toBe(
      '{"id":"i","rawId":"AQ","response":{"attestationObject":"Ag","clientDataJSON":"Aw","transports":[]},"type":"public-key","clientExtensionResults":{},"authenticatorAttachment":"cross-platform"}',
    );
  });

  it('leaves out a public key the browser reports as null', async () => {
    create.mockResolvedValueOnce({
      ...BARE_REGISTRATION_CREDENTIAL,
      response: { ...BARE_REGISTRATION_CREDENTIAL.response, getPublicKey: (): null => null },
    });

    expect(wire(await register())).toBe(BARE_REGISTRATION_JSON);
  });

  it.each([undefined, {}])(
    'rejects without calling the browser when PublicKeyCredential is %j',
    async (value) => {
      vi.stubGlobal('PublicKeyCredential', value);

      await expect(register()).rejects.toThrow('WebAuthn is not supported in this browser');
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('rejects when the browser resolves no credential', async () => {
    create.mockResolvedValueOnce(null);

    await expect(register()).rejects.toThrow('Registration was not completed');
  });

  it.each([
    ['NotAllowedError', NATIVE],
    ['InvalidStateError', 'The authenticator was previously registered'],
    ['AbortError', 'Registration ceremony was sent an abort signal'],
    [
      'UnknownError',
      'The authenticator was unable to process the specified options, or could not create a new credential',
    ],
    [
      'NotSupportedError',
      'No available authenticator supported any of the specified pubKeyCredParams algorithms',
    ],
    ['ConstraintError', NATIVE],
    ['TypeError', NATIVE],
    ['OperationError', NATIVE],
    ['constructor', NATIVE],
    ['toString', NATIVE],
  ])('reports a %s from the browser as "%s"', async (name, message) => {
    create.mockRejectedValueOnce(new DOMException(NATIVE, name));

    await expect(register()).rejects.toHaveProperty('message', message);
  });

  it.each([
    ['127.0.0.1', '127.0.0.1', '127.0.0.1 is an invalid domain'],
    ['localhost', 'example.org', 'The RP ID "example.org" is invalid for this domain'],
    ['app.example.com', 'example.com', 'The RP ID "example.com" is invalid for this domain'],
  ])('reports a SecurityError on host %s for RP ID %s as "%s"', async (hostname, id, message) => {
    vi.stubGlobal('location', { hostname });
    create.mockRejectedValueOnce(new DOMException(NATIVE, 'SecurityError'));

    await expect(register({ rp: { name: 'BSLT', id } })).rejects.toHaveProperty('message', message);
  });

  it.each(['localhost', 'xn--bcher-kva.example'])(
    'passes a SecurityError through unchanged when the RP ID is the valid host %s',
    async (hostname) => {
      vi.stubGlobal('location', { hostname });
      const refused = new DOMException(NATIVE, 'SecurityError');
      create.mockRejectedValueOnce(refused);

      await expect(register({ rp: { name: 'BSLT', id: hostname } })).rejects.toBe(refused);
    },
  );

  it('reports a NotAllowedError from another realm as an Error, so the screens show its text', async () => {
    // jsdom's DOMException is not an instance of this realm's Error.
    const cancelled = new DOMException(NATIVE, 'NotAllowedError');
    create.mockRejectedValueOnce(cancelled);

    const error: unknown = await register().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: NATIVE, cause: cancelled });
  });

  it.each([null, 'boom', { name: 42 }])(
    'passes the rejection %j through unchanged',
    async (value) => {
      create.mockRejectedValueOnce(value);

      await expect(register()).rejects.toBe(value);
    },
  );
});

describe('getPasskey', () => {
  it('decodes the binary members and passes every other member through', async () => {
    get.mockResolvedValueOnce(E2E_AUTHENTICATION_CREDENTIAL);

    await authenticate();

    expect(get.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(publicKeyOf(get)).toStrictEqual({
      rpId: '127.0.0.1',
      challenge: new Uint8Array([1, 2, 3, 4]),
      allowCredentials: [
        {
          id: new Uint8Array([0xfb, 0xff]),
          type: 'public-key',
          transports: ['internal', 'hybrid'],
        },
      ],
      timeout: 60000,
      userVerification: 'preferred',
      sessionKey: 'auth:k',
    });
  });

  it.each([{ allowCredentials: [] }, { allowCredentials: undefined }])(
    'hands the browser no allowCredentials for %j, so discoverable login works',
    async (overrides) => {
      get.mockResolvedValueOnce(E2E_AUTHENTICATION_CREDENTIAL);

      await authenticate(overrides);

      expect(publicKeyOf(get)).not.toHaveProperty('allowCredentials');
    },
  );

  it('encodes the e2e plain-object credential exactly as the replaced library did', async () => {
    get.mockResolvedValueOnce(E2E_AUTHENTICATION_CREDENTIAL);

    expect(wire(await authenticate())).toBe(wire(E2E_AUTHENTICATION_JSON));
  });

  it.each([
    [
      'a user handle and a known attachment',
      bytes(0x75, 0x31),
      'cross-platform',
      '{"id":"mock-credential-id","rawId":"AQIDBA","response":{"authenticatorData":"CAkK","clientDataJSON":"BQYH","signature":"CwwN","userHandle":"dTE"},"type":"public-key","clientExtensionResults":{},"authenticatorAttachment":"cross-platform"}',
    ],
    [
      'an empty user handle and an unknown attachment',
      bytes(),
      'weird',
      '{"id":"mock-credential-id","rawId":"AQIDBA","response":{"authenticatorData":"CAkK","clientDataJSON":"BQYH","signature":"CwwN","userHandle":""},"type":"public-key","clientExtensionResults":{}}',
    ],
  ])('encodes %s as the replaced library did', async (_case, userHandle, attachment, json) => {
    get.mockResolvedValueOnce({
      ...E2E_AUTHENTICATION_CREDENTIAL,
      authenticatorAttachment: attachment,
      response: { ...E2E_AUTHENTICATION_CREDENTIAL.response, userHandle },
    });

    expect(wire(await authenticate())).toBe(json);
  });

  it('rejects when the browser resolves no credential', async () => {
    get.mockResolvedValueOnce(null);

    await expect(authenticate()).rejects.toThrow('Authentication was not completed');
  });

  it.each([
    ['NotAllowedError', NATIVE],
    ['AbortError', 'Authentication ceremony was sent an abort signal'],
    [
      'UnknownError',
      'The authenticator was unable to process the specified options, or could not create a new assertion signature',
    ],
    ['InvalidStateError', NATIVE],
    ['NotSupportedError', NATIVE],
    ['ConstraintError', NATIVE],
    ['OperationError', NATIVE],
    ['constructor', NATIVE],
    ['toString', NATIVE],
  ])('reports a %s from the browser as "%s"', async (name, message) => {
    get.mockRejectedValueOnce(new DOMException(NATIVE, name));

    await expect(authenticate()).rejects.toHaveProperty('message', message);
  });

  it.each([
    ['127.0.0.1', '127.0.0.1 is an invalid domain'],
    ['localhost', 'The RP ID "127.0.0.1" is invalid for this domain'],
  ])('reports a SecurityError on host %s as "%s"', async (hostname, message) => {
    vi.stubGlobal('location', { hostname });
    get.mockRejectedValueOnce(new DOMException(NATIVE, 'SecurityError'));

    await expect(authenticate()).rejects.toHaveProperty('message', message);
  });

  it('passes a SecurityError through unchanged when the RP ID is the valid host', async () => {
    vi.stubGlobal('location', { hostname: 'app.example.com' });
    const refused = new DOMException(NATIVE, 'SecurityError');
    get.mockRejectedValueOnce(refused);

    await expect(authenticate({ rpId: 'app.example.com' })).rejects.toBe(refused);
  });

  it('rejects without calling the browser when WebAuthn is missing', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);

    await expect(authenticate()).rejects.toThrow('WebAuthn is not supported in this browser');
    expect(get).not.toHaveBeenCalled();
  });

  it('aborts the ceremony in flight when a new one starts', async () => {
    get.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(signal.reason as Error);
          });
        }),
    );
    get.mockResolvedValueOnce(E2E_AUTHENTICATION_CREDENTIAL);

    const first = authenticate();
    const second = authenticate();

    await expect(first).rejects.toThrow('Authentication ceremony was sent an abort signal');
    await expect(second).resolves.toMatchObject({ id: 'mock-credential-id' });
    const firstSignal = get.mock.calls[0]?.[0].signal;
    expect(firstSignal?.aborted).toBe(true);
    expect(firstSignal?.reason).toMatchObject({ name: 'AbortError' });
  });
});
