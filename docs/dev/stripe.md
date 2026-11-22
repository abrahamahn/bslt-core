# Stripe Connection & Verification

The billing stack (provider, webhooks, checkout, subscription lifecycle, and UI)
is fully implemented. This guide connects it to a real Stripe account and verifies
the end-to-end path. Until Stripe keys are present, billing auto-disables and the
public plan list is served from defaults — so an unconfigured app is safe.

## 1. Get test-mode keys

Stripe now uses **Sandboxes** instead of the old "Test mode" toggle:

1. Click the **account picker** (your business name, top-left) → **Sandboxes**, then
   create or open a sandbox — this is the current test environment.
2. With the sandbox open, go to **Developers** (sidebar, bottom-left) → **API keys**.
3. Copy the keys (inside a sandbox they are automatically test keys):
   - **Publishable key** — `pk_test_...`
   - **Secret key** — `sk_test_...` (click to reveal)

## 2. Set the environment

Add to `config/env/.env.local` (or your secret store):

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
# Webhook secret comes from step 3
STRIPE_WEBHOOK_SECRET=whsec_...

# Optional — pin a provider explicitly; otherwise auto-detected from key presence
BILLING_PROVIDER=stripe
BILLING_CURRENCY=usd

# Map your plan rows to Stripe Price IDs (price_..., not product_...)
PLAN_FREE_ID=price_...
PLAN_PRO_ID=price_...
PLAN_ENTERPRISE_ID=price_...

# Redirect targets (sensible localhost defaults are applied if omitted)
BILLING_CHECKOUT_SUCCESS_URL=http://localhost:5173/billing/success
BILLING_CHECKOUT_CANCEL_URL=http://localhost:5173/pricing
BILLING_PORTAL_RETURN_URL=http://localhost:5173/settings/billing
```

**Auto-enable behavior** (`main/server/system/src/config/services/billing.ts`):

- `config.billing.enabled` becomes `true` only when both `STRIPE_SECRET_KEY` and
  `STRIPE_PUBLISHABLE_KEY` are present.
- In **development**, missing keys silently disable billing (no crash).
- In **production**, an explicit `BILLING_PROVIDER=stripe` with missing keys, or a
  missing `STRIPE_WEBHOOK_SECRET`, fails startup validation by design.

## 3. Forward webhooks in development

Stripe cannot reach `localhost`, so use the [Stripe CLI](https://stripe.com/docs/stripe-cli):

```bash
stripe login
stripe listen --forward-to localhost:8080/api/webhooks/stripe
```

`stripe listen` prints a signing secret (`whsec_...`) — put it in
`STRIPE_WEBHOOK_SECRET` and restart the server. The webhook route only registers
when billing is enabled and verifies every payload's `stripe-signature` against
this secret.

## 4. Verify end-to-end

With the server (`:8080`), web (`:5173`), and `stripe listen` all running:

1. **Checkout** — open `/pricing`, pick a paid plan, complete Stripe Checkout with
   the test card `4242 4242 4242 4242` (any future expiry / any CVC).
2. **Webhook → DB** — `stripe listen` logs `customer.subscription.created` and
   `invoice.paid`; the server logs `Created subscription from webhook`. Confirm a
   row in `subscriptions` with `status = 'active'` for your user.
3. **Payment emails** — `stripe trigger invoice.payment_failed` only proves the
   endpoint receives + signature-verifies events; its synthetic invoice is not
   linked to a subscription in your DB, so no dunning email sends. To actually
   exercise the dunning emails, use **Billing → Subscriptions → Simulations**
   (test clocks): advance a real sandbox subscription to renewal with a failing
   card (`4000 0000 0000 0341`) to fire a real `invoice.payment_failed`, then pay
   the past-due invoice to fire `invoice.paid`. (See [payment emails](#payment-emails) below.)
4. **Portal** — from `/settings/billing`, open the billing portal and cancel; confirm
   `customer.subscription.deleted` flips the row to `canceled`.

### Trigger specific events

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

## 5. Going live

Swap test keys for live keys (`sk_live_...`, `pk_live_...`), register a production
webhook endpoint at `https://<your-domain>/api/webhooks/stripe` in the Stripe
Dashboard, and copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
`STRIPE_WEBHOOK_SECRET` is mandatory in production.

## Payment emails

The Stripe webhook sends transactional + in-app notifications on dunning
transitions (`main/server/core/src/billing/billing-notifier.ts`), fired
**after** the webhook DB transaction commits:

| Event                           | Subscription transition | Notification      |
| ------------------------------- | ----------------------- | ----------------- |
| `invoice.payment_failed`        | → `past_due`            | Payment failed    |
| `invoice.paid`                  | `past_due` → `active`   | Payment recovered |
| `customer.subscription.deleted` | → `canceled`            | Account suspended |

Emails require an `EmailService` (console provider in dev logs them; SMTP in prod).
They are best-effort: a send failure is logged and never breaks webhook processing.

## Tests

- Webhook signature accept / tamper / wrong-secret / replay-idempotency:
  `main/apps/server/.../*stripe*webhook*.real-db.test.ts` (in `pnpm test:real-db`).
- Notifier unit tests: `main/server/core/src/billing/billing-notifier.test.ts`.
