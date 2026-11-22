// tests/e2e/specs/system/a11y.e2e.ts
/**
 * Accessibility Gate (axe-core)
 *
 * Runs axe against the core real-server pages — login, register, dashboard, and
 * settings — and fails on any CRITICAL or SERIOUS violation (plan section 12.7).
 */

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createAndLoginE2eUser } from '#tests/e2e/fixtures/auth';
import { ensureLoggedOut, suppressCookieConsent } from '#tests/e2e/page-objects/ui';

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';

interface ViolationSummary {
  id: string;
  impact: string;
  help: string;
  targets: string[];
}

async function auditPage(page: Page): Promise<{
  critical: ViolationSummary[];
  serious: ViolationSummary[];
}> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const summarize = (impact: string): ViolationSummary[] =>
    results.violations
      .filter((violation) => violation.impact === impact)
      .map((violation) => ({
        id: violation.id,
        impact,
        help: violation.help,
        targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
      }));

  return { critical: summarize('critical'), serious: summarize('serious') };
}

async function expectNoSeriousOrCriticalViolations(page: Page, pageName: string): Promise<void> {
  const { critical, serious } = await auditPage(page);

  expect(
    critical,
    `${pageName} has critical accessibility violations:\n${JSON.stringify(critical, null, 2)}`,
  ).toEqual([]);
  expect(
    serious,
    `${pageName} has serious accessibility violations:\n${JSON.stringify(serious, null, 2)}`,
  ).toEqual([]);
}

test.describe('Accessibility gate (zero serious or critical violations)', () => {
  test('login page', async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);

    await page.goto('/auth?mode=login');
    await expect(page.getByLabel(/email|username/i).first()).toBeVisible();

    await expectNoSeriousOrCriticalViolations(page, 'login');
  });

  test('register page', async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);

    await page.goto('/auth?mode=register');
    await expect(page.getByLabel(/^Email$/i)).toBeVisible();

    await expectNoSeriousOrCriticalViolations(page, 'register');
  });

  test('dashboard', async ({ page }) => {
    await suppressCookieConsent(page);
    await createAndLoginE2eUser(page, baseURL, 'a11y-dash');

    await page.goto('/dashboard');
    // toBeAttached: side navigation collapses below the tablet breakpoint.
    await expect(page.getByRole('navigation', { name: /primary/i })).toBeAttached();

    await expectNoSeriousOrCriticalViolations(page, 'dashboard');
  });

  test('settings', async ({ page }) => {
    await suppressCookieConsent(page);
    await createAndLoginE2eUser(page, baseURL, 'a11y-settings');

    await page.goto('/settings');
    // toBeAttached: side navigation collapses below the tablet breakpoint.
    await expect(page.getByRole('navigation', { name: /settings sections/i })).toBeAttached();

    await expectNoSeriousOrCriticalViolations(page, 'settings');
  });
});
