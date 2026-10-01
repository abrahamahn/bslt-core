// main/server/core/src/auth/security/device-fingerprint.ts
/**
 * Device Fingerprint Helper
 *
 * Generates deterministic fingerprints for device tracking.
 * Checks trusted devices table and records device access.
 *
 * @module security/device-fingerprint
 */

import { createHash } from 'node:crypto';

import type { Repositories } from '@bslt/db/factory';

// ============================================================================
// Fingerprint Generation
// ============================================================================

/**
 * Generate a deterministic device fingerprint from a network identity and user agent.
 * Uses SHA-256 hash of the concatenated values.
 *
 * @param identity - Client identity, typically an IP-based fallback source
 * @param userAgent - Browser user agent string
 * @returns Hex-encoded SHA-256 hash of `${identity}:${userAgent}`
 * @complexity O(n) where n is the length of the input strings
 */
export function generateDeviceFingerprint(identity: string, userAgent: string): string {
  const input = `${identity}:${userAgent}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a stable device fingerprint from the browser-provided device ID.
 *
 * Browser device IDs are already scoped to a browser profile. Keeping the user
 * agent out of this hash prevents duplicate device rows after browser updates.
 *
 * @param deviceId - Stable browser/device ID from the client
 * @returns Hex-encoded SHA-256 hash of `device:${deviceId}`
 * @complexity O(n) where n is the length of the device ID
 */
export function generateStableDeviceFingerprint(deviceId: string): string {
  return createHash('sha256').update(`device:${deviceId}`).digest('hex');
}

// ============================================================================
// Device Lookup
// ============================================================================

/**
 * Check if a device fingerprint is known for a given user.
 *
 * @param repos - Repository container
 * @param userId - The user ID to check against
 * @param fingerprint - The device fingerprint hash
 * @returns True if the device has been seen before for this user
 * @complexity O(1) - single database lookup
 */
export async function isKnownDevice(
  repos: Repositories,
  userId: string,
  fingerprint: string,
): Promise<boolean> {
  const device = await repos.trustedDevices.findByFingerprint(userId, fingerprint);
  return device !== null;
}

/**
 * Check if a device fingerprint has been explicitly trusted by the user.
 *
 * @param repos - Repository container
 * @param userId - The user ID to check against
 * @param fingerprint - The device fingerprint hash
 * @returns True if the device has been explicitly trusted (trusted_at is set)
 * @complexity O(1) - single database lookup
 */
export async function isTrustedDevice(
  repos: Repositories,
  userId: string,
  fingerprint: string,
): Promise<boolean> {
  const device = await repos.trustedDevices.findByFingerprint(userId, fingerprint);
  return device !== null && device.trustedAt !== null;
}

// ============================================================================
// Device Access Recording
// ============================================================================

/**
 * Record a device access by upserting the trusted_devices table.
 * If the device exists, update last_seen_at. If new, create a record.
 *
 * @param repos - Repository container
 * @param userId - The user who is accessing from this device
 * @param fingerprint - The device fingerprint hash
 * @param ipAddress - Current IP address
 * @param userAgent - Current user agent string
 * @complexity O(1) - single database upsert
 */
export async function recordDeviceAccess(
  repos: Repositories,
  userId: string,
  fingerprint: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repos.trustedDevices.upsert({
    userId,
    deviceFingerprint: fingerprint,
    ipAddress,
    userAgent,
    lastSeenAt: new Date(),
  });
}
