#!/usr/bin/env bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Activate Node 24+ if the cloud container defaulted to an older Node major
# (node:crypto argon2 and TypeScript config loading require Node >= 24).
current_node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$current_node_major" -lt 24 ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    nvm install 24 >/dev/null 2>&1 || nvm use 24 >/dev/null 2>&1 || true
  elif command -v fnm >/dev/null 2>&1; then
    fnm install 24 >/dev/null 2>&1 || true
    eval "$(fnm env)" || true
    fnm use 24 >/dev/null 2>&1 || true
  elif command -v mise >/dev/null 2>&1; then
    mise use -g node@24 >/dev/null 2>&1 || true
    eval "$(mise activate bash --shims)" || true
  fi
fi

# Ensure pnpm is available (via corepack when not preinstalled).
if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

# Persist memory-safe Turbo / V8 heap defaults and active PATH for all session commands.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export PATH=\"$PATH\""
    echo "export TURBO_CONCURRENCY=2"
    echo 'export NODE_OPTIONS="--max-old-space-size=4096"'
  } >>"$CLAUDE_ENV_FILE"
fi

pnpm install --frozen-lockfile
