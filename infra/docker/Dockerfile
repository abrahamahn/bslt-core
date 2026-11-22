# syntax=docker/dockerfile:1
# The Node.js version is pinned in /.node-version. This default must equal it
# (the version-pins merge gate checks), so a build needs no build arg.
ARG NODE_VERSION=24.22.3

# =============================================================================
# Base Stage - Common dependencies and configuration
# =============================================================================
FROM node:${NODE_VERSION}-alpine AS base

# Install security updates and required packages.
# `git` is required because workspace `prepare` hooks run during `pnpm install`.
RUN apk update && \
    apk upgrade && \
    apk add --no-cache dumb-init git && \
    rm -rf /var/cache/apk/*

# Enable pnpm via corepack
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_PATH=/pnpm/store
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN mkdir -p /pnpm/store

WORKDIR /app

# =============================================================================
# Dependencies Stage - Fetch and cache dependencies
# =============================================================================
FROM base AS deps

# Copy only package files for better layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY main/apps/server/package.json main/apps/server/
COPY main/kernel/comms/package.json main/kernel/comms/
COPY main/kernel/contract/package.json main/kernel/contract/
COPY main/kernel/db/package.json main/kernel/db/
COPY main/kernel/protocols/package.json main/kernel/protocols/
COPY main/kernel/realtime/package.json main/kernel/realtime/
COPY main/kernel/schema/package.json main/kernel/schema/
COPY main/kernel/server/package.json main/kernel/server/
COPY main/kernel/storage/package.json main/kernel/storage/
COPY main/modules/audit/package.json main/modules/audit/
COPY main/modules/compliance/package.json main/modules/compliance/
COPY main/modules/devtools/package.json main/modules/devtools/
COPY main/modules/identity/package.json main/modules/identity/

# Fetch production dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm fetch --prod

# =============================================================================
# Build Stage - Compile TypeScript and prepare deployment
# =============================================================================
FROM base AS build

WORKDIR /app

ENV CI=true

# Copy cached pnpm store from deps stage
COPY --from=deps /pnpm/store /pnpm/store

# Copy all source files
COPY . .

# `@bslt/server...` is pnpm's "package and its dependencies" selector, so build
# order and deployed workspace packages are derived directly from the declared
# dependency graph (`@bslt/comms`, `@bslt/db`, `@bslt/realtime`, `@bslt/storage`,
# installed modules, etc.).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile && \
    pnpm --filter "@bslt/server..." build && \
    pnpm --filter @bslt/server deploy --prod --legacy /app/server-deploy

# Verify every deployed `@bslt/*` package produced its compiled `dist` output.
RUN for d in /app/server-deploy/node_modules/@bslt/*/; do \
      ls "$d/dist/"*.js >/dev/null 2>&1 || { echo "MISSING dist: $d"; exit 1; }; \
    done; echo "all @bslt packages have a dist"

# =============================================================================
# Production Stage - Minimal runtime image with security hardening
# =============================================================================
FROM node:${NODE_VERSION}-alpine AS runner

# Install security updates, dumb-init for proper signal handling, and ffmpeg for @bslt/files media processing
RUN apk update && \
    apk upgrade && \
    apk add --no-cache dumb-init ffmpeg && \
    rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Runtime image does not need package managers; remove to reduce vuln surface.
RUN rm -rf /usr/local/lib/node_modules/npm && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Copy built application from build stage
COPY --from=build --chown=nodejs:nodejs /app/server-deploy/ .
COPY --from=build --chown=nodejs:nodejs /app/bslt.lock.json ./bslt.lock.json

# The migrate one-shot (`node node_modules/@bslt/db/dist/migrate/entry.js`) applies
# the baselines @bslt/db (`sql`) and installed modules (`server/migrations`) ship.
# They are SQL, so nothing compiles or imports them: a source missing from the
# image would fail the first deploy, not this build. Read every source through the
# package, the way the entry does.
RUN node --input-type=module -e "const db = await import('@bslt/db'); for (const source of db.migrationSources()) await db.readSourceFiles(source);" || \
      { echo "CANNOT READ the migration sources of @bslt/db"; exit 1; }

# Load kernel packages directly from the production image so any missing runtime
# dependency (`ws`, `web-push`, etc.) fails image build instead of boot.
RUN for p in comms realtime; do \
      node --input-type=module -e "await import('@bslt/$p')" || \
        { echo "CANNOT LOAD kernel package: @bslt/$p"; exit 1; }; \
    done

# Passwords are hashed with node:crypto argon2 (Node 24.7 or later, on OpenSSL
# 3.2 or later). Without it the server would fail at boot; fail the build instead.
RUN node -e "process.exit(typeof require('node:crypto').argon2 === 'function' ? 0 : 1)" || \
      { echo "node:crypto has no argon2: the server cannot hash passwords"; exit 1; }

RUN ffmpeg -version >/dev/null && ffprobe -version >/dev/null || \
      { echo "ffmpeg/ffprobe missing in production runner image"; exit 1; }

# Set production environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

# Switch to non-root user
USER nodejs

# Expose application port
EXPOSE 8080

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/src/main.js"]
