import { describe, expect, it } from 'vitest';

import {
  ARABIC_MONTH_NAMES,
  OFFICIAL_HOLIDAYS_2026_2027,
  addDaysIso,
  findHolidayOnDate,
  formatHolidayDates,
  formatIsoDateAr,
  getExcludedDayLabel,
  holidayCoversDate,
  holidayRange,
  isDateExcluded,
  isoWeekday,
  normalizeCalendarSettings,
  parseIsoDate,
  withDerivedDateStr,
} from '@/lib/academic-calendar';
import { DEFAULT_CALENDAR_SETTINGS } from '@/lib/storage';
import type { AcademicCalendarSettings, OfficialHoliday } from '@/lib/types';

const holiday = (partial: Partial<OfficialHoliday> = {}): OfficialHoliday => ({
  id: 'h-test',
  name: 'يوم مستثنى',
  type: 'national',
  dateStr: '',
  startDate: '2026-12-06',
  ...partial,
});

describe('structured holiday ranges', () => {
  it('covers single days and inclusive ranges', () => {
    const single = holiday({ startDate: '2026-11-01' });
    expect(holidayRange(single)).toEqual({ start: '2026-11-01', end: '2026-11-01' });
    expect(holidayCoversDate(single, '2026-11-01')).toBe(true);
    expect(holidayCoversDate(single, '2026-11-02')).toBe(false);

    const range = holiday({ startDate: '2026-12-06', endDate: '2026-12-10' });
    expect(holidayCoversDate(range, '2026-12-06')).toBe(true);
    expect(holidayCoversDate(range, '2026-12-08')).toBe(true);
    expect(holidayCoversDate(range, '2026-12-10')).toBe(true);
    expect(holidayCoversDate(range, '2026-12-11')).toBe(false);
    expect(holidayCoversDate(range, '2026-12-05')).toBe(false);
  });

  it('ignores legacy entries without structured dates', () => {
    const legacy = holiday({ startDate: undefined, dateStr: 'عطلة فصلية' });
    expect(holidayRange(legacy)).toBeNull();
    expect(holidayCoversDate(legacy, '2026-12-06')).toBe(false);
    expect(isDateExcluded([legacy], '2026-12-06')).toBe(false);
  });

  it('rejects inverted ranges', () => {
    const inverted = holiday({ startDate: '2027-03-10', endDate: '2027-03-02' });
    expect(holidayRange(inverted)).toBeNull();
  });

  it('derives the legacy display text from the structured dates', () => {
    const single = withDerivedDateStr(holiday({ startDate: '2026-11-01' }));
    expect(single.dateStr).toContain('01 نوفمبر 2026');
    expect(single.dateStr).toContain('الأحد');

    const range = withDerivedDateStr(holiday({ startDate: '2026-10-28', endDate: '2026-11-01' }));
    expect(range.dateStr).toContain('من');
    expect(range.dateStr).toContain('إلى');
    expect(formatHolidayDates(range)).toContain('28 أكتوبر 2026');
  });
});

describe('automatic exclusion of holidays and examination days', () => {
  it('finds the covering entry and builds a readable label', () => {
    const exams = holiday({ id: 'h-exam', name: 'اختبارات الفصل الأول', type: 'exam', startDate: '2026-12-06', endDate: '2026-12-10' });
    expect(findHolidayOnDate([exams], '2026-12-07')?.id).toBe('h-exam');
    expect(getExcludedDayLabel([exams], '2026-12-07')).toContain('اختبارات الفصل الأول');
    expect(getExcludedDayLabel([exams], '2026-12-07')).toContain('أيام اختبارات');
    expect(getExcludedDayLabel([exams], '2026-12-11')).toBeNull();
  });

  it('excludes every official 2026/2027 holiday and examination period', () => {
    const holidays = OFFICIAL_HOLIDAYS_2026_2027;
    const excluded = [
      '2026-10-28', // عطلة الخريف
      '2026-11-01', // نوفمبر
      '2026-12-06', // اختبارات الفصل الأول
      '2026-12-10',
      '2026-12-18', // عطلة الشتاء
      '2027-01-01',
      '2027-01-12',
      '2027-03-02', // اختبارات الفصل الثاني
      '2027-03-04',
      '2027-03-07',
      '2027-03-08',
      '2027-03-09', // عيد الفطر
      '2027-03-11',
      '2027-03-19', // عطلة الربيع / عيد النصر
      '2027-04-03',
      '2027-05-01',
      '2027-05-09', // البكالوريا التجريبية
      '2027-05-13',
      '2027-05-17', // عيد الأضحى
      '2027-05-18',
      '2027-05-23', // اختبارات الفصل الثالث
      '2027-05-27',
      '2027-06-06',
      '2027-06-15',
      '2027-07-05',
    ];
    for (const date of excluded) {
      expect(isDateExcluded(holidays, date), date).toBe(true);
    }
    // ordinary teaching days stay included
    for (const date of ['2026-10-04', '2026-12-13', '2027-02-14', '2027-04-11']) {
      expect(isDateExcluded(holidays, date), date).toBe(false);
    }
  });

  it('ships the official calendar as the default settings', () => {
    expect(DEFAULT_CALENDAR_SETTINGS.holidays).toBe(OFFICIAL_HOLIDAYS_2026_2027);
    expect(DEFAULT_CALENDAR_SETTINGS.holidays.some((entry) => entry.type === 'exam')).toBe(true);
    expect(DEFAULT_CALENDAR_SETTINGS.evaluationRules.unexcusedAbsenceDeduction).toBe(0.5);
  });
});

describe('date helpers', () => {
  it('computes weekdays and day arithmetic in local time', () => {
    expect(isoWeekday('2026-11-01')).toBe(0); // الأحد
    expect(isoWeekday('2026-10-28')).toBe(3); // الأربعاء
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('formats ISO dates with Algerian month names', () => {
    expect(formatIsoDateAr('2027-01-12')).toBe('12 جانفي 2027');
    expect(formatIsoDateAr('2027-07-05')).toBe('05 جويلية 2027');
    expect(ARABIC_MONTH_NAMES).toHaveLength(12);
  });
});

describe('normalizeCalendarSettings migration', () => {
  const base = DEFAULT_CALENDAR_SETTINGS;

  it('preserves a stored 1.0 deduction rather than rewriting a teacher choice', () => {
    const stored: AcademicCalendarSettings = {
      ...base,
      evaluationRules: { ...base.evaluationRules, unexcusedAbsenceDeduction: 1.0 },
    };
    const normalized = normalizeCalendarSettings(stored, base);
    expect(normalized.evaluationRules.unexcusedAbsenceDeduction).toBe(1);
    // the other rules stay untouched
    expect(normalized.evaluationRules.lateDeduction).toBe(base.evaluationRules.lateDeduction);
  });

  it('keeps a teacher-chosen deduction that differs from the old default', () => {
    const stored: AcademicCalendarSettings = {
      ...base,
      evaluationRules: { ...base.evaluationRules, unexcusedAbsenceDeduction: 2 },
    };
    expect(normalizeCalendarSettings(stored, base).evaluationRules.unexcusedAbsenceDeduction).toBe(2);
  });

  it('falls back to defaults for missing or invalid input', () => {
    expect(normalizeCalendarSettings(undefined, base)).toBe(base);
    expect(normalizeCalendarSettings(null, base)).toBe(base);
    const normalized = normalizeCalendarSettings({ ...base, holidays: undefined as unknown as OfficialHoliday[] }, base);
    expect(normalized.holidays).toBe(base.holidays);
  });

  it('keeps structured dates and the exam type of stored entries', () => {
    const entry = holiday({ type: 'exam', startDate: '2026-12-06', endDate: '2026-12-10' });
    const normalized = normalizeCalendarSettings({ ...base, holidays: [entry] }, base);
    expect(normalized.holidays[0].type).toBe('exam');
    expect(normalized.holidays[0].startDate).toBe('2026-12-06');
  });
});


describe('secondary calendar scope and day boundaries', () => {
  it('keeps the departure teaching day and the return morning included', () => {
    for (const date of ['2026-10-27', '2026-11-02', '2026-12-17', '2027-01-03', '2027-03-18', '2027-04-04']) {
      expect(isDateExcluded(OFFICIAL_HOLIDAYS_2026_2027, date, '2AS'), date).toBe(false);
    }
  });
  it('applies mock-baccalaureate exams only to third year', () => {
    expect(isDateExcluded(OFFICIAL_HOLIDAYS_2026_2027, '2027-05-10', '3AS')).toBe(true);
    expect(isDateExcluded(OFFICIAL_HOLIDAYS_2026_2027, '2027-05-10', '2AS')).toBe(false);
    expect(isDateExcluded(OFFICIAL_HOLIDAYS_2026_2027, '2027-05-10', '1AS_ARTS')).toBe(false);
  });
  it('applies third-term exams on May 23–27 only to first and second year', () => {
    expect(isDateExcluded(OFFICIAL_HOLIDAYS_2026_2027, '2027-05-24', '3AS')).toBe(false);
    expect(isDateExcluded(OFFICIAL_HOLIDAYS_2026_2027, '2027-05-24', '2AS')).toBe(true);
    expect(isDateExcluded(OFFICIAL_HOLIDAYS_2026_2027, '2027-05-24', '1AS_SCIENCE')).toBe(true);
  });
  it('rejects impossible dates instead of rolling them into the following month', () => {
    expect(parseIsoDate('2027-02-29')).toBeNull();
    expect(parseIsoDate('2027-02-30')).toBeNull();
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
  });
  it('respects an intentionally empty holiday list (deletions are absolute)', () => {
    expect(normalizeCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, holidays: [] }, DEFAULT_CALENDAR_SETTINGS).holidays).toEqual([]);
  });
});


describe('untouched legacy defaults migration', () => {
  it('upgrades the old calendar and its old default deduction, but not a teacher-edited calendar', () => {
    const names = ['عطلة الشتاء', 'عطلة الربيع', 'عيد ثورة أول نوفمبر', 'رأس السنة الميلادية', 'رأس السنة الأمازيغية (يناير)', 'عيد الفطر', 'عيد الفطر — اليوم الثاني', 'عيد النصر', 'عيد العمال', 'عيد الأضحى', 'عيد الأضحى — اليوم الثاني', 'رأس السنة الهجرية', 'عاشوراء', 'عيد الاستقلال والشباب'];
    const dates = ['عطلة فصلية', 'عطلة فصلية', '01 نوفمبر 2026', '01 جانفي 2027', '12 جانفي 2027', '10 مارس 2027', '11 مارس 2027', '19 مارس 2027', '01 ماي 2027', '17 ماي 2027', '18 ماي 2027', '06 جوان 2027', '15 جوان 2027', '05 جويلية 2027'];
    const legacy: AcademicCalendarSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      holidays: names.map((name, i) => ({ id: `h-${i + 1}`, name, dateStr: dates[i], type: 'national' })),
      evaluationRules: { ...DEFAULT_CALENDAR_SETTINGS.evaluationRules, unexcusedAbsenceDeduction: 1 },
    };
    const normalized = normalizeCalendarSettings(legacy, DEFAULT_CALENDAR_SETTINGS);
    expect(normalized.holidays).toBe(OFFICIAL_HOLIDAYS_2026_2027);
    expect(normalized.evaluationRules.unexcusedAbsenceDeduction).toBe(0.5);
    // Do not reset a teacher-edited date or bring deleted entries back.
    const edited = { ...legacy, holidays: legacy.holidays.map((h, i) => i === 2 ? { ...h, dateStr: 'تاريخ مخصص' } : h) };
    expect(normalizeCalendarSettings(edited, DEFAULT_CALENDAR_SETTINGS).holidays[2].dateStr).toBe('تاريخ مخصص');
    expect(normalizeCalendarSettings(edited, DEFAULT_CALENDAR_SETTINGS).evaluationRules.unexcusedAbsenceDeduction).toBe(1);
  });
});
