// main/client/ui/src/components/ProfileCompletenessCard.tsx
import { Progress } from '../elements/Progress';
import { Text } from '../elements/Text';

import type { ReactElement } from 'react';

export interface ProfileCompletenessCardProps {
  percentage: number;
  /** Display-ready labels for the fields that are not yet filled. */
  missingFields: string[];
  className?: string;
}

export const ProfileCompletenessCard = ({
  percentage,
  missingFields,
  className,
}: ProfileCompletenessCardProps): ReactElement | null => {
  if (percentage >= 100) return null;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <Text size="sm" className="font-medium">
          Profile Completeness
        </Text>
        <Text size="sm" tone="muted">
          {String(percentage)}%
        </Text>
      </div>
      <Progress value={percentage} />
      {missingFields.length > 0 && (
        <Text size="sm" tone="muted" className="mt-2">
          Missing: {missingFields.join(', ')}
        </Text>
      )}
    </div>
  );
};
