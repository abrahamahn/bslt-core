// main/apps/web/public/theme-init.js
/**
 * Pre-paint theme resolver. Loaded from <head> BEFORE the critical CSS so an
 * explicit light/dark choice paints correctly from the very first frame — the
 * bundle's useEffect runs far too late to stop the flash.
 *
 * A FILE, not an inline <script>: production serves `script-src 'self'` (see
 * main/shared/src/modules/system/security/csp.ts), which silently blocks inline
 * scripts in production only. index-html.test.ts enforces this.
 *
 * The contract with useThemeMode (main/client/react/src/hooks/useThemeMode.ts),
 * pinned by index-html.test.ts:
 * - The key is 'app-theme-mode' — the storageKey App.tsx passes to ThemeProvider.
 * - useLocalStorage stores JSON, so the value is '"dark"' with quotes: parse it.
 * - 'light'/'dark' → set data-theme, exactly what the hook's effect re-asserts
 *   on mount, so React confirms rather than flips the attribute.
 * - 'system', absent, or corrupt → touch nothing; the hook removes the (absent)
 *   attribute and CSS light-dark() follows the OS preference either way.
 *
 * ES5 on purpose: this runs before any bundle, in whatever browser shows up.
 */
(function () {
  try {
    var stored = window.localStorage.getItem('app-theme-mode');
    if (stored === null) return;
    var mode = JSON.parse(stored);
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    }
  } catch (_error) {
    // Storage denied or corrupt value: leave the OS preference in charge.
  }
})();
