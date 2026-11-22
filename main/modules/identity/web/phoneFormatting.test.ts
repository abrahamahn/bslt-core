// main/modules/identity/web/phoneFormatting.test.ts
import { describe, expect, it } from 'vitest';

import { formatInternationalPhoneInput, normalizeInternationalPhoneInput } from './phoneFormatting';

describe('phoneFormatting', () => {
  it('REJECTS non-digit noise and whitespace-only input by normalizing to empty string', () => {
    expect(normalizeInternationalPhoneInput('')).toBe('');
    expect(normalizeInternationalPhoneInput('   ')).toBe('');
    expect(normalizeInternationalPhoneInput(' + ')).toBe('');
    expect(normalizeInternationalPhoneInput('abc-()-xyz')).toBe('');
    expect(formatInternationalPhoneInput('abc')).toBe('');
  });

  it('CLAMPS inputs exceeding 15 E.164 digits and ignores trailing overflow digits', () => {
    expect(normalizeInternationalPhoneInput('+12345678901234567890')).toBe('+123456789012345');
    expect(formatInternationalPhoneInput('+44123456789012345678')).toBe('+44 123 4567 8901 23');
  });

  it('HANDLES incomplete partial phone prefixes without crashing or inventing digits', () => {
    expect(formatInternationalPhoneInput('+')).toBe('+');
    expect(formatInternationalPhoneInput('+1')).toBe('+1');
    expect(formatInternationalPhoneInput('+7')).toBe('+7');
    expect(formatInternationalPhoneInput('55')).toBe('(55');
    expect(formatInternationalPhoneInput('55512')).toBe('(555) 12');
    expect(normalizeInternationalPhoneInput('55512')).toBe('55512');
  });

  it('formats and normalizes valid NANP and international numbers', () => {
    expect(formatInternationalPhoneInput('+15551234567')).toBe('+1 (555) 123-4567');
    expect(formatInternationalPhoneInput('5551234567')).toBe('(555) 123-4567');
    expect(formatInternationalPhoneInput('15551234567')).toBe('+1 (555) 123-4567');
    expect(formatInternationalPhoneInput('+442079460958')).toBe('+44 2079 460 958');
    expect(formatInternationalPhoneInput('+79991234567')).toBe('+7 9991 234 567');
    expect(normalizeInternationalPhoneInput('(555) 123-4567')).toBe('+15551234567');
    expect(normalizeInternationalPhoneInput('1 (555) 123-4567')).toBe('+15551234567');
  });
});
