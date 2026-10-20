import { describe, expect, it } from 'vitest';
import { normalizeGradeInput } from '../lib/grade-input';

describe('normalizeGradeInput', () => {
  it('normalizes Arabic-Indic digits and Arabic decimal separator', () => {
    expect(normalizeGradeInput('١٤٫٥')).toBe('14.5');
  });

  it('normalizes Persian digits and comma decimal separator', () => {
    expect(normalizeGradeInput('۱۴,۷۵')).toBe('14.75');
  });

  it('preserves Western decimal input', () => {
    expect(normalizeGradeInput('12.25')).toBe('12.25');
  });
});
