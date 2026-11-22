// main/kernel/contract/src/money.ts
import { bigintString, enumOf, object, type Infer } from '@bslt/schema';

export const ASSET_EXPONENTS = {
  USD: 2,
  USDC: 6,
} as const;

export const assetCodeSchema = enumOf(['USD', 'USDC'] as const);

export type AssetCode = Infer<typeof assetCodeSchema>;

export const moneySchema = object({
  amount: bigintString,
  asset: assetCodeSchema,
});

export type Money = Infer<typeof moneySchema>;
