// main/server/core/src/auth/handlers/devices.ts
/**
 * Device Management Handlers
 *
 * Handles listing, trusting, and revoking trusted devices for the
 * authenticated user.
 *
 * @module handlers/devices
 */

import { mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';
import {
  type DeviceItem,
  type DeviceListResponse,
  type TrustDeviceResponse,
} from '@bslt/shared/core/auth';
import { AuthenticationError, NotFoundError } from '@bslt/shared/system';

import { createErrorMapperLogger } from '../types';

import type { AppContext, RequestWithCookies } from '../types';

// ============================================================================
// Handlers
// ============================================================================

/**
 * List all devices for the authenticated user.
 *
 * GET /api/users/me/devices
 *
 * @param ctx - Application context
 * @param request - Authenticated request
 * @returns List of user devices
 * @complexity O(n) where n is the number of devices for the user
 */
export async function handleListDevices(
  ctx: AppContext,
  request: RequestWithCookies,
): Promise<DeviceListResponse | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError('Unauthorized');
    }

    const devices = await ctx.repos.trustedDevices.findByUser(userId);

    const deviceResponses: DeviceItem[] = devices.map((device) => ({
      id: device.id,
      deviceFingerprint: device.deviceFingerprint,
      label: device.label,
      ipAddress: device.ipAddress,
      userAgent: device.userAgent,
      firstSeenAt: device.firstSeenAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
      trusted: device.trustedAt !== null,
      createdAt: device.createdAt.toISOString(),
    }));

    return { devices: deviceResponses };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Mark a device as trusted.
 *
 * POST /api/users/me/devices/:id/trust
 *
 * @param ctx - Application context
 * @param params - Route params containing device ID
 * @param request - Authenticated request
 * @returns Updated device or error
 * @complexity O(1) - single database lookup and update
 */
export async function handleTrustDevice(
  ctx: AppContext,
  params: { id: string },
  request: RequestWithCookies,
): Promise<TrustDeviceResponse | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError('Unauthorized');
    }

    // Verify the device belongs to this user
    const device = await ctx.repos.trustedDevices.findById(params.id);
    if (device === null) {
      throw new NotFoundError('Device not found');
    }
    if (device.userId !== userId) {
      throw new NotFoundError('Device not found');
    }

    const updated = await ctx.repos.trustedDevices.markTrusted(params.id);
    if (updated === null) {
      throw new NotFoundError('Device not found');
    }

    return {
      device: {
        id: updated.id,
        deviceFingerprint: updated.deviceFingerprint,
        label: updated.label,
        ipAddress: updated.ipAddress,
        userAgent: updated.userAgent,
        firstSeenAt: updated.firstSeenAt.toISOString(),
        lastSeenAt: updated.lastSeenAt.toISOString(),
        trusted: updated.trustedAt !== null,
        createdAt: updated.createdAt.toISOString(),
      },
    };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Revoke (delete) a trusted device.
 *
 * DELETE /api/users/me/devices/:id
 *
 * @param ctx - Application context
 * @param params - Route params containing device ID
 * @param request - Authenticated request
 * @returns Success or error
 * @complexity O(1) - single database lookup and delete
 */
export async function handleRevokeDevice(
  ctx: AppContext,
  params: { id: string },
  request: RequestWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError('Unauthorized');
    }

    // Verify the device belongs to this user
    const device = await ctx.repos.trustedDevices.findById(params.id);
    if (device === null) {
      throw new NotFoundError('Device not found');
    }
    if (device.userId !== userId) {
      throw new NotFoundError('Device not found');
    }

    const deleted = await ctx.repos.trustedDevices.revoke(params.id);
    if (!deleted) {
      throw new NotFoundError('Device not found');
    }

    return { message: 'Device revoked successfully' };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
