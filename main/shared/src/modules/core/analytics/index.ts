// main/shared/src/modules/core/analytics/index.ts

export {
  ANALYTICS_EVENT_NAME_REGEX,
  ANALYTICS_MAX_BATCH_SIZE,
  ANALYTICS_MAX_EVENT_NAME_LENGTH,
  ANALYTICS_MAX_PROPS_BYTES,
  ANALYTICS_MAX_PROPS_DEPTH,
  track,
  trackEventSchema,
  trackEventsRequestSchema,
  trackEventsResponseSchema,
} from './analytics.schemas';
export type {
  AnalyticsPropValue,
  AnalyticsProps,
  TrackEvent,
  TrackEventsRequest,
  TrackEventsResponse,
} from './analytics.schemas';

export {
  DEFAULT_ANALYTICS_SAMPLE_RATE,
  clampSampleRate,
  isPiiKey,
  prepareEventsForDispatch,
  redactPii,
  shouldSample,
} from './analytics.dispatch';
export type { DispatchResult } from './analytics.dispatch';
