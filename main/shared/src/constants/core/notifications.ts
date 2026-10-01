// main/shared/src/constants/core/notifications.ts

/**
 * @file Notification & Audit Constants
 * @description Notification providers, channels, types, and audit categories.
 * @module Core/Constants/Notifications
 */

// ============================================================================
// Notification Providers
// ============================================================================

export const NOTIFICATION_SCHEMA_PROVIDERS = ['onesignal', 'courier', 'generic'] as const;
export const NOTIFICATION_ENV_PROVIDERS = [
  'onesignal',
  'courier',
  'knock',
  'sns',
  'braze',
  'generic',
] as const;

// ============================================================================
// Notification Channels & Types
// ============================================================================

export const NOTIFICATION_CHANNELS = ['push', 'email', 'sms', 'in_app'] as const;
export const NOTIFICATION_TYPES = [
  'system',
  'security',
  'marketing',
  'social',
  'transactional',
] as const;
export const NOTIFICATION_LEVELS = ['info', 'success', 'warning', 'error'] as const;
export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
