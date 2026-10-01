// main/shared/src/modules/core/jobs/index.ts

export {
  BatchedQueue,
  QueueFullError,
  type BatchedQueueOptions,
  type BatchProcessResult,
} from './batched.queue';

export {
  calculateBackoff,
  canRetry,
  createJobSchema,
  getJobStatusLabel,
  getJobStatusTone,
  isTerminalStatus,
  jobActionResponseSchema,
  jobDetailsSchema,
  jobErrorSchema,
  jobIdRequestSchema,
  jobListQuerySchema,
  jobListResponseSchema,
  jobSchema,
  jobStatusSchema,
  queueStatsSchema,
  shouldProcess,
  updateJobSchema,
  type CreateJob,
  type DomainJob,
  type Job,
  type JobActionResponse,
  type JobDetails,
  type JobError,
  type JobIdRequest,
  type JobListQuery,
  type JobListResponse,
  type JobPriority,
  type JobStatus,
  type QueueStats,
  type UpdateJob,
} from './jobs';

export { ReactiveMap } from './reactive.map';
