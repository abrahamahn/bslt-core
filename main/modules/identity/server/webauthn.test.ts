// main/modules/identity/server/webauthn.test.ts
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeCbor } from '@bslt/protocols/cbor';
import { COSE_ALGORITHMS } from '@bslt/protocols/cose';

import {
  clearChallengeStore,
  deleteUserPasskeyInRepo,
  getWebauthnAuthenticationOptionsInRepo,
  getWebauthnRegistrationOptionsInRepo,
  listUserPasskeysInRepo,
  renameUserPasskeyInRepo,
  verifyWebauthnAuthenticationInRepo,
  verifyWebauthnRegistrationInRepo,
  type WebauthnServiceConfig,
} from './webauthn';

import type { IdentityRepository } from './repository';

const WEBAUTHN_CFG: WebauthnServiceConfig = {
  rpName: 'BSLT Test',
  rpId: 'localhost',
  origin: 'http://localhost:5173',
  attestation: 'none',
};

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

interface VirtualAuthenticator {
  readonly credentialIdBytes: Buffer;
  readonly credentialIdB64u: string;
  readonly cosePublicKey: Buffer;
  readonly signAssertion: (payload: Uint8Array) => Buffer;
}

function createVirtualAuthenticator(alg: -7 | -8 | -257 = -7): VirtualAuthenticator {
  const credentialIdBytes = randomBytes(32);
  const credentialIdB64u = credentialIdBytes.toString('base64url');

  if (alg === COSE_ALGORITHMS.ES256) {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const cosePublicKey = encodeCbor(
      new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]),
    );
    return {
      credentialIdBytes,
      credentialIdB64u,
      cosePublicKey,
      signAssertion: (payload) => sign('sha256', payload, privateKey),
    };
  }

  if (alg === COSE_ALGORITHMS.EdDSA) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
    const cosePublicKey = encodeCbor(
      new Map<number | string, unknown>([
        [1, 1],
        [3, -8],
        [-1, 6],
        [-2, Buffer.from(jwk.x, 'base64url')],
      ]),
    );
    return {
      credentialIdBytes,
      credentialIdB64u,
      cosePublicKey,
      signAssertion: (payload) => sign(null, payload, privateKey),
    };
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  const cosePublicKey = encodeCbor(
    new Map<number | string, unknown>([
      [1, 3],
      [3, -257],
      [-1, Buffer.from(jwk.n, 'base64url')],
      [-2, Buffer.from(jwk.e, 'base64url')],
    ]),
  );
  return {
    credentialIdBytes,
    credentialIdB64u,
    cosePublicKey,
    signAssertion: (payload) => sign('sha256', payload, privateKey),
  };
}

function buildRegistrationPayload(
  auth: VirtualAuthenticator,
  challenge: string,
  overrides: {
    readonly id?: string;
    readonly rawId?: string;
    readonly credentialType?: string;
    readonly clientType?: string;
    readonly clientChallenge?: string;
    readonly clientOrigin?: string;
    readonly crossOrigin?: boolean;
    readonly rpIdForHash?: string;
    readonly flags?: number;
    readonly signCount?: number;
    readonly fmt?: string;
    readonly attStmt?: Map<string, unknown>;
    readonly extraTrailingBytes?: Buffer;
    readonly extensionsCbor?: Buffer;
    readonly transports?: string[];
  } = {},
): Record<string, unknown> {
  const rpIdHash = createHash('sha256')
    .update(overrides.rpIdForHash ?? WEBAUTHN_CFG.rpId)
    .digest();
  const flags = overrides.flags ?? FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT;
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(overrides.signCount ?? 0, 0);

  const aaguid = Buffer.alloc(16, 0);
  const credLenBuf = Buffer.alloc(2);
  credLenBuf.writeUInt16BE(auth.credentialIdBytes.byteLength, 0);

  const authDataParts: Buffer[] = [rpIdHash, Buffer.from([flags]), counterBuf];
  if ((flags & FLAG_AT) !== 0) {
    authDataParts.push(aaguid, credLenBuf, auth.credentialIdBytes, auth.cosePublicKey);
  }
  if (overrides.extensionsCbor !== undefined) {
    authDataParts.push(overrides.extensionsCbor);
  }
  if (overrides.extraTrailingBytes !== undefined) {
    authDataParts.push(overrides.extraTrailingBytes);
  }
  const authData = Buffer.concat(authDataParts);

  const attestationObject = encodeCbor(
    new Map<string, unknown>([
      ['fmt', overrides.fmt ?? 'none'],
      ['attStmt', overrides.attStmt ?? new Map()],
      ['authData', authData],
    ]),
  );

  const clientData = {
    type: overrides.clientType ?? 'webauthn.create',
    challenge: overrides.clientChallenge ?? challenge,
    origin: overrides.clientOrigin ?? WEBAUTHN_CFG.origin,
    ...(overrides.crossOrigin !== undefined ? { crossOrigin: overrides.crossOrigin } : {}),
  };
  const clientDataBytes = Buffer.from(JSON.stringify(clientData), 'utf8');

  return {
    id: overrides.id ?? auth.credentialIdB64u,
    rawId: overrides.rawId ?? auth.credentialIdB64u,
    type: overrides.credentialType ?? 'public-key',
    response: {
      clientDataJSON: clientDataBytes.toString('base64url'),
      attestationObject: attestationObject.toString('base64url'),
      transports: overrides.transports ?? ['internal', 'hybrid'],
    },
    clientExtensionResults: {},
  };
}

function buildAuthenticationPayload(
  auth: VirtualAuthenticator,
  challenge: string,
  overrides: {
    readonly id?: string;
    readonly rawId?: string;
    readonly credentialType?: string;
    readonly clientType?: string;
    readonly clientChallenge?: string;
    readonly clientOrigin?: string;
    readonly crossOrigin?: boolean;
    readonly rpIdForHash?: string;
    readonly flags?: number;
    readonly signCount?: number;
    readonly tamperAuthDataAfterSign?: boolean;
    readonly customSignature?: Buffer;
  } = {},
): Record<string, unknown> {
  const rpIdHash = createHash('sha256')
    .update(overrides.rpIdForHash ?? WEBAUTHN_CFG.rpId)
    .digest();
  const flags = overrides.flags ?? FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS;
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(overrides.signCount ?? 1, 0);

  const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), counterBuf]);
  const clientData = {
    type: overrides.clientType ?? 'webauthn.get',
    challenge: overrides.clientChallenge ?? challenge,
    origin: overrides.clientOrigin ?? WEBAUTHN_CFG.origin,
    ...(overrides.crossOrigin !== undefined ? { crossOrigin: overrides.crossOrigin } : {}),
  };
  const clientDataBytes = Buffer.from(JSON.stringify(clientData), 'utf8');
  const clientDataHash = createHash('sha256').update(clientDataBytes).digest();
  const signedPayload = Buffer.concat([authData, clientDataHash]);
  const signature = overrides.customSignature ?? auth.signAssertion(signedPayload);

  if (overrides.tamperAuthDataAfterSign === true) {
    authData[36] = (authData[36] ?? 0) ^ 0x01;
  }

  return {
    id: overrides.id ?? auth.credentialIdB64u,
    rawId: overrides.rawId ?? auth.credentialIdB64u,
    type: overrides.credentialType ?? 'public-key',
    response: {
      clientDataJSON: clientDataBytes.toString('base64url'),
      authenticatorData: authData.toString('base64url'),
      signature: signature.toString('base64url'),
    },
    clientExtensionResults: {},
  };
}

function stubRepo(overrides: Partial<IdentityRepository> = {}): IdentityRepository {
  return {
    listWebauthnCredentialsByUser: vi.fn().mockResolvedValue([]),
    findWebauthnCredentialByCredentialId: vi.fn().mockResolvedValue(null),
    createWebauthnCredential: vi.fn().mockResolvedValue({ id: 'row-1' }),
    updateWebauthnCredentialCounter: vi.fn().mockResolvedValue(undefined),
    renameWebauthnCredential: vi.fn().mockResolvedValue(undefined),
    deleteWebauthnCredential: vi.fn().mockResolvedValue(undefined),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as IdentityRepository;
}

describe('identity WebAuthn & passkey service (owned CBOR/COSE)', () => {
  beforeEach(() => {
    clearChallengeStore();
  });

  // --- Adversarial / Failure Cases (8 / 11 tests = 72.7%) ---

  it('rejects missing challenges, expired challenges, and single-use challenge replay', async () => {
    const auth = createVirtualAuthenticator(-7);

    await expect(
      verifyWebauthnRegistrationInRepo(
        stubRepo(),
        'u-1',
        buildRegistrationPayload(auth, 'missing'),
        WEBAUTHN_CFG,
      ),
    ).rejects.toThrow(/challenge expired or not found/iu);

    const opts = await getWebauthnRegistrationOptionsInRepo(
      stubRepo(),
      'u-1',
      'alice@example.com',
      WEBAUTHN_CFG,
    );
    const challenge = opts['challenge'] as string;
    const validReg = buildRegistrationPayload(auth, challenge);

    await verifyWebauthnRegistrationInRepo(stubRepo(), 'u-1', validReg, WEBAUTHN_CFG);

    // Replay with identical credential must fail immediately because challenge was consumed
    await expect(
      verifyWebauthnRegistrationInRepo(stubRepo(), 'u-1', validReg, WEBAUTHN_CFG),
    ).rejects.toThrow(/challenge expired or not found/iu);
  });

  it('rejects non-"none" attestation config and non-"none" / non-empty attestation statements (D11)', async () => {
    const auth = createVirtualAuthenticator(-7);

    await expect(
      getWebauthnRegistrationOptionsInRepo(stubRepo(), 'u-1', 'alice@example.com', {
        ...WEBAUTHN_CFG,
        attestation: 'direct',
      }),
    ).rejects.toThrow(/none.*attestation/iu);

    const opts1 = await getWebauthnRegistrationOptionsInRepo(
      stubRepo(),
      'u-1',
      'alice@example.com',
      WEBAUTHN_CFG,
    );
    await expect(
      verifyWebauthnRegistrationInRepo(
        stubRepo(),
        'u-1',
        buildRegistrationPayload(auth, opts1['challenge'] as string, { fmt: 'packed' }),
        WEBAUTHN_CFG,
      ),
    ).rejects.toThrow(/attestation/iu);

    const opts2 = await getWebauthnRegistrationOptionsInRepo(
      stubRepo(),
      'u-1',
      'alice@example.com',
      WEBAUTHN_CFG,
    );
    await expect(
      verifyWebauthnRegistrationInRepo(
        stubRepo(),
        'u-1',
        buildRegistrationPayload(auth, opts2['challenge'] as string, {
          fmt: 'none',
          attStmt: new Map([['sig', Buffer.from([1, 2, 3])]]),
        }),
        WEBAUTHN_CFG,
      ),
    ).rejects.toThrow(/attestation/iu);
  });

  it('rejects wrong credential type and mismatched id / rawId / attested credentialId', async () => {
    const auth = createVirtualAuthenticator(-7);

    const opts1 = await getWebauthnRegistrationOptionsInRepo(
      stubRepo(),
      'u-1',
      'alice@example.com',
      WEBAUTHN_CFG,
    );
    await expect(
      verifyWebauthnRegistrationInRepo(
        stubRepo(),
        'u-1',
        buildRegistrationPayload(auth, opts1['challenge'] as string, {
          credentialType: 'password',
        }),
        WEBAUTHN_CFG,
      ),
    ).rejects.toThrow(/credential type/iu);

    const opts2 = await getWebauthnRegistrationOptionsInRepo(
      stubRepo(),
      'u-1',
      'alice@example.com',
      WEBAUTHN_CFG,
    );
    await expect(
      verifyWebauthnRegistrationInRepo(
        stubRepo(),
        'u-1',
        buildRegistrationPayload(auth, opts2['challenge'] as string, {
          rawId: randomBytes(32).toString('base64url'),
        }),
        WEBAUTHN_CFG,
      ),
    ).rejects.toThrow(/credential id/iu);
  });

  it('rejects wrong ceremony type, wrong challenge, wrong origin, and crossOrigin=true in clientDataJSON', async () => {
    const auth = createVirtualAuthenticator(-7);

    for (const override of [
      { clientType: 'webauthn.get' },
      { clientChallenge: randomBytes(32).toString('base64url') },
      { clientOrigin: 'https://evil.example.com' },
      { crossOrigin: true },
    ]) {
      const opts = await getWebauthnRegistrationOptionsInRepo(
        stubRepo(),
        'u-1',
        'alice@example.com',
        WEBAUTHN_CFG,
      );
      await expect(
        verifyWebauthnRegistrationInRepo(
          stubRepo(),
          'u-1',
          buildRegistrationPayload(auth, opts['challenge'] as string, override),
          WEBAUTHN_CFG,
        ),
      ).rejects.toThrow();
    }
  });

  it('rejects wrong rpIdHash, missing UP flag, invalid BS=1/BE=0 flags, missing AT flag, and trailing unparsed bytes', async () => {
    const auth = createVirtualAuthenticator(-7);

    for (const override of [
      { rpIdForHash: 'evil.example.com' },
      { flags: FLAG_AT }, // UP (0x01) missing
      { flags: FLAG_UP | FLAG_BS | FLAG_AT }, // BS=1 while BE=0 -> invalid per WebAuthn L3
      { flags: FLAG_UP }, // AT (0x40) missing on registration
      { extraTrailingBytes: Buffer.from([0xde, 0xad]) }, // ED=0 with trailing bytes
    ]) {
      const opts = await getWebauthnRegistrationOptionsInRepo(
        stubRepo(),
        'u-1',
        'alice@example.com',
        WEBAUTHN_CFG,
      );
      await expect(
        verifyWebauthnRegistrationInRepo(
          stubRepo(),
          'u-1',
          buildRegistrationPayload(auth, opts['challenge'] as string, override),
          WEBAUTHN_CFG,
        ),
      ).rejects.toThrow();
    }
  });

  it('rejects unknown credentialId, tampered assertion signatures, and tampered authenticatorData', async () => {
    const auth = createVirtualAuthenticator(-7);
    const otherAuth = createVirtualAuthenticator(-7);

    const { sessionKey: skUnknown, options: optsUnknown } =
      await getWebauthnAuthenticationOptionsInRepo(stubRepo(), WEBAUTHN_CFG);
    await expect(
      verifyWebauthnAuthenticationInRepo(
        stubRepo(),
        buildAuthenticationPayload(auth, optsUnknown['challenge'] as string),
        skUnknown,
        WEBAUTHN_CFG,
      ),
    ).rejects.toThrow(/Credential not found/iu);

    const storedRow = {
      id: 'row-1',
      userId: 'u-1',
      credentialId: auth.credentialIdB64u,
      publicKey: auth.cosePublicKey.toString('base64url'),
      counter: 1,
      transports: 'internal',
    };

    // Signature created by another authenticator key
    const { sessionKey: skWrongSig, options: optsWrongSig } =
      await getWebauthnAuthenticationOptionsInRepo(stubRepo(), WEBAUTHN_CFG);
    const wrongSigPayload = buildAuthenticationPayload(auth, optsWrongSig['challenge'] as string, {
      signCount: 2,
      customSignature: otherAuth.signAssertion(Buffer.from('forged')),
    });
    await expect(
      verifyWebauthnAuthenticationInRepo(
        stubRepo({ findWebauthnCredentialByCredentialId: vi.fn().mockResolvedValue(storedRow) }),
        wrongSigPayload,
        skWrongSig,
        WEBAUTHN_CFG,
      ),
    ).rejects.toThrow(/signature|verification failed/iu);

    // Authenticator data mutated after signing
    const { sessionKey: skTampered, options: optsTampered } =
      await getWebauthnAuthenticationOptionsInRepo(stubRepo(), WEBAUTHN_CFG);
    await expect(
      verifyWebauthnAuthenticationInRepo(
        stubRepo({ findWebauthnCredentialByCredentialId: vi.fn().mockResolvedValue(storedRow) }),
        buildAuthenticationPayload(auth, optsTampered['challenge'] as string, {
          signCount: 2,
          tamperAuthDataAfterSign: true,
        }),
        skTampered,
        WEBAUTHN_CFG,
      ),
    ).rejects.toThrow(/signature|verification failed/iu);
  });

  it('rejects cloned authenticators on signCount rollback or non-increment when stored counter > 0', async () => {
    const auth = createVirtualAuthenticator(-7);
    const storedRow = {
      id: 'row-1',
      userId: 'u-1',
      credentialId: auth.credentialIdB64u,
      publicKey: auth.cosePublicKey.toString('base64url'),
      counter: 10,
      transports: 'internal',
    };

    for (const replayCounter of [10, 9, 0]) {
      const { sessionKey, options } = await getWebauthnAuthenticationOptionsInRepo(
        stubRepo(),
        WEBAUTHN_CFG,
      );
      await expect(
        verifyWebauthnAuthenticationInRepo(
          stubRepo({ findWebauthnCredentialByCredentialId: vi.fn().mockResolvedValue(storedRow) }),
          buildAuthenticationPayload(auth, options['challenge'] as string, {
            signCount: replayCounter,
          }),
          sessionKey,
          WEBAUTHN_CFG,
        ),
      ).rejects.toThrow(/counter/iu);
    }
  });

  it('returns PASSKEY_NOT_FOUND when renaming or deleting a missing or foreign passkey', async () => {
    expect(await renameUserPasskeyInRepo(stubRepo(), 'u-1', 'missing-pk', 'Laptop')).toEqual({
      ok: false,
      code: 'PASSKEY_NOT_FOUND',
      message: 'Passkey not found',
    });
    expect(await deleteUserPasskeyInRepo(stubRepo(), 'u-1', 'missing-pk')).toEqual({
      ok: false,
      code: 'PASSKEY_NOT_FOUND',
      message: 'Passkey not found',
    });
  });

  // --- Positive End-to-End Ceremonies (3 / 11 tests) ---

  it('completes end-to-end registration and authentication across ES256 (-7), EdDSA (-8), and RS256 (-257)', async () => {
    for (const alg of [-7, -8, -257] as const) {
      const auth = createVirtualAuthenticator(alg);
      let capturedCreate: Record<string, unknown> | undefined;
      const createWebauthnCredential = vi.fn().mockImplementation((input) => {
        capturedCreate = input as Record<string, unknown>;
        return Promise.resolve({ id: `row-${String(alg)}` });
      });

      const regOpts = await getWebauthnRegistrationOptionsInRepo(
        stubRepo(),
        'u-1',
        'alice@example.com',
        WEBAUTHN_CFG,
      );
      expect(regOpts['attestation']).toBe('none');

      const regResult = await verifyWebauthnRegistrationInRepo(
        stubRepo({ createWebauthnCredential }),
        'u-1',
        buildRegistrationPayload(auth, regOpts['challenge'] as string, {
          flags: FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT | FLAG_ED,
          signCount: 1,
          extensionsCbor: encodeCbor(new Map([['credProps', new Map([['rk', true]])]])),
        }),
        WEBAUTHN_CFG,
        `Key ${String(alg)}`,
      );

      expect(regResult).toEqual({
        credentialId: `row-${String(alg)}`,
        message: 'Passkey registered successfully',
      });
      expect(capturedCreate).toMatchObject({
        userId: 'u-1',
        credentialId: auth.credentialIdB64u,
        counter: 1,
        deviceType: 'multiDevice',
        backedUp: true,
        name: `Key ${String(alg)}`,
      });

      const updateCounter = vi.fn().mockResolvedValue(undefined);
      const { sessionKey, options } = await getWebauthnAuthenticationOptionsInRepo(
        stubRepo({
          findUserByEmail: vi.fn().mockResolvedValue({ id: 'u-1' }),
          listWebauthnCredentialsByUser: vi.fn().mockResolvedValue([
            {
              id: `row-${String(alg)}`,
              userId: 'u-1',
              credentialId: auth.credentialIdB64u,
              publicKey: capturedCreate?.['publicKey'] as string,
              counter: 1,
              transports: 'internal,hybrid',
            },
          ]),
        }),
        WEBAUTHN_CFG,
        'alice@example.com',
      );
      expect(Array.isArray(options['allowCredentials'])).toBe(true);

      const authResult = await verifyWebauthnAuthenticationInRepo(
        stubRepo({
          findWebauthnCredentialByCredentialId: vi.fn().mockResolvedValue({
            id: `row-${String(alg)}`,
            userId: 'u-1',
            credentialId: auth.credentialIdB64u,
            publicKey: capturedCreate?.['publicKey'] as string,
            counter: 1,
            transports: 'internal,hybrid',
          }),
          updateWebauthnCredentialCounter: updateCounter,
        }),
        buildAuthenticationPayload(auth, options['challenge'] as string, { signCount: 2 }),
        sessionKey,
        WEBAUTHN_CFG,
      );

      expect(authResult).toEqual({ userId: 'u-1' });
      expect(updateCounter).toHaveBeenCalledWith(`row-${String(alg)}`, 2);
    }
  });

  it('allows software/synced authenticators that keep signCount at 0 across ceremonies', async () => {
    const auth = createVirtualAuthenticator(-7);
    const updateCounter = vi.fn().mockResolvedValue(undefined);
    const { sessionKey, options } = await getWebauthnAuthenticationOptionsInRepo(
      stubRepo(),
      WEBAUTHN_CFG,
    );
    // Discoverable ceremony omits allowCredentials when email is omitted
    expect(options['allowCredentials']).toBeUndefined();

    const authResult = await verifyWebauthnAuthenticationInRepo(
      stubRepo({
        findWebauthnCredentialByCredentialId: vi.fn().mockResolvedValue({
          id: 'row-zero',
          userId: 'u-zero',
          credentialId: auth.credentialIdB64u,
          publicKey: auth.cosePublicKey.toString('base64url'),
          counter: 0,
          transports: null,
        }),
        updateWebauthnCredentialCounter: updateCounter,
      }),
      buildAuthenticationPayload(auth, options['challenge'] as string, {
        flags: FLAG_UP,
        signCount: 0,
      }),
      sessionKey,
      WEBAUTHN_CFG,
    );

    expect(authResult).toEqual({ userId: 'u-zero' });
    expect(updateCounter).toHaveBeenCalledWith('row-zero', 0);
  });

  it('lists, renames, and deletes owned user passkeys', async () => {
    const samplePasskeyRow = {
      id: 'pk-1',
      userId: 'u-1',
      credentialId: 'cred-1',
      publicKey: 'pk',
      counter: 5,
      transports: 'internal',
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'YubiKey 5',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastUsedAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    const repo = stubRepo({
      listWebauthnCredentialsByUser: vi.fn().mockResolvedValue([samplePasskeyRow]),
    });

    const listed = await listUserPasskeysInRepo(repo, 'u-1');
    expect(listed).toEqual([
      {
        id: 'pk-1',
        name: 'YubiKey 5',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);

    expect(await renameUserPasskeyInRepo(repo, 'u-1', 'pk-1', 'Backup Key')).toEqual({
      ok: true,
      value: { message: 'Passkey renamed successfully' },
    });
    expect(await deleteUserPasskeyInRepo(repo, 'u-1', 'pk-1')).toEqual({
      ok: true,
      value: { message: 'Passkey deleted successfully' },
    });
  });
});
