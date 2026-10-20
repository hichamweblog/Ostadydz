import { describe, expect, it } from 'vitest';
import {
  calculateContinuousEvaluation,
  calculateStudentAverage
} from '@/lib/grade-calculator';

describe('calculateStudentAverage', () => {
  it('calculates the official average with one quiz', () => {
    expect(calculateStudentAverage(16, 12, 14)).toBe(14);
  });

  it('does not calculate an average when quiz is missing', () => {
    expect(calculateStudentAverage(16, null, 14)).toBeNull();
  });

  it('does not calculate an average when a required mark is missing', () => {
    expect(calculateStudentAverage(16, 12, null)).toBeNull();
  });

  it('rejects marks outside the 0 to 20 range', () => {
    expect(calculateStudentAverage(21, 12, 14)).toBeNull();
    expect(calculateStudentAverage(16, 12, Number.NaN)).toBeNull();
  });

  it('calculates continuous evaluation from four capped components', () => {
    expect(calculateContinuousEvaluation(4, 3.5, 5, 2.25)).toBe(14.75);
    expect(calculateContinuousEvaluation(8, -1, 5, 5)).toBe(15);
  });
});

describe('pedagogical evaluations tiers', () => {
  it('assigns distinctive estimations to EXCELLENT and VERY_GOOD tiers (§3.6)', async () => {
    const { getDefaultEstimation, getScoreTier, PEDAGOGICAL_TIERS } = await import('@/lib/pedagogical-evaluations');
    expect(getScoreTier(19)).toBe('EXCELLENT');
    expect(getDefaultEstimation(19)).toBe('نتائج ممتازة');

    expect(getScoreTier(17)).toBe('VERY_GOOD');
    expect(getDefaultEstimation(17)).toBe('نتائج جيدة جداً');

    expect(PEDAGOGICAL_TIERS.EXCELLENT.defaultEstimation).not.toBe(
      PEDAGOGICAL_TIERS.VERY_GOOD.defaultEstimation
    );
  });
});
