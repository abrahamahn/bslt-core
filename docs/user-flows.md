# User Flows

This guide explains how the main product surfaces are meant to work together.
Use it as a quick smoke-test script when validating the full-stack app locally.

## Sign In And Activity

1. Sign in from `/login`.
2. Open the dashboard and review the activity feed.
3. Sign out from the account menu.
4. Sign back in and confirm the activity feed includes both `user.login` and `user.logout`.

The activity feed is the user-facing timeline. It should show meaningful account,
billing, task, and security actions rather than only admin audit events.

## Billing

1. Open Billing Settings.
2. Review the current subscription and usage.
3. Add a payment method.
4. In local mock billing, use `Use Test Card`, then save.
5. Confirm the payment method list refreshes and only one default method is active.
6. Review invoices and select an invoice to inspect details.
7. Return to the dashboard or Activity page and confirm billing actions appear
   in the recent activity timeline.
8. Open the notification bell and confirm billing changes create in-app
   notifications for the account.

Payment method setup should feel like one action. The app prepares the setup
intent when the dialog opens; a retry button only appears when preparation fails.

## Admin Overview

1. Sign in as an admin.
2. Open Admin Dashboard.
3. Confirm health, users, tenants, security, jobs, billing, webhooks, feature
   flags, audit, and route manifest signals render without crashing.
4. Use `Refresh All` to confirm each backing API can refresh independently.
5. Open Billing Settings from the normal app area and confirm admin can still use
   regular account billing features.

Admins should be allowed through normal authenticated user flows, while
admin-only routes must stay restricted to admins.

## Common Errors

- `401 Unauthorized`: the access token is missing, expired, or invalid. Sign in again.
- `403 Forbidden`: the route is authenticated but the role or tenant access is not allowed.
- `429 Too Many Requests`: login or security rate limits are active. Wait for the retry window.
- Missing metrics or partial admin payloads should render fallback values, not crash the page.

## Local Smoke Test

Run the app, sign in, and walk this sequence:

1. Dashboard activity.
2. Settings security tab.
3. Billing payment method add flow.
4. Billing invoice detail selection.
5. Admin dashboard overview.
6. Logout and login activity verification.
