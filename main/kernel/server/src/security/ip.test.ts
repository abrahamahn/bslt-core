// main/kernel/server/src/security/ip.test.ts
import { describe, expect, it } from 'vitest';

import { ipv4ToInt, isIpv4InCidrRange, parseIpv4Cidr } from './ip';

describe('ipv4 CIDR helpers', () => {
  it('parses valid IPv4 addresses and CIDR blocks', () => {
    expect(ipv4ToInt('127.0.0.1')).toBe(0x7f000001);
    const range = parseIpv4Cidr('10.0.0.0/8');
    expect(range).toBeDefined();
    expect(isIpv4InCidrRange(ipv4ToInt('10.25.1.9')!, range!)).toBe(true);
    expect(isIpv4InCidrRange(ipv4ToInt('11.0.0.1')!, range!)).toBe(false);
  });

  it('rejects malformed IPv4 strings and out-of-range CIDR prefixes', () => {
    expect(ipv4ToInt('')).toBeUndefined();
    expect(ipv4ToInt('999.0.0.1')).toBeUndefined();
    expect(ipv4ToInt('1.2.3')).toBeUndefined();
    expect(ipv4ToInt('-1.0.0.1')).toBeUndefined();
    expect(parseIpv4Cidr('10.0.0.0')).toBeUndefined();
    expect(parseIpv4Cidr('10.0.0.0/33')).toBeUndefined();
    expect(parseIpv4Cidr('10.0.0.0/-1')).toBeUndefined();
    expect(parseIpv4Cidr('bad/24')).toBeUndefined();
  });
});
