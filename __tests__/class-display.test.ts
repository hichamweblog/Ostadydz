import { describe, expect, it } from 'vitest';
import { compactClassName } from '../lib/class-display';

describe('compactClassName', () => {
  it('uses familiar Algerian class abbreviations', () => {
    expect(compactClassName('3 علوم تجريبية 1')).toBe('3 ع ت 1');
    expect(compactClassName('2 آداب وفلسفة 2')).toBe('2 آ ف 2');
  });

  it('keeps already compact names readable', () => {
    expect(compactClassName('3 ع ت 1')).toBe('3 ع ت 1');
  });
});
