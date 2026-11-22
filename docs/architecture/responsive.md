# Responsive & Device Optimization Architecture

How BSLT keeps the UI clean and consistent on every device class — phones
(iPhone/Android), tablets, laptops, and ultrawide desktops — with one
standard instead of per-page improvisation.

## The system at a glance

| Layer           | Location                                       | Role                                                                                                                           |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Canonical scale | `main/shared/src/constants/breakpoints.ts`     | Single source of truth: `BREAKPOINTS`, `MOBILE_BREAKPOINT`, `breakpointUp/Down()`                                              |
| Theme tokens    | `main/client/ui/src/theme/breakpoints.ts`      | Re-exports the scale; `buildThemeCss` emits `--ui-breakpoint-*`, `--ui-content-max`, `--ui-touch-target`                       |
| CSS utilities   | `main/client/ui/src/styles/utilities.css`      | Mobile-first `bp:` variants (`md:flex-row`, `lg:grid-cols-3`, …) of the core layout utilities                                  |
| React hooks     | `main/client/react/src/hooks/`                 | `useIsMobile`, `useBreakpoint`, `useBreakpointUp/Down`, `useIsTouch` — all derived from the shared scale                       |
| Enforcement     | `main/tools/scripts/lint/lint-responsive.ts`   | `pnpm bslt gate run responsive` (also runs in `pnpm lint:css`) fails off-scale media queries and undefined `bp:` classes       |
| Enforcement     | `main/tools/scripts/lint/lint-dead-classes.ts` | `pnpm bslt gate run dead-classes` (also in `pnpm lint:css`) fails **any** class — prefixed or not — that no stylesheet defines |

## Canonical breakpoints

| Token | rem | px   | Device class                                             |
| ----- | --- | ---- | -------------------------------------------------------- |
| `sm`  | 30  | 480  | Large phones (stack below, compact paddings)             |
| `md`  | 48  | 768  | Portrait tablets — **the mobile cutoff** (`useIsMobile`) |
| `lg`  | 64  | 1024 | Landscape tablets / small laptops                        |
| `xl`  | 80  | 1280 | Laptops (fluid-token midpoint)                           |
| `2xl` | 96  | 1536 | Large / ultrawide desktops                               |

CSS `@media` cannot reference `var()`, so stylesheets use these rem values
literally — e.g. `@media (max-width: 48rem)`. Any other width value fails
`pnpm bslt gate run responsive`.

### Reference widths (not breakpoints)

`REFERENCE_WIDTHS`, in the same file, holds widths that appear in a media query
but are **not** layout breakpoints — their value is derived from a formula
rather than chosen from the scale. The lint accepts these in addition to
`BREAKPOINTS`, so an undeclared width still fails; declaring one is a review
checkpoint, not an escape hatch.

There is one today. `rootRamp` (`31.25rem`) is where the root font-size ramp in
`AppShell.css` opens, because `3.2vw` equals exactly `1rem` at that width — so
the gate opens precisely where the ramp would otherwise start shrinking text,
with no step at the boundary. Snapping it to 30rem would not tidy it; it would
re-tune the curve (the coefficient would have to become 3.333vw and the 12px
floor would move from 375px to 360px). Snapping it to 48rem is not viable at
all: continuity there needs ~2.08vw, which puts every phone at the floor.

Note the rem, rather than the equivalent `500px`. On the root element `rem`
resolves against the browser's _initial_ font size, and so does `rem` inside a
media query — so gate and clamp track the reader's font preference together.
Pinned at `500px` they diverge: a reader on a 20px default would cross the gate
and watch the root drop 20px → 16px in a single pixel of resize.

Conventions:

- **Mobile-first utilities**: `bp:` class variants and `breakpointUp()` use
  `min-width` — author the phone layout unprefixed, layer wider layouts on top.
- **Max-width overrides**: component/feature CSS that _tightens_ mobile uses
  `@media (max-width: 48rem)`, matching `useIsMobile`.
- Both directions may match at exactly the boundary; later rules win, which is
  why the responsive variants live at the end of `utilities.css`.

## Decision ladder — pick the highest rung that works

1. **Fluid/intrinsic first (no breakpoint at all).** Prefer
   `repeat(auto-fit, minmax(min(20rem, 100%), 1fr))`, `flex-wrap`, `clamp()`
   typography/spacing tokens, and `min()`/`max()` caps. Layouts that never
   consult the viewport can't drift.
2. **Responsive utility classes** for simple layout swaps in markup:
   `class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4"`,
   `class="flex flex-col md:flex-row md:items-center md:justify-between"`.
   The variant set (display, flex direction/alignment, grid columns/spans,
   order, sticky) is defined in `utilities.css`; anything not defined there is
   a lint error — **there is no Tailwind here**, undefined prefixes render as
   no-ops. Arbitrary-value syntax (`md:grid-cols-[…]`) is never supported; use
   the next rung.
3. **Co-located CSS with canonical media queries** when the change is bigger
   than a utility swap (multi-property, pseudo-elements, bespoke grids).
4. **Container queries** when a component must adapt to its _container_ (e.g.
   a card that renders both in a sidebar and full-width —
   `AccountModal.css` is the reference).
5. **JS hooks last** — only when behavior (not styling) changes:
   `useIsMobile()` for the mobile boundary, `useBreakpoint()` /
   `useBreakpointUp('lg')` for named tiers, `useIsTouch()` for coarse-pointer
   behavior. All SSR-safe (server renders the mobile-first default).

## Device rules (apply everywhere)

- **Touch targets**: interactive elements ≥ `var(--ui-touch-target)` (44px)
  on coarse pointers; use `@media (pointer: coarse)` or `useIsTouch()`.
- **Safe areas**: fixed/full-bleed surfaces (shells, modals, toasters,
  side-peeks, bottom bars) pad with
  `max(var(--ui-gap-*), env(safe-area-inset-*))`; `index.html` ships
  `viewport-fit=cover`.
- **Dynamic viewport units**: full-height surfaces use `dvh` (not `vh`) so
  mobile browser chrome doesn't clip content; modals cap at
  `min(85dvh, 100%)`.
- **Ultrawide**: main content areas cap at `var(--ui-content-max)` (90rem).
- **Overflow discipline**: tables and wide data get an `overflow-x: auto`
  wrapper with `min-width: 0` on grid/flex parents; the page body never
  scrolls horizontally.
- **Hover is an enhancement**: hover-only affordances need a
  touch-reachable equivalent.

## Enforcement

```bash
pnpm bslt gate run responsive    # standalone: breakpoints + bp: variants
pnpm bslt gate run dead-classes  # standalone: every class resolves to a real selector
pnpm lint:css           # tokens + both of the above
```

Checks:

1. Every `(min|max)-width` media query in `main/apps/web/src` and
   `main/client/*/src` uses a canonical rem value (30 | 48 | 64 | 80 | 96).
2. Every `sm:`/`md:`/`lg:`/`xl:`/`2xl:` class referenced from TSX is actually
   defined in `utilities.css`.
3. Every **other** class referenced from TSX also resolves to a selector that
   exists — in the four `@bslt/ui` stylesheets or in a co-located `.css`.

Check 3 is check 2 without its arbitrary restriction. There is no Tailwind
here, so `truncate`, `hover:bg-surface-hover`, and `max-w-[12rem]` are not
styles, they are wishes: they render as nothing while the markup reads as
though the intent were satisfied. That is a hard bug to see in review and an
impossible one to see at runtime, which is how 448 of them accumulated across
86 files before the check existed.

### The debt file

Switching the check on with 448 pre-existing violations would have meant either
a permanently red build or no check at all, and "no check" is how they got
there. So `dead-classes-debt.json` records a per-file ceiling that only moves
down:

- a file above its ceiling **fails** the lint — that is new breakage;
- a file below it is reported so the ceiling can be lowered with
  `pnpm bslt gate run dead-classes --update`;
- a file absent from the debt file has a ceiling of zero.

The carried total is printed on every run. A gate that reported "all clear"
while three hundred classes styled nothing would teach exactly the wrong
lesson.

To extend the variant set, add the rule to the RESPONSIVE VARIANTS section of
`utilities.css` (keep all five breakpoint blocks uniform). To change the scale
itself, edit `main/shared/src/constants/breakpoints.ts` and run
`pnpm build:theme` — the tokens, hooks, and lint all follow automatically.
