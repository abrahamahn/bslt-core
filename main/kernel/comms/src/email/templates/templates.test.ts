// main/kernel/comms/src/email/templates/templates.test.ts
/**
 * Tests for the billing email templates.
 *
 * Each template is a pure function: it must produce the right subject, embed
 * its parameters in both the text and the branded HTML, and carry the app
 * name through the layout.
 */

import { describe, expect, it } from 'vitest';

import { createEmailTemplates } from './templates';

const templates = createEmailTemplates({ appName: 'Acme' });

describe('email templates — branding', () => {
  it('renders the configured app name into the layout', () => {
    const result = templates.subscriptionCreated('Pro', 'https://app.test/billing');
    expect(result.html).toContain('Acme');
  });
});

describe('subscriptionCreated', () => {
  it('names the plan in the subject and embeds the manage URL', () => {
    const result = templates.subscriptionCreated('Pro', 'https://app.test/billing');
    expect(result.subject).toBe('Your Pro subscription is active');
    expect(result.to).toBe('');
    expect(result.text).toContain('Pro');
    expect(result.text).toContain('https://app.test/billing');
    expect(result.html).toContain('https://app.test/billing');
    expect(result.html).toContain('Pro');
  });
});

describe('subscriptionCanceled', () => {
  it('states the access-until date and the resubscribe URL', () => {
    const result = templates.subscriptionCanceled(
      'Pro',
      'June 30, 2026',
      'https://app.test/pricing',
    );
    expect(result.subject).toBe('Your Pro subscription has been canceled');
    expect(result.text).toContain('June 30, 2026');
    expect(result.text).toContain('https://app.test/pricing');
    expect(result.html).toContain('June 30, 2026');
    expect(result.html).toContain('https://app.test/pricing');
  });
});

describe('paymentFailed', () => {
  it('embeds the amount and the update URL, and mentions the grace period', () => {
    const result = templates.paymentFailed('$29.00', 'https://app.test/billing/payment');
    expect(result.subject).toBe('Payment failed - action required');
    expect(result.text).toContain('$29.00');
    expect(result.text).toContain('https://app.test/billing/payment');
    expect(result.html).toContain('$29.00');
    expect(result.html).toContain('14-day grace period');
  });
});

describe('paymentSucceeded', () => {
  it('embeds the amount and the invoice URL', () => {
    const result = templates.paymentSucceeded('$29.00', 'https://app.test/invoices/inv_1');
    expect(result.subject).toBe('Payment received - $29.00');
    expect(result.text).toContain('$29.00');
    expect(result.text).toContain('https://app.test/invoices/inv_1');
    expect(result.html).toContain('https://app.test/invoices/inv_1');
  });
});

describe('paymentRecovered', () => {
  it('confirms restoration and embeds the manage URL in a branded layout', () => {
    const result = templates.paymentRecovered('https://app.test/settings/billing');
    expect(result.subject).toMatch(/restored/i);
    expect(result.text).toContain('https://app.test/settings/billing');
    expect(result.html).toContain('Subscription Restored');
    expect(result.html).toContain('https://app.test/settings/billing');
  });
});

describe('accountSuspended', () => {
  it('embeds the reason and the resubscribe URL in a branded layout', () => {
    const result = templates.accountSuspended('grace_period_expired', 'https://app.test/pricing');
    expect(result.subject).toMatch(/suspended/i);
    expect(result.text).toContain('grace_period_expired');
    expect(result.html).toContain('Account Suspended');
    expect(result.html).toContain('https://app.test/pricing');
  });
});

describe('workspaceInvitation', () => {
  it('embeds the inviter, workspace, role, and accept URL in a branded layout', () => {
    const result = templates.workspaceInvitation(
      'https://app.test/invitations/inv-1/accept',
      'Design Team',
      'Jane Doe',
      'admin',
    );
    expect(result.subject).toBe("You're invited to join Design Team on Acme");
    expect(result.to).toBe('');
    expect(result.text).toContain('Jane Doe invited you to join Design Team as admin.');
    expect(result.text).toContain('https://app.test/invitations/inv-1/accept');
    expect(result.html).toContain('Acme');
    expect(result.html).toContain('Jane Doe');
    expect(result.html).toContain('https://app.test/invitations/inv-1/accept');
  });

  it('defaults the expiry to 7 days and honors an explicit value', () => {
    const withDefault = templates.workspaceInvitation('https://a.test', 'W', 'I', 'member');
    expect(withDefault.text).toContain('expires in 7 days');
    const explicit = templates.workspaceInvitation('https://a.test', 'W', 'I', 'member', 14);
    expect(explicit.html).toContain('expires in 14 days');
  });

  it('escapes user-controlled workspace, inviter, and role in the HTML', () => {
    const result = templates.workspaceInvitation(
      'https://a.test',
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(2)>',
      '"><b>owner</b>',
    );
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('<img src=x');
    expect(result.html).not.toContain('"><b>');
    expect(result.html).toContain('&lt;script&gt;');
  });
});
