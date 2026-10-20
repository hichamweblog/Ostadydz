import { describe, expect, it } from 'vitest';
import { getLocalDateString, normalizeDateToIso, normalizeTime } from '@/lib/date-utils';

describe('getLocalDateString', () => {
  it('formats a date without converting it to UTC', () => {
    expect(getLocalDateString(new Date(2026, 8, 18, 23, 59))).toBe('2026-09-18');
  });
});

describe('normalizeDateToIso', () => {
  it('converts Algerian DD/MM/YYYY dates to ISO YYYY-MM-DD', () => {
    expect(normalizeDateToIso('15/06/2008')).toBe('2008-06-15');
    expect(normalizeDateToIso('05/11/2007')).toBe('2007-11-05');
    expect(normalizeDateToIso('24-07-2008')).toBe('2008-07-24');
  });

  it('preserves already valid ISO YYYY-MM-DD dates', () => {
    expect(normalizeDateToIso('2008-06-15')).toBe('2008-06-15');
    expect(normalizeDateToIso('2007/11/05')).toBe('2007-11-05');
  });

  it('converts Arabic-Indic numerals', () => {
    expect(normalizeDateToIso('١٥/٠٦/٢٠٠٨')).toBe('2008-06-15');
  });

  it('handles Date objects', () => {
    expect(normalizeDateToIso(new Date(2008, 5, 15))).toBe('2008-06-15');
  });

  it('handles Excel serial dates', () => {
    // 39614 = 2008-06-15
    expect(normalizeDateToIso(39614)).toBe('2008-06-15');
  });

  it('returns null for null, undefined, empty, or unparseable input', () => {
    expect(normalizeDateToIso(null)).toBeNull();
    expect(normalizeDateToIso(undefined)).toBeNull();
    expect(normalizeDateToIso('')).toBeNull();
    expect(normalizeDateToIso('   ')).toBeNull();
    expect(normalizeDateToIso('غير محدد')).toBeNull();
    expect(normalizeDateToIso('99/99/9999')).toBeNull();
  });
});

describe('normalizeTime', () => {
  it('formats various time strings to standard HH:MM', () => {
    expect(normalizeTime('8:00')).toBe('08:00');
    expect(normalizeTime('08:00')).toBe('08:00');
    expect(normalizeTime('08:00:00')).toBe('08:00');
    expect(normalizeTime('14:30:45')).toBe('14:30');
    expect(normalizeTime('23:59')).toBe('23:59');
  });

  it('handles Arabic-Indic numerals', () => {
    expect(normalizeTime('٠٨:٣٠')).toBe('08:30');
    expect(normalizeTime('١٤:٠٠')).toBe('14:00');
  });

  it('returns null for invalid or unparseable time strings', () => {
    expect(normalizeTime(null)).toBeNull();
    expect(normalizeTime(undefined)).toBeNull();
    expect(normalizeTime('')).toBeNull();
    expect(normalizeTime('not a time')).toBeNull();
    expect(normalizeTime('25:00')).toBeNull();
    expect(normalizeTime('12:60')).toBeNull();
  });
});
