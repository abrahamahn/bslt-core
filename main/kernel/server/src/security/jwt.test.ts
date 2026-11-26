// main/kernel/server/src/security/jwt.test.ts
import { describe, expect, it } from 'vitest';

import { decode, JwtError, sign, verify } from './jwt';

const SECRET = 'unit-test-jwt-secret-32-chars-min!';

describe('native HS256 JWT', () => {
  it('rejects malformed tokens, alg:none attacks, wrong secrets, expired tokens, and invalid expiry specs', () => {
    expect(() => sign({ sub: 'u1' }, SECRET, { expiresIn: 'invalid' })).toThrow(JwtError);
    expect(() => verify('not-a-jwt', SECRET)).toThrow(/Invalid token format/u);
    expect(() => verify('a..c', SECRET)).toThrow(/Invalid token format/u);

    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    const payload = Buffer.from(JSON.stringify({ sub: 'u1' })).toString('base64url');
    expect(() => verify(`${noneHeader}.${payload}.sig`, SECRET)).toThrow(
      /Algorithm not supported/u,
    );

    const validToken = sign({ sub: 'u1', role: 'user' }, SECRET, { expiresIn: '1h' });
    expect(() => verify(validToken, 'wrong-secret-key-here-32-chars!!')).toThrow(
      /Invalid signature/u,
    );

    const expiredToken = sign({ sub: 'u1' }, SECRET, { expiresIn: -10 });
    expect(() => verify(expiredToken, SECRET)).toThrow(/expired/u);

    expect(decode('malformed')).toBeNull();
    expect(decode('a.!!!.c')).toBeNull();
  });

  it('signs, verifies, tolerates clock skew, and decodes HS256 tokens', () => {
    const token = sign({ sub: 'user-42', role: 'admin' }, SECRET, { expiresIn: '15m' });
    const verified = verify(token, SECRET);
    expect(verified['sub']).toBe('user-42');
    expect(verified['role']).toBe('admin');
    expect(typeof verified.iat).toBe('number');
    expect(typeof verified.exp).toBe('number');

    const decoded = decode(token);
    expect(decoded?.['sub']).toBe('user-42');

    const slightlyExpired = sign({ sub: 'user-42' }, SECRET, { expiresIn: -2 });
    expect(verify(slightlyExpired, SECRET, { clockToleranceSeconds: 10 })['sub']).toBe('user-42');
  });
});
