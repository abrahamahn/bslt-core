// main/tools/lib/env-file.ts
/**
 * Reads dotenv files the way the audits need them: the active assignments, with
 * their line numbers, ignoring comments.
 */

export interface EnvAssignment {
  readonly key: string;
  readonly line: number;
  readonly raw: string;
  readonly value: string;
}

function stripInlineComment(value: string): string {
  const trimmed = value.trim();
  const isQuoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));

  if (isQuoted) return trimmed.slice(1, -1);
  return trimmed.replace(/\s+#.*$/u, '').trim();
}

/** Uncommented `KEY=value` lines, with inline comments and quotes removed from the value. */
export function parseActiveEnvAssignments(content: string): EnvAssignment[] {
  const assignments: EnvAssignment[] = [];
  const assignmentPattern = /^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/u;

  content.split(/\r?\n/u).forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;

    const match = assignmentPattern.exec(rawLine);
    if (match === null) return;

    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) return;

    assignments.push({ key, line: index + 1, raw: rawLine, value: stripInlineComment(rawValue) });
  });

  return assignments;
}
