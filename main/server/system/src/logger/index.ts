// main/server/system/src/logger/index.ts

export {
  colorize,
  levelToColor,
  nowHHMMSS,
  padLevel,
  USE_COLOR,
  type ColorName,
} from './formatter';

export {
  createJobCorrelationId,
  createJobLogger,
  createLogger,
  createRequestLogger,
  developmentFormatter,
  serializeError,
} from './logger';

export type { Logger } from '@bslt/shared/system';
