// main/kernel/server/src/cron/cron-parser.test.ts
/**
 * Adversarial tests for the cron parser.
 *
 * Covers malformed input, range/step boundaries, the DOM/DOW OR semantics,
 * leap-year sparsity, and impossible expressions.
 */

import { describe, expect, it } from 'vitest';

import { nextRun, occurrencesBetween, parseCron } from './cron-parser';

/** Convenience: next occurrence as an ISO string for compact assertions. */
function next(expr: string, fromIso: string): string {
  return nextRun(parseCron(expr), new Date(fromIso)).toISOString();
}

describe('parseCron — validation (failure states)', () => {
  it.each([
    ['', 'empty'],
    ['* * * *', 'four fields'],
    ['* * * * * *', 'six fields'],
    ['60 * * * *', 'minute out of range'],
    ['* 24 * * *', 'hour out of range'],
    ['* * 0 * *', 'day-of-month below 1'],
    ['* * 32 * *', 'day-of-month above 31'],
    ['* * * 13 *', 'month above 12'],
    ['* * * 0 *', 'month below 1'],
    ['* * * * 8', 'weekday above 7'],
    ['5-1 * * * *', 'inverted range'],
    ['*/0 * * * *', 'zero step'],
    ['*/x * * * *', 'non-numeric step'],
    ['abc * * * *', 'non-numeric token'],
    ['1- * * * *', 'dangling range'],
  ])('rejects "%s" (%s)', (expr) => {
    expect(() => parseCron(expr)).toThrow();
  });

  it('accepts month and weekday names', () => {
    expect(() => parseCron('0 0 1 JAN MON')).not.toThrow();
    expect(() => parseCron('0 0 * * sun-fri')).not.toThrow();
  });

  it('normalizes weekday 7 to Sunday (0)', () => {
    const parsed = parseCron('0 0 * * 7');
    expect(parsed.daysOfWeek.values.has(0)).toBe(true);
    expect(parsed.daysOfWeek.values.has(7)).toBe(false);
  });
});

describe('nextRun — basic scheduling', () => {
  it('every minute advances by exactly one minute', () => {
    expect(next('* * * * *', '2026-06-12T10:00:30.000Z')).toBe('2026-06-12T10:01:00.000Z');
  });

  it('top of every hour', () => {
    expect(next('0 * * * *', '2026-06-12T10:15:00.000Z')).toBe('2026-06-12T11:00:00.000Z');
  });

  it('is strictly after — a matching instant returns the next one', () => {
    expect(next('0 * * * *', '2026-06-12T10:00:00.000Z')).toBe('2026-06-12T11:00:00.000Z');
  });

  it('daily at a specific time rolls to the next day', () => {
    expect(next('30 2 * * *', '2026-06-12T03:00:00.000Z')).toBe('2026-06-13T02:30:00.000Z');
  });

  it('step expressions land on the next multiple', () => {
    expect(next('*/15 * * * *', '2026-06-12T10:07:00.000Z')).toBe('2026-06-12T10:15:00.000Z');
  });

  it('list expressions pick the nearest member', () => {
    expect(next('0,30 * * * *', '2026-06-12T10:05:00.000Z')).toBe('2026-06-12T10:30:00.000Z');
  });

  it('range with step', () => {
    // Minutes 0,10,20,30 within the 0-30 window; next after :22 is :30.
    expect(next('0-30/10 * * * *', '2026-06-12T10:22:00.000Z')).toBe('2026-06-12T10:30:00.000Z');
  });
});

describe('nextRun — day-of-month vs day-of-week OR semantics', () => {
  it('matches when only DOM is restricted', () => {
    // The 15th at midnight, regardless of weekday.
    expect(next('0 0 15 * *', '2026-06-12T00:00:00.000Z')).toBe('2026-06-15T00:00:00.000Z');
  });

  it('matches when only DOW is restricted', () => {
    // Next Monday (2026-06-15 is a Monday) at midnight.
    expect(next('0 0 * * MON', '2026-06-12T00:00:00.000Z')).toBe('2026-06-15T00:00:00.000Z');
  });

  it('when BOTH are restricted, a day matching EITHER field fires', () => {
    const parsed = parseCron('0 0 13 * MON');
    // 2026-06-13 is a Saturday (the 13th — DOM match) → fires.
    expect(nextRun(parsed, new Date('2026-06-12T12:00:00.000Z')).toISOString()).toBe(
      '2026-06-13T00:00:00.000Z',
    );
    // From the 14th, the next hit is Monday the 15th (DOW match), not the 13th.
    expect(nextRun(parsed, new Date('2026-06-14T00:00:00.000Z')).toISOString()).toBe(
      '2026-06-15T00:00:00.000Z',
    );
  });
});

describe('nextRun — sparse and edge cases', () => {
  it('finds the next leap-year Feb 29', () => {
    // 2027 is not a leap year; the next Feb 29 after 2026 is 2028.
    expect(next('0 0 29 2 *', '2026-03-01T00:00:00.000Z')).toBe('2028-02-29T00:00:00.000Z');
  });

  it('rolls across a year boundary', () => {
    expect(next('0 0 1 1 *', '2026-12-15T00:00:00.000Z')).toBe('2027-01-01T00:00:00.000Z');
  });

  it('throws for an impossible expression (Feb 30)', () => {
    expect(() => next('0 0 30 2 *', '2026-01-01T00:00:00.000Z')).toThrow(/no occurrence/i);
  });
});

describe('occurrencesBetween — catch-up replay', () => {
  it('returns every occurrence in the half-open window, oldest first', () => {
    const parsed = parseCron('0 * * * *'); // hourly
    const result = occurrencesBetween(
      parsed,
      new Date('2026-06-12T09:00:00.000Z'),
      new Date('2026-06-12T12:00:00.000Z'),
      100,
    );
    expect(result.map((d) => d.toISOString())).toEqual([
      '2026-06-12T10:00:00.000Z',
      '2026-06-12T11:00:00.000Z',
      '2026-06-12T12:00:00.000Z',
    ]);
  });

  it('is bounded by max even when the window is huge', () => {
    const parsed = parseCron('* * * * *'); // every minute
    const result = occurrencesBetween(
      parsed,
      new Date('2026-06-12T00:00:00.000Z'),
      new Date('2026-06-13T00:00:00.000Z'),
      5,
    );
    expect(result).toHaveLength(5);
    expect(result[0]?.toISOString()).toBe('2026-06-12T00:01:00.000Z');
  });

  it('returns nothing when the window contains no occurrence', () => {
    const parsed = parseCron('0 0 * * *'); // daily midnight
    const result = occurrencesBetween(
      parsed,
      new Date('2026-06-12T01:00:00.000Z'),
      new Date('2026-06-12T23:00:00.000Z'),
      100,
    );
    expect(result).toEqual([]);
  });
});
