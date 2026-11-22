// main/kernel/server/src/cron/cron-parser.ts
/**
 * Minimal 5-field cron parser (UTC).
 *
 * Supports the standard `minute hour day-of-month month day-of-week` syntax:
 *   - `*`              every value
 *   - `a`              single value
 *   - `a-b`            inclusive range
 *   - `a,b,c`          list
 *   - `* / n`          step over the whole range (written without spaces)
 *   - `a-b/n`          step over a range
 *   - `a/n`            step from `a` to the field maximum
 *
 * Month accepts JAN–DEC and day-of-week accepts SUN–SAT (case-insensitive).
 * Day-of-week 7 is treated as Sunday (0). When both day-of-month and
 * day-of-week are restricted (neither is `*`), a day matches if it satisfies
 * EITHER field — the classic Vixie-cron OR semantics.
 *
 * Everything is computed in UTC for deterministic server scheduling.
 *
 * @module cron/cron-parser
 */

interface CronField {
  values: Set<number>;
  wildcard: boolean;
}

export interface ParsedCron {
  minutes: CronField;
  hours: CronField;
  daysOfMonth: CronField;
  months: CronField;
  daysOfWeek: CronField;
  /** The original normalized expression, for logging/persistence. */
  expression: string;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DOW_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** Resolve a token to a number, honoring per-field names (months, weekdays). */
function resolveToken(token: string, names: Record<string, number> | undefined): number {
  const named = names?.[token.toLowerCase()];
  if (named !== undefined) {
    return named;
  }
  if (!/^\d+$/.test(token)) {
    throw new Error(`Invalid cron token: "${token}"`);
  }
  return Number.parseInt(token, 10);
}

function parseField(
  spec: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): CronField {
  const trimmed = spec.trim();
  if (trimmed === '') {
    throw new Error('Empty cron field');
  }

  const values = new Set<number>();
  const wildcard = trimmed === '*';

  for (const segment of trimmed.split(',')) {
    const [rangePart, stepPart] = segment.split('/');
    if (rangePart === undefined || rangePart === '') {
      throw new Error(`Invalid cron segment: "${segment}"`);
    }

    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (stepPart !== undefined && (!/^\d+$/.test(stepPart) || step < 1)) {
      throw new Error(`Invalid cron step: "${segment}"`);
    }

    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      if (a === undefined || b === undefined) {
        throw new Error(`Invalid cron range: "${segment}"`);
      }
      start = resolveToken(a, names);
      end = resolveToken(b, names);
    } else {
      start = resolveToken(rangePart, names);
      // `a/n` (no explicit end) steps from `a` to the field maximum.
      end = stepPart === undefined ? start : max;
    }

    if (start < min || end > max || start > end) {
      throw new Error(`Cron value out of range [${String(min)}-${String(max)}]: "${segment}"`);
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return { values, wildcard };
}

/**
 * Parse a 5-field cron expression into matchable fields.
 *
 * @throws Error when the expression is malformed or out of range.
 */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Cron expression must have 5 fields (minute hour day month weekday), got ${String(fields.length)}: "${expression}"`,
    );
  }

  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];

  const daysOfWeek = parseField(dow, 0, 7, DOW_NAMES);
  // Normalize 7 (Sunday) to 0 so getUTCDay() comparisons match.
  if (daysOfWeek.values.delete(7)) {
    daysOfWeek.values.add(0);
  }

  return {
    minutes: parseField(minute, 0, 59),
    hours: parseField(hour, 0, 23),
    daysOfMonth: parseField(dom, 1, 31),
    months: parseField(month, 1, 12, MONTH_NAMES),
    daysOfWeek,
    expression: fields.join(' '),
  };
}

function dayMatches(parsed: ParsedCron, date: Date): boolean {
  const domMatch = parsed.daysOfMonth.values.has(date.getUTCDate());
  const dowMatch = parsed.daysOfWeek.values.has(date.getUTCDay());
  const domRestricted = !parsed.daysOfMonth.wildcard;
  const dowRestricted = !parsed.daysOfWeek.wildcard;

  if (domRestricted && dowRestricted) {
    return domMatch || dowMatch;
  }
  if (domRestricted) {
    return domMatch;
  }
  if (dowRestricted) {
    return dowMatch;
  }
  return true;
}

/**
 * The next UTC occurrence strictly after `after`.
 *
 * Advances field-by-field (month → day → hour → minute) so the search is
 * efficient even for sparse expressions. Throws if no match exists within
 * five years — long enough to cover Feb-29 (a 4-year gap) while quickly
 * rejecting impossible expressions like `0 0 30 2 *`.
 */
export function nextRun(parsed: ParsedCron, after: Date): Date {
  // Start at the next whole minute strictly after `after`.
  let cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor = new Date(cursor.getTime() + 60_000);

  const limitYear = after.getUTCFullYear() + 5;

  while (cursor.getUTCFullYear() <= limitYear) {
    if (!parsed.months.values.has(cursor.getUTCMonth() + 1)) {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 0, 0, 0));
      continue;
    }
    if (!dayMatches(parsed, cursor)) {
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1, 0, 0, 0),
      );
      continue;
    }
    if (!parsed.hours.values.has(cursor.getUTCHours())) {
      cursor = new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          cursor.getUTCDate(),
          cursor.getUTCHours() + 1,
          0,
          0,
        ),
      );
      continue;
    }
    if (!parsed.minutes.values.has(cursor.getUTCMinutes())) {
      cursor = new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          cursor.getUTCDate(),
          cursor.getUTCHours(),
          cursor.getUTCMinutes() + 1,
          0,
        ),
      );
      continue;
    }
    return cursor;
  }

  throw new Error(`Cron expression has no occurrence within 5 years: "${parsed.expression}"`);
}

/**
 * All occurrences in the half-open window `(after, until]`, oldest first.
 *
 * Used by catch-up to replay runs missed while the scheduler was down.
 * Bounded by `max` to avoid unbounded replay after a long outage.
 */
export function occurrencesBetween(
  parsed: ParsedCron,
  after: Date,
  until: Date,
  max: number,
): Date[] {
  const out: Date[] = [];
  let cursor = after;
  while (out.length < max) {
    const next = nextRun(parsed, cursor);
    if (next.getTime() > until.getTime()) {
      break;
    }
    out.push(next);
    cursor = next;
  }
  return out;
}
