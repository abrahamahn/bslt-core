// main/apps/web/src/__tests__/documents.test.ts
/**
 * The guard on the published documents themselves.
 *
 * The three file-owned legal pages ship straight from docs/legal/*.md, and a
 * markdown file can assert anything about the product with nothing checking.
 * So every claim a document makes about storage is pinned here to the code
 * that makes it true — the shared cookie-name constants, the auth config, the
 * in-memory token store — never to a sentence copied out of the document.
 * Ported from ganbate's guard of the same name and shape.
 *
 * It sits in __tests__ rather than beside a module because its subject is the
 * markdown under docs/legal/, not a source file — there is no colocated peer
 * for it to sit next to, which is precisely what the colocated-test-pairs
 * audit flags.
 *
 * Two things break this suite, and both are the point:
 *
 *   1. A document contradicts the code → the failure names the document and
 *      quotes the words.
 *   2. The CODE drops the control a document describes → the "still ships"
 *      pin fails, which means the documents have just started overclaiming.
 *      Fix the code or rewrite the document in the same commit. Never delete
 *      the assertion to go green — unchecked documents are how the falsehood
 *      ships in the first place.
 *
 * FOR FORKS WHOSE DOCUMENTS QUOTE PRICES: pin every figure to the constant
 * the checkout actually charges, row by row, never to prose. The template
 * (from ganbate, whose purchase terms print a coin-pack table):
 *
 *   it.each([...COIN_PACKS])('quotes the real price for the $name pack', (pack) => {
 *     const row = new RegExp(
 *       `\\|\\s*${pack.name}\\s*\\|\\s*${money(pack.coinsCents)}\\s*\\|\\s*\\$${money(pack.priceUsdCents)}\\s*\\|`,
 *     );
 *     expect(body).toMatch(row);
 *   });
 *
 * bslt's static documents quote no prices today, so no such block exists here
 * (YAGNI) — and the per-document "quotes no price" tripwire below fails the
 * day one appears, so writing the pin cannot be forgotten.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokenStore } from '@bslt/client-engine';
import { DOCUMENT_TYPES } from '@bslt/compliance/contract';
import { fillDocument, OPERATOR } from '@bslt/compliance/web';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from '@bslt/contract';
import { DEFAULT_SESSION_DAYS, REMEMBERED_SESSION_DAYS } from '@bslt/identity/contract';
import { parseMarkdown } from '@bslt/ui';
import { describe, expect, it } from 'vitest';

// src/__tests__ -> src -> web -> apps -> main -> repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const LEGAL = join(REPO_ROOT, 'main/modules/compliance/seeds/legal');

/** The documents that are actually published. Notes-to-self are not. */
const NOT_PUBLISHED = new Set(['README.md']);

/** Kept verbatim until a lawyer signs off — mirrors legal-templates.test.ts. */
const TEMPLATE_BANNER =
  '**This is an unedited template. It is not legal advice and must be reviewed by a lawyer before you publish it.**';

/** A currency figure — `$4.99`, `€10`, `4.99 USD`, `ten dollars` is prose and fine. */
const PRICE_FIGURE =
  /[$€£]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars?|euros?|cents?)\b/i;

interface PublishedDoc {
  /** For failure messages: `legal/cookie-policy.md`. */
  readonly name: string;
  /** Bare file name, for parity with the page layer. */
  readonly file: string;
  readonly body: string;
}

function publishedDocs(): readonly PublishedDoc[] {
  return readdirSync(LEGAL)
    .filter((file) => file.endsWith('.md') && !NOT_PUBLISHED.has(file))
    .map((file) => ({
      name: `legal/${file}`,
      file,
      body: readFileSync(join(LEGAL, file), 'utf-8'),
    }));
}

/** Source text of a file, by repo-relative path. Throws loudly if it moves. */
function sourceOf(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
}

/** The `## Heading` … next-`## ` slice of a document. */
function sectionOf(doc: PublishedDoc, heading: string): string {
  const start = doc.body.indexOf(heading);
  expect(start, `${doc.name} has no "${heading}" section`).toBeGreaterThan(-1);
  const rest = doc.body.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

/** First-column backticked names of a markdown table: | `refreshToken` | … */
function backtickedKeys(section: string): readonly string[] {
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1] ?? '');
}

describe('the published documents', () => {
  const docs = publishedDocs();

  it('finds the documents (the guard is worthless if it scans nothing)', () => {
    expect(docs.length).toBeGreaterThanOrEqual(3);
  });

  it('renders an undefined token as "[pending]", never as raw markup', () => {
    // Every "no gap once rendered" check below rests on this branch, and
    // today's documents cite only defined tokens — so without this pin, the
    // branch could regress to leaving raw [[…]] and the guard would stay
    // green right up until the first [[TODO]] note ships to a reader.
    expect(fillDocument('[[SOME_FUTURE_FACT]]')).toBe('[pending]');
  });

  it('has a non-empty value for every operator fact', () => {
    for (const [token, value] of Object.entries(OPERATOR)) {
      expect(
        value.trim(),
        `OPERATOR.${token} is blank — it would fill a legal document with nothing`,
      ).not.toBe('');
    }
  });

  for (const doc of docs) {
    describe(doc.name, () => {
      /**
       * A `[[TOKEN]]` the fill table does not define — a `[[TODO — …]]` note
       * included — renders to the reader as the literal string "[pending]":
       * a hole in a sentence, mid-paragraph. Nothing else in CI catches it.
       */
      it('cites no token the fill table does not define', () => {
        const tokens = [...doc.body.matchAll(/\[\[([A-Z_]+)[\s\S]*?\]\]/g)].map(
          (match) => match[1] ?? '',
        );
        const unknown = tokens.filter((token) => !(token in OPERATOR));

        expect(
          unknown,
          `${doc.name} cites ${unknown.map((token) => `[[${token}]]`).join(', ')}, which OPERATOR ` +
            'does not define. It renders as "[pending]". Resolve it or cut it.',
        ).toEqual([]);
      });

      it('leaves no placeholder and no gap once rendered', () => {
        const filled = fillDocument(doc.body);
        expect(filled).not.toContain('[[');
        expect(filled).not.toContain('[pending]');
      });

      it('says something (more than 200 characters of filled prose)', () => {
        expect(fillDocument(doc.body).trim().length).toBeGreaterThan(200);
      });

      it('quotes no price — this guard pins none to the checkout', () => {
        // A figure nothing verifies is the exact lie this suite exists to
        // stop. The day a document must quote one, pin it row-by-row to the
        // constant the checkout charges (template in the header) and retire
        // this tripwire for that figure — never by loosening the pattern.
        const hit = doc.body.match(PRICE_FIGURE);
        expect(
          hit,
          `${doc.name} quotes "${hit?.[0] ?? ''}", but no assertion pins that figure to the ` +
            'code that charges it. Add the pin before publishing the price.',
        ).toBeNull();
      });

      it('still confesses to being an unedited template', () => {
        expect(
          doc.body,
          `${doc.name} lost its unedited-template banner. bslt ships templates; the banner ` +
            'comes off only in the commit where a lawyer signs the document off — and then ' +
            'this assertion changes with it, deliberately.',
        ).toContain(TEMPLATE_BANNER);
      });
    });
  }
});

/**
 * Parity with the page layer. A document nobody renders is dead weight that
 * this guard would keep vouching for; a page rendering a file from outside
 * docs/legal escapes both the fill contract and every check above.
 */
describe('parity with the page layer', () => {
  const pagesDir = join(REPO_ROOT, 'main/modules/compliance/web');
  const pagesSource = readFileSync(join(pagesDir, 'ContentPages.tsx'), 'utf-8');
  const rendered = [...pagesSource.matchAll(/from '([^']+)\?raw'/g)].map((match) => match[1] ?? '');

  it('renders only markdown that lives in compliance/seeds/legal — from ANY source file', () => {
    const scanDirs = [join(REPO_ROOT, 'main/apps/web/src'), join(REPO_ROOT, 'main/modules')];
    for (const dir of scanDirs) {
      for (const file of sourceFilesUnder(dir)) {
        const specs = [...readFileSync(file, 'utf-8').matchAll(/from '(\.\.?\/[^']*\.md)\?raw'/g)];
        for (const [, spec] of specs) {
          expect(
            resolve(dirname(file), spec ?? '').startsWith(`${LEGAL}/`),
            `${file} renders ${spec ?? ''}, which is outside compliance/seeds/legal — no guard covers it`,
          ).toBe(true);
        }
      }
    }
  });

  it('renders every published document, and nothing else', () => {
    expect([...rendered.map((spec) => basename(spec))].sort()).toEqual(
      publishedDocs()
        .map((doc) => doc.file)
        .sort(),
    );
  });
});

/**
 * The other half of the ownership split: the DB-seeded templates.
 *
 * LegalDocumentPage and the admin live preview render `legal_documents`
 * content through the same `<Markdown>` component, and the bodies seeded by
 * the compliance seed are the first content every deployment serves — but
 * legal-templates.test.ts (main/kernel/db) can only grep the SQL, because a
 * server package must not import the `@bslt/ui` parser. So the parse check
 * lives here, on the web side, where the parser is already a dependency.
 */
describe('the DB-seeded templates (the required seed of compliance)', () => {
  const sql = sourceOf('main/modules/compliance/server/migrations/seeds/0001_legal_templates.sql');
  // Each VALUES row: ('type', 'Title', $doc$body$doc$, 1, NOW()).
  const templates = [...sql.matchAll(/'([a-z_]+)',\s*'[^']+',\s*\$doc\$([\s\S]*?)\$doc\$/g)].map(
    (match) => ({ type: match[1] ?? '', body: match[2] ?? '' }),
  );

  it('extracts one body per document type — the guard is worthless if it scans nothing', () => {
    expect(templates.map((template) => template.type).sort()).toEqual([...DOCUMENT_TYPES].sort());
  });

  it.each(templates)('$type parses to a real document, not one opaque blob', ({ body }) => {
    // A body the parser reads as fewer than a handful of blocks means the
    // markdown is broken enough to render as a wall of text on the live page —
    // nothing else runs these bodies through the parser before a reader does.
    expect(parseMarkdown(body).length).toBeGreaterThan(3);
  });

  it.each(templates)('$type says something (more than 200 characters)', ({ body }) => {
    expect(body.trim().length).toBeGreaterThan(200);
  });

  it.each(templates)('$type quotes no price — nothing pins one to the checkout', ({ body }) => {
    expect(body).not.toMatch(PRICE_FIGURE);
  });
});

/**
 * The storage story the cookie policy tells is the storage the app uses.
 *
 * The policy's own promise — "if you find a cookie we set that is not in this
 * table, either the table or the code is wrong" — is exactly the kind of
 * sentence that goes stale silently, so every fact it rests on is pinned to
 * the constant or source that makes it true. The first draft failed here: it
 * claimed sign-out removes the legacy `accessToken` entry, and nothing does.
 */
describe('legal/cookie-policy.md — the storage story it tells', () => {
  const doc = publishedDocs().find((candidate) => candidate.file === 'cookie-policy.md');
  if (doc === undefined) throw new Error('docs/legal/cookie-policy.md is gone');

  it('names exactly the cookies the server sets, by their shared constants', () => {
    const listed = backtickedKeys(sectionOf(doc, '## What we set'));
    expect(
      [...listed].sort(),
      'The cookie table and AUTH_CONSTANTS disagree. The policy promises the table is the ' +
        'whole list — change the table and the code in the same commit.',
    ).toEqual([CSRF_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME].sort());
  });

  /**
   * Pinned to the SESSION-SPAN constants, not to `REFRESH_TOKEN_EXPIRY_DAYS`.
   *
   * That config default no longer decides this cookie: since remember-me landed,
   * `sessionSpanDays` does, and the cookie is issued for 30 days or half a day.
   * The old assertion compared the policy against the config default — and both
   * still said "7 days" while neither governed the cookie any more, so it went
   * on passing while the published document was wrong. A guard has to be tied to
   * the value that actually decides the behaviour, or it only proves two stale
   * copies agree with each other.
   */
  it('quotes the real refresh-token lifetimes, both of them', () => {
    const rememberedDays = String(REMEMBERED_SESSION_DAYS);
    const defaultHours = String(DEFAULT_SESSION_DAYS * 24);
    const row = doc.body
      .split('\n')
      .find((line) => line.includes(`\`${REFRESH_TOKEN_COOKIE_NAME}\``));

    expect(
      row,
      `The ${REFRESH_TOKEN_COOKIE_NAME} row is gone from the cookie table.`,
    ).toBeDefined();
    expect(
      row,
      `The ${REFRESH_TOKEN_COOKIE_NAME} row no longer quotes the ${rememberedDays}-day ` +
        'remembered lifetime. Change the policy and REMEMBERED_SESSION_DAYS together.',
    ).toContain(`${rememberedDays} days`);
    expect(
      row,
      `The ${REFRESH_TOKEN_COOKIE_NAME} row no longer quotes the ${defaultHours}-hour ` +
        'default lifetime. Change the policy and DEFAULT_SESSION_DAYS together.',
    ).toContain(`${defaultHours} hours`);
  });

  /**
   * "Both are httpOnly" — pinned to the code that sets each cookie, so tearing
   * the flag out fails HERE first, while the policy is still telling the truth.
   */
  it('the refresh cookie still ships under that name, httpOnly', () => {
    expect(sourceOf('main/modules/identity/server/crypto.ts')).toContain(
      `export const REFRESH_COOKIE_NAME = '${REFRESH_TOKEN_COOKIE_NAME}'`,
    );
    expect(sourceOf('main/modules/identity/server/index.ts')).toContain(
      'httpOnly: k.env.COOKIE_HTTP_ONLY ?? true',
    );
    expect(sourceOf('main/modules/identity/server/index.ts')).toContain(
      'req.setCookie?.(REFRESH_COOKIE_NAME, issued.refreshToken, issued.cookieOptions)',
    );
    expect(sourceOf('main/kernel/server/src/config/auth/auth.ts')).toMatch(
      new RegExp(
        `cookie: \\{\\s*name: '${REFRESH_TOKEN_COOKIE_NAME}',[\\s\\S]{0,220}?httpOnly: true`,
      ),
    );
  });

  it('the CSRF cookie still ships under that name, httpOnly, session-lived', () => {
    const csrf = sourceOf('main/apps/server/src/middleware/csrf.ts');
    expect(csrf).toContain('const { CSRF_COOKIE_NAME } = AUTH_CONSTANTS');
    expect(csrf).toContain('cookieName = CSRF_COOKIE_NAME');
    expect(csrf).toContain('httpOnly = true');

    const setCookie = /this\.setCookie\(cookieName, finalToken, \{([\s\S]*?)\}\);/.exec(csrf);
    expect(
      setCookie,
      'csrf.ts no longer sets its cookie where this guard can see it',
    ).not.toBeNull();
    expect(setCookie?.[1]).toContain('httpOnly');
    // "Expires: when you close your browser" — a maxAge would make that false.
    expect(setCookie?.[1]).not.toContain('maxAge');
  });

  /**
   * "The access token lives only in the page's memory and is never written to
   * disk." Proven on the real store, not on its comments: the singleton the
   * web AuthService wraps must leave every browser store untouched.
   */
  it('keeps the sign-in token in memory only — no browser store ever sees it', () => {
    window.localStorage.clear();
    window.sessionStorage.clear();

    tokenStore.set('a-token-that-must-never-touch-disk');

    expect(tokenStore.get()).toBe('a-token-that-must-never-touch-disk');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it('tells the truth about the legacy accessToken entry', () => {
    // The policy names the entry by the real constant, and the migration
    // reader it describes exists.
    expect(doc.body).toContain(`\`${ACCESS_TOKEN_COOKIE_NAME}\``);
    expect(sourceOf('main/apps/web/src/app/authToken.ts')).toContain(
      'localStorage.getItem(ACCESS_TOKEN_COOKIE_NAME)',
    );

    // And it must NOT promise a sign-out cleanup: clear() is memory-only in
    // both directions, so a leftover legacy entry outlives sign-out. The first
    // draft claimed otherwise — this is the check that caught it. If sign-out
    // ever starts removing the entry, flip this pin and let the policy say so.
    window.localStorage.setItem(ACCESS_TOKEN_COOKIE_NAME, 'legacy-entry');
    tokenStore.clear();
    expect(window.localStorage.getItem(ACCESS_TOKEN_COOKIE_NAME)).toBe('legacy-entry');
    window.localStorage.removeItem(ACCESS_TOKEN_COOKIE_NAME);

    expect(doc.body).not.toMatch(/remov\w*[^.]{0,60}\bsign(?:ing)?[ -]?out\b/i);
    expect(doc.body).not.toMatch(/\bsign(?:ing)?[ -]?out\b[^.]{0,60}remov\w*/i);
  });

  it('points the reader at a Data controls section that exists', () => {
    expect(doc.body).toContain('Data controls');
    expect(sourceOf('main/modules/compliance/web/ComplianceSettings.tsx')).toContain(
      '<ConsentPreferences',
    );
  });

  /**
   * "Analytics consent also covers crash reports" — pinned to the reporter's
   * own consent check, so a reporter that stops asking fails here while the
   * policy still promises that it asks.
   */
  it('says crash reports need analytics consent, as the error reporter enforces', () => {
    expect(sectionOf(doc, '## Your choice')).toMatch(/\banalytics\b[^.]*\bcrash reports\b/i);
    expect(sourceOf('main/apps/web/src/lib/errorReporter.ts')).toContain(
      "readConsent()?.analytics === 'granted'",
    );
  });

  /**
   * What a crash report carries, told whole: the stack trace the wire format
   * accepts (every frame, an extension's included), and the IP address and user
   * agent the request log writes beside each report under the same request id.
   */
  it('says a crash report carries its stack trace and is logged with the IP address and browser', () => {
    const choice = sectionOf(doc, '## Your choice');
    expect(choice).toMatch(/\bcrash reports?\b[\s\S]*\bstack trace\b/i);
    expect(sourceOf('main/kernel/contract/src/error-report.ts')).toContain(
      'stack: optional(string({ max: ERROR_REPORT_LIMITS.stack }))',
    );

    expect(choice).toMatch(/\bIP address\b[^.]*\bbrowser\b[^.]*\blogs\b/i);
    const requestLog = sourceOf('main/apps/server/src/plugin/logger.ts');
    expect(requestLog).toContain('ip: request.ip');
    expect(requestLog).toContain("userAgent: request.headers['user-agent']");
  });

  /**
   * Every local-storage key the table lists must be a key some source file
   * actually writes. The doc is the input; the code is the truth — nothing
   * here hardcodes a copy of either.
   */
  it('lists only local-storage keys the app actually writes', () => {
    const keys = backtickedKeys(sectionOf(doc, '## Local storage'));
    expect(keys.length).toBeGreaterThan(0);

    const sources = ['main/apps/web/src', 'main/modules', 'main/kernel/client/src'].flatMap(
      (root) => sourceFilesUnder(join(REPO_ROOT, root)),
    );
    const contents = sources.map((file) => readFileSync(file, 'utf-8'));

    const orphaned = keys.filter((key) => {
      const literal = new RegExp(`['"\`]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
      return !contents.some((source) => literal.test(source));
    });

    expect(
      orphaned,
      `cookie-policy.md lists ${orphaned.map((key) => `\`${key}\``).join(', ')}, but no source ` +
        'file writes that key — the table has drifted from the code. Fix whichever is wrong.',
    ).toEqual([]);
  });
});

/** Non-test .ts/.tsx sources under a directory, so a stale test copy of a key can never vouch for it. */
function sourceFilesUnder(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
      return [];
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

// ============================================================================
// Forbidden claims — the §0 pattern, run across every published document
// ============================================================================

interface FalseClaim {
  /** The shape of a sentence that contradicts the code. */
  readonly pattern: RegExp;
  /** Why the code makes it false. Quoted back at whoever wrote it. */
  readonly because: string;
}

function expectNoFalseClaims(
  docs: readonly PublishedDoc[],
  claims: readonly FalseClaim[],
  whatTheCodeDoes: string,
): void {
  const found = docs.flatMap((doc) =>
    claims.flatMap((claim) => {
      const hit = doc.body.match(claim.pattern);
      return hit === null
        ? []
        : [`${doc.name} — "${hit[0].trim()}"\n      FALSE: ${claim.because}`];
    }),
  );

  expect(
    found,
    `A published document contradicts the code:\n\n${found.join('\n\n')}\n\n` +
      `What the code actually does: ${whatTheCodeDoes}\n\n` +
      'Correct the document. Do not weaken this check to go green.',
  ).toEqual([]);
}

const STORAGE_LIES: readonly FalseClaim[] = [
  {
    pattern:
      /\btoken\b[^.]{0,80}\b(?:is|are)\s+(?:stored|kept|saved|persisted)\b[^.]{0,60}\blocal ?storage\b/i,
    because:
      'tokenStore (@bslt/client-engine) is createMemoryTokenStore(); the behavioural ' +
      'pin above proves a set token never reaches localStorage.',
  },
  {
    pattern: /\btoken\b[^.]{0,40}\blives?\s+in\s+local ?storage\b/i,
    because: 'it lives in a closure variable; no store on the page can be read to recover it.',
  },
  {
    pattern: /\bwe set (?:analytics|advertising|tracking) cookies\b/i,
    because:
      'exactly two cookies exist — refreshToken and _csrf — and the table-equality pin is the census.',
  },
];

describe('no published document contradicts the storage truth', () => {
  it('is denied by no published document', () => {
    expectNoFalseClaims(
      publishedDocs(),
      STORAGE_LIES,
      'the access token is memory-only (tokenStore = createMemoryTokenStore()); the only cookies ' +
        'are the httpOnly refreshToken and _csrf pair, both server-set.',
    );
  });
});
