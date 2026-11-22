// main/modules/identity/web/webauthn.ts
/**
 * Passkey ceremonies on `navigator.credentials`. The server's options arrive as
 * JSON with base64url binary members; the browser wants bytes, and the server
 * verifies the credential as JSON again. Browser errors keep the messages users
 * saw before this codec was owned. Browser globals are read only inside the
 * ceremonies, so the SSR prerender can import this module.
 */

type DescriptorJSON = Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string };

export type PasskeyCreationOptionsJSON = Omit<
  PublicKeyCredentialCreationOptions,
  'challenge' | 'user' | 'excludeCredentials'
> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string };
  excludeCredentials?: DescriptorJSON[];
};

export type PasskeyRequestOptionsJSON = Omit<
  PublicKeyCredentialRequestOptions,
  'challenge' | 'allowCredentials'
> & { challenge: string; allowCredentials?: DescriptorJSON[] };

// A type alias, not an interface, so a credential is a `Record<string, unknown>` for the API client.
type CredentialJSON<Response> = {
  id: string;
  rawId: string;
  response: Response;
  type: string;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  authenticatorAttachment: AuthenticatorAttachment | undefined;
};

export function bytesToBase64Url(bytes: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// No ConstraintError, TypeError or malformed-pubKeyCredParams messages: this server never asks
// for a resident key or required user verification, sends a 32-byte user.id and only public-key
// params, so the replaced library passed those errors through unchanged as well. NotAllowedError
// and SecurityError are explained in `report`.
const REGISTRATION_ERRORS: ReadonlyMap<string, string> = new Map([
  ['AbortError', 'Registration ceremony was sent an abort signal'],
  ['InvalidStateError', 'The authenticator was previously registered'],
  [
    'NotSupportedError',
    'No available authenticator supported any of the specified pubKeyCredParams algorithms',
  ],
  [
    'UnknownError',
    'The authenticator was unable to process the specified options, or could not create a new credential',
  ],
]);

const AUTHENTICATION_ERRORS: ReadonlyMap<string, string> = new Map([
  ['AbortError', 'Authentication ceremony was sent an abort signal'],
  [
    'UnknownError',
    'The authenticator was unable to process the specified options, or could not create a new assertion signature',
  ],
]);

/** A valid domain (https://url.spec.whatwg.org/#valid-domain) as the replaced library tested it. */
const DOMAIN = /^((xn--[a-z0-9-]+|[a-z0-9]+(-[a-z0-9]+)*)\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i;

/** One ceremony at a time: starting another aborts the one in flight. */
let pending: AbortController | undefined;

async function ceremony(
  call: (signal: AbortSignal) => Promise<Credential | null>,
  rpId: string | undefined,
  errors: ReadonlyMap<string, string>,
  incomplete: string,
): Promise<PublicKeyCredential> {
  if (!('PublicKeyCredential' in globalThis) || typeof PublicKeyCredential !== 'function') {
    throw new Error('WebAuthn is not supported in this browser');
  }
  pending?.abort(
    new DOMException('Cancelling existing WebAuthn API call for new one', 'AbortError'),
  );
  pending = new AbortController();
  const credential = await call(pending.signal).catch((error: unknown) => {
    throw report(error, errors, rpId);
  });
  if (!credential) throw new Error(incomplete);
  // No instanceof check: extensions and the e2e mock resolve plain objects.
  return credential as PublicKeyCredential;
}

/**
 * A known name gets its message; NotAllowedError keeps the browser's own text, which platforms
 * overload, in an Error; SecurityError names the host or RP ID the browser refused; anything else
 * passes through. Read by shape, not instanceof, so an error from another realm is reported too,
 * and looked up in a Map, so a name like `constructor` finds no prototype key.
 */
function report(
  error: unknown,
  messages: ReadonlyMap<string, string>,
  rpId: string | undefined,
): unknown {
  const { name = '', message } = (error ?? {}) as Partial<DOMException>;
  const reported =
    name === 'NotAllowedError'
      ? message
      : name === 'SecurityError'
        ? refusedOrigin(rpId)
        : messages.get(name);
  return reported === undefined ? error : new Error(reported, { cause: error });
}

/** Why the browser refused this origin, or undefined when host and RP ID look right. */
function refusedOrigin(rpId: string | undefined): string | undefined {
  const { hostname } = globalThis.location;
  if (hostname !== 'localhost' && !DOMAIN.test(hostname)) return `${hostname} is an invalid domain`;
  return rpId === hostname ? undefined : `The RP ID "${String(rpId)}" is invalid for this domain`;
}

const toDescriptor = ({ id, ...rest }: DescriptorJSON): PublicKeyCredentialDescriptor => ({
  ...rest,
  id: base64UrlToBytes(id),
});

/** An optional getter's value, or undefined when the browser lacks it or an extension broke it. */
function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function envelope<Response>(
  credential: PublicKeyCredential,
  response: Response,
): CredentialJSON<Response> {
  const { authenticatorAttachment } = credential;
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    response,
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment:
      authenticatorAttachment === 'platform' || authenticatorAttachment === 'cross-platform'
        ? authenticatorAttachment
        : undefined,
  };
}

export async function createPasskey({
  challenge,
  user,
  excludeCredentials,
  ...rest
}: PasskeyCreationOptionsJSON): Promise<
  CredentialJSON<{
    attestationObject: string;
    clientDataJSON: string;
    transports: string[] | undefined;
    publicKeyAlgorithm: number | undefined;
    publicKey: string | undefined;
    authenticatorData: string | undefined;
  }>
> {
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...rest,
    challenge: base64UrlToBytes(challenge),
    user: { ...user, id: base64UrlToBytes(user.id) },
    // An empty list stays: it is what a user's first passkey registers with.
    ...(excludeCredentials && { excludeCredentials: excludeCredentials.map(toDescriptor) }),
  };
  const credential = await ceremony(
    (signal) => navigator.credentials.create({ publicKey, signal }),
    publicKey.rp.id,
    REGISTRATION_ERRORS,
    'Registration was not completed',
  );
  const response = credential.response as AuthenticatorAttestationResponse;
  return envelope(credential, {
    attestationObject: bytesToBase64Url(response.attestationObject),
    clientDataJSON: bytesToBase64Url(response.clientDataJSON),
    transports: attempt(() => response.getTransports()),
    publicKeyAlgorithm: attempt(() => response.getPublicKeyAlgorithm()),
    publicKey: attempt(() => {
      const key = response.getPublicKey();
      return key === null ? undefined : bytesToBase64Url(key);
    }),
    authenticatorData: attempt(() => bytesToBase64Url(response.getAuthenticatorData())),
  });
}

export async function getPasskey({
  challenge,
  allowCredentials,
  ...rest
}: PasskeyRequestOptionsJSON): Promise<
  CredentialJSON<{
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle: string | undefined;
  }>
> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...rest,
    challenge: base64UrlToBytes(challenge),
    // An empty list would block discoverable credentials, so it is left out.
    ...(allowCredentials?.length && { allowCredentials: allowCredentials.map(toDescriptor) }),
  };
  const credential = await ceremony(
    (signal) => navigator.credentials.get({ publicKey, signal }),
    publicKey.rpId,
    AUTHENTICATION_ERRORS,
    'Authentication was not completed',
  );
  const response = credential.response as AuthenticatorAssertionResponse;
  return envelope(credential, {
    authenticatorData: bytesToBase64Url(response.authenticatorData),
    clientDataJSON: bytesToBase64Url(response.clientDataJSON),
    signature: bytesToBase64Url(response.signature),
    userHandle: response.userHandle ? bytesToBase64Url(response.userHandle) : undefined,
  });
}
