// main/modules/audit/web/format.ts
import type { ActivityEntry, AuditSeverity } from '../contract';

type AuditBadgeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const ACTION_LABELS: Readonly<Record<string, string>> = {
  'user.login': 'Signed in',
  'user.logout': 'Signed out',
  'user.register': 'Created account',
  'user.password.changed': 'Changed password',
  'user.profile.updated': 'Updated profile',
  'user.username.changed': 'Changed username',
  'billing.subscription.canceled': 'Canceled subscription',
  'billing.subscription.resumed': 'Resumed subscription',
  'billing.plan.changed': 'Changed plan',
  'billing.payment.succeeded': 'Payment succeeded',
  'billing.payment.failed': 'Payment failed',
  'billing.payment_method.added': 'Added payment method',
  'billing.payment_method.removed': 'Removed payment method',
  'billing.payment_method.default_changed': 'Changed default payment method',
};

export function formatAuditDateTime(iso: string): string {
  if (iso === '') return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatAuditTimeAgo(iso: string, now: Date = new Date()): string {
  if (iso === '') return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';

  const diffSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${String(diffHours)}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${String(diffDays)}d ago`;
  return formatAuditDateTime(iso);
}

export function truncateAuditText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export function auditSeverityTone(severity: AuditSeverity): AuditBadgeTone {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'danger';
    case 'warn':
      return 'warning';
    case 'info':
      return 'info';
  }
}

export function securitySeverityTone(severity: string): AuditBadgeTone {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low':
      return 'info';
    default:
      return 'neutral';
  }
}

export function actorTypeTone(actorType: string): AuditBadgeTone {
  return actorType === 'system' ? 'warning' : 'info';
}

function humanizeAuditToken(value: string): string {
  return value
    .replace(/[._-]+/gu, ' ')
    .split(' ')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatSecurityEventType(eventType: string): string {
  if (eventType.trim() === '') return 'Unknown';
  return humanizeAuditToken(eventType);
}

export function formatActivityActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanizeAuditToken(action);
}

export function formatActivitySummary(activity: ActivityEntry): string | null {
  if (activity.description !== null && activity.description !== '') {
    return activity.description;
  }
  if (activity.resourceType === '') {
    return null;
  }
  const label = humanizeAuditToken(activity.resourceType);
  if (activity.resourceId === '' || activity.resourceType === 'session') {
    return label;
  }
  return `${label} #${activity.resourceId.slice(0, 8)}`;
}
