// main/kernel/contract/src/money.test.ts
import { describe, expect, it } from 'vitest';

import { ASSET_EXPONENTS, assetCodeSchema, moneySchema, type AssetCode, type Money } from './money';

describe('money and asset contracts', () => {
  it('exposes exact exponents for USD and USDC and parses valid Money values', () => {
    expect(ASSET_EXPONENTS).toEqual({ USD: 2, USDC: 6 });
    const usd: AssetCode = assetCodeSchema.parse('USD');
    expect(usd).toBe('USD');

    const parsed: Money = moneySchema.parse({ amount: '1999', asset: 'USD' });
    expect(parsed).toEqual({ amount: '1999', asset: 'USD' });

    const usdc: Money = moneySchema.parse({ amount: '5000000', asset: 'USDC' });
    expect(usdc).toEqual({ amount: '5000000', asset: 'USDC' });
  });

  it('rejects unknown asset codes', () => {
    expect(() => assetCodeSchema.parse('EUR')).toThrow();
    expect(() => assetCodeSchema.parse('usd')).toThrow();
    expect(() => assetCodeSchema.parse('')).toThrow();
    expect(() => assetCodeSchema.parse(123)).toThrow();
  });

  it('rejects non-integer, floating-point, or malformed money amounts and unknown keys', () => {
    expect(() => moneySchema.parse({ amount: '19.99', asset: 'USD' })).toThrow();
    expect(() => moneySchema.parse({ amount: 1999, asset: 'USD' })).toThrow();
    expect(() => moneySchema.parse({ amount: '', asset: 'USD' })).toThrow();
    expect(() => moneySchema.parse({ amount: '1e5', asset: 'USD' })).toThrow();
    expect(() => moneySchema.parse({ amount: '100', asset: 'BTC' })).toThrow();
    expect(() => moneySchema.parse({ amount: '100', asset: 'USD', currency: 'USD' })).toThrow();
  });
});
