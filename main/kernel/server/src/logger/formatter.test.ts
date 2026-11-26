// main/kernel/server/src/logger/formatter.test.ts
import { describe, expect, it } from 'vitest';

import { colorize, COLORS, levelToColor, nowHHMMSS, padLevel, USE_COLOR } from './formatter';

describe('logger formatter', () => {
  it('maps log levels to colors, pads level labels, formats timestamps, and respects USE_COLOR', () => {
    expect(levelToColor('error')).toBe('red');
    expect(levelToColor('FATAL')).toBe('red');
    expect(levelToColor('warn')).toBe('yellow');
    expect(levelToColor('ok')).toBe('green');
    expect(levelToColor('info')).toBe('blue');
    expect(levelToColor('debug')).toBe('cyan');
    expect(levelToColor('trace')).toBe('gray');
    expect(levelToColor('custom')).toBe('gray');

    expect(padLevel('info')).toBe('INFO ');
    expect(padLevel('error')).toBe('ERROR');
    expect(nowHHMMSS()).toMatch(/^\d{2}:\d{2}:\d{2}$/u);

    const colored = colorize('hello', 'green');
    if (USE_COLOR) {
      expect(colored).toBe(`${COLORS.green}hello${COLORS.reset}`);
    } else {
      expect(colored).toBe('hello');
    }
  });
});
