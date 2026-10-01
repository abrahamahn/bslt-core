// main/server/core/src/users/handlers/index.ts
/**
 * Users Handlers
 *
 * Re-exports all handler functions from the users module.
 *
 * @module handlers
 */

// Profile handlers
export { handleMe } from './profile';

// Profile completeness
export { computeProfileCompleteness, handleGetProfileCompleteness } from './profile-completeness';

// Session management
export { listUserSessions, revokeAllSessions, revokeSession, type UserSession } from './sessions';

// Username management
export { handleUpdateUsername } from './username';

// Account lifecycle
export {
  handleDeactivateAccount,
  handleReactivateAccount,
  handleRequestDeletion,
} from './lifecycle';

// Avatar HTTP handlers and service functions
export {
  cacheBustAvatarUrl,
  deleteAvatar,
  getAvatarFallbackUrl,
  getAvatarUrl,
  getGravatarUrl,
  getInitialsAvatarUrl,
  handleDeleteAvatar,
  handleUploadAvatar,
  uploadAvatar,
  type StorageProvider,
} from './avatar';

// Profile & password HTTP handlers and service functions
export {
  changePassword,
  handleChangePassword,
  handleUpdateProfile,
  updateProfile,
  type ProfileUser,
  type UpdateProfileData,
} from './account';
