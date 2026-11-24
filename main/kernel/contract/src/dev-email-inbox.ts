// main/kernel/contract/src/dev-email-inbox.ts
/**
 * Development-only in-memory ring buffer for emails emitted by the console or
 * fallback email provider. Exposed by `@bslt/devtools` at `/developer/emails`
 * so founders can click verification, reset, magic-link, and workspace-invite
 * URLs locally without configuring SMTP.
 */

interface CapturedDevEmail {
  readonly id: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string | null;
  readonly html: string | null;
  readonly links: readonly string[];
  readonly sentAt: string;
}

interface RecordDevEmailInput {
  readonly id: string;
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly text?: string | undefined;
  readonly html?: string | undefined;
  readonly sentAt?: string | undefined;
}

const MAX_CAPTURED_EMAILS = 100;
const capturedEmails: CapturedDevEmail[] = [];

const HTTP_URL_REGEX = /https?:\/\/[^\s"'<>()]+/gu;
const HREF_ATTR_REGEX = /href=["']([^"']+)["']/gu;

function normalizeExtractedLink(raw: string): string | null {
  const trimmed = raw.trim().replace(/[.,;:!?]+$/u, '');
  if (trimmed === '') return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  return null;
}

export function extractEmailLinks(
  text: string | null | undefined,
  html: string | null | undefined,
): string[] {
  const seen = new Set<string>();
  const add = (candidate: string): void => {
    const normalized = normalizeExtractedLink(candidate);
    if (normalized !== null) {
      seen.add(normalized);
    }
  };

  if (typeof text === 'string' && text.length > 0) {
    for (const match of text.matchAll(HTTP_URL_REGEX)) {
      add(match[0]);
    }
  }

  if (typeof html === 'string' && html.length > 0) {
    for (const match of html.matchAll(HREF_ATTR_REGEX)) {
      if (match[1] !== undefined) add(match[1]);
    }
    for (const match of html.matchAll(HTTP_URL_REGEX)) {
      add(match[0]);
    }
  }

  return [...seen];
}

export function recordCapturedDevEmail(input: RecordDevEmailInput): CapturedDevEmail {
  const recipients: string[] = typeof input.to === 'string' ? [input.to] : [...input.to];
  const text = input.text ?? null;
  const html = input.html ?? null;
  const entry: CapturedDevEmail = {
    id: input.id,
    to: recipients,
    subject: input.subject,
    text,
    html,
    links: extractEmailLinks(text, html),
    sentAt: input.sentAt ?? new Date().toISOString(),
  };

  capturedEmails.unshift(entry);
  if (capturedEmails.length > MAX_CAPTURED_EMAILS) {
    capturedEmails.length = MAX_CAPTURED_EMAILS;
  }

  return entry;
}

export function listCapturedDevEmails(): readonly CapturedDevEmail[] {
  return [...capturedEmails];
}

export function clearCapturedDevEmails(): number {
  const cleared = capturedEmails.length;
  capturedEmails.length = 0;
  return cleared;
}
