// main/client/ui/src/utils/markdown.ts
/**
 * A Markdown parser for authored documents — terms, privacy policy, cookie
 * policy, help pages.
 *
 * It emits a typed token list, never an HTML string, so the renderer builds
 * React elements and HTML injection is impossible: a `<script>` in a document
 * is text, because text is all this can produce.
 *
 * That argument is about *markup*, and it is easy to stop there and miss the
 * other half. A link carries a URL, and `[click](javascript:alert(1))` needs no
 * markup at all — so hrefs are checked against an allowlist here, in the
 * parser, and `MarkdownLinkSpan.href` is safe by construction. There is
 * deliberately no `sanitize` option to leave switched off: these documents are
 * editable from an admin panel, which is exactly where a stored payload would
 * arrive.
 *
 * It supports what the documents use — headings, paragraphs, bold, italic,
 * strikethrough, code, links, backslash escapes, lists, GFM tables, rules,
 * blockquotes, fenced code — and nothing else. Anything unrecognised degrades
 * to plain text.
 */

export interface MarkdownTextSpan {
  readonly kind: 'text';
  readonly value: string;
}

/** Emphasis nests: `_italic with **bold** inside_` is real, and common. */
export interface MarkdownStyledSpan {
  readonly kind: 'bold' | 'italic' | 'strike';
  readonly spans: readonly MarkdownSpan[];
}

/** Code is never parsed further — its content is literal by definition. */
export interface MarkdownCodeSpan {
  readonly kind: 'code';
  readonly value: string;
}

export interface MarkdownLinkSpan {
  readonly kind: 'link';
  readonly value: string;
  /** Allowlisted by {@link safeHref}. Never a `javascript:` or `data:` URL. */
  readonly href: string;
  /** True for http(s) — rendered as an anchor that opens in a new tab. */
  readonly external: boolean;
}

export type MarkdownSpan =
  | MarkdownTextSpan
  | MarkdownStyledSpan
  | MarkdownCodeSpan
  | MarkdownLinkSpan;

export interface MarkdownHeading {
  readonly kind: 'heading';
  /** 1–6. */
  readonly level: number;
  readonly spans: readonly MarkdownSpan[];
}

export interface MarkdownParagraph {
  readonly kind: 'paragraph';
  readonly spans: readonly MarkdownSpan[];
}

export interface MarkdownList {
  readonly kind: 'list';
  readonly ordered: boolean;
  readonly items: readonly (readonly MarkdownSpan[])[];
}

export interface MarkdownTable {
  readonly kind: 'table';
  readonly head: readonly (readonly MarkdownSpan[])[];
  readonly rows: readonly (readonly (readonly MarkdownSpan[])[])[];
}

export interface MarkdownQuote {
  readonly kind: 'quote';
  readonly spans: readonly MarkdownSpan[];
}

export interface MarkdownCode {
  readonly kind: 'code';
  readonly value: string;
}

export interface MarkdownRule {
  readonly kind: 'rule';
}

export type MarkdownBlock =
  | MarkdownHeading
  | MarkdownParagraph
  | MarkdownList
  | MarkdownTable
  | MarkdownQuote
  | MarkdownCode
  | MarkdownRule;

const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const QUOTE = /^>\s?(.*)$/;
const TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

/** The only absolute schemes a document may link to. */
const SAFE_SCHEME = /^(https?|mailto):/i;
/** http(s) specifically — these leave the app and open in a new tab. */
const EXTERNAL_SCHEME = /^https?:/i;

interface SafeHref {
  readonly href: string;
  readonly external: boolean;
}

/**
 * Resolve a link target to something safe to put in an `href`.
 *
 * An allowlist, not a blocklist, and that is the whole point: browsers strip
 * tabs and newlines from a scheme before resolving it, so `java\tscript:` runs
 * as `javascript:` while any blocklist matching the literal string sails past.
 * Anything not positively recognised becomes `#`.
 *
 * Protocol-relative `//host` is rejected rather than followed — an authored
 * document has no reason to emit one, and it navigates off-origin while reading
 * like a path.
 */
export function safeHref(raw: string): SafeHref {
  const href = raw.trim();

  if (href.startsWith('//')) return { href: '#', external: false };
  // Same-origin by construction: a path, an in-page anchor, or a query.
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('?')) {
    return { href, external: false };
  }
  if (SAFE_SCHEME.test(href)) {
    return { href, external: EXTERNAL_SCHEME.test(href) };
  }
  return { href: '#', external: false };
}

/**
 * `\*` escapes, `**bold**`, `*italic*`/`_italic_`, `~~strike~~`, `` `code` ``,
 * `[text](href)` — in one pass.
 *
 * Escapes are matched first so a literal `\*` is consumed as text instead of
 * pairing with a later delimiter: without that, the escaped asterisk opened a
 * phantom italic span that swallowed the next real one and broke every inline
 * span for the rest of the line. Bold is lazy and allows anything inside it
 * (`[\s\S]+?`), not `[^*]+`: a bold span whose text contains an asterisk
 * matched nothing under the stricter pattern and printed its own asterisks at
 * the reader. Bold is tried before italic so `**x**` is never read as an empty
 * italic wrapping `*x*`.
 */
const INLINE =
  /(\\[\\`*_~[\]|]|\*\*[\s\S]+?\*\*|~~[\s\S]+?~~|\*[^*\n]+\*|_[\s\S]+?_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function parseSpans(source: string): readonly MarkdownSpan[] {
  const spans: MarkdownSpan[] = [];
  let cursor = 0;

  for (const match of source.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index;
    if (at > cursor) {
      spans.push({ kind: 'text', value: source.slice(cursor, at) });
    }
    cursor = at + token.length;

    if (token.startsWith('\\')) {
      spans.push({ kind: 'text', value: token.slice(1) });
    } else if (token.startsWith('**')) {
      // Recurse: emphasis nests, and the closing line of a legal document is
      // routinely italic text wrapping a bold sentence. Treating the outer
      // span's body as flat text printed the inner asterisks at the reader.
      spans.push({ kind: 'bold', spans: parseSpans(token.slice(2, -2)) });
    } else if (token.startsWith('~~')) {
      spans.push({ kind: 'strike', spans: parseSpans(token.slice(2, -2)) });
    } else if (token.startsWith('`')) {
      spans.push({ kind: 'code', value: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const { href, external } = safeHref(token.slice(split + 2, -1));
      spans.push({ kind: 'link', value: token.slice(1, split), href, external });
    } else {
      spans.push({ kind: 'italic', spans: parseSpans(token.slice(1, -1)) });
    }
  }

  if (cursor < source.length) {
    spans.push({ kind: 'text', value: source.slice(cursor) });
  }
  return spans;
}

function splitRow(line: string): readonly (readonly MarkdownSpan[])[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => parseSpans(cell.trim()));
}

/** Parse a Markdown document into blocks. Never throws; unknown syntax is text. */
export function parseMarkdown(source: string): readonly MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      index += 1;
      continue;
    }

    // Fenced code — taken verbatim, never parsed for inline syntax.
    if (trimmed.startsWith('```')) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // closing fence (or end of document — an unclosed fence still ends here)
      blocks.push({ kind: 'code', value: body.join('\n') });
      continue;
    }

    if (RULE.test(trimmed)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        spans: parseSpans(heading[2] ?? ''),
      });
      index += 1;
      continue;
    }

    // A table needs its divider row on the next line, or it is just paragraphs.
    if (trimmed.startsWith('|') && TABLE_DIVIDER.test((lines[index + 1] ?? '').trim())) {
      const head = splitRow(trimmed);
      const rows: (readonly (readonly MarkdownSpan[])[])[] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        rows.push(splitRow((lines[index] ?? '').trim()));
        index += 1;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    const isUnordered = UNORDERED.test(trimmed);
    if (isUnordered || ORDERED.test(trimmed)) {
      const items: string[] = [];
      const pattern = isUnordered ? UNORDERED : ORDERED;
      while (index < lines.length) {
        const candidate = (lines[index] ?? '').trim();
        const item = pattern.exec(candidate);

        if (item !== null) {
          items.push(item[1] ?? '');
          index += 1;
          continue;
        }

        // Lazy continuation: an item that wraps onto the next line belongs to
        // the item, not to a new paragraph. Splitting it there tore `**bold`
        // spans that wrapped mid-phrase in half and printed the asterisks —
        // real documents wrap constantly.
        const continues =
          items.length > 0 &&
          candidate !== '' &&
          !HEADING.test(candidate) &&
          !RULE.test(candidate) &&
          !QUOTE.test(candidate) &&
          !candidate.startsWith('```') &&
          !candidate.startsWith('|');
        if (!continues) break;

        items[items.length - 1] = `${items[items.length - 1] ?? ''} ${candidate}`;
        index += 1;
      }
      blocks.push({
        kind: 'list',
        ordered: !isUnordered,
        items: items.map((item) => parseSpans(item)),
      });
      continue;
    }

    const quote = QUOTE.exec(trimmed);
    if (quote !== null) {
      const body: string[] = [quote[1] ?? ''];
      index += 1;
      while (index < lines.length) {
        const next = QUOTE.exec((lines[index] ?? '').trim());
        if (next === null) break;
        body.push(next[1] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'quote', spans: parseSpans(body.join(' ')) });
      continue;
    }

    // Paragraph: consume until a blank line or a line that starts a new block.
    //
    // The FIRST line is always consumed, unconditionally. Without that, a line
    // this branch was reached with but that the loop's guard also rejects — a
    // `|` row with no divider under it, say, which is not a table and so lands
    // here — would consume nothing, leave `index` where it was, and spin
    // forever, allocating an empty paragraph per turn until the heap died.
    const body: string[] = [trimmed];
    index += 1;
    while (index < lines.length) {
      const candidate = (lines[index] ?? '').trim();
      if (
        candidate === '' ||
        HEADING.test(candidate) ||
        RULE.test(candidate) ||
        UNORDERED.test(candidate) ||
        ORDERED.test(candidate) ||
        QUOTE.test(candidate) ||
        candidate.startsWith('```') ||
        candidate.startsWith('|')
      ) {
        break;
      }
      body.push(candidate);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', spans: parseSpans(body.join(' ')) });
  }

  return blocks;
}
