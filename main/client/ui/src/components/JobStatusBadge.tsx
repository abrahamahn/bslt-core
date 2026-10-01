// main/client/ui/src/components/JobStatusBadge.tsx
import { getJobStatusLabel, getJobStatusTone, type JobStatus } from '@bslt/shared/core/jobs';

import { Badge } from '../elements/Badge';

import type { ReactElement } from 'react';

export interface JobStatusBadgeProps {
  status: JobStatus;
}

export const JobStatusBadge = ({ status }: JobStatusBadgeProps): ReactElement => {
  return <Badge tone={getJobStatusTone(status)}>{getJobStatusLabel(status)}</Badge>;
};
