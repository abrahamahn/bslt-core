// main/modules/compliance/server/age-assurance.ts
import type { AgeAssuranceLevel, AgeAssuranceMethod } from '../contract';

interface StartAgeAssuranceInput {
  readonly userId: string;
  readonly threshold: number;
  readonly method: AgeAssuranceMethod;
  readonly confirmed: boolean;
  readonly jurisdiction?: string | null | undefined;
  readonly providerRef?: string | null | undefined;
}

interface AgeAssuranceCheckOutcome {
  readonly provider: string;
  readonly method: AgeAssuranceMethod;
  readonly threshold: number;
  readonly resultOverThreshold: boolean;
  readonly assuranceLevel: AgeAssuranceLevel;
  readonly jurisdiction: string | null;
  readonly providerRef: string | null;
  readonly checkedAt: Date;
  readonly expiresAt: Date | null;
}

/**
 * Provider-agnostic age-assurance port (restructure plan §17.2 Phase 15, stack-review §257).
 * Stores outcomes only — never collects or returns date of birth or identity document images.
 */
export interface AgeAssuranceProvider {
  readonly name: string;
  startCheck(input: StartAgeAssuranceInput): Promise<AgeAssuranceCheckOutcome>;
}

export function createAttestationAgeAssuranceProvider(
  now: () => Date = () => new Date(),
): AgeAssuranceProvider {
  return {
    name: 'attestation',
    startCheck(input: StartAgeAssuranceInput): Promise<AgeAssuranceCheckOutcome> {
      const userId = input.userId.trim();
      if (userId.length === 0) {
        return Promise.reject(new Error('AgeAssuranceProvider requires a non-empty userId'));
      }
      if (!Number.isInteger(input.threshold) || input.threshold < 13 || input.threshold > 120) {
        return Promise.reject(
          new Error('AgeAssuranceProvider threshold must be an integer between 13 and 120'),
        );
      }

      const assuranceLevel: AgeAssuranceLevel =
        input.method === 'document' || input.method === 'eid_wallet'
          ? 'high'
          : input.method === 'attestation'
            ? 'self_attested'
            : 'standard';

      return Promise.resolve({
        provider: 'attestation',
        method: input.method,
        threshold: input.threshold,
        resultOverThreshold: input.confirmed,
        assuranceLevel,
        jurisdiction: input.jurisdiction ?? null,
        providerRef: input.providerRef ?? null,
        checkedAt: now(),
        expiresAt: null,
      });
    },
  };
}
