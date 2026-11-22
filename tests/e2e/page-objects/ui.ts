// tests/e2e/page-objects/ui.ts
import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function dismissCookieConsent(page: Page): Promise<void> {
  const banner = page.getByTestId('cookie-consent-banner');
  if ((await banner.count()) === 0) {
    return;
  }

  const acceptAll = page.getByRole('button', { name: /^Accept All$/i });
  if (await acceptAll.isVisible()) {
    await acceptAll.click();
    await expect(banner).toHaveCount(0);
  }
}

export async function suppressCookieConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('cookie-consent-dismissed', 'true');
  });
}

export async function ensureLoggedOut(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.addInitScript(() => {
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('access_token');
    window.localStorage.removeItem('auth_token');
    window.localStorage.removeItem('cookie-consent-dismissed');
    window.localStorage.setItem('cookie-consent-dismissed', 'true');
  });

  // Best-effort server-side cleanup with a strict timeout to avoid 30s test stalls.
  try {
    await page.request.post('/api/auth/logout', {
      failOnStatusCode: false,
      timeout: 2000,
    });
  } catch {
    // Ignore cleanup failures; cookie/localStorage reset above is the primary precondition.
  }
}

// The web app's own fallback (DEFAULT_APP_NAME in main/apps/web/src/config.ts),
// shown when VITE_APP_NAME is unset or blank.
const WEB_DEFAULT_APP_NAME = 'Your App';

/**
 * The brand name the web app renders in its chrome.
 *
 * The name is configuration (`VITE_APP_NAME`; `pnpm bootstrap` and
 * `bslt rename` set it), so specs must not hard-code one. The Playwright
 * config loads config/env into process.env before it starts Vite, and Vite
 * lets process.env override its env files, so this reads the same value the
 * dev server serves. Resolution mirrors `createClientConfig()`.
 */
export function configuredAppName(): string {
  const configured = process.env['VITE_APP_NAME']?.trim();
  return configured !== undefined && configured !== '' ? configured : WEB_DEFAULT_APP_NAME;
}

// AppShell.css hides the top bar's brand on phones narrower than 30rem, to
// fit the bar's buttons on one row.
const BRAND_HIDDEN_MAX_WIDTH_PX = 480;

/**
 * The app chrome is up: the top bar carries the brand. Scoped to the top bar
 * because the landing page under the auth modal repeats the brand as its own
 * h1. On small phones the brand is rendered but hidden by CSS, so there it
 * must be present rather than visible.
 */
export async function expectAppShell(page: Page): Promise<void> {
  const topPanel = page.getByTestId('app-top-panel');
  await expect(topPanel).toBeVisible();
  const brand = topPanel.getByRole('heading', {
    level: 1,
    name: configuredAppName(),
    exact: true,
    includeHidden: true,
  });
  const width = page.viewportSize()?.width ?? Number.POSITIVE_INFINITY;
  if (width <= BRAND_HIDDEN_MAX_WIDTH_PX) {
    await expect(brand).toBeAttached();
  } else {
    await expect(brand).toBeVisible();
  }
}

/**
 * The auth modal. /login, /register and /auth?mode=… open it over the landing
 * page, which has its own "Sign in" link and brand heading, so auth-form
 * locators belong inside this dialog.
 */
export function authDialog(page: Page): Locator {
  return page.getByRole('dialog');
}

export interface RegisterFormFields {
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  password: string;
}

/** The register form inside the auth modal (the one holding "Create account"). */
export function registerForm(page: Page): Locator {
  return authDialog(page)
    .locator('form')
    .filter({ has: page.getByRole('button', { name: /create account/i }) });
}

/**
 * Tick every consent the register form requires before it enables submit.
 *
 * Reads the required boxes off the form rather than naming them, so a consent
 * the product adds later (as the age/jurisdiction attestation was) is ticked
 * here without editing every spec. The styled `.checkbox-box` span overlays
 * each input inside its label, so the check is forced; Playwright still
 * verifies the box ends up checked.
 */
export async function acceptRequiredRegistrationConsents(page: Page): Promise<void> {
  const form = registerForm(page);
  const checkboxes = await form.getByRole('checkbox').all();
  let required = 0;
  for (const checkbox of checkboxes) {
    if (await checkbox.evaluate((element) => (element as HTMLInputElement).required)) {
      required += 1;
      await checkbox.check({ force: true });
    }
  }
  expect(required, 'the register form should require at least the ToS consent').toBeGreaterThan(0);
}

/**
 * Open the register form, fill every field and tick every required consent.
 * Submitting is left to the caller, which usually waits on the response.
 */
export async function fillRegisterForm(page: Page, fields: RegisterFormFields): Promise<void> {
  await page.goto('/auth?mode=register');
  const form = registerForm(page);
  await form.getByLabel(/^Email$/i).fill(fields.email);
  await form.getByLabel(/^Username$/i).fill(fields.username);
  await form.getByLabel(/^First Name$/i).fill(fields.firstName ?? 'New');
  await form.getByLabel(/^Last Name$/i).fill(fields.lastName ?? 'User');
  await form.getByLabel(/^Password$/i).fill(fields.password);
  await acceptRequiredRegistrationConsents(page);
}

// The settings page renders its sections as sidebar navigation buttons (not
// ARIA tabs); the active section is reflected by `aria-current="page"` on the
// button and `data-active-tab` on the content panel.
export function settingsSectionPanel(page: Page, sectionId: string): Locator {
  return page.locator(`[data-active-tab="${sectionId}"]`);
}

export async function openSettingsSection(page: Page, sectionId: string): Promise<void> {
  await page.goto(`/settings?tab=${encodeURIComponent(sectionId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings');
  await expect(settingsSectionPanel(page, sectionId)).toBeVisible({ timeout: 15_000 });
}

export async function selectSettingsSection(page: Page, label: string | RegExp): Promise<void> {
  const button = page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: label });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}

export async function expectPathOrRedirect(
  page: Page,
  requestedPath: string,
  extraAllowedPaths: string[] = [],
): Promise<void> {
  const allowed = [requestedPath, '/login', '/auth', ...extraAllowedPaths];
  const pattern = new RegExp(`^(?:${allowed.map(escapeRegex).join('|')})$`);
  await expect.poll(() => new URL(page.url()).pathname).toMatch(pattern);
}

/**
 * Pass the first step of the Danger Zone's sudo modal. Deactivate and delete
 * open one modal in two steps: it names the action and its consequences
 * ("Continue"), then swaps to "Confirm Your Identity" for the password.
 */
export async function continueDangerZoneAction(page: Page, actionTitle: string): Promise<void> {
  const actionStep = page.getByRole('dialog', { name: actionTitle, exact: true });
  await expect(actionStep).toBeVisible({ timeout: 10_000 });
  await actionStep.getByRole('button', { name: 'Continue', exact: true }).click();
}

/**
 * A sign-in to an account inside its deletion grace period. Login succeeds on
 * purpose (it proves ownership so the owner can cancel the deletion), but the
 * session is held on /reactivate: the app stays closed until the owner chooses
 * "Reactivate my account" or signs out.
 */
export async function expectPendingDeletionReactivationPrompt(page: Page): Promise<void> {
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 10_000 }).toBe('/reactivate');
  await expect(page.getByRole('heading', { name: 'Restore your account' })).toBeVisible();
  await expect(page.getByText(/your account is scheduled for deletion/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reactivate my account' })).toBeVisible();
}
