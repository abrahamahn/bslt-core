// main/kernel/storage/src/config.ts
/**
 * Storage configuration is loaded and validated once, at the env parse site
 * (`@bslt/server-system` config `loadStorageConfig`/`validateStorage`), which
 * also supplies the local provider's URL signing secret. This package only
 * owns provider-level defaults.
 */

/** Default maximum file size for storage uploads (10MB) */
export const DEFAULT_STORAGE_MAX_FILE_SIZE = 10 * 1024 * 1024;
