# Porting from Ganbate

Ganbate (`main/ganbate`) is built on this starter. Building it — and deploying it — surfaced **eight bugs
that live in the starter itself**, so they are inherited by every app forked from it, and produced
**twelve pieces of infrastructure that are not casino-specific** and would earn their place here.

Everything below was verified against this repo at `eb2cb4aa`, not assumed. File references in the form
`main/...` are paths **in this repo**; source to copy from is named explicitly as `ganbate:`.

## Status

Re-verified against the code (not against this doc, and not against commit messages) as of `844cdbd7`;
§2.2 verified done against the working tree on 2026-07-15, when it landed. §1.6, §2.5, §2.6 and §2.7
verified done against the working tree the same day, when they landed — with the deviations noted below.

| Done                                                                                       | Remaining | Moot        |
| ------------------------------------------------------------------------------------------ | --------- | ----------- |
| §1.1 §1.2 §1.3 §1.4 §1.5 §1.6 §1.7 §1.8 §2.1 §2.2 §2.3 §2.4 §2.5 §2.6 §2.7 §2.8 §2.9 §2.10 | —         | §2.11 §2.12 |

Wave 1 (everything above) is closed. **Wave 2 — ganbate's work after 2026-07-16 — is open; see
[Part 5](#part-5--wave-2-audited-2026-08-03).** All of §5.1 (five live bugs) and all of §5.2
(admin correctness), all of §5.3 (ops) and all of §5.4 are fixed (2026-08-03 — 2026-08-04).
**Wave 2 is closed.** §5.4.3 turned out to be much larger than the audit described; see the
§5.4.3 entry below.

The original "suggested order" below is **stale** — everything on it is done. How the last items landed:

- **The §1.1 block is closed.** SSR was finished as a **build-time prerender**: the runtime server is
  deleted, `render()` is called by `pnpm --filter @bslt/web build`, and the public pages ship as files
  (§2.3), declared once in `siteMap.ts` (§2.4). §1.7 came with it — the prerenderer marks the root
  `data-prerendered` and the bootstrap **drops that markup and mounts fresh**; `hydrateIfMarkup` is gone,
  since nothing in the repo can produce hydratable markup any more. §2.10's splash covers the remount.
- **§2.2 is done** (2026-07-15). Cookies, acceptable use and the disclaimer are file-owned: markdown in
  `docs/legal/`, imported `?raw` and rendered by `main/apps/web/src/features/content/` through
  `fillDocument()` + `<Markdown>`, prerendering fully at build time. The CI guard ported as
  `main/apps/web/src/__tests__/documents.test.ts` pins every storage claim the cookie policy makes to
  the shared cookie constants, the auth config and the in-memory token store. Terms and Privacy
  deliberately stay DB-published — the ToS acceptance gate keys on their version numbers — so the
  admin publisher offers exactly those two (`PUBLISHABLE_DOCUMENT_TYPES`). See `docs/legal/README.md`
  for the ownership contract.
- **§1.6 is done** (2026-07-15). `main/apps/web/src/app/routeLoad.ts` ports `lazyPage` / `loadPaced` /
  `notBefore`: a 400ms floor (`MIN_ROUTE_LOAD_MS`, 0 under test) so a fast chunk cannot cut a loader off
  mid-stroke, plus a reload-once-for-stale-chunk guard with a 30s cooldown. The route table in
  `routes.tsx` is unchanged — only the loader moved.
- **§2.5 is done** (2026-07-15), **minus the ads stack the starter does not have**: no CMP and no
  AdSense were ported — there is nothing here for a certified CMP to gate. `main/apps/web/src/lib/consent/`
  is the whole surface: `loadConsentedScript` is the one place a third-party script tag may be created,
  and BOTH categories require an explicit `granted` (the opt-out relaxation a CPRA fork may take is
  documented at the gate, not pre-taken). GPC is read at the gate itself, so a failed opt-out write
  cannot re-personalise; the "Do Not Sell or Share" control sits in the footer of every page, no login
  required (§7026). Storage key `bslt.consent.v1`, fail-closed on tamper and private mode; dismissing
  the banner without answering counts as a refusal; signed-in choices mirror to the server consent
  preferences.
- **§2.6 is done** (2026-07-15), with one deliberate deviation: the **default block list is empty** —
  the starter blocks nowhere until `BLOCKED_REGIONS` is set, because a starter has no jurisdictional
  posture to inherit from a casino. The shared rule lives in `main/shared/src/modules/core/geo/`, the
  header adapter + null adapter in `main/apps/server/src/middleware/geo.ts`, wired in `bootstrap/app.ts`.
  The honest constraint survived the port: an unknown location never blocks, `/health` stays reachable,
  and when no location source is configured the boot log says outright that nothing can be blocked.
- **§2.7 is done** (2026-07-15). All four account-creation paths funnel through `insertAttestedUser`
  (`main/server/core/src/auth/attestation.ts`) — the only users-INSERT in any auth flow; OAuth carries
  the attestation inside the AES-GCM-sealed state, and OTP / magic-link refuse **before** consuming the
  token, so a refused attempt costs nothing. Wording deviates from ganbate's: 13+ with the EEA 16+ note
  (`attestation.policy.ts`; statement and version pinned by test). Migration
  `0916_user_eligibility_attestation.sql` adds both columns with a both-or-neither CHECK, deliberately
  not backfilled. No date of birth is collected.

Two items were **moot on arrival**, and the doc was wrong about both: there is not one `url(#…)`, gradient
or `clipPath` id anywhere in the repo (§2.11 has nothing to fix — the convention still belongs in
`docs/CLAUDE.md`, and becomes load-bearing the moment a logo exists), and there is no logo component at
all (§2.12 has nowhere to land). §2.10 shipped **without** one, deliberately: this starter has no brand to
draw, so the splash is a themed CSS ring. A fork that adds a logo drops it into the splash's critical-CSS
block — that is the moment §2.11 and §2.12 stop being moot.

One bug this doc **missed**, found while checking §1.3 and now fixed: the admin editor
(`LegalDocumentsPage`) declared its own `DOCUMENT_TYPES` with 2 of the 5 types, so three public legal
routes could never be given content from the admin UI. §2.2 later made a two-entry picker _deliberate_
— but derived from the ownership split (`PUBLISHABLE_DOCUMENT_TYPES`): the other three routes are now
file-owned and no longer fed from the DB at all, so offering them would publish versions no page shows.

---

## Part 1 — Bugs in the starter

These are not Ganbate's bugs. They are here, now, and every fork carries them.

### 1.1 SSR is dead by construction

`main/apps/web/src/ssr/ServerApp.tsx:68`

```tsx
<Routes>{null}</Routes>
```

The SSR shell registers **zero routes**. `render()` therefore returns an empty string for every URL,
faithfully. And the server that would call it never does — `main/apps/web/ssr-server.ts:100` _blanks_
the placeholders instead of filling them:

```ts
.replace('<!--ssr-outlet-->', '')
```

So `entry-server.tsx`'s `render()` has **no callers anywhere in the repo**. The whole apparatus —
`entry-server`, `ServerApp`, `SsrContext`, the `<!--ssr-outlet-->` / `<!--ssr-head-->` placeholders,
the `build:server` and `dev:ssr` scripts — is scaffolding that produces a blank page. It looks like a
feature in a code review and is a no-op in production.

**Decide one of two things, and do it deliberately:**

- **Delete it.** If nothing in the starter needs SSR, the scaffolding is a trap: the next person to
  need SEO will believe it works.
- **Finish it as a build-time prerender** (§2.3). That is what Ganbate did, and it is cheaper and safer
  than a runtime SSR server for the pages that actually need indexing.

### 1.2 A legal-document page that cannot render a legal document

`main/apps/web/src/pages/LegalDocumentPage.tsx:24`

```ts
const paragraphs = document.content.split(/\n{2,}/u); // → wrapped in <p>
```

Content is split on blank lines and wrapped in `<p>`. Any real terms-of-service has headings, bold,
links, lists and tables — all of which ship to the user as **literal characters**: `## Your account`,
`**no refunds**`, `|---|---|`.

The starter has an admin editor for these documents, a versioning system and an acceptance flow — and
the one thing it cannot do is display them. Fix with the Markdown renderer in §2.1.

### 1.3 `DOCUMENT_TYPES` is declared twice

- `main/shared/src/constants/core/compliance.ts`
- `main/shared/src/modules/core/compliance/compliance.schemas.ts`

Two independent literals, same name, no import between them. They will drift; the only question is
when. One must become the single source and the other must import it. (The DB column is free text with
no CHECK constraint, so widening the union is a UI-side change — no migration.)

### 1.4 The CSP will silently kill any inline script you add

`infra/runtime/caddy/Caddyfile` sends `script-src 'self'` with no `'unsafe-inline'`.

The starter's `index.html` currently has no inline `<script>`, so it is fine **today**. The moment
anyone adds one — a pre-paint theme resolver is the classic case, and Ganbate added exactly that — it
is blocked in production only. It works perfectly in dev, where no CSP header is sent.

**The rule worth writing down:** scripts live in files (`public/theme-init.js`), never inline. Do not
"fix" this by adding `'unsafe-inline'` — that defeats the header. See `ganbate:main/apps/web/public/theme-init.js`.

---

### 1.5 The API image cannot boot from a clean checkout — so CI cannot deploy

**This is the one to fix first. It is live in this repo, and it is not theoretical: it took Ganbate's
production down twice before it was understood.**

`infra/docker/Dockerfile` builds exactly six packages:

```
shared, db, server-system, comms, core, server
```

The optional modules — `realtime`, `storage`, `workers`, `media` — are **never built**. The server does
not import them statically; it pulls them in through `main/apps/server/src/bootstrap/optional-import.ts`
when their capability is enabled. So pnpm's dependency graph never drags them into the build — but
`pnpm deploy` still copies each package **folder**, just with no `dist/`. The API then dies at boot:

```
Failed to start server: Error: Capability "realtime" is enabled, but optional module
"@bslt/realtime" could not be loaded: Cannot find module
'/app/node_modules/@bslt/realtime/dist/index.js'
```

It has only ever worked because images get built on a machine where an earlier local `pnpm build` had
already left those `dist/` folders on disk for the Docker context to copy in. **A clean checkout — which
is exactly what CI does — produces an API image that cannot start.**

Two things make it hard to see. It fails **one module at a time**, so it reads like a one-off rather than
a missing build step; and it only bites where nobody looks, because everyone's laptop has a warm `dist/`.

Fix (`ganbate: infra/docker/Dockerfile`) — build them, and keep the list in step with the optional
capabilities:

```dockerfile
    pnpm --filter @bslt/realtime build && \
    pnpm --filter @bslt/storage  build && \
    pnpm --filter @bslt/workers  build && \
```

And guard it, because the next optional module will be added by someone who has never read this file:

```sh
docker run --rm --entrypoint sh <image> -c \
  'for d in /app/node_modules/@bslt/*/; do
     test -f "$d/dist/index.js" || { echo "MISSING dist: $d"; exit 1; }
   done; echo OK'
```

### 1.6 A Suspense fallback has no exit, and no floor

Two distinct defects, one cause: React destroys a Suspense fallback in the **same commit** that mounts the
page.

- It cannot animate out. There is no unmount hook, so a loading screen **blinks** away and the page
  appears to pop in.
- A chunk that resolves in 300ms **cuts a 1.7s intro off mid-stroke**, every single time. A half-drawn
  loading screen reads as breakage, not polish.

Neither is fixable from inside the fallback. Both are fixable from the router — the code that decides
_when_ the chunk resolves: hold the resolved module back to a floor, fade the loader out, and only then
hand it to React. `React.lazy` caches, so only the **first** visit to a page pays it; returning to a page
never suspends and never waits.

`ganbate: main/apps/web/src/app/routes.tsx` (`loadPaced` / `notBefore`) and
`features/casino/components/GanbateLoader.tsx` (`fadeOutRouteLoader`).

### 1.7 Any markup inside `#root` silently turns `createRoot` into a hydration mismatch

`main/apps/web/src/bootstrap/client.tsx`:

```ts
if (options.hydrateIfMarkup && rootElement.firstElementChild !== null)
  hydrateRoot(rootElement, app);
else createRoot(rootElement).render(app);
```

`#root` is empty today, so it always takes `createRoot` and the flag looks inert. Put **anything** in
there — a splash, a prerender, a skeleton — and `firstElementChild` becomes non-null, so React hydrates
against DOM it never rendered. The tree is blown away and re-rendered, and the only symptom is a console
warning nobody reads.

Pre-paint markup belongs as a **sibling** of `#root`, torn down on mount. See §2.10.

### 1.8 A bare `prettier --write .` corrupts the generated `theme.css`

`main/client/ui/src/styles/theme.css` is **generated** by `sync-css-theme.ts` and byte-verified by
`buildThemeCss.test.ts`. It is already listed in `config/.prettierignore` — but that only applies if you
pass `--ignore-path config/.prettierignore`, which the repo scripts do and a bare `npx prettier --write .`
does not. Reformat it and the generator no longer reproduces it byte-for-byte, so its test fails.

The trap: **the generator will not repair it.** It re-runs only when its _source_ changes, so
`pnpm build:theme` cheerfully reports "up to date" while the output is wrong. Restore it from git
(`git show HEAD:<path> > <path>`) and always use `pnpm format`, never a bare prettier.

---

## Part 2 — Infrastructure worth taking

### 2.1 A Markdown renderer with no dependency and no `dangerouslySetInnerHTML`

`ganbate:main/client/ui/src/utils/markdown.ts` (parser) · `.../components/Markdown.tsx` (renderer)

A parser that emits a **typed token list**, and a renderer that turns tokens into **React elements**.
No HTML string is ever produced, so injection is impossible _by construction_ rather than by sanitiser
— which matters precisely because these documents are edited from an admin panel, where a renderer that
can emit markup is a stored-XSS hole one bad paste away. No new npm package.

Supports what real documents use: headings, paragraphs, bold/italic/code, links (internal → router,
external → `rel="noreferrer noopener"`), ordered/unordered lists, GFM tables, rules, blockquotes,
fenced code.

**Take the tests with it.** Four parser bugs surfaced against real documents, and a reimplementation
will hit all four:

| Bug                                                                                        | Symptom                                                          |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| A `\|` line with no divider row is not a table — and the paragraph branch also rejected it | **Infinite loop**, consuming nothing, until the heap died        |
| `**bold containing an asterisk**` (e.g. `**1.36% at 2.00×**`)                              | Regex `[^*]+` matched nothing; asterisks printed to the user     |
| List items with wrapped continuation lines                                                 | Bold spans torn in half across the wrap                          |
| **Emphasis did not nest** (`_italic with **bold** inside_`)                                | The outer span swallowed the inner one and printed its asterisks |

The last one is the one to care about: it is the shape of the closing legal line of _every_ document
("_…18+. **Coins have no cash value.** …_"), so the single most load-bearing sentence in the set rendered
with visible `**`.

### 2.2 The document system: Markdown in `docs/`, rendered as pages, guarded by CI

`ganbate:main/apps/web/src/features/content/**`

- Documents live as `.md` files in `docs/` and are imported with Vite's `?raw`. **One source of truth** —
  there is no second copy of the prose in a component, which is what stops the site and the terms from
  drifting apart.
- **Placeholder substitution**: documents carry `[[OPERATOR_ADDRESS]]` and `[[EFFECTIVE_DATE]]`, filled at
  render from a single constant. Swapping a company address is one line, not a hunt through nine files.
  An _unfilled_ placeholder renders as a visible gap — never as raw `[[…]]` markup.
- **A CI guard on the documents themselves** (`ganbate:.../features/content/documents.test.ts`), which is
  the part most projects skip:
  - no unresolved `[[TODO]]` may ship (they render to the user as a hole in a sentence),
  - **the prices quoted in the purchase terms must match the price constants in code.** A repricing that
    forgets the legal document is a consumer-law problem, not a typo, and nothing else in CI notices.

### 2.3 Build-time prerender instead of runtime SSR

`ganbate:main/tools/scripts/build/prerender.ts`

The pages worth indexing in a SaaS — marketing, pricing copy, legal, docs, changelog — are **pure prose
with no per-user data**. Their HTML is identical for every visitor, so compute it once at build instead
of on every request. Ganbate's audit put this to a judge panel and it beat full SSR 3–0.

Produces `about/index.html`, `sitemap.xml`, `robots.txt`. nginx already resolves `/about` →
`about/index.html` via `try_files $uri $uri/`. **No new production process. The API never serves HTML** —
which matters, because putting HTML on the API's path turns "API down" into "site down".

**Two traps it cost us to find:**

1. **Hydration.** The client boots with `hydrateIfMarkup: true`. Prerendered markup contains the
   _document_; the client renders the _whole app shell_ around it. Hydrating one against the other
   throws a mismatch and re-renders anyway. Mark the root `data-prerendered` and have the bootstrap
   **drop it and mount fresh** — under the splash, so the swap is invisible.
2. **The build must actually run it.** `Dockerfile.web` ran `pnpm build`, not the prerender step, so the
   pages would have shipped as empty SPA shells and nobody would have noticed until the traffic didn't
   arrive.

### 2.4 `siteMap.ts` — one source of truth for public pages

`ganbate:main/apps/web/src/app/siteMap.ts`

Every public page declared once: path, title, source document, and a **`live` flag**. The router, the
footer and the prerenderer all read it. The footer renders a link **only when `live` is true**, so it is
structurally incapable of advertising a 404 — and adding a page is one entry, not an edit in three files
that drift.

Also carries the copy that must be identical everywhere (a product's legal one-liner, an age notice), so
three surfaces cannot end up saying three different things.

### 2.5 Consent that actually gates the scripts

`ganbate:main/apps/web/src/lib/consent/**`, `lib/cmp.ts`, `lib/adsense.ts`,
`features/settings/components/DoNotSellControl.tsx`

Any SaaS running ads or third-party analytics needs this, and the starter has a consent _banner_ whose
choice nothing enforces:

- **No script may reach the DOM without consent.** The load-bearing test asserts exactly that — not that
  a flag was stored.
- **EEA/UK:** a Google-certified CMP loads _first_; ads load only if it reports consent. Serving ads
  there without a certified CMP risks the ad account itself.
- **CPRA "Do Not Sell or Share":** personalised ads are "sharing" under California law. The control must
  be conspicuous and **must not require a login** (§7026) — so it cannot live only behind a protected
  settings route.
- **The subtle killer:** `requestNonPersonalizedAds` must be set **before** the ad script loads. Set it
  after and it silently does nothing — you ship an opt-out that opts nobody out, and the toggle looks
  like it works.

### 2.6 Geo eligibility without a geo-IP dependency

`ganbate:main/apps/server/src/middleware/geo.ts` · `main/shared/src/modules/core/geo/**`

A `GeoProvider` port with a header adapter (reads a CDN's region header) and a null adapter, plus a
**configurable blocked-region list** in env. Any SaaS with jurisdictional limits (sanctions, state law,
export control) needs this, and it needs it without a 60 MB MaxMind database in the image.

**The honest design constraint, worth copying along with the code:** an _unknown_ location must not block.
A free-tier CDN gives country, not US state. Blocking every visitor you cannot identify is worse than the
problem — so it is header-driven where the header exists, and backed by a signup attestation otherwise,
and the legal copy says exactly that rather than claiming enforcement that does not exist.

### 2.7 Registration attestation, enforced on every auth path

`ganbate:main/shared/src/modules/core/users/attestation.policy.ts` ·
`main/server/core/src/auth/attestation.ts` · migration `0935_user_eligibility_attestation.sql`

An explicit, **unchecked-by-default** confirmation at signup (age, jurisdiction, terms), recorded with a
timestamp, and **enforced on the server** — on _all four_ account-creation paths the starter ships:
password, OAuth, magic link, email OTP.

The generalisable point: the starter has four ways to create an account. A gate added to the registration
_form_ covers one of them. Finding the path that bypasses your check is the whole task.

And: **no date of birth.** A DOB you never verify proves nothing about age, while converting a
zero-liability checkbox into PII you must store, protect, disclose and delete on request.

### 2.8 `IconButton`

`ganbate:main/client/ui/src/elements/IconButton.tsx`

A square icon-only button with one edge length (`--ui-icon-btn-size`, sm/md/lg). Trivial, but the app had
three hand-rolled square buttons at 2.5rem, 2.25rem and 1.75rem before it existed. `aria-label` is a
required prop — an icon-only button without one is invisible to a screen reader, so the type system asks
for it.

### 2.9 Repo ergonomics

- **`check:changed`** — `turbo run lint type-check test --filter=...[HEAD]`. Runs the same checks scoped to
  the packages your diff touches _and everything downstream_, so it is not weaker for a given change. The
  full-monorepo scripts are the pre-push gate, not the inner loop.
- **`ci:fast:local` uses `format:check:ci`** (`--no-cache`), so every local push re-checks formatting on
  every file from cold. The cached `format:check` verifies exactly the same thing — Prettier's cache is
  content-keyed. Keep `--no-cache` in CI, where the cache is genuinely cold.
- **The `node` trap.** If commands exit silently with no output, `node` may be an nvm lazy-load _shell
  function_ whose `_load_nvm` helper is missing from the environment. It exits 1 while spewing to stderr;
  ESLint and Vitest die with no visible cause. `unset -f node npm npx pnpm` and put the real binary first
  on `PATH`. This cost an hour of chasing phantom test failures.

---

### 2.10 A pre-hydration splash that is honest about when the app is ready

`index.html` paints a flat colour and `#root` is empty, so between first paint and React mount the user
stares at a coloured void — and SSR does not fill it (§1.1). Ganbate paints an animated logo directly in
the critical-CSS block: no bundle, no font, no request.

Two things make it more than decoration:

- **It is a sibling of `#root`** (§1.7), and it is torn down from `bootstrap/` — not by React.
- **"Ready" is strict.** It holds until the window `load` event, `document.fonts.ready`, auth settling,
  _and_ the first route's chunk being on screen.

The load-bearing part is the **failsafe**. Every one of those signals can fail to arrive — one hung image,
one stalled auth call — and without a hard ceiling the splash would sit over a working app forever. It
always reveals.

`ganbate: main/apps/web/src/bootstrap/splash.ts` + the `<style>` block in `index.html`.

### 2.11 SVG ids are document-global — derive them from `useId()`

Any `<linearGradient id="glow">` or `<clipPath id="clip">` inside a component collides the moment that
component renders **twice on one page** — a header logo and a loading screen, say — and the second
instance silently steals the first's paint. It looks like a rendering bug and it is a naming bug.

`useId()` fixes it, but strip the colons: React yields `":r0:"`, and that is hostile inside `url(#…)`.

```tsx
const id = useId().replace(/:/g, '');
```

This repo already ships the latent version of the bug in any component with a hard-coded gradient id.

### 2.12 Ship a logo as traced vector paths, not text in a webfont

A wordmark set in a webfont paints in a **fallback face** until that font loads — which is precisely when
the logo matters most, because a pre-hydration splash (§2.10) renders before any stylesheet exists. Paths
cannot flash, reflow, or go missing, and they stay crisp from a 2rem header to a full-screen splash.

Trace once (`potrace`), commit the source art beside the component, and keep the **accessible name**
coming from config (`clientConfig.appName`) so a rename still reaches screen readers even though the drawn
letters cannot follow it.

---

## Part 3 — Practices that actually found bugs

Worth writing into `docs/CLAUDE.md`, because each of these caught a real defect that unit tests and code
review did not.

**Mutation-test your security gates.** A bet-history endpoint had seven passing tests. Swapping in the
flag-gated implementation a hurried dev would write (`if (!bet.canVerify)` instead of checking the seed
itself) left **all seven green** while handing out a working link to a sealed secret. If a wrong
implementation passes your tests, you do not have tests — you have a description.

**Enumerate exhaustively anything involving money or odds.** Two mispriced games shipped because a property
test asserted a _range_ (`0.95 < EV ≤ 0.99`) — roomy enough to hide a doubled house edge, and a side bet
paying out **more than it took in**. The fixed tests enumerate all 1,624,350 possible deals and assert the
exact number. They run in under a second.

**Ground your documents in your code, and let them audit it.** Writing an honest odds page forced someone
to compute the real payout math, which is _how those two mispriced games were found_. Writing an honest
privacy policy forced someone to read what the API actually returns — which is how we found the public
chat endpoint shipping every poster's account UUID to anyone scraping it, joined to their username, with
nothing consuming it.

**Never ship an internal identifier on a public payload.** A UUID in a public response is a stable
identifier for every user who posts, free to any scraper. Identify a message by its own id; identify a
person by their display name.

**A comment is not a control.** `selfExclude`'s doc comment said "blocks bets and purchases". Bets were
blocked. Purchases were not — so a self-excluded user could still be charged. A safety control that stops
the play but not the spending is _worse_ than none: it looks like protection while it collects.

---

- **Verify UI by looking at it — headless Chrome will do it.**
  `google-chrome --headless --screenshot=out.png --window-size=W,H --virtual-time-budget=MS file://…`
  renders CSS animations **at a chosen timestamp**. Every geometry bug in Ganbate's logo — a raised paw
  that merged into the head and read as a cat seen from behind, a tail that rendered as a detached egg —
  was invisible in the path data and obvious in a screenshot. To sample a curve deterministically, freeze
  it with a **negative `animation-delay`** rather than trusting the virtual clock.

- **`eslint --fix` can delete a load-bearing type assertion.** `no-unnecessary-type-assertion` misjudged a
  cast on `import.meta.glob` (which is `Record<string, unknown>`), and removing it turned the value into
  `{} | null`. Lint went green; the build broke. **Always re-run type-check immediately after an
  auto-fix** — the pre-push hook was the only thing that caught it.

- **`node` may be an nvm shell _function_, not the binary.** In one environment
  `node -e "console.log(1)"` printed nothing and exited **0** — silently. Every toolchain command was
  unusable, and it presented as "the command ran but printed nothing" rather than as a broken toolchain.
  The tell is `command -v node` returning `node` instead of a path. Call the absolute binary.

---

## Part 4 — Do not port

Casino-specific, and correctly so: the provably-fair engine, the house-edge/RTP module, the coin economy
(wallet, ledger, packs, rescue), the game implementations, and the responsible-play controls (though the
_shape_ of §2.7's attestation and the "enforce it in the locked transaction, not in the handler" instinct
generalise well).

---

## Part 5 — Wave 2 (audited 2026-08-03)

Ganbate landed **258 commits after 2026-07-16** (the wave-1 cutoff). This part is what survives the
casino filter. Every claim below was verified against **this repo at `de959892`** by reading the code in
both trees — not by trusting commit messages, and not by assuming a ganbate bug exists here. Where a
ganbate fix turned out to be already present (or bslt turned out to be ahead), it is listed in §5.6 so
nobody re-audits it.

Ganbate commit SHAs are given so the exact diff can be pulled with
`git -C ~/projects/main/ganbate show <sha>`.

### Status

| Done                                          | Remaining | Not applicable |
| --------------------------------------------- | --------- | -------------- |
| §5.1 (all 5) §5.2 (all) §5.3 (all) §5.4 (all) | —         | §5.5           |

How the done items landed (2026-08-03, each verified by its new tests):

- **§5.1.1** — `upsertUpdateColumns` derives the SET list from the insert row; four SQL-shape tests
  pin that a toggle-only upsert never names `value = EXCLUDED.value`.
- **§5.1.2** — guard module + `totpVerify` preset + `jti` ported as-is; handler tests pin 5-then-429
  and the burned-token refusal. **Correction to the SMS claim below:** `verifySms2faCode` already
  enforces `SMS_MAX_ATTEMPTS` per code in the DB and consumes the code at the cap, so the SMS verify
  path was never brute-forceable — no change was needed there.
- **§5.1.4** — `authorize.ts` + `canSubscribe` on both `subscribe` and the sync replay, bound per
  connection in the realtime lifecycle; 13 shared tests + 4 lifecycle tests.
- **§5.1.5** — production-without-DSN now selects the Console provider (dev/test stay Noop). Found
  while porting: the composition root (`bootstrap/phases/infra.ts`) passes `dsn: null`
  unconditionally, so before this fix production error tracking was Noop no matter what.

- **§5.4.1, server half** (2026-08-03) — steps 1–3 of the five-step port. Step 1 (per-user
  subscribe authorization) shipped back in §5.1.4. **Step 2, lifecycle hardening:** `maxPayload`
  64 KiB on the socket server; a 30s ping/pong heartbeat with a `WeakSet` liveness registry that
  `terminate()`s half-open sockets (a peer gone without a close frame never pongs, and its
  subscription state would otherwise linger until a publish happened to touch one of its keys); and
  a **teardown-once guard**, because `ws` emits BOTH `error` and `close` for the same socket, so the
  active-connection counter drifted negative and pubsub state was cleaned twice. The heartbeat timer
  is `unref`'d so it never holds the process open. **Step 3, the publish:** new
  `notifications/publish.ts` and one call in `createInAppNotification`, on the RECIPIENT's channel,
  derived from the recipient and never from a caller-supplied value. The frame carries `{key,
version}` and no payload — no notification text crosses the socket, so a subscription mistake
  could leak timing at worst, never content. Publishing is best-effort and swallows a throwing bus:
  the row is already committed, and a realtime channel that can fail a write is worse than none.
  Each of the three is mutation-tested; deleting the publish call alone fails exactly one test,
  which is the point — without that assertion the whole chain is dead weight nothing would notice.
  **Steps 4–5 (browser half, same day):** `main/apps/web/src/lib/realtime.ts` — one shared socket
  per tab, subscribe/unsubscribe refcounted per key, exponential-backoff reconnect that
  re-subscribes everything (the server keeps no memory of a client), and a CSRF token carried as a
  query param because browsers cannot set headers on a WebSocket handshake. Placed in the app's
  `lib/`, NOT under a feature folder as ganbate had it. `useNotifications` now subscribes to
  `notificationsChannel(user.id)` and refetches on a frame — **the 60s poll deliberately stays**,
  because sockets drop and a notification that only ever arrives over a live socket is one that
  silently never arrives. Ganbate's recorded bug is now a pinned test: the transport fetches
  its token from `@bslt/api`'s new `getCsrfToken`, not a local fetch. The first attempt DID hand-write
  the request and `audit:api-client-surfaces` caught it — the right call, and the better fix was to
  export a token getter from the canonical client rather than take the allowlist exemption, so the
  endpoint path is defined once. That removes the upstream failure mode instead of re-checking for
  it: a socket that never connects is indistinguishable from a working poll, which is exactly why it
  survived so long there. The path assertion now lives in `@bslt/api`'s own tests, where the path
  does.
- **§5.4.2** (2026-08-03) — "keep me signed in". New shared `auth.session.logic.ts` with the two
  dials ganbate separated: `sessionSpanDays(rememberMe)` (30 days / 0.5 day), `sessionSpanDaysOf`
  (recovers the span from the token row's own dates, so a rotation preserves the user's choice with
  **no new column** to disagree with them), and `sessionIdleWindowMs` = `min(7d, span)`. One value
  now governs BOTH the refresh cookie's `maxAge` and the token family's expiry, which is the point:
  bslt previously paired a fixed 30-minute idle timeout with a config-length cookie, so the browser
  could hold a credential the server had already decided to reject. Wired through `LoginRequest`
  (optional, absent behaves as false), the login handler, `authenticateUser`, the cookie helper, and
  the refresh path — which also re-sets the rotated cookie with the recovered span, or a remembered
  session would silently shrink to the default on its first refresh. A "Keep me signed in" checkbox
  was added to `LoginForm`, unchecked by default. **The audit called ganbate's `ad2d5d9` fixture fix
  NOT-APPLICABLE because bslt lacked this feature — correct then, and porting the feature made it
  applicable:** bslt's own refresh test fixture supplied only `createdAt` and started returning 500,
  because the span is read from the distance between `createdAt` and `expiresAt`.
- **§5.4.4 + §5.4.5** (2026-08-03). **Correction to the audit:** it reported that this repo's
  prerender "emits `<title>` only" and lacks the empty-HTML build guard. Both were wrong — the head
  already carried `description`, `og:title`, `og:description`, `og:type` and a canonical, and
  `assertRendered` already fails the build on an empty root. The real gap was subtler and worse:
  `SsrData.description` existed but **nothing ever populated it**, so the meta description tag never
  rendered on any page, and the canonical was emitted with a bare path. Fixed by adding
  `description` to `SitePage` (populated for the six live pages), threading it and an **absolute**
  `canonicalUrl` through `prerenderFiles`, and adding `og:url` plus a JSON-LD `WebPage` block.
  Canonical/`og:url`/JSON-LD are omitted entirely when `SITE_URL` is unset, because a canonical
  naming a path without an origin is worse than none. JSON-LD unicode-escapes `<` so a document
  containing `</script>` cannot close the tag early. **`reportUncaughtErrors`** (~40 lines) catches
  what an ErrorBoundary structurally cannot — rejected promises, failed dynamic imports, throws in
  timers — re-dispatching them as `app:uncaught-error`. It deliberately does not log (the browser
  already prints these) and ignores `error` events with no `event.error`, since a failed `<img>`
  fires one and reporting those as crashes buries the real ones; that guard is mutation-tested.
- **§5.3.4** (2026-08-03) — deploy verification. The deploy step now asserts the **running image
  reference matches the one this run built** (`docker inspect --format '{{.Config.Image}}'` per
  service) — container health alone has lied before, because a stale container from the previous
  deploy is perfectly healthy while serving the old code. The public-URL check is demoted to
  `continue-on-error` and renamed "Probe public URL (informational)": it goes through whatever
  fronts the origin, and a CDN will serve a cached 200 over a dead origin, so gating rollback on it
  makes the one check that triggers rollback a check that cannot fail. Authoritative verification is
  the container health + image assertion, asked of the containers over SSH.
  New **`audit:vite-build-args`** (in `audit:template`) verifies the chain that decides what a
  production bundle contains: each ARG is declared _and_ exported into the `vite build` step, and is
  either passed by the workflow that builds the deployed image or listed as intentionally defaulted.
  Anchored at `continuous-integration.yml` (which builds the image the deploy pulls by digest) and
  it **refuses to pass vacuously** if that anchor disappears — the previous incarnation of this
  audit in ganbate pointed at a disabled workflow and passed green forever. Current state: 13 client
  args, 2 passed, 12 intentionally defaulted. Writing it caught its own false positive — anchoring
  on the first cache-mounted `RUN` finds the _deps_ stage and reports every arg as unwired — and it
  was mutation-tested by adding an unpassed ARG.
- **§5.3.1–§5.3.3** (2026-08-03) — ops. The **backup script**
  (`main/tools/scripts/deploy/backup-database.sh`) is ported to run from host cron, with the
  verification chain that matters: byte floor, `gzip -t`, a `CREATE TABLE` count (the schema is
  most of the bytes, so a zero-row dump clears any size threshold), a read-back after upload, and
  a missing offsite treated as **failure** rather than a warning. Local prune only — offsite
  retention is a bucket lifecycle rule, so a bug in the script cannot delete history.
  `docs/deploy/backup-restore.md` gains the install steps and a **restore drill** (restore the
  offsite object, off-host, compare table/row counts and newest migration), and its description of
  the CI workflow is corrected: skip-safe was documented as a feature, and is now flagged as a
  green tick for a job that did nothing. **Quick wins:** `.tmp/` added to `.prettierignore` (seven
  audit scripts write there), `pnpm ci:everything` added, and the demo Caddyfile's three exact-match
  `handle /health` widened to `/health*`. **`/health/geo`** ported with the `geoProbe` helper and a
  summary on `/health` itself. One deviation from ganbate, found by its own test: the probe reads
  `config.server.geo` **defensively**, because it rides on the liveness check and must never be the
  reason `/health` fails — adding it naively 500'd `/health` against a context without geo config.
- **§5.2.2** (2026-08-03) — the structural fix. `adminProtectedRoute` is type-narrowed to
  `'POST' | 'PUT' | 'PATCH' | 'DELETE'`, so an admin GET **cannot** be registered without going
  through the new `adminGetRoute(handler, contract)`. The narrowing immediately earned its keep:
  it surfaced four more GET registrations (health, and the three billing ones) written in a
  multi-line form that a grep for `adminProtectedRoute('GET'` had missed — 19 in total, not the 15
  the audit counted. A contract is mandatory and is either a query schema or one of three stated
  markers: `READS_NO_QUERY` or `QUERY_VALIDATED_IN_HANDLER`. (A third, `QUERY_NOT_YET_VALIDATED`,
  carried the five routes that still read unchecked query strings — users/search, security/metrics,
  webhooks, webhook deliveries, tenants. All five were given schemas on 2026-08-04 and the marker
  was removed.) With a schema, the query is parsed **before** the handler and invalid input is a
  400 rather than a clamp; the handler then receives the coerced value **as an argument**, so a
  schema change breaks its handler at compile time.
  `admin/users` is bound to `adminUserListFiltersSchema`, so the `sortBy` whitelist that had never
  executed now runs — an unknown sort is refused instead of silently falling through to
  `created_at`. Note the route layer's `schema` argument validates the request BODY, which is why a
  GET could never have been covered by it and why this needed its own gate.
- **§5.2.1** (2026-08-03) — all three lying filters now filter in SQL. **Audit log:** new
  `adminAuditEventsQuerySchema` (shared); the handler passes every filter to
  `auditEvents.find()` **together** — the old if/else honoured only the first of
  tenantId/actorId/action and dropped `category` entirely — and an out-of-range `limit` is now a
  400 rather than a silent clamp. **Support inbox:** new `supportRequestsQuerySchema`, the status
  travels through `client/api` to the repository's existing `{status, limit}` options, and the
  status is part of the react-query key so switching filters refetches. **Webhook deliveries:**
  `findByWebhookId` gained a `status` parameter applied in SQL alongside the LIMIT, replacing the
  admin handler's limit-then-filter-in-JS. All three responses carry `{ limit, truncated }` from a
  fetch-`limit + 1` probe, so a capped page can say it is capped instead of reading as the whole
  result. Note the mutation invalidation had to move from exact-key `invalidateOnSuccess` to
  `invalidateQueries` by prefix, or resolving a request would leave the filtered view the operator
  is looking at showing the old status.
- **§5.2.3 + §5.2.4** (2026-08-03) — the clear-filters trio and the four single-file items.
  `UserFilters` now sends cleared keys as an explicit `undefined` (the consumer merges, so an
  omitted key meant "keep the old filter"); `useJobsList.setStatus` drops the key entirely so the
  "All" tab is not a one-way trap and the react-query key stays stable;
  `SecurityEventsFilters` omits cleared keys so the page's "N filter(s) active" and the export
  dialog's scope warning stop overstating. Lockout: new `LOCKOUT_DURATION_MINUTES` +
  `MAX_LOCKOUT_DURATION_MINUTES` in shared, the request schema derives its ceiling from it, both
  web surfaces render from it, and `LockUserDialog`'s custom-duration field is bounded on the
  input AND in the submit predicate so the enabled button and the submit agree.
  `GrantSubscriptionCard` is gated on `isBillingEnabled()`. New `notificationTargetUrlSchema`
  accepts root-relative paths (the sender's own `/dashboard` placeholder was rejected), and
  refuses `javascript:`/`data:`/`file:` and `//host` authority forms — the value reaches
  `openWindow`. **Test finding worth keeping:** the existing "should not include role when empty
  value is selected" test asserted `toHaveBeenCalledWith({})`, which passes for BOTH the buggy and
  fixed shapes (vitest's argument matching ignores undefined-valued keys) — that is why the bug
  survived. It now asserts on the raw call object, and a mutation check confirms it fails when the
  fix is reverted.
- **§5.1.3** — landed after the owner decision (2026-08-03): **config flag, default ON**. The
  classification (`webhookUrl.ts`, ganbate's plus an `isCloudMetadataWebhookUrl` split) lives in
  shared; the POLICY lives server-side in `webhooks/target-policy.ts` and is enforced at
  create/update in the handlers — not in the schema — so the flag can come from runtime config.
  `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` (new optional env, `WebhookConfig.allowPrivateTargets`)
  restores the self-hosted internal-targets allowance; the cloud metadata endpoint (169.254/16 in
  every spelling, `metadata.google.internal`) is refused regardless of the flag. The delivery-time
  warn in `dispatch.ts` stays as the second line for rows that predate the check, and the three
  long-red integration assertions (`webhooks.integration.test.ts:640–671`) are now satisfiable.

### 5.1 Bugs live in the starter — port first

These five are defects in this repo today, all small, all independent.

#### 5.1.1 Toggling a tenant feature-flag override destroys its stored value — `f943085`

`main/server/db/src/repositories/features/tenant-feature-overrides.ts`:

```ts
.onConflictDoUpdate(['tenant_id', 'key'], ['is_enabled', 'value'])
```

The SET columns are named unconditionally, so `value` is always written from the EXCLUDED row — which is
**NULL** whenever the request carried only `isEnabled`. And the shipped admin UI sends exactly that:
`FeatureFlagOverrideTable.tsx` `handleToggle` posts `{ isEnabled: !current }`. The toggle appears to
work; the override's JSON config is silently gone.

Fix on the **server**, as ganbate did — deriving the SET list from the keys actually present on the
insert row — because patching the UI to echo the old value back would fix one caller and leave the
destruction in place for every other one. ~16 lines. `useFeatureFlagOverrides` has no test file here;
ganbate's commit adds a 250-line one — take it.

#### 5.1.2 The TOTP login step is brute-forceable — `bb5bfcf`

`main/server/core/src/auth/handlers/totp.ts` verifies the challenge JWT and then the 6-digit code with
**no rate limit, no attempt counter, no single-use marker**. A 6-digit code is 10⁶ possibilities; the
only brake is the 5-minute challenge expiry, and fresh challenges are free to mint. Account lockout never
fires because each password step _succeeds_. This is an exploitable gap in exactly the scenario 2FA
exists for: the attacker already has the password.

Ganbate's fix, all portable as-is:

- `ganbate:main/server/core/src/auth/security/totp-challenge-guard.ts` — 58-line self-contained module
  (`burnChallenge` / `isChallengeBurned`), TTL = the challenge's own life.
- A `totpVerify` preset (`{ max: 5, windowMs: 60_000 }`) in `rateLimitPresets.ts`, **keyed by userId, not
  IP** — IPs are rotatable, and the account is the thing under attack.
- `jti: randomUUID()` on the challenge JWT (`service.ts`); on the first rate-limit breach the `jti` is
  burned so the token cannot be re-hammered after the window rolls.
- `handlers/totp.test.ts` (150 lines) — this repo has none.

**Go further than ganbate:** this repo has a second unthrottled challenge surface ganbate lacks —
`main/server/core/src/auth/handlers/sms-challenge.ts`. Its _send_ path is rate-limited; its _verify_
path (which accepts both `sms_challenge` and `totp_challenge` purposes) is not. The same guard module
covers both.

The guard is in-memory and single-instance — the identical assumption the existing `AuthRateLimiter`
already carries, so it introduces no new constraint. A multi-instance deployment wants both behind a
shared store; that is a pre-existing item, not this one.

#### 5.1.3 A webhook may target the cloud metadata endpoint — `0303955`

`createWebhookSchema` in `main/shared/src/modules/comms/webhooks/webhooks.ts` validates the target with
`parseString(..., { url: true })` and nothing else. `http://169.254.169.254/latest/meta-data/` is a valid
webhook today. The delivery-time check in `main/server/core/src/webhooks/dispatch.ts`
(`isPrivateOrLoopbackHost`) **warns but delivers** — a documented decision ("self-hosted deployments
legitimately target internal hosts") — and its classification is materially weaker than ganbate's: no
CGNAT 100.64/10, no multicast, no IPv6 ULA/link-local, no IPv4-mapped IPv6, no embedded-credentials
check, and `host.startsWith('10.')` also matches a hostname like `10.example.com`.

The tell: **this repo already contains the failing tests.**
`tests/integration/api/webhooks.integration.test.ts:640–671` asserts localhost / `0.0.0.0` / `127.x`
targets are rejected with ≥400 — assertions the current schema cannot satisfy.

Port `ganbate:main/shared/src/modules/comms/webhooks/webhookUrl.ts` (154 lines + 96 of tests). It blocks
non-http(s) schemes, credentials-in-URL, loopback in every spelling, RFC1918, CGNAT, 0/8, multicast,
IPv6 ULA/link-local, and IPv4-mapped IPv6 in **both** spellings (`new URL('http://[::ffff:127.0.0.1]/')`
reports its hostname as `[::ffff:7f00:1]`; the first version of the guard missed that). It applies to
**input** schemas only — response schemas keep the plain parse so rows stored before the guard existed
stay readable. It deliberately does not close DNS rebinding.

**One decision before porting:** keep the self-hosted allowance by putting enforcement behind a config
flag (default on) rather than hardcoding it in the schema as ganbate did. But `169.254.169.254` is a
hard block regardless — no self-hosted deployment legitimately webhooks the metadata endpoint. Skip the
`secret`-optional change bundled in the same ganbate diff; this repo does not have the drift it fixes.

#### 5.1.4 The realtime bus has no per-user authorization — `47fbb2c` (authz slice)

This repo runs the full pubsub server (`main/server/realtime/`, `main/shared/src/modules/db/pubsub/`)
with **no `canSubscribe` gate**: any authenticated socket may subscribe to any key — including
`record:notifications:{someoneElsesUserId}`, which is guessable — and a `sync_request` with an empty
`keys` filter replays the entire history buffer.

Port `ganbate:main/shared/src/modules/db/pubsub/authorize.ts` (+ 202 lines of tests) and the
`canSubscribeToKey(key, userId)` parameter on `subscription.manager.ts`, bound **once per socket** to the
verified user id, gating both `subscribe` and the sync replay. `PER_USER_RECORD_TABLES` is a deny-list,
not a permission system — cheap and honest. This is worth doing even if §5.4.1 never ships: the bus is
live today with zero browser subscribers, which is exactly when nobody would notice it leaking.

#### 5.1.5 Without a Sentry DSN, production errors go to a Noop sink — adapted from `549e274`

> **Superseded by restructure Phase 12 (A5).** Sentry is gone: the error tracker is the platform
> logger (`createLogErrorTracker`), so every 5xx is a log event in every environment and there is no
> DSN switch left to port. The text below is kept as the record of the D3-era decision. D3 itself
> (crash capture for everyone as a legitimate interest) is superseded by the owner decision of
> 2026-11-16: browser crash reports need analytics consent ([W47](../log/2026-W47.md)).

`main/server/system/src/observability/factory.ts` falls back to `NoopErrorTrackingProvider` when no DSN
is configured. `console.provider.ts` **exists and is selected by nothing.** A production deployment
without a DSN — the common self-host case — drops every 5xx in silence.

Ganbate deleted Sentry outright; this repo keeps it (wave-1 decision D3, not relitigated here). The
D3-safe five-line fix is to make the fallback environment-aware:

```ts
if (config.dsn) return new SentryNodeProvider();
return config.environment === 'production'
  ? new ConsoleErrorTrackingProvider()
  : new NoopErrorTrackingProvider();
```

Ganbate's rationale ports verbatim: "a DSN is a vendor's address; keeping it as the switch would mean an
operator had to invent one to turn local logging on."

### 5.2 Admin correctness

All verified present in this repo. The 2026-06/07 settings-admin polish campaign did not touch any of
them.

#### 5.2.1 Three filters that lie — `59803c7`, and the webhook half of `e00859d`

- **Support Inbox** (`SupportInboxPage.tsx`) and **Audit Log** (`AuditEventsPage.tsx`) filter
  **client-side over a server-capped 100 rows** — the filter searches the newest 100, not the data. The
  audit repo here already has `find(filter)` with category/severity/date/limit/offset, so the handler
  rewrite is a straight substitution; the support side needs a `supportRequestsQuerySchema` +
  query-string plumbing through `client/api`. Both surfaces gain a `truncated` probe (fetch `limit + 1`)
  so the UI can say the bound out loud.
- **Webhook delivery list** (`main/server/core/src/admin/webhookHandlers.ts:131`) applies its status
  filter **in JS after the SQL LIMIT** — `?status=failed&limit=100` returns failures _within the newest
  100 rows_, routinely zero on a busy webhook. Move the filter into the repository query, and assert on
  the emitted SQL in the repo test — a JS-side filter satisfies any assertion made on rows alone.

#### 5.2.2 Fifteen admin GETs read `request.query` raw — `e00859d` + `02c4187`

Every admin GET here goes through `adminProtectedRoute` with no query schema: bare `Number()` with no
NaN guard, no ceiling on `offset` (`?offset=1e12` makes Postgres count its way there), and unchecked
`as` casts on `role`/`status`/`sortBy` in `userHandlers.ts`. The `adminUserListFiltersSchema` sort
whitelist **exists in shared and is bound to nothing**, so it has never run; `mapSortByToColumn`'s
`default:` silently launders bad input to `created_at`.

Port the mechanism, not just the fixes: `adminGetRoute(handler, contract)` which `safeParse`s a declared
schema and 400s before the handler, plus `adminProtectedRoute` **type-narrowed to non-GET** so a future
admin GET cannot skip validation by construction. Escape hatches (`READS_NO_QUERY`,
`QUERY_VALIDATED_IN_HANDLER`) force the author to state intent. `jobsHandlers.ts` already does it right
and is the in-repo precedent. Add `MAX_QUERY_OFFSET`. Keep all six user-sort fields — unlike ganbate,
this repo's `first_name`/`last_name` columns are alive. While there, delete the locally re-declared
`AdminAuditEvent*` types in `main/client/api/src/admin/client.ts` in favour of shared re-exports; the
local copy lacking `category` is what forced the client-side audit filter in the first place.

#### 5.2.3 "Clear filters" cannot clear — `828e7a4` + part of `02c4187`

The `...(value && { key })` conditional-spread idiom, in three places, each merging into previous state
so an absent key means _keep filtering_:

- `UserFilters.tsx` — "All Roles" leaves the previous role filter in force (three call sites;
  `handlePlanChange` already does it right).
- `useJobsList.ts` — the Jobs "All" tab is a one-way trap, and the lingering `status: undefined` also
  splits the React Query cache (`filter` is part of the query key).
- `SecurityEventsFilters.tsx` — assigns `undefined` instead of deleting the key, so both consumers that
  count keys overstate: the page's "N filter(s) active" and — worse — `ExportDialog`'s "active filters
  will be applied to the export", which claims a narrower scope than it exports.

#### 5.2.4 Small, single-file items

- **`15f4f3d` (reduced scope):** `LockUserDialog`'s custom-duration input has `min={0}` and **no max** —
  typing 400 days posts 576,000 minutes and gets a silent 400 (schema ceiling is 43,200). Port the
  single `LOCKOUT_DURATION_MINUTES` table with `MAX_LOCKOUT_DURATION_MINUTES` derived from it, the
  schema max derived from _that_, and both web surfaces rendering from it. Skip the six-month entry and
  `PlayerLockoutPanel` — those exist only for responsible-play rules.
- **`5df536d`:** `UserDetailPage` renders `GrantSubscriptionCard` unconditionally — the only billing
  surface in the app not gated on `isBillingEnabled()`. With billing off (the default profile) the card
  can only ever say "No Stripe-synced plans available", indistinguishable from breakage. One line.
  Sweep the other admin billing surfaces for the same omission while there.
- **`828e7a4` (URL slice):** the push-notification sender's URL schema rejects its own `/dashboard`
  placeholder (the shared `urlSchema` requires absolute URLs) — and nothing blocks `javascript:`.
  Port `notificationTargetUrlSchema`: accepts root-relative paths, rejects authority forms (`//evil.com`,
  `/\evil.com`) and non-http(s) schemes, because the value ends up in `openWindow`.

### 5.3 Ops and infrastructure

#### 5.3.1 The backup that verifies itself, and the drill that proves it — `2454603`, `b53a23b`, `3c91b0c`

This repo's `.github/workflows/database-backup.yml` is **the file ganbate deleted**, and it has every
property the deletion indicts: if the secrets are missing it logs a notice and **exits 0** — a green
tick every night for a job that may never have run; it performs zero integrity verification (no size
floor, no `gzip -t`, no structure check, no read-back after upload); and it prunes offsite history from
the job, so a bug there deletes backups.

Port `ganbate:main/tools/scripts/deploy/backup-database.sh` (145 lines, droplet cron, app-agnostic apart
from the project-name defaults). Its design points are the value:

- Three-way dump verification: byte floor, `gzip -t`, and `grep -c '^CREATE TABLE' >= 50` — because
  schema dominates dump bytes, so a zero-row dump clears any size threshold.
- Missing offsite is a **hard failure**; `BACKUP_ALLOW_LOCAL_ONLY=1` is a deliberately awkward escape
  that still exits 3 so cron keeps nagging.
- The upload is **read back** from the bucket; offsite retention is a bucket lifecycle rule, never the
  script.
- `trap ... ERR`, because v1 died silently on an empty env file before reaching its own guard.

Port the runbook (`ganbate:docs/dev/backups.md`) into `docs/deploy/backup-restore.md`, including the
**restore drill**: ganbate streamed the offsite object (not the local copy) into a throwaway postgres
**off-droplet** and compared table counts, row counts, and a ledger SUM against live. This repo has
never recorded a drill. Then decide the workflow's fate: delete it or make it fail loudly when
unconfigured — the skip-safe green is worse than no job. Still open in both repos: nothing alerts if
the cron stops.

#### 5.3.2 Quick wins

- **`.prettierignore` is missing `.tmp/`** (`ff9920f`, part 2). Seven audit scripts here write generated
  JSON/markdown under `.tmp/`; the very next `pnpm format:check` flags it. Two lines, zero risk.
- **`pnpm ci:everything`** — every ingredient exists here (`test:real-db`, `test:postgres-smoke`,
  `test:e2e`, `audit:api-governance:strict`); there is just no aggregate. One `package.json` line.
- **Demo Caddyfile health matching** — `infra/docker/demo/Caddyfile` uses exact-match `handle /health`
  in three places, the same subpath-into-SPA trap ganbate hit on its live edge. Widen to `/health*`.
  The production Caddyfile is already correct.

#### 5.3.3 `/health/geo` — a probe that says whether the gate is armed — `2e90824` + `5d53f49`

The wave-1 geo port (§2.6) shipped the gate; ganbate later learned its failure mode: **an inert gate is
invisible** from inside the app and from the CDN dashboard. `health/geo` echoes the request's geo
headers, resolves them through the same construction the gate uses, and returns a plain-language
verdict ("NO region header — if this request came through the CDN, enable the visitor-location
transform or the region gate is inert"), with a summary on `/health` itself.

This is the cheapest port in the set: `main/apps/server/src/http/system-routes.ts` is **byte-identical**
between the repos except for these additions, `GEO_EXEMPT_PATH_PREFIXES` already exempts `/health`
subpaths, and the production Caddyfile already forwards `/health*`. Copy the `geoProbe` helper, the
route, and the 77 lines of tests.

#### 5.3.4 Deploy verification and the build-arg chain — `19815d0`, `5f94738`, `d2c9d9d`

- **The health gate reads the CDN.** `application-deploy.yml` verifies with `https://$TARGET/health` —
  a CDN can serve a cached 200 while the origin is down, making the one check that triggers rollback a
  check that cannot fail. The authoritative signal is container healthchecks over SSH (a weaker count
  version already exists in the workflow — promote it), with the public URL demoted to informational.
  Add ganbate's final step: assert the **running image names** match the pushed SHA — "container health
  alone has lied before."
- **`vite-build-args` audit** (`ganbate:main/tools/scripts/audit/vite-build-args.ts`, 290 lines):
  verifies each `VITE_*` build arg through all three links — Dockerfile declares it AND exports it into
  the `RUN vite build`, the deploy path passes it to `docker build`, compose passes it locally — plus a
  machine-scoped `--require-values` mode that resolves each arg to `config/env/.env.production` and
  fails naming the key a human would set. This repo has 45 audits and nothing covering this chain, and
  real exposure: `SITE_URL` absent from the image build silently wrongs every `sitemap.xml` `<loc>`.
  Re-anchor link 2 to this repo's actual image-build step (`application-deploy.yml` or a Woodpecker
  lane) — and heed the audit's own comment: its previous incarnation pointed at a disabled workflow and
  passed green forever.
- **Auto-deploy** (`ganbate:.github/workflows/deploy.yml`, 59 lines, self-hosted runner): proves the
  pattern, but this repo already runs a Woodpecker agent on the same box — a `.woodpecker/deploy.yaml`
  is the idiomatic destination, not a 16th GitHub workflow. Worthless without a deploy script; if one is
  ever adopted, take `ganbate:main/tools/scripts/deploy/deploy-from-local.sh` **at HEAD** (its
  `6122d0d`/`d362c99`/`44d31f6` fixes are already folded in), including migrate-before-serve and the
  compose-drift warning.

### 5.4 Features worth taking

#### 5.4.1 Realtime notifications — `47fbb2c`

The headline. This repo's notification bell polls every 60 seconds; the server-side pubsub bus runs with
**zero browser subscribers**. Ganbate's channel: the frame carries only `{key, version}` — never payload
— so the browser refetches over the authenticated HTTP list route; publishing is best-effort
(`try/catch`, never fails the write); and the 60s poll **stays** as fallback, because a notification
that only ever arrives over a live socket is one that silently never arrives.

Port order, each step independently useful:

1. §5.1.4 (authorization) — a prerequisite and a standalone security fix.
2. WS lifecycle hardening (`lifecycle.ts`): `maxPayload: 64 KiB`, 30s ping/pong heartbeat with a
   `WeakSet` liveness registry that `terminate()`s half-open sockets, and a teardown-once guard (`ws`
   emits both `error` and `close`, so connection counts drifted negative and pubsub state was cleaned
   twice). Plus `SubscriptionManager.getStats()`.
3. `ganbate:main/server/core/src/notifications/publish.ts` + the `pubsub` dep + one call in `send.ts`.
4. Browser transport: `ganbate:main/apps/web/src/features/casino/lib/realtime.ts` and
   `hooks/useRealtimeChannel.ts` — nothing in either is casino-specific; **relocate** them
   (`main/client/react/` or app lib), don't inherit ganbate's awkward `@features/casino` import.
5. Wire `useNotifications` to invalidate on the frame; keep the poll.

One inherited lesson: ganbate's transport docstring records that the socket **never connected in any
environment** for a long period because it fetched `/csrf-token` instead of `/api/csrf-token`. Verify
the CSRF path and the dev-proxy `/ws` forwarding before calling this done.

#### 5.4.2 "Keep me signed in" — `7f9f9d0`, `aa7fe76`, `5aa340f`

This repo has no `rememberMe` anywhere — a real gap in a SaaS starter. Ganbate's
`auth.session.logic.ts` (69 lines, shared) separates two dials that codebases conflate:
`sessionSpanDays(rememberMe)` (30d remembered / 0.5d default — one value governing both the cookie
`maxAge` and the token-family expiry so they cannot disagree), `sessionSpanDaysOf(createdAt, expiresAt)`
(recovers the span from the token row on rotation — **no new column**, so the schema cannot contradict
the dates it already has), and `sessionIdleWindowMs(spanDays)` = `min(7d, span)`.

The bug it fixed is the argument for the design: email-OTP logins got a 7-day cookie and were retired by
the server after 2 hours — cookie and server disagreed about the same session, and the server won. If
this ships, wire the checkbox on **all** login paths (ganbate's second bug: the OTP path had no control
at all, and a hand-narrowed handler type would have silently dropped the field).

#### 5.4.3 The admin shell — `40dd3df`, `e35d21b`, `96e75a9`

Four primitives — `AdminPage`, `AdminSection`, `AdminEmptyState`, `AdminStatTile`/`AdminStatGrid` — plus
grouped sidebar nav, applied across every admin page (29 in ganbate; ~19 here, all hand-rolling their
own `<Heading as="h1">` today). Pure `@bslt/ui` composition, zero casino coupling; both repos share
`adminSurface.ts`, so the nav grouping has a clean anchor.

The part that is not cosmetic: ganbate found much of the admin markup **was styling nothing** —
Tailwind-shaped classnames that don't exist in `client/ui/src/styles/utilities.css`. The same dead
classes are in use in this repo's admin (`text-3xl`, `text-text-primary`, `bg-surface-hover`,
`border-border`, `max-w-xs`, `truncate`, `w-64`, `min-w-16`, `text-text-error` — in
`AdminDashboardPage`, `RouteManifestPage`, `WebhookListPage`, `AuditEventsPage`, `JobsTable`, and
others). The webhook URLs are not truncating; the classes are wishes.

Two port notes from ganbate's own commits: import the shells **by direct path, not the `../components`
barrel** (admin page tests mock that barrel; a barrel import resolves to `undefined`), and ship each
page's `.css` in the same commit as the page that imports it. Land §5.2 first so the restyle diff stays
reviewable. Related, same day: `d4d9580` replaced the 2s branded-loader floor on admin routes with a
per-page fade and opted the panel into `.selectable-text` — check whether this repo's admin routes
inherit the same `MIN_ROUTE_LOAD_MS` floor from §1.6's port.

#### 5.4.3 — landed 2026-08-04, and the audit understated it

The four primitives shipped as described (`AdminPage`, `AdminSection`, `AdminEmptyState`,
`AdminStatTile`/`AdminStatGrid`, in `features/admin/components/shell/` behind their own barrel — the
`../components` barrel is mocked wholesale by admin page tests, so a shell imported through it
resolves to `undefined`). They needed no new CSS: every class they use already existed once the
utility gaps below were filled.

The dead-class half was the real finding, and it was **repo-wide, not admin-only**. The audit named
nine suspect classes in admin. A scan written for the occasion found **448 across 86 files**, of
which 142 were in admin. Everything from `truncate` (not truncating) through `hover:bg-danger-hover`
(no variant system exists, so the danger button had no hover state) to entire BEM families in
`client/ui/src/components/billing/` that no stylesheet ever defined — `PlanChangeDialog`,
`UsageDashboard`, and `TenantUsageOverrideEditor` are laid out by classes that do not exist.

Three things came out of it that the porting note did not anticipate:

1. **The check belongs in the repo, not in a one-off script.** `lint-responsive.ts` already caught
   this exact bug, but only for `bp:`-prefixed classes — `md:flex` was guarded and `truncate` was
   not. `lint-dead-classes.ts` drops that restriction. The arbitrary half of an existing check was
   the whole reason the other 448 were invisible.
2. **Recall and precision both had to be earned empirically.** The first version fired on
   `getSeverityClass('critical')` (an argument, not a class) and on its own doc comment (prose about
   dead classes, not markup). It also _missed_ `const colorClass = ok ? 'text-green-600' : …`,
   which never appears in a `className=` attribute — six dead classes were hiding in one such
   ternary, making a widget look colour-coded while it rendered plain body text.
3. **A debt file, not a clean sweep.** 268 dead classes remain outside admin, mostly the billing BEM
   families, which need stylesheets written rather than tokens swapped. `dead-classes-debt.json`
   records a per-file ceiling that only moves down, so the gate is on today and the remainder is
   counted out loud on every run instead of being quietly deferred.

Utilities added while fixing admin, all completing scales that already existed rather than inventing
a system: the directional padding steps, `space-y-1/2/3`, `tracking-wide`, `truncate`, `break-all`,
the text-decoration and list utilities, `max-w-xs`/`max-w-3xl`, `border-danger`, `inline-block`,
`select-all`, and `.divide-y` — which replaces the "border on every row, then cancel the last one"
idiom that depended on a `last:` variant this repo does not implement, so the last row kept its
border everywhere it was used.

One-off sizes were **not** added as utilities. Most were on `<Skeleton>`, which already takes real
`height`/`width` props; the rest became co-located BEM classes. Letting guessed-at markup dictate the
design system is how a repo grows a Tailwind it never installed.

#### 5.4.4 Prerender head: description, canonical, OG, JSON-LD — from `prerender.ts` follow-ups

This repo's prerender (§2.3) emits `<title>` only. Ganbate's emits meta description, canonical link,
`og:title`/`og:description`/`og:url`/`og:type`, and a JSON-LD `WebPage` block (angle brackets
unicode-escaped inside the JSON so document text can never close the script tag), and **fails the build
when a page renders empty HTML** ("is its route in ServerApp?").

This repo's prerender architecture is otherwise the better of the two (typed `LiveSitePage`, tested,
`SITE_URL`-optional) — do **not** port ganbate's `siteMap.ts`, which diverged into casino content. Lift
`headFor()` + `jsonLd()` (~60 lines) into `main/apps/web/src/ssr/prerender.ts`, add a `description`
field to `SitePage`, and take the empty-HTML guard. Highest-ROI SEO delta available.

#### 5.4.5 `app:uncaught-error` — errors the ErrorBoundary cannot see — from `b562a32`

~20 vendor-neutral lines (`ganbate:main/apps/web/src/bootstrap/client.tsx`): listen for `error` and
`unhandledrejection` on `window`, re-dispatch as a `CustomEvent`. Deliberately does **not** log (the
browser already prints these; logging doubles them) and **ignores `error` events with no `event.error`**
(a failed `<img>` fires one; reporting those as crashes buries the real ones). With Sentry unconfigured
— the common dev and self-host case — this repo's ErrorBoundary catches render errors and nothing else:
rejected promises in handlers, failed dynamic imports, throws in `setTimeout` all sail past. Works with
Sentry on or off; you are porting the hook, not a consumer — ganbate hasn't wired a listener yet either.

### 5.5 Do not port (wave 2)

Casino-bound with no generic framework underneath, verified by reading the implementations, not the
commit messages: the **demo/guest mode** (every line binds to stake/payout/wallet — though three of its
patterns are worth keeping in mind: answer the _mode_ before the _resource_; an optional `demo?:`
resolver on the shared mutation seam instead of a parallel code path; `Omit<Request, 'amountCents'>`
making the billable field unreachable by construction), the **fraud-signals page** (each signal is
hand-written SQL against casino tables), and the **social-share approval queue** (single casino table —
though its DB-invariant techniques generalise: a partial unique index `WHERE status = 'pending'` beats a
service-level duplicate check, and paired CHECK constraints make contradictory states unrepresentable).

Ganbate's **GitHub-Actions exit** is its own fork in the road — this repo keeps Actions (Woodpecker
here runs _alongside_ Actions, not instead). Its **Sentry removal** happened here too, in restructure
Phase 12 (A5); the owner decision of 2026-11-16 supersedes D3 (browser crash reports need analytics
consent).

### 5.6 Verified already covered — do not re-audit

- **Dependency override pins** — in parity at `de959892`; ganbate's one extra pin (`@hono/node-server`)
  covers a package absent from this repo's tree.
- **TOTP secret encryption-at-rest tests** (`686f777`) — this repo's `totp-secret.test.ts` covers the
  same guarantees plus one ganbate lacks (the base32-alphabet/colon discriminator premise).
- **Responsive contract / iOS guards** (`037e477`, `47c32ec`) — ported as `76fa6b3b`.
- **Billing plan-change logic** (`e84f7b4` slice) — this repo is ahead (`prorationBehaviorForDirection`,
  `PlanPriceMismatchError`, single-sourced `PLAN_FEES`).
- **`fix:esm-dist` in the merge gate** (`ff9920f`, part 1) — this repo has no per-package postbuild
  hooks, so the dist-clobber that fix exists for cannot occur here. (Observed while checking, not a
  ganbate port: `.woodpecker/quality.yaml` runs `audit-template` before `build`, so `audit:esm-dist`
  walks empty dist dirs and passes vacuously on a cold checkout.)
- **Sentry build-arg removal** (`35f09ec`) — no `VITE_SENTRY_*` args exist in this repo's
  `Dockerfile.web`, and Phase 12 removed the browser SDK itself.

### Suggested order

Small-and-severe first; the shell restyle last so its diff stays reviewable.

| Order | Item                                                           | Effort | Class                |
| ----- | -------------------------------------------------------------- | ------ | -------------------- |
| 1     | §5.1.1 flag-override upsert                                    | XS     | data loss, live      |
| 2     | §5.1.2 TOTP + SMS challenge throttle                           | S      | security, live       |
| 3     | §5.1.4 pubsub `canSubscribeToKey`                              | S      | security, live       |
| 4     | §5.1.5 Console error fallback                                  | XS     | observability, live  |
| 5     | §5.1.3 webhook SSRF guard (after the config-flag call)         | M      | security, live       |
| 6     | §5.3.2 `.tmp/` ignore · `ci:everything` · `/health*`           | XS     | hygiene              |
| 7     | §5.2.3 + §5.2.4 clear-filters, lockout, billing gate, push URL | S      | admin correctness    |
| 8     | §5.2.1 server-side Support/Audit/delivery filtering            | M      | admin correctness    |
| 9     | §5.2.2 `adminGetRoute` query contracts                         | M      | structural           |
| 10    | §5.3.1 backup script + restore drill                           | M      | ops                  |
| 11    | §5.3.3 `/health/geo`                                           | S      | ops                  |
| 12    | §5.4.5 uncaught-error hook · §5.4.4 prerender head             | S      | features             |
| 13    | §5.4.2 remember-me                                             | M      | feature              |
| 14    | §5.4.1 realtime notifications (steps 2–5)                      | L      | feature              |
| 15    | §5.4.3 admin shell + dead-class sweep                          | L      | design coherence     |
| 16    | §5.3.4 deploy verification + build-arg audit                   | M      | ops, needs anchoring |

---
