# Cookie Policy

**This is an unedited template. It is not legal advice and must be reviewed by a lawyer before you publish it.**

_Last updated: [[EFFECTIVE_DATE]]_

## What cookies are

A cookie is a small file a site stores on your device. [[COMPANY_NAME]] uses them to keep you signed in and to keep the service secure — and for nothing else. We set no analytics cookies and no advertising cookies.

## What we set

**Strictly necessary.** These cannot be switched off; signing in does not work without them. Both are `httpOnly`, which means code running in the page cannot read them.

| Cookie         | Purpose                            | Expires                                              |
| -------------- | ---------------------------------- | ---------------------------------------------------- |
| `refreshToken` | Keeps you signed in between visits | 30 days with "Keep me signed in", otherwise 12 hours |
| `_csrf`        | Blocks cross-site request forgery  | When you close your browser                          |

That is the whole list. If you find a cookie we set that is not in this table, tell us at [[CONTACT_EMAIL]] — either the table or the code is wrong, and we will fix whichever it is.

## Local storage — cookie-like, but not cookies

The app also keeps a few values in your browser's local storage. Unlike cookies, they are never attached to a request; they only help the page remember your choices between visits. The main entries:

| Key                        | Purpose                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `bslt.consent.v1`          | Your consent choice for analytics and advertising, and when you made it             |
| `cookie-consent-dismissed` | Remembers that you answered the consent banner                                      |
| `abe-locale-preference`    | Your language choice                                                                |
| `abe-timezone-preference`  | Your timezone choice                                                                |
| `bslt.activeOrgId`         | The workspace you last had open                                                     |
| `bslt:browser-device-id`   | A random identifier that tells this browser apart from your other signed-in devices |

Local storage also caches app state — draft messages, offline changes waiting to be sent, fetched data — so the app opens where you left it.

One thing is deliberately **not** in local storage: your sign-in token. The access token lives only in the page's memory and is never written to disk, so a script that reads local storage cannot steal it. Earlier versions of the app stored it under an `accessToken` entry; if one is still there, the current app reads it once to carry the old session into memory and never writes a new one. Clearing your browser's site data deletes the leftover entry.

## Your choice

The consent banner asks before we do anything that is not strictly necessary. Your answer is stored on your device (the `bslt.consent.v1` entry above) and, when you are signed in, with your account too; you can change it at any time under Settings → Data controls, and the banner dismissal itself is remembered on your device. The choice is enforced: no analytics or advertising script loads unless you granted that category, and dismissing the banner without answering counts as a refusal. Marketing email has its own toggle under Settings → Data controls. If your browser sends the Global Privacy Control signal, we record it as an advertising opt-out automatically — no banner needed. The "Do Not Sell or Share My Personal Information" control in the footer of every page does the same, with or without an account. Your browser can block or delete cookies too, though the strictly necessary ones are required for signing in to work.

## Contact

[[CONTACT_EMAIL]]
