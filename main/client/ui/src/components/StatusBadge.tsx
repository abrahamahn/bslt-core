// main/client/ui/src/components/StatusBadge.tsx
import { getUserStatusLabel, getUserStatusTone, type UserStatus } from '@bslt/shared/core/admin';

import { Badge } from '../elements/Badge';

import type { ReactElement } from 'react';

interface AdminUserLocal {
  lockedUntil: string | null;
  emailVerified: boolean;
}

export interface StatusBadgeProps {
  status: UserStatus;
}

export function getUserStatus(user: AdminUserLocal): UserStatus {
  const now = new Date();

  if (
    user.lockedUntil !== null &&
    user.lockedUntil.length > 0 &&
    new Date(user.lockedUntil) > now
  ) {
    return 'locked';
  }

  if (!user.emailVerified) {
    return 'unverified';
  }

  return 'active';
}

export const StatusBadge = ({ status }: StatusBadgeProps): ReactElement => {
  return <Badge tone={getUserStatusTone(status)}>{getUserStatusLabel(status)}</Badge>;
};
