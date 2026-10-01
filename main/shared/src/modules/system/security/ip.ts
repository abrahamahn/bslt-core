// main/shared/src/modules/system/security/ip.ts
/**
 * Pure IPv4/CIDR helpers shared across runtimes.
 */

/** Represents a parsed IPv4 CIDR range. */
export interface Ipv4CidrRange {
  /** Numeric representation of the network address */
  networkInt: number;
  /** Numeric representation of the subnet mask */
  maskInt: number;
  /** The original CIDR string */
  original: string;
}

/**
 * Convert an IPv4 string to a 32-bit unsigned integer.
 * @returns The integer representation, or undefined if invalid.
 */
export function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;

  let result = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return undefined;
    result = (result << 8) | num;
  }

  return result >>> 0;
}

/**
 * Parse an IPv4 CIDR string into its numeric components.
 * @returns The parsed range, or undefined if invalid.
 */
export function parseIpv4Cidr(cidr: string): Ipv4CidrRange | undefined {
  const slashIndex = cidr.indexOf('/');
  if (slashIndex === -1) return undefined;

  const ip = cidr.substring(0, slashIndex);
  const prefixStr = cidr.substring(slashIndex + 1);
  const prefix = Number(prefixStr);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return undefined;

  const networkInt = ipv4ToInt(ip);
  if (networkInt === undefined) return undefined;

  const maskInt = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

  return {
    networkInt: (networkInt & maskInt) >>> 0,
    maskInt,
    original: cidr,
  };
}

/**
 * Check if a numeric IP is within a parsed CIDR range.
 */
export function isIpv4InCidrRange(ipInt: number, range: Ipv4CidrRange): boolean {
  return (ipInt & range.maskInt) >>> 0 === range.networkInt;
}
