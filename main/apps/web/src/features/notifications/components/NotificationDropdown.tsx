// main/apps/web/src/features/notifications/components/NotificationDropdown.tsx
/**
 * NotificationDropdown
 *
 * Dropdown panel displaying recent notifications with
 * mark-as-read and mark-all-read actions.
 */

import { Button, EmptyState, Heading, Skeleton, Text } from '@bslt/ui';

import type { Notification } from '@bslt/shared/comms/notifications';
import type { ReactElement } from 'react';

import { formatRelativeTime, useLocale } from '@/i18n';

// ============================================================================
// Types
// ============================================================================

export interface NotificationDropdownProps {
  notifications: Notification[];
  isLoading: boolean;
  onMarkAsRead: (ids: string[]) => void;
  onMarkAllAsRead: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onNotificationClick?: (notification: Notification) => void;
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

const LEVEL_STYLES: Record<string, string> = {
  info: 'var(--ui-color-primary)',
  success: 'var(--ui-color-success)',
  warning: 'var(--ui-color-warning)',
  error: 'var(--ui-color-danger)',
};

// ============================================================================
// Component
// ============================================================================

export function NotificationDropdown({
  notifications,
  isLoading,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
  onClose,
  onNotificationClick,
  className,
}: NotificationDropdownProps): ReactElement {
  const locale = useLocale();
  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <div
      className={className}
      role="dialog"
      aria-label="Notifications"
      style={{
        position: 'absolute',
        right: '0',
        top: '100%',
        width: '22rem',
        maxHeight: '28rem',
        overflowY: 'auto',
        background: 'var(--ui-color-surface)',
        border: '1px solid var(--ui-color-border)',
        borderRadius: 'var(--ui-radius-md)',
        zIndex: 50,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3"
        style={{ borderBottom: '1px solid var(--ui-color-border)' }}
      >
        <Heading as="h3" size="sm">
          Notifications
        </Heading>
        <div className="flex gap-2">
          {hasUnread && (
            <Button variant="text" size="small" onClick={onMarkAllAsRead}>
              Mark all read
            </Button>
          )}
          <Button variant="text" size="small" onClick={onClose} aria-label="Close notifications">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton width="100%" height="3rem" radius="var(--ui-radius-md)" />
          <Skeleton width="100%" height="3rem" radius="var(--ui-radius-md)" />
          <Skeleton width="100%" height="3rem" radius="var(--ui-radius-md)" />
        </div>
      )}

      {!isLoading && notifications.length === 0 && (
        <div className="p-4">
          <EmptyState title="All caught up" description="No new notifications" />
        </div>
      )}

      {!isLoading &&
        notifications.map((notification) => (
          <div
            key={notification.id}
            className="p-3"
            style={{
              borderBottom: '1px solid var(--ui-color-border)',
              background: notification.isRead ? 'transparent' : 'var(--ui-color-bg)',
              cursor: 'pointer',
            }}
            onClick={(): void => {
              if (!notification.isRead) {
                onMarkAsRead([notification.id]);
              }
              if (onNotificationClick !== undefined) {
                onNotificationClick(notification);
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e): void => {
              if (e.key === 'Enter') {
                if (!notification.isRead) {
                  onMarkAsRead([notification.id]);
                }
                if (onNotificationClick !== undefined) {
                  onNotificationClick(notification);
                }
              }
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-2">
                  {!notification.isRead && (
                    <span
                      style={{
                        width: '0.5rem',
                        height: '0.5rem',
                        borderRadius: 'var(--ui-radius-full)',
                        background: LEVEL_STYLES[notification.type] ?? 'var(--ui-color-primary)',
                        flexShrink: 0,
                      }}
                      aria-label="Unread"
                    />
                  )}
                  <Text
                    size="sm"
                    className="font-medium"
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {notification.title}
                  </Text>
                </div>
                <Text size="sm" tone="muted" style={{ marginTop: 'var(--ui-gap-xs)' }}>
                  {notification.message}
                </Text>
                <Text
                  size="sm"
                  tone="muted"
                  style={{
                    marginTop: 'var(--ui-gap-xs)',
                    fontSize: 'var(--ui-font-size-xs)',
                  }}
                >
                  {formatRelativeTime(notification.createdAt, locale)}
                </Text>
              </div>
              <Button
                variant="text"
                size="small"
                onClick={(e: React.MouseEvent): void => {
                  e.stopPropagation();
                  onDelete(notification.id);
                }}
                aria-label={`Delete notification: ${notification.title}`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </Button>
            </div>
          </div>
        ))}
    </div>
  );
}
