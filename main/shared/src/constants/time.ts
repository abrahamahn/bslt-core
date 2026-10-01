// main/shared/src/constants/time.ts

/**
 * @file Time Constants
 * @description Compile-time numeric literals for time calculations.
 * @module Primitives/Constants/Time
 */

/** Check standard time zone identifiers. */
export const TIME_ZONE = {
  UTC: 'UTC',
} as const;

/** Common date format strings. */
export const DATE_FORMATS = {
  ISO_8601: "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
  DISPLAY_DATE: 'MMM dd, yyyy',
  DISPLAY_DATETIME: 'MMM dd, yyyy HH:mm',
} as const;

/**
 * Standard time unit conversions.
 * All values are integers.
 */
export const TIME = {
  MS_PER_SECOND: 1000,
  SECONDS_PER_MINUTE: 60,
  MINUTES_PER_HOUR: 60,
  HOURS_PER_DAY: 24,
  DAYS_PER_WEEK: 7,

  MS_PER_MINUTE: 60 * 1000,
  MS_PER_HOUR: 60 * 60 * 1000,
  MS_PER_DAY: 24 * 60 * 60 * 1000,

  SECONDS_PER_HOUR: 60 * 60,
  SECONDS_PER_DAY: 60 * 60 * 24,
} as const;

// ----------------------------------------------------------------------------
// Direct Exports
// ----------------------------------------------------------------------------

/** Milliseconds per second. */
export const MS_PER_SECOND = TIME.MS_PER_SECOND;
/** Seconds per minute. */
export const SECONDS_PER_MINUTE = TIME.SECONDS_PER_MINUTE;
/** Minutes per hour. */
export const MINUTES_PER_HOUR = TIME.MINUTES_PER_HOUR;
/** Hours per day. */
export const HOURS_PER_DAY = TIME.HOURS_PER_DAY;
/** Days per week. */
export const DAYS_PER_WEEK = TIME.DAYS_PER_WEEK;
/** Milliseconds per minute. */
export const MS_PER_MINUTE = TIME.MS_PER_MINUTE;
/** Milliseconds per hour. */
export const MS_PER_HOUR = TIME.MS_PER_HOUR;
/** Milliseconds per day. */
export const MS_PER_DAY = TIME.MS_PER_DAY;
/** Seconds per hour. */
export const SECONDS_PER_HOUR = TIME.SECONDS_PER_HOUR;
/** Seconds per day. */
export const SECONDS_PER_DAY = TIME.SECONDS_PER_DAY;
