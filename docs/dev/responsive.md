# The responsive contract

How a feature gets built once and looks right on every device — instead of
being re-tuned per phone after the fact. Ported from ganbate (2026-07-27),
where every rule below was written from a failure actually hit.

## The model: one reference width, one scale rule

The mobile view is **authored at the desktop browser's minimum window (~500px)**
and approved there. Real phones (375–430px) render the SAME CSS on a narrower
canvas, which makes everything read oversized on device — and invites
per-device size tuning that drifts from the reference.

The fix is structural, not per-feature (`AppShell.css`):

```css
@media (max-width: 500px) {
  html {
    font-size: clamp(0.75rem, 3.2vw, 1rem);
  }
}
```

On the root's own `font-size`, rem resolves against the INITIAL value (16px),
never against itself — so this is 12px..16px in device terms while staying
token-legal. `3.2vw` is exactly 16px at 500px, so the ramp is continuous at
the boundary.
Because the design system is rem-based — type AND spacing — everything scales
in proportion: **a phone shows the same picture the min-width window shows,
fitted.** The 12px floor (a 0.75 scale, reached at 375px) keeps the narrowest
devices legible; below it, layouts fold instead of shrinking further.

What this buys: **a new feature written in tokens is device-proportional with
zero device-specific work.**

## The rules that keep it true

1. **Tokens and rem only.** Any hardcoded px size is invisible to the ramp and
   will read oversized on phones — the no-px rule is also the device-compat
   rule.
2. **Never re-declare token VALUES per feature or per breakpoint.** A second
   per-device remap creates two sources of truth that drift (tried in ganbate,
   reverted same day).
3. **Text inputs pin `max(12pt, token)`** — app-wide, beside the ramp in
   `AppShell.css`. iOS Safari zooms the whole page onto any focused input
   under 16 REAL pixels, and a scaled rem lands under that threshold. 12pt is
   exactly 16px, written as an absolute unit because this floor is a platform
   constant that must not follow the ramped root. The one deliberate exception
   to proportionality.
4. **No content-coupled pixel budgets.** A layout balanced against today's
   label lengths breaks the day a label changes (ganbate's footer broke from a
   two-character rename). Prefer wrap/fold patterns that degrade on their own.
5. **Anchor overlays to edges that cannot move** — not to wrapper bottoms that
   shift when a helper line wraps.
6. **Media queries change LAYOUT, not sizes.** Stacking, folding, swapping a
   nav — fine. Re-tuning sizes per width is what the ramp makes unnecessary.
7. **Fixed bottom bars carry `env(safe-area-inset-bottom)`** so the iOS home
   indicator never covers controls.

## Known deviation (pre-existing, not changed by the port)

`.app-shell-viewport` uses `height: 100vh`. On phones, `100vh` is the viewport
with the browser chrome HIDDEN, so the shell can run taller than what is
visible and trap the bottom of the scroll region under the toolbar; `100dvh`
tracks the real visible height. Ganbate switched for exactly that reason.
Left as-is here pending a verified pass on this app's layouts — flip it and
sweep when mobile work next touches the shell.

## The guardrail

```bash
BASE_URL=http://localhost:5173 pnpm bslt report responsive-sweep
SWEEP_PAGES=/,/pricing,/login pnpm bslt report responsive-sweep   # custom page list
```

Drives Chromium across 280 / 320 / 360 / 390 / 430 / 500 plus one WebKit pass
at iPhone width, and fails on: horizontal overflow, an inactive root ramp, or
an input under 16 real px. Needs network and installed Playwright browsers, so
it is **not** in the merge gate — run it before pushing UI work, and always
after touching tokens, breakpoints, or the ramp itself.
