// main/kernel/server/src/security/csp.test.ts

import { describe, expect, it } from 'vitest';

import {
  API_CSP,
  CSP_SCRIPT_SRC,
  CSP_STYLE_SRC,
  EDGE_CSP,
  findUnsafeScriptSources,
  parseCsp,
  serializeCsp,
} from './csp';
import { getProductionSecurityDefaults } from './headers';

describe('CSP policy', () => {
  describe('the non-negotiable rule', () => {
    // The whole point of the header. If someone "fixes" a blocked inline script by
    // adding 'unsafe-inline' here, both the edge and the API would still agree with
    // each other and the Caddyfile drift audit would pass — this is the test that
    // catches it. Deleting it to make a build green re-opens injected-script XSS.
    it.each([
      ['edge', EDGE_CSP],
      ['api', API_CSP],
    ])('%s script-src permits no inline or eval execution', (_layer, policy) => {
      expect(findUnsafeScriptSources(policy)).toEqual([]);
    });

    it("edge script-src is 'self' plus pinned-https origins only", () => {
      // The third-party surface must stay enumerable: named https origins, no
      // scheme-wide grants (https:), no bare wildcard, no http.
      const [self, ...origins] = (parseCsp(EDGE_CSP)['script-src'] ?? '').split(' ');

      expect(self).toBe("'self'");
      expect(origins.length).toBeGreaterThan(0);
      for (const origin of origins) {
        expect(origin).toMatch(/^https:\/\/[a-z0-9.-]+$/u);
      }
    });

    it('api script-src stays bare self — the API serves JSON, not documents', () => {
      expect(parseCsp(API_CSP)['script-src']).toBe("'self'");
    });

    it('permits inline styles, which cannot execute, on both layers', () => {
      // index.html carries critical anti-flash CSS. This is the deliberate exception.
      expect(parseCsp(EDGE_CSP)['style-src']).toContain("'unsafe-inline'");
      expect(parseCsp(API_CSP)['style-src']).toContain("'unsafe-inline'");
    });

    it('builds both layers from the one script-src / style-src definition', () => {
      expect(parseCsp(EDGE_CSP)['script-src']?.startsWith(`${CSP_SCRIPT_SRC} `)).toBe(true);
      expect(parseCsp(API_CSP)['script-src']).toBe(CSP_SCRIPT_SRC);
      expect(parseCsp(EDGE_CSP)['style-src']).toBe(CSP_STYLE_SRC);
      expect(parseCsp(API_CSP)['style-src']).toBe(CSP_STYLE_SRC);
    });
  });

  describe('findUnsafeScriptSources', () => {
    it('flags unsafe-inline', () => {
      expect(findUnsafeScriptSources("script-src 'self' 'unsafe-inline';")).toEqual([
        expect.stringContaining("'unsafe-inline'"),
      ]);
    });

    it('flags unsafe-eval', () => {
      expect(findUnsafeScriptSources("script-src 'self' 'unsafe-eval';")).toEqual([
        expect.stringContaining("'unsafe-eval'"),
      ]);
    });

    it('flags both when both are present', () => {
      expect(
        findUnsafeScriptSources("script-src 'self' 'unsafe-inline' 'unsafe-eval';"),
      ).toHaveLength(2);
    });

    it('ignores unsafe-inline that belongs to style-src', () => {
      // A naive `header.includes("'unsafe-inline'")` check would fail this, and would
      // therefore reject the policy the app actually ships.
      expect(
        findUnsafeScriptSources("script-src 'self'; style-src 'self' 'unsafe-inline';"),
      ).toEqual([]);
    });

    it('reports nothing when no script source is permissive', () => {
      expect(findUnsafeScriptSources("default-src 'self';")).toEqual([]);
    });

    it("flags 'unsafe-inline' inherited from default-src when script-src is absent", () => {
      // The quiet way to re-enable inline scripts: delete script-src rather than
      // loosen it. CSP falls back to default-src, so this policy executes inline
      // <script> — a guard that only reads script-src would call it clean.
      expect(findUnsafeScriptSources("default-src 'self' 'unsafe-inline';")).toEqual([
        expect.stringContaining('default-src'),
      ]);
    });

    it("flags 'unsafe-eval' inherited from default-src when script-src is absent", () => {
      expect(findUnsafeScriptSources("default-src 'self' 'unsafe-eval';")).toEqual([
        expect.stringContaining("'unsafe-eval'"),
      ]);
    });

    it('does not consult default-src once script-src overrides it', () => {
      // script-src wins outright; a permissive default-src is then irrelevant to
      // scripts, and flagging it would reject a policy that is actually safe.
      expect(
        findUnsafeScriptSources("default-src 'self' 'unsafe-inline'; script-src 'self';"),
      ).toEqual([]);
    });
  });

  describe('serializeCsp / parseCsp', () => {
    it('serializes directives in order, semicolon-terminated', () => {
      expect(serializeCsp({ 'default-src': "'self'", 'script-src': "'none'" })).toBe(
        "default-src 'self'; script-src 'none';",
      );
    });

    it('round-trips a serialized policy', () => {
      expect(parseCsp(EDGE_CSP)).toEqual({
        'default-src': "'self'",
        'script-src': "'self' https://js.stripe.com https://challenges.cloudflare.com",
        'style-src': "'self' 'unsafe-inline'",
        'img-src': "'self' data: blob:",
        'font-src': "'self'",
        'connect-src': "'self' wss: https://api.stripe.com",
        'frame-src':
          'https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com',
        'object-src': "'none'",
        'base-uri': "'self'",
        'frame-ancestors': "'self'",
      });
    });

    it('tolerates the loose whitespace a hand-edited Caddyfile may carry', () => {
      expect(parseCsp("  default-src   'self' ;;  script-src 'self'  ")).toEqual({
        'default-src': "'self'",
        'script-src': "'self'",
      });
    });

    it('parses a valueless directive', () => {
      expect(parseCsp('upgrade-insecure-requests;')).toEqual({ 'upgrade-insecure-requests': '' });
    });
  });

  describe('getProductionSecurityDefaults', () => {
    it('serves the shared API policy rather than a second hand-written copy', () => {
      expect(getProductionSecurityDefaults().csp).toBe(API_CSP);
    });

    it('keeps the policy byte-identical to the one production shipped before it was shared', () => {
      // Pinning the exact string proves extracting the constant changed no behavior.
      expect(getProductionSecurityDefaults().csp).toBe(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; object-src 'none';",
      );
    });
  });
});
