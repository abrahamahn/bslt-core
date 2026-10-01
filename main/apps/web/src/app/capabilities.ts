// Edition availability is fixed at export time; runtime flags cannot add missing code.
export function isBillingEnabled(): boolean {
  return false;
}
export function isActivityFeedEnabled(): boolean {
  return false;
}
export function isTeamsEnabled(): boolean {
  return false;
}
export function isAdvancedAdminEnabled(): boolean {
  return false;
}
export function isDeveloperToolsEnabled(): boolean {
  return false;
}
export function isDeveloperChromeEnabled(): boolean {
  return false;
}
export function isMediaEnabled(): boolean {
  return false;
}
export function isAdvancedAuthEnabled(): boolean {
  const value: unknown = import.meta.env['VITE_ENABLE_ADVANCED_AUTH'];
  return (
    value === true ||
    (typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()))
  );
}
