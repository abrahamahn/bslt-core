# Rust backend slice (moved)

The opt-in Rust backend (`main/apps/server-rust`), its web client
(`main/apps/web/src/features/rust-access`, `rust.html`, `vite.rust.config.ts`,
`playwright.rust.config.ts`), its e2e spec (`main/apps/web/tests/rust-access.e2e.spec.ts`), the
`rust-backend.yml` workflow and `docs/dev/rust-backend.md` were removed from bslt-main in
restructure Phase 1 (2026-11-11).

They now live in the Kanu repository, on branch `import/bslt-server-rust`, with their history.
Continue Rust work there. bslt-main is a TypeScript-only foundation; see
[`docs/architecture/restructure/restructure-plan.md`](../architecture/restructure/restructure-plan.md)
section 15.2.
