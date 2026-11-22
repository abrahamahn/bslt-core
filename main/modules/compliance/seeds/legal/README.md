# docs/legal — the file-owned legal documents

The markdown files in this directory are the published source of truth for the
static legal pages. They are imported with `?raw` into
`main/apps/web/src/features/content/` and rendered through `fillDocument()` +
the `@bslt/ui` `<Markdown>` component, so they ship with the bundle and render
fully at prerender time — no API call involved. This README is not rendered.

## Who owns which page

| Page              | Owner                                                      | Why                                                       |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `/terms`          | **Database** (`legal_documents` table, admin legal editor) | ToS acceptance gating depends on document version numbers |
| `/privacy`        | **Database** (same system)                                 | Same versioned, acceptance-tracked flow                   |
| `/cookies`        | **This directory** — `cookie-policy.md`                    | Plain prose; changes when the code changes                |
| `/acceptable-use` | **This directory** — `acceptable-use.md`                   | Plain prose                                               |
| `/disclaimer`     | **This directory** — `disclaimer.md`                       | Plain prose                                               |

The DB seeds in migration `0913_legal_document_templates.sql` remain the floor
for the DB-backed system and must not be edited; to publish real Terms or
Privacy copy, create version 2 in the admin legal editor.

## The `[[TOKEN]]` contract

Documents never hard-code operator facts. They carry `[[TOKEN]]` placeholders,
and `fillDocument()` (in
`main/apps/web/src/features/content/lib/document.ts`) replaces each one from
the exported `OPERATOR` record — so a fact lives in exactly one place. The
current token set:

| Token                | Fills as                                      |
| -------------------- | --------------------------------------------- |
| `[[COMPANY_NAME]]`   | `BSLT`                                        |
| `[[CONTACT_EMAIL]]`  | `abeahn@engineering.upenn.edu`                |
| `[[EFFECTIVE_DATE]]` | The date the current document set took effect |

Rules:

- A known token renders as its value.
- Any unknown token — including a multi-line `[[TODO: …]]` authoring note —
  renders as the literal string `[pending]`, never as raw `[[…]]` markup.
- Neither outcome is publishable for an unresolved note: resolve it or cut it
  before it lands.

## What enforces this

The CI guard in `main/apps/web/src/__tests__/documents.test.ts` is what makes
these rules real: it scans every published document here, fails on unresolved
`[[TODO]]` notes, fails if a rendered document still contains `[[`, and pins
the factual claims (the cookie table above all) to the code that makes them
true. Change the code or the prose — the guard demands both move in the same
commit.
