-- 0913_legal_document_templates.sql
--
-- Seeds a starter template for every type in DOCUMENT_TYPES.
--
-- Why a migration and not the seed script: `seed.ts` refuses to run when
-- NODE_ENV=production, so seeding there would leave every real deployment with
-- a document system that has no documents — a versioned, acceptance-tracked,
-- admin-editable legal feature whose public /terms and /privacy pages render
-- "not published yet". These have to exist in every environment.
--
-- THE TEXT BELOW IS NOT LEGAL ADVICE AND IS NOT READY TO PUBLISH.
-- It is scaffolding: correct in shape, deliberately incomplete in substance.
-- Every value a real operator must supply is written as a LOUD placeholder —
-- `[SET COMPANY_NAME]` — so the rendered page is unmistakably a template rather
-- than plausible-looking boilerplate somebody ships by accident. Replacing them
-- is the job of a lawyer, not of a starter kit.
--
-- To publish real copy, do NOT edit this migration. Use the admin legal editor
-- to create version 2; the page always serves the highest version. This file is
-- the floor, not the source of truth.
--
-- Idempotent: ON CONFLICT (type, version) DO NOTHING, so re-running is a no-op
-- and an operator who has already published v1 is never overwritten.

INSERT INTO legal_documents (type, title, content, version, effective_at)
VALUES
(
  'terms_of_service',
  'Terms of Service',
  $doc$# Terms of Service

**This is an unedited template. It is not legal advice and must be reviewed by a lawyer before you publish it.**

_Last updated: [SET EFFECTIVE_DATE]_

## 1. Who we are

These Terms of Service ("Terms") govern your access to and use of [SET PRODUCT_NAME], operated by [SET COMPANY_NAME] ("we", "us", "our"), a company registered at [SET COMPANY_ADDRESS].

You can reach us at [SET CONTACT_EMAIL].

## 2. Accepting these Terms

By creating an account or using the service, you agree to these Terms. If you do not agree, do not use the service.

If you are using the service on behalf of an organisation, you confirm that you have authority to bind that organisation, and "you" means that organisation.

## 3. Your account

- You must provide accurate information and keep it up to date.
- You are responsible for everything that happens under your account.
- You must keep your credentials secret and tell us promptly at [SET CONTACT_EMAIL] if you believe they have been compromised.
- You must be at least [SET MINIMUM_AGE] years old to hold an account.

## 4. Acceptable use

Your use of the service is subject to our Acceptable Use Policy. In short: do not break the law, do not attack the service, and do not use it to harm other people.

## 5. Subscriptions, billing and refunds

- Paid plans are billed in advance on a recurring basis until cancelled.
- Prices are stated at the point of purchase and may change on notice.
- You may cancel at any time; cancellation takes effect at the end of the current billing period.
- **Refunds: [SET REFUND_POLICY].** State this plainly. A refund policy that is vague is a refund policy that will be decided against you.

## 6. Your content

You keep ownership of the content you upload. You grant us the limited licence we need in order to host, process and display it back to you — and to no wider extent than running the service requires.

## 7. Availability

We aim to keep the service available, but we do not promise it will be uninterrupted or error-free. We may change, suspend or discontinue features.

[SET UPTIME_COMMITMENT — if you offer an SLA, say so here and link it. If you do not, say that instead. Do not imply one you have not agreed to.]

## 8. Termination

You may stop using the service and delete your account at any time.

We may suspend or terminate your account if you materially breach these Terms, or if we are required to by law. Where it is lawful and practical to do so, we will tell you first and give you a chance to put things right.

## 9. Disclaimers and liability

Please see our Disclaimer.

## 10. Changes to these Terms

We may update these Terms. If a change is material, we will give you reasonable notice before it takes effect. Continuing to use the service after that means you accept the updated Terms.

## 11. Governing law

These Terms are governed by the laws of [SET GOVERNING_LAW], and the courts of [SET JURISDICTION] have exclusive jurisdiction.

## 12. Contact

[SET COMPANY_NAME]
[SET COMPANY_ADDRESS]
[SET CONTACT_EMAIL]
$doc$,
  1,
  NOW()
),
(
  'privacy_policy',
  'Privacy Policy',
  $doc$# Privacy Policy

**This is an unedited template. It is not legal advice and must be reviewed by a lawyer before you publish it.**

_Last updated: [SET EFFECTIVE_DATE]_

## 1. Who is responsible for your data

[SET COMPANY_NAME], of [SET COMPANY_ADDRESS], is the controller of the personal data described here.

Contact us about privacy at [SET PRIVACY_CONTACT_EMAIL].

[SET DPO_DETAILS — required if you appoint a Data Protection Officer, or if GDPR Art. 37 obliges you to. Delete this line if neither applies.]

## 2. What we collect

**You give us:**

| Data | Why |
| --- | --- |
| Email address | To create your account, sign you in, and send service notices |
| Name and profile details | To identify you inside the product |
| Payment details | Taken and stored by our payment processor, not by us |
| Anything you upload | To provide the service back to you |

**We collect automatically:**

| Data | Why |
| --- | --- |
| IP address, browser, device | Security, abuse prevention, and debugging |
| Usage and page events | To understand what to improve |
| Cookies and similar | See our Cookie Policy |

## 3. Why we are allowed to use it

Under GDPR Art. 6 we rely on:

- **Contract** — to give you the service you signed up for.
- **Legitimate interests** — to keep the service secure and to improve it, where that does not override your rights.
- **Consent** — for non-essential cookies and marketing. You can withdraw it at any time.
- **Legal obligation** — to keep records we are required to keep.

## 4. Who we share it with

We do not sell your personal data.

We share it with processors who run the service on our behalf — hosting, email delivery, payments, error tracking — and each is bound to use it only on our instructions. [SET SUBPROCESSOR_LIST — name them, or link a page that does. "Trusted partners" is not a list.]

We may disclose data where the law requires it.

## 5. Where it goes

[SET DATA_LOCATION.] If personal data leaves the UK/EEA, we rely on [SET TRANSFER_MECHANISM — e.g. Standard Contractual Clauses] to protect it.

## 6. How long we keep it

We keep your account data for as long as your account is open, and afterwards only as long as we need it for the purposes set out here or the law requires. [SET RETENTION_PERIODS.]

## 7. Your rights

You can ask us to:

- give you a copy of your data;
- correct it if it is wrong;
- delete it;
- restrict or object to how we use it;
- port it to another provider;
- stop sending you marketing.

Exercise any of these from your account settings, or by emailing [SET PRIVACY_CONTACT_EMAIL]. We will respond within one month.

You may also complain to your local supervisory authority — in the UK, the Information Commissioner's Office.

## 8. California residents

If you are a California resident, you have the rights described in the CCPA/CPRA, including the right to know, to delete, to correct, and to opt out of the sale or sharing of personal information. **We do not sell your personal information.** You may exercise these rights without being discriminated against for doing so.

## 9. Children

The service is not directed at children under [SET MINIMUM_AGE], and we do not knowingly collect their personal data. If you believe a child has given us data, contact [SET PRIVACY_CONTACT_EMAIL] and we will delete it.

## 10. Security

We protect your data with encryption in transit, hashed credentials, access controls, and audit logging. No system is perfectly secure, and we will tell you and the relevant regulator about a breach where the law requires it.

## 11. Changes

We will post any update here and, if the change is material, tell you directly.
$doc$,
  1,
  NOW()
),
(
  'cookie_policy',
  'Cookie Policy',
  $doc$# Cookie Policy

**This is an unedited template. It is not legal advice and must be reviewed by a lawyer before you publish it.**

_Last updated: [SET EFFECTIVE_DATE]_

## What cookies are

A cookie is a small file a site stores on your device. We use them to keep you signed in, to keep the service secure, and — only with your consent — to understand how the product is used.

## What we set

**Strictly necessary.** These cannot be switched off; the service does not work without them.

| Cookie | Purpose | Expires |
| --- | --- | --- |
| Session | Keeps you signed in | [SET SESSION_COOKIE_LIFETIME] |
| CSRF token | Blocks cross-site request forgery | Session |
| Consent choice | Remembers what you chose here | 12 months |

**Analytics — only with your consent.**

| Cookie | Purpose | Expires |
| --- | --- | --- |
| [SET ANALYTICS_COOKIE] | [SET PURPOSE] | [SET LIFETIME] |

[SET — list every non-essential cookie you actually set. An incomplete cookie table is a common enforcement finding, and it is trivially checkable by anyone with developer tools open.]

## Your choice

We ask before setting anything that is not strictly necessary. You can change your mind at any time from the cookie settings in your account, and your browser can block or delete cookies too — though the strictly necessary ones are required for the service to function.

## Contact

[SET PRIVACY_CONTACT_EMAIL]
$doc$,
  1,
  NOW()
),
(
  'acceptable_use',
  'Acceptable Use Policy',
  $doc$# Acceptable Use Policy

**This is an unedited template. It is not legal advice and must be reviewed by a lawyer before you publish it.**

_Last updated: [SET EFFECTIVE_DATE]_

This policy is part of our Terms of Service. It sets out what you may not do with [SET PRODUCT_NAME].

## You must not

- break any law, or help anyone else to;
- infringe anyone's intellectual property, privacy, or other rights;
- upload malware, or anything designed to damage or interfere with software or hardware;
- probe, scan, or test the security of the service without our prior written permission;
- try to gain unauthorised access to any account, system, or data;
- interfere with the service or place an unreasonable load on it — including scraping, or automated access outside our documented API;
- send spam, or use the service to send unsolicited messages;
- harass, threaten, defame, or impersonate anyone;
- upload content that is unlawful, or that sexualises children;
- resell or sublicense the service unless your agreement with us says you may.

## Reporting abuse

Report anything that breaks this policy to [SET ABUSE_CONTACT_EMAIL].

## What happens if you break it

We may remove content, suspend or terminate your account, and where the law requires it, report the matter to the authorities. We will act proportionately, and where it is lawful and practical we will tell you first.
$doc$,
  1,
  NOW()
),
(
  'disclaimer',
  'Disclaimer',
  $doc$# Disclaimer

**This is an unedited template. It is not legal advice and must be reviewed by a lawyer before you publish it.**

_Last updated: [SET EFFECTIVE_DATE]_

## No warranty

The service is provided "as is" and "as available". To the fullest extent the law allows, we make no warranties of any kind, whether express or implied, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement.

We do not warrant that the service will be uninterrupted, timely, secure, or error-free, or that any defect will be corrected.

## Limitation of liability

To the fullest extent the law allows, [SET COMPANY_NAME] is not liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, revenue, data, or goodwill, arising out of your use of the service.

Our total liability for any claim arising out of the service is limited to [SET LIABILITY_CAP — e.g. the amount you paid us in the twelve months before the claim].

## What we cannot exclude

Nothing here excludes or limits liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for anything else that the law does not permit us to exclude. If you are a consumer, you keep your statutory rights.

## Third-party content and links

The service may link to, or integrate with, things we do not control. We are not responsible for them, and a link is not an endorsement.

## Not professional advice

Nothing in the service is [SET — legal / financial / medical / tax] advice, and it should not be relied on as such.

[SET JURISDICTION_NOTE — some jurisdictions do not allow the exclusion of certain warranties or the limitation of certain damages, so some of the above may not apply to you.]
$doc$,
  1,
  NOW()
)
ON CONFLICT (type, version) DO NOTHING;
