// main/kernel/server/src/logger/dev.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLineStreamHandler,
  createTurboLineProcessor,
  isTurboSummaryLine,
  logLine,
  normalizePostgresComposeLine,
  normalizeServerLine,
  normalizeTurboLine,
  renderSectionHeader,
  renderStartupBanner,
  shouldSuppressServerLine,
} from './dev';

describe('dev logger helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeServerLine', () => {
    it('normalizes EnvLoader lines to env scope', () => {
      const out = normalizeServerLine('[EnvLoader] Loading stage: development');
      expect(out).toEqual({
        handled: true,
        scope: 'env',
        level: 'info',
        message: 'Loading stage: development',
      });
    });

    it('normalizes bracketed server status lines', () => {
      const out = normalizeServerLine('[16:02:11] WARN  Server listening on http://0.0.0.0:8080');
      expect(out).toEqual({
        handled: true,
        scope: 'server',
        level: 'warn',
        time: '16:02:11',
        message: 'Server listening on http://0.0.0.0:8080',
      });
    });

    it('normalizes ISO bracketed server lines and drops duplicate prefix', () => {
      const out = normalizeServerLine('[2026-03-06T06:11:31.679Z] INFO  Startup Summary');
      expect(out).toEqual({
        handled: true,
        scope: 'server',
        level: 'info',
        message: 'Startup Summary',
      });
    });

    it('maps bracketed HTTP marker line to readable label', () => {
      const out = normalizeServerLine('[16:02:25] INFO  |');
      expect(out).toEqual({
        handled: true,
        scope: 'server',
        level: 'info',
        time: '16:02:25',
        message: 'HTTP request log',
      });
    });

    it('formats JSON/indented lines as server-scoped info messages', () => {
      expect(normalizeServerLine('{')).toMatchObject({
        handled: true,
        scope: 'server',
        level: 'info',
      });
      expect(normalizeServerLine('  "path": "/api/auth/refresh",')).toMatchObject({
        handled: true,
        scope: 'server',
        level: 'info',
      });
      expect(normalizeServerLine('}')).toMatchObject({
        handled: true,
        scope: 'server',
        level: 'info',
      });
    });

    it('maps the label level of a server JSON line', () => {
      const out = normalizeServerLine(
        '{"level":"error","time":"2026-01-15T10:30:00.000Z","msg":"x"}',
      );
      expect(out).toEqual({ handled: true, scope: 'server', level: 'error', message: 'x' });
      expect(normalizeServerLine('{"level":"warn","msg":"w"}').level).toBe('warn');
      expect(normalizeServerLine('{"level":"fatal","msg":"f"}').level).toBe('error');
    });

    it('compacts JSON log lines and maps level/severity', () => {
      const out = normalizeServerLine(
        '{"level":"error","time":"2026-02-24T11:51:30.783Z","task":"usage-snapshot","affectedCount":0,"msg":"Scheduled task failed"}',
      );
      expect(out).toEqual({
        handled: true,
        scope: 'server',
        level: 'error',
        message: '[Usage Snapshot] Scheduled task failed (affectedCount=0)',
      });
    });

    it('normalizes category slug labels to title case', () => {
      const out = normalizeServerLine(
        '{"level":"info","category":"infrastructuer-logger","msg":"Boot complete"}',
      );
      expect(out).toEqual({
        handled: true,
        scope: 'server',
        level: 'info',
        message: '[Infrastructure Logger] Boot complete',
      });
    });

    it('defaults unknown server lines to info scoped server message', () => {
      const out = normalizeServerLine('Queue server started');
      expect(out).toEqual({
        handled: true,
        scope: 'server',
        level: 'info',
        message: 'Queue server started',
      });
    });
  });

  describe('isTurboSummaryLine', () => {
    it('detects turbo summary lines', () => {
      expect(isTurboSummaryLine('• turbo 2.8.3')).toBe(true);
      expect(isTurboSummaryLine('Tasks: 2 successful, 2 total')).toBe(true);
      expect(isTurboSummaryLine('Cached: 0 cached, 2 total')).toBe(true);
    });

    it('ignores non-summary lines', () => {
      expect(isTurboSummaryLine('VITE v7.3.1 ready in 284 ms')).toBe(false);
      expect(isTurboSummaryLine('Server listening on http://0.0.0.0:8080')).toBe(false);
    });
  });

  describe('normalizeTurboLine', () => {
    it('normalizes scoped turbo lines to package scope', () => {
      const out = normalizeTurboLine('@bslt/web:dev: > vite', false);
      expect(out).toEqual({
        scope: 'web',
        level: 'info',
        message: 'Starting Vite dev server',
      });
    });

    it('strips duplicate vite time prefixes inside scoped lines', () => {
      const out = normalizeTurboLine('@bslt/web:dev: 3:17:35 PM [vite] server restarted.', false);
      expect(out).toEqual({
        scope: 'web',
        level: 'info',
        message: '[vite] server restarted.',
      });
    });
  });

  describe('normalizePostgresComposeLine', () => {
    it('normalizes postgres structured logs and strips docker prefix', () => {
      const out = normalizePostgresComposeLine(
        'bslt-dev-postgres  | 2026-03-06 06:24:29.384 UTC [27] LOG:  checkpoint starting: time',
      );
      expect(out).toEqual({
        scope: 'postgres',
        level: 'info',
        message: 'checkpoint starting: time',
      });
    });

    it('normalizes docker container lifecycle lines', () => {
      const out = normalizePostgresComposeLine('Container bslt-dev-postgres Running');
      expect(out).toEqual({
        scope: 'postgres',
        level: 'info',
        message: 'Container bslt-dev-postgres Running',
      });
    });

    it('drops empty/noise-only postgres lines', () => {
      expect(normalizePostgresComposeLine('bslt-dev-postgres  | ')).toBeNull();
      expect(normalizePostgresComposeLine('   ')).toBeNull();
    });
  });

  describe('shouldSuppressServerLine', () => {
    it('suppresses schedule spam by default', () => {
      expect(shouldSuppressServerLine('Starting scheduled task', {})).toBe(true);
      expect(shouldSuppressServerLine('Scheduled task completed', {})).toBe(true);
      expect(shouldSuppressServerLine('Infra phase bootstrapped', {})).toBe(false);
    });

    it('keeps all lines when verbose schedule mode is enabled', () => {
      expect(
        shouldSuppressServerLine('Starting scheduled task', {
          DEV_LOG_VERBOSE_SCHEDULE: '1',
        }),
      ).toBe(false);
    });
  });

  describe('createLineStreamHandler', () => {
    it('buffers partial chunks and emits complete lines', () => {
      const lines: string[] = [];
      const stream = createLineStreamHandler((line) => lines.push(line));
      stream.push('line-a');
      stream.push('\nline-b\nline');
      stream.push('-c');
      stream.flush();

      expect(lines).toEqual(['line-a', 'line-b', 'line-c']);
    });
  });

  describe('createTurboLineProcessor', () => {
    it('compacts vite-proxy multi-line blocks and suppresses immediate duplicate trace lines', () => {
      const processor = createTurboLineProcessor();

      expect(processor.push('@bslt/web:dev: [vite-proxy] upstream error {')).toEqual([]);
      expect(processor.push("@bslt/web:dev:   target: 'http://127.0.0.1:8080',")).toEqual([]);
      expect(
        processor.push("@bslt/web:dev:   error: 'connect ECONNREFUSED 127.0.0.1:8080',"),
      ).toEqual([]);
      expect(processor.push("@bslt/web:dev:   method: 'POST',")).toEqual([]);
      expect(processor.push("@bslt/web:dev:   path: '/api/auth/refresh'")).toEqual([]);

      expect(processor.push('@bslt/web:dev: }')).toEqual([
        {
          scope: 'web',
          level: 'error',
          message:
            '[vite-proxy] upstream ECONNREFUSED POST /api/auth/refresh -> http://127.0.0.1:8080',
        },
      ]);

      expect(
        processor.push('@bslt/web:dev: 3:17:35 PM [vite] http proxy error: /api/auth/refresh'),
      ).toEqual([]);
      expect(processor.push('@bslt/web:dev: Error: connect ECONNREFUSED 127.0.0.1:8080')).toEqual(
        [],
      );
      expect(
        processor.push(
          '@bslt/web:dev:     at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16)',
        ),
      ).toEqual([]);
      expect(processor.push('@bslt/web:dev: 3:17:35 PM [vite] server restarted.')).toEqual([
        {
          scope: 'web',
          level: 'info',
          message: '[vite] server restarted.',
        },
      ]);
    });
  });

  describe('logLine', () => {
    it('renders stable left columns with explicit time', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      logLine('server', 'Server listening on http://0.0.0.0:8080', 'warn', '16:02:11');

      const line = String(spy.mock.calls[0]?.[0] ?? '');
      expect(line).toContain('16:02:11');
      expect(line).toContain('WARN ');
      expect(line).toContain('server  ');
      expect(line).toContain('Server listening on http://0.0.0.0:8080');
    });
  });

  describe('banner and section rendering', () => {
    it('renders section headers via shared logger helper', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      renderSectionHeader('Development Environment', 'Preparing local services');

      expect(spy).toHaveBeenCalledTimes(4);
      expect(String(spy.mock.calls[1]?.[0] ?? '')).toContain('Development Environment');
      expect(String(spy.mock.calls[2]?.[0] ?? '')).toContain('Preparing local services');
    });

    it('renders startup banner content through shared helper', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const startedAt = new Date('2026-03-06T07:00:00.000Z');

      renderStartupBanner({
        mode: 'Mode: @bslt/server + @bslt/web',
        startedAt,
        clearScreen: false,
      });

      const rendered = stdoutSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
      expect(rendered).toContain('Your App');
      expect(rendered).toContain('Development Environment');
      expect(rendered).toContain('Mode: @bslt/server + @bslt/web');
      expect(rendered).toContain('Press Ctrl+C to stop all dev processes');
      expect(rendered).toContain(`Started: ${startedAt.toLocaleString()}`);
    });
  });
});
