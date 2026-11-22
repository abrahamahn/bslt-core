// main/modules/compliance/server/age-assurance.test.ts
import { describe, expect, it } from 'vitest';

import { createAttestationAgeAssuranceProvider } from './age-assurance';

describe('createAttestationAgeAssuranceProvider', () => {
  const now = new Date('2026-11-19T00:00:00.000Z');
  const provider = createAttestationAgeAssuranceProvider(() => now);

  it('fails closed when userId is blank, threshold is out of range, or attestation is unconfirmed', async () => {
    await expect(
      provider.startCheck({
        userId: '   ',
        threshold: 18,
        method: 'attestation',
        confirmed: true,
      }),
    ).rejects.toThrow(/userId/i);

    await expect(
      provider.startCheck({
        userId: 'u-1',
        threshold: 12,
        method: 'attestation',
        confirmed: true,
      }),
    ).rejects.toThrow(/threshold/i);

    await expect(
      provider.startCheck({
        userId: 'u-1',
        threshold: 121,
        method: 'attestation',
        confirmed: true,
      }),
    ).rejects.toThrow(/threshold/i);

    const denied = await provider.startCheck({
      userId: 'u-1',
      threshold: 18,
      method: 'attestation',
      confirmed: false,
    });
    expect(denied.resultOverThreshold).toBe(false);
  });

  it('records outcome-only age-assurance check with zero DOB or document artifacts', async () => {
    const check = await provider.startCheck({
      userId: 'u-1',
      threshold: 18,
      method: 'attestation',
      confirmed: true,
      jurisdiction: 'GB',
    });

    expect(check).toEqual({
      provider: 'attestation',
      method: 'attestation',
      threshold: 18,
      resultOverThreshold: true,
      assuranceLevel: 'self_attested',
      jurisdiction: 'GB',
      providerRef: null,
      checkedAt: now,
      expiresAt: null,
    });
    expect(Object.keys(check)).not.toContain('dateOfBirth');
    expect(Object.keys(check)).not.toContain('documentImage');
  });
});
