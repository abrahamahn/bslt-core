#!/usr/bin/env -S node --import tsx
// main/build-config/bin/esm-fix.ts
/**
 * `bslt-esm-fix [dir...]`: adds `.js` to the relative imports of built ESM output
 * (default `dist`). Every package build runs it after `tsc`; see `src/esm-fix.ts`.
 */
import { fixEsmExtensions } from '../src/esm-fix';

fixEsmExtensions(process.argv.slice(2));
