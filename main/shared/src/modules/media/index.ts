// main/shared/src/modules/media/index.ts
/**
 * Media Shared Utilities
 *
 * This module provides unified abstractions for media processing,
 * file type detection, and validation.
 *
 * @module Modules/Media
 */

export {
  detectFileType,
  detectFileTypeFromPath,
  generateFileId,
  getMimeType,
  isAllowedFileType,
  parseAudioMetadataFromBuffer,
  sanitizeFilename,
  validateUploadConfig,
  type AudioMetadata,
} from './media';

export type {
  AudioProcessingOptions,
  ContentModerationResult,
  FileTypeResult,
  ImageProcessingOptions,
  MediaMetadata,
  MediaProcessingOptions,
  ProcessingResult,
  SecurityScanResult,
  UploadConfig,
  VideoProcessingOptions,
} from './media.types';
