import type {
  AcademicCalendarSettings,
  HolidayType,
  GradeLevel,
  OfficialHoliday,
} from './types';

/**
 * Phase 6 — the official Algerian school calendar 2026/2027 (secondary education) as published
 * in the supplied Ministry circular dated 05 October 2026 (decision n° 41 of 28 September).
 * Term breaks exclude whole non-teaching days: the evening departure and morning return
 * named by the circular do not exclude the last teaching day or the return day.
 *
 * Every entry carries structured ISO dates (`startDate` / `endDate`, inclusive) so the app can
 * exclude those days from teaching sessions automatically, instead of relying on free text.
 */

/** Algerian French-derived month names, as used everywhere else in the app. */
export const ARABIC_MONTH_NAMES = [
  'جانفي',
  'فيفري',
  'مارس',
  'أفريل',
  'ماي',
  'جوان',
  'جويلية',
  'أوت',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

export const ARABIC_WEEKDAY_NAMES = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

/** Official holidays, term breaks and examination periods for 2026/2027 (secondary track). */
export const OFFICIAL_HOLIDAYS_2026_2027: OfficialHoliday[] = [
  {
    id: 'h-autumn-2026',
    name: 'عطلة الخريف',
    type: 'term',
    startDate: '2026-10-28',
    endDate: '2026-11-01',
    dateStr: 'من الأربعاء 28 أكتوبر إلى الأحد 01 نوفمبر 2026',
  },
  {
    id: 'h-nov-2026',
    name: 'عيد ثورة أول نوفمبر',
    type: 'national',
    startDate: '2026-11-01',
    dateStr: 'الأحد 01 نوفمبر 2026',
  },
  {
    id: 'h-exam-t1-2026',
    name: 'اختبارات الفصل الأول',
    type: 'exam',
    startDate: '2026-12-06',
    endDate: '2026-12-10',
    dateStr: 'من الأحد 06 إلى الخميس 10 ديسمبر 2026',
  },
  {
    id: 'h-winter-2026',
    name: 'عطلة الشتاء',
    type: 'term',
    startDate: '2026-12-18',
    endDate: '2027-01-02',
    dateStr: 'من الجمعة 18 ديسمبر 2026 إلى السبت 02 جانفي 2027',
  },
  {
    id: 'h-newyear-2027',
    name: 'رأس السنة الميلادية',
    type: 'national',
    startDate: '2027-01-01',
    dateStr: 'الجمعة 01 جانفي 2027',
  },
  {
    id: 'h-yennayer-2027',
    name: 'رأس السنة الأمازيغية (يناير)',
    type: 'national',
    startDate: '2027-01-12',
    dateStr: 'الثلاثاء 12 جانفي 2027',
  },
  {
    id: 'h-exam-t2-a-2027',
    name: 'اختبارات الفصل الثاني (02–04 مارس)',
    type: 'exam',
    startDate: '2027-03-02',
    endDate: '2027-03-04',
    dateStr: 'من الثلاثاء 02 إلى الخميس 04 مارس 2027',
  },
  {
    id: 'h-exam-t2-b-2027',
    name: 'اختبارات الفصل الثاني (07–08 مارس)',
    type: 'exam',
    startDate: '2027-03-07',
    endDate: '2027-03-08',
    dateStr: 'من الأحد 07 إلى الإثنين 08 مارس 2027',
  },
  {
    id: 'h-fitr-2027',
    name: 'عيد الفطر (ثلاثة أيام)',
    type: 'religious',
    provisional: true,
    startDate: '2027-03-09',
    endDate: '2027-03-11',
    dateStr: 'من الثلاثاء 09 إلى الخميس 11 مارس 2027',
  },
  {
    id: 'h-spring-2027',
    name: 'عطلة الربيع',
    type: 'term',
    startDate: '2027-03-19',
    endDate: '2027-04-03',
    dateStr: 'من الجمعة 19 مارس إلى السبت 03 أفريل 2027',
  },
  {
    id: 'h-victory-2027',
    name: 'عيد النصر',
    type: 'national',
    startDate: '2027-03-19',
    dateStr: 'الجمعة 19 مارس 2027',
  },
  {
    id: 'h-labour-2027',
    name: 'عيد العمال',
    type: 'national',
    startDate: '2027-05-01',
    dateStr: 'السبت 01 ماي 2027',
  },
  {
    id: 'h-exam-bac-2027',
    name: 'اختبارات البكالوريا التجريبية — السنة الثالثة',
    type: 'exam',
    levels: ['3AS'],
    startDate: '2027-05-09',
    endDate: '2027-05-13',
    dateStr: 'من الأحد 09 إلى الخميس 13 ماي 2027',
  },
  {
    id: 'h-adha-2027',
    name: 'عيد الأضحى (يومان)',
    type: 'religious',
    provisional: true,
    startDate: '2027-05-17',
    endDate: '2027-05-18',
    dateStr: 'الإثنين 17 والثلاثاء 18 ماي 2027',
  },
  {
    id: 'h-exam-t3-2027',
    name: 'اختبارات الفصل الثالث — السنتان الأولى والثانية',
    type: 'exam',
    levels: ['1AS_ARTS', '1AS_SCIENCE', '2AS'],
    startDate: '2027-05-23',
    endDate: '2027-05-27',
    dateStr: 'من الأحد 23 إلى الخميس 27 ماي 2027',
  },
  {
    id: 'h-hijri-2027',
    name: 'رأس السنة الهجرية',
    type: 'religious',
    provisional: true,
    startDate: '2027-06-06',
    dateStr: 'الأحد 06 جوان 2027',
  },
  {
    id: 'h-achoura-2027',
    name: 'عاشوراء',
    type: 'religious',
    provisional: true,
    startDate: '2027-06-15',
    dateStr: 'الثلاثاء 15 جوان 2027',
  },
  {
    id: 'h-independence-2027',
    name: 'عيد الاستقلال والشباب',
    type: 'national',
    startDate: '2027-07-05',
    dateStr: 'الإثنين 05 جويلية 2027',
  },
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses an ISO date into parts; returns null for missing/invalid values. */
export function parseIsoDate(iso: string | undefined | null): { year: number; month: number; day: number } | null {
  if (typeof iso !== 'string') return null;
  const match = ISO_DATE.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Weekday index (0 = Sunday) for an ISO date, computed without timezone surprises. */
export function isoWeekday(iso: string): number | null {
  const parts = parseIsoDate(iso);
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day).getDay();
}

/** Adds (or subtracts) whole days to an ISO date, staying in local time. */
export function addDaysIso(iso: string, days: number): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;
  const date = new Date(parts.year, parts.month - 1, parts.day);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "01 نوفمبر 2026" style rendering of an ISO date. */
export function formatIsoDateAr(iso: string | undefined | null): string {
  const parts = parseIsoDate(iso);
  if (!parts) return '';
  const monthName = ARABIC_MONTH_NAMES[parts.month - 1] ?? '';
  return `${String(parts.day).padStart(2, '0')} ${monthName} ${parts.year}`;
}

/** Inclusive range covered by a holiday entry. Legacy text-only entries cover nothing. */
export function holidayRange(holiday: OfficialHoliday): { start: string; end: string } | null {
  const start = typeof holiday.startDate === 'string' ? holiday.startDate.trim() : '';
  if (!parseIsoDate(start)) return null;
  const endRaw = typeof holiday.endDate === 'string' ? holiday.endDate.trim() : '';
  const end = parseIsoDate(endRaw) ? endRaw : start;
  if (end < start) return null;
  return { start, end };
}

/** Whether the holiday entry covers the given ISO date (inclusive on both ends). */
export function holidayCoversDate(holiday: OfficialHoliday, isoDate: string): boolean {
  const range = holidayRange(holiday);
  if (!range) return false;
  return isoDate >= range.start && isoDate <= range.end;
}

/** The first holiday/excluded-day entry covering the date, if any. */
export function findHolidayOnDate(
  holidays: OfficialHoliday[] | undefined | null,
  isoDate: string,
  level?: GradeLevel,
): OfficialHoliday | undefined {
  if (!Array.isArray(holidays) || !parseIsoDate(isoDate)) return undefined;
  return holidays.find((holiday) =>
    (!holiday.levels?.length || !level || holiday.levels.includes(level)) && holidayCoversDate(holiday, isoDate)
  );
}

/** Days covered by the calendar entries are excluded from teaching sessions automatically. */
export function isDateExcluded(
  holidays: OfficialHoliday[] | undefined | null,
  isoDate: string,
  level?: GradeLevel,
): boolean {
  return Boolean(findHolidayOnDate(holidays, isoDate, level));
}

/** Human-readable label for an excluded day, e.g. "عطلة الشتاء (عطلة فصلية)". */
export function getExcludedDayLabel(
  holidays: OfficialHoliday[] | undefined | null,
  isoDate: string,
  level?: GradeLevel,
): string | null {
  const holiday = findHolidayOnDate(holidays, isoDate, level);
  if (!holiday) return null;
  return `${holiday.name} (${holidayTypeLabel(holiday.type)})`;
}

export function holidayTypeLabel(type: OfficialHoliday['type']): string {
  switch (type) {
    case 'national':
      return 'مناسبة وطنية';
    case 'religious':
      return 'مناسبة دينية';
    case 'exam':
      return 'أيام اختبارات';
    case 'term':
    default:
      return 'عطلة فصلية';
  }
}

/** Display text for a holiday entry: structured dates win over the legacy free text. */
export function formatHolidayDates(holiday: OfficialHoliday): string {
  const range = holidayRange(holiday);
  if (!range) return holiday.dateStr || 'تاريخ غير محدد';
  if (range.start === range.end) {
    const weekday = isoWeekday(range.start);
    const prefix = weekday === null ? '' : `${ARABIC_WEEKDAY_NAMES[weekday]} `;
    return `${prefix}${formatIsoDateAr(range.start)}`;
  }
  const startWeekday = isoWeekday(range.start);
  const startPrefix = startWeekday === null ? '' : `${ARABIC_WEEKDAY_NAMES[startWeekday]} `;
  const endWeekday = isoWeekday(range.end);
  const endPrefix = endWeekday === null ? '' : `${ARABIC_WEEKDAY_NAMES[endWeekday]} `;
  return `من ${startPrefix}${formatIsoDateAr(range.start)} إلى ${endPrefix}${formatIsoDateAr(range.end)}`;
}

/** Recomputes the legacy `dateStr` field from the structured dates (kept for older builds). */
export function withDerivedDateStr(holiday: OfficialHoliday): OfficialHoliday {
  const range = holidayRange(holiday);
  if (!range) return holiday;
  return { ...holiday, dateStr: formatHolidayDates(holiday) };
}

/**
 * Phase 6 migration + guard-rails for the calendar settings:
 * - missing evaluation rules receive the new 0.5 default; existing teacher choices are kept;
 * - the untouched legacy default holiday list is upgraded to structured official dates;
 * - holiday entries keep their structured dates and gain the `exam` type when missing.
 */
export function normalizeCalendarSettings(
  calendar: AcademicCalendarSettings | undefined | null,
  defaults: AcademicCalendarSettings,
): AcademicCalendarSettings {
  if (!calendar || typeof calendar !== 'object') return defaults;
  const rules = {
    ...defaults.evaluationRules,
    ...(calendar.evaluationRules || {}),
  };
  // A stored value (including 1.0) may be a teacher's deliberate choice: never overwrite it.
  // Only a missing rule receives the new 0.5 default.
  const holidays: OfficialHoliday[] = Array.isArray(calendar.holidays)
    ? calendar.holidays
        .filter((holiday): holiday is OfficialHoliday => Boolean(holiday && typeof holiday === 'object'))
        .map((holiday): OfficialHoliday => {
          const type: HolidayType =
            holiday.type === 'exam' || holiday.type === 'national' || holiday.type === 'religious'
              ? holiday.type
              : 'term';
          return { ...holiday, type };
        })
    : defaults.holidays;
  const legacyNames = ['عطلة الشتاء', 'عطلة الربيع', 'عيد ثورة أول نوفمبر', 'رأس السنة الميلادية', 'رأس السنة الأمازيغية (يناير)', 'عيد الفطر', 'عيد الفطر — اليوم الثاني', 'عيد النصر', 'عيد العمال', 'عيد الأضحى', 'عيد الأضحى — اليوم الثاني', 'رأس السنة الهجرية', 'عاشوراء', 'عيد الاستقلال والشباب'];
  const legacyDates = ['عطلة فصلية', 'عطلة فصلية', '01 نوفمبر 2026', '01 جانفي 2027', '12 جانفي 2027', '10 مارس 2027', '11 مارس 2027', '19 مارس 2027', '01 ماي 2027', '17 ماي 2027', '18 ماي 2027', '06 جوان 2027', '15 جوان 2027', '05 جويلية 2027'];
  const untouchedLegacyCalendar = holidays.length === 14 && holidays.every(h =>
    /^h-(?:[1-9]|1[0-4])$/.test(h.id) && !h.startDate && h.name === legacyNames[Number(h.id.slice(2)) - 1] && h.dateStr === legacyDates[Number(h.id.slice(2)) - 1]
  ) && new Set(holidays.map(h => h.id)).size === 14;
  // Only the fully untouched old default configuration can be identified safely. Upgrade
  // its old 1.0 default once; never rewrite a stored deduction in a customised/new calendar.
  const oldDefaultRules = untouchedLegacyCalendar && rules.unexcusedAbsenceDeduction === 1 &&
    Object.entries(defaults.evaluationRules).every(([key, value]) =>
      key === 'unexcusedAbsenceDeduction' || calendar.evaluationRules?.[key as keyof typeof rules] === value
    );
  if (oldDefaultRules) rules.unexcusedAbsenceDeduction = 0.5;
  return {
    ...defaults,
    ...calendar,
    holidays: untouchedLegacyCalendar ? defaults.holidays : holidays,
    evaluationRules: rules,
    termDates: { ...defaults.termDates, ...(calendar.termDates || {}) },
    timetableSettings: { ...defaults.timetableSettings, ...(calendar.timetableSettings || {}) },
  };
}
