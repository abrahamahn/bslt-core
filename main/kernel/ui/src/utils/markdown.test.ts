// main/kernel/ui/src/utils/markdown.test.ts
import { describe, expect, it } from 'vitest';

import { parseMarkdown, safeHref } from './markdown';

import type { MarkdownBlock, MarkdownLinkSpan, MarkdownSpan } from './markdown';

/** Flatten a span tree to the text a reader would actually see. */
function textOf(spans: readonly MarkdownSpan[]): string {
  return spans
    .map((span) => {
      switch (span.kind) {
        case 'text':
        case 'code':
          return span.value;
        case 'link':
          return span.value;
        case 'bold':
        case 'italic':
        case 'strike':
          return textOf(span.spans);
      }
    })
    .join('');
}

function links(blocks: readonly MarkdownBlock[]): MarkdownLinkSpan[] {
  const found: MarkdownLinkSpan[] = [];
  const walk = (spans: readonly MarkdownSpan[]): void => {
    for (const span of spans) {
      if (span.kind === 'link') found.push(span);
      else if (span.kind === 'bold' || span.kind === 'italic' || span.kind === 'strike') {
        walk(span.spans);
      }
    }
  };
  for (const block of blocks) {
    if (block.kind === 'paragraph' || block.kind === 'heading' || block.kind === 'quote') {
      walk(block.spans);
    } else if (block.kind === 'list') {
      block.items.forEach(walk);
    }
  }
  return found;
}

describe('safeHref', () => {
  // These documents are edited from an admin panel. A link target is the one
  // place a payload can arrive without any markup at all.
  it.each([
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['  javascript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:msgbox(1)'],
    ['file:///etc/passwd'],
  ])('neutralises %s to #', (hostile) => {
    expect(safeHref(hostile)).toEqual({ href: '#', external: false });
  });

  it('neutralises a scheme obfuscated with an embedded tab', () => {
    // Browsers strip tabs and newlines before resolving a scheme, so this runs
    // as javascript:. An allowlist rejects it without having to know that.
    expect(safeHref('java\tscript:alert(1)').href).toBe('#');
  });

  it('rejects protocol-relative URLs, which read as paths but leave the origin', () => {
    expect(safeHref('//evil.example').href).toBe('#');
  });

  it.each([
    ['https://example.com', true],
    ['http://example.com', true],
  ])('keeps %s and marks it external', (href, external) => {
    expect(safeHref(href)).toEqual({ href, external });
  });

  it.each([['/terms'], ['#section-3'], ['?tab=data'], ['mailto:privacy@example.com']])(
    'keeps %s as an internal target',
    (href) => {
      expect(safeHref(href)).toEqual({ href, external: false });
    },
  );
});

describe('parseMarkdown — hostile input', () => {
  it('renders a script tag as text, never as markup', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('paragraph');
    // The token list has no way to express an element, so this can only be text.
    expect(textOf((blocks[0] as { spans: readonly MarkdownSpan[] }).spans)).toBe(
      '<script>alert(1)</script>',
    );
  });

  it('strips a javascript: href reached through a link in a list item', () => {
    const [link] = links(parseMarkdown('- [click me](javascript:alert(1))'));
    expect(link?.href).toBe('#');
    expect(link?.value).toBe('click me');
  });
});

// Each of these four was a real defect found against real legal prose. A
// reimplementation hits all four, so they are the load-bearing cases.
describe('parseMarkdown — the four parser bugs', () => {
  it('terminates on a pipe line with no divider row', () => {
    // Not a table (no divider), and the paragraph branch also rejected a line
    // starting with `|` — so it consumed nothing and spun until the heap died.
    const blocks = parseMarkdown('| a | b |\n\nAfter.');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph']);
    expect(textOf((blocks[0] as { spans: readonly MarkdownSpan[] }).spans)).toBe('| a | b |');
  });

  it('parses bold whose text contains an asterisk', () => {
    // `[^*]+` matched nothing here, so the asterisks printed to the reader.
    const blocks = parseMarkdown('Rated **4 * out of 5** overall.');
    const spans = (blocks[0] as { spans: readonly MarkdownSpan[] }).spans;
    const bold = spans.find((span) => span.kind === 'bold');
    expect(bold).toBeDefined();
    expect(textOf([bold as MarkdownSpan])).toBe('4 * out of 5');
    expect(textOf(spans)).not.toContain('**');
  });

  it('keeps a bold span intact across a wrapped list continuation line', () => {
    // Real documents wrap constantly; splitting the item at the wrap tore the
    // bold span in half and printed its asterisks.
    const blocks = parseMarkdown('- We may **suspend your\n  account** without notice.');
    expect(blocks[0]?.kind).toBe('list');
    const items = (blocks[0] as { items: readonly (readonly MarkdownSpan[])[] }).items;
    expect(items).toHaveLength(1);
    expect(textOf(items[0] as readonly MarkdownSpan[])).toBe(
      'We may suspend your account without notice.',
    );
    expect(textOf(items[0] as readonly MarkdownSpan[])).not.toContain('*');
  });

  it('nests emphasis', () => {
    // The closing line of nearly every legal document is italic text wrapping a
    // bold sentence. A flat outer span printed the inner asterisks.
    const blocks = parseMarkdown('_Please read this. **No refunds.** Thank you._');
    const spans = (blocks[0] as { spans: readonly MarkdownSpan[] }).spans;
    const italic = spans.find((span) => span.kind === 'italic');
    expect(italic).toBeDefined();
    const inner = (italic as { spans: readonly MarkdownSpan[] }).spans;
    expect(inner.some((span) => span.kind === 'bold')).toBe(true);
    expect(textOf(spans)).toBe('Please read this. No refunds. Thank you.');
    expect(textOf(spans)).not.toContain('*');
  });

  it('does not let a backslash escape disable inline parsing for the rest of the line', () => {
    // The old renderer bailed out of inline parsing at the first backslash.
    // Worse, an unconsumed `\*` pairs with the next real delimiter and opens a
    // phantom italic span that swallows the bold that follows it.
    const blocks = parseMarkdown('Give 5\\* effort and **try**.');
    const spans = (blocks[0] as { spans: readonly MarkdownSpan[] }).spans;
    expect(spans.some((span) => span.kind === 'bold')).toBe(true);
    expect(spans.some((span) => span.kind === 'italic')).toBe(false);
    expect(textOf(spans)).toBe('Give 5* effort and try.');
  });
});

/**
 * The paragraph branch consumes its first line unconditionally, because a line
 * it is reached with but that its own loop-guard also rejects — a `|` row with
 * no divider under it, say — would otherwise consume nothing, never advance
 * `index`, and allocate an empty paragraph per turn until the heap died. Every
 * one of these must terminate.
 */
describe('parseMarkdown — always terminates', () => {
  const nasty = [
    '| pipes | but no divider |',
    '|',
    '```',
    '```\nunclosed fence',
    '> ',
    '#',
    '   ',
    '|||\n|||',
    '- \n- ',
  ];

  for (const source of nasty) {
    it(`terminates on ${JSON.stringify(source)}`, () => {
      // A hang here fails by test timeout rather than by assertion — which is
      // the point: it must not hang.
      const blocks = parseMarkdown(source);
      expect(Array.isArray(blocks)).toBe(true);
    });
  }

  it('parses a long document in linear time', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `## S${String(i)}\n\nBody.`).join('\n\n');
    const blocks = parseMarkdown(big);

    expect(blocks.filter((block) => block.kind === 'heading')).toHaveLength(5000);
    expect(blocks.filter((block) => block.kind === 'paragraph')).toHaveLength(5000);
  });
});

describe('parseMarkdown — blocks', () => {
  it('parses headings at their level', () => {
    const blocks = parseMarkdown('# One\n\n### Three');
    expect(blocks.map((block) => (block as { level?: number }).level)).toEqual([1, 3]);
  });

  it('parses _underscore_ italic', () => {
    const blocks = parseMarkdown('See the _effective date_ above.');
    const spans = (blocks[0] as { spans: readonly MarkdownSpan[] }).spans;
    const italic = spans.find((span) => span.kind === 'italic');
    expect(italic).toBeDefined();
    expect(textOf([italic as MarkdownSpan])).toBe('effective date');
    expect(textOf(spans)).not.toContain('_');
  });

  it('parses ~~strikethrough~~ as a strike span', () => {
    const blocks = parseMarkdown('The fee is ~~$5~~ $3.');
    const spans = (blocks[0] as { spans: readonly MarkdownSpan[] }).spans;
    const strike = spans.find((span) => span.kind === 'strike');
    expect(strike).toBeDefined();
    expect(textOf([strike as MarkdownSpan])).toBe('$5');
    expect(textOf(spans)).not.toContain('~');
  });

  it('parses a GFM table with its header and rows', () => {
    const blocks = parseMarkdown('| Cookie | Purpose |\n| --- | --- |\n| sid | Session |');
    expect(blocks[0]?.kind).toBe('table');
    const table = blocks[0] as {
      head: readonly (readonly MarkdownSpan[])[];
      rows: readonly (readonly (readonly MarkdownSpan[])[])[];
    };
    expect(table.head.map(textOf)).toEqual(['Cookie', 'Purpose']);
    expect(table.rows).toHaveLength(1);
    expect((table.rows[0] ?? []).map(textOf)).toEqual(['sid', 'Session']);
  });

  it('parses inline emphasis inside a table cell', () => {
    const blocks = parseMarkdown('| Term |\n| --- |\n| **binding** text |');
    const table = blocks[0] as { rows: readonly (readonly (readonly MarkdownSpan[])[])[] };
    const cell = table.rows[0]?.[0] ?? [];
    expect(cell.some((span) => span.kind === 'bold')).toBe(true);
    expect(textOf(cell)).toBe('binding text');
  });

  it('ends a table at the first non-pipe line and keeps parsing after it', () => {
    const blocks = parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nParagraph after.');
    expect(blocks.map((block) => block.kind)).toEqual(['table', 'paragraph']);
  });

  it('takes fenced code verbatim, without parsing inline syntax inside it', () => {
    const blocks = parseMarkdown('```\nconst a = **not bold**;\n```');
    expect(blocks[0]).toEqual({ kind: 'code', value: 'const a = **not bold**;' });
  });

  it('ends an unclosed fence at the end of the document rather than hanging', () => {
    const blocks = parseMarkdown('```\nunterminated');
    expect(blocks).toEqual([{ kind: 'code', value: 'unterminated' }]);
  });

  it('joins consecutive quote lines into one blockquote', () => {
    const blocks = parseMarkdown('> First line\n> second line');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('quote');
    expect(textOf((blocks[0] as { spans: readonly MarkdownSpan[] }).spans)).toBe(
      'First line second line',
    );
  });

  it('distinguishes ordered from unordered lists', () => {
    const blocks = parseMarkdown('1. First\n2. Second');
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true });
    expect(parseMarkdown('- First\n- Second')[0]).toMatchObject({ kind: 'list', ordered: false });
  });

  it('returns no blocks for an empty document', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });
});
