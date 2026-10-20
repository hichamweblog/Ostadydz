import {
  resolveLevelAndStream,
  STREAMS_BY_ID,
  SUBJECTS,
  SUBJECT_VARIANTS,
  type LevelCode,
  type StreamId,
  type SubjectId,
  type VariantId,
} from './education';
import { mapLevelAndStreamToLegacyGradeLevel, type GradeLevel } from './types';

export function normalizeArabicText(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function normalizeArabicName(name: string | undefined | null): string {
  return normalizeArabicText(name);
}

export function getStudentNameKey(name: string | undefined | null): string {
  return normalizeArabicText(name).replace(/\s+/g, '');
}

export function normalizeClassName(name: string | undefined | null): string {
  if (!name) return '';
  return normalizeArabicText(name)
    .replace(/الفوج|فوج|القسم|قسم/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function areNamesMatching(
  nameA: string | undefined | null,
  nameB: string | undefined | null
): boolean {
  const normA = normalizeArabicText(nameA);
  const normB = normalizeArabicText(nameB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const tokensA = normA.split(' ').filter(Boolean);
  const tokensB = normB.split(' ').filter(Boolean);
  if (tokensA.length >= 2 && tokensB.length >= 2) {
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    if (setA.size === setB.size && [...setA].every(tok => setB.has(tok))) {
      return true;
    }
  }
  return false;
}

export function isSameStudentName(
  nameA: string | undefined | null,
  nameB: string | undefined | null
): boolean {
  return areNamesMatching(nameA, nameB);
}

export function isSameClassName(
  classA: string | undefined | null,
  classB: string | undefined | null
): boolean {
  const normA = normalizeClassName(classA);
  const normB = normalizeClassName(classB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const parsedA = parseClassDescriptorToLevelAndStream(classA || '');
  const parsedB = parseClassDescriptorToLevelAndStream(classB || '');
  const groupA = extractGroupNumber(classA || '');
  const groupB = extractGroupNumber(classB || '');

  if (
    parsedA.levelCode === parsedB.levelCode &&
    parsedA.streamId === parsedB.streamId &&
    groupA !== null &&
    groupA === groupB
  ) {
    return true;
  }
  return false;
}

export function isSameClass(
  classA: string | undefined | null,
  classB: string | undefined | null
): boolean {
  return isSameClassName(classA, classB);
}

export interface ParsedStreamInfo {
  levelCode: LevelCode;
  streamId: StreamId;
  shortStreamLabel: string;
  streamLabelAr: string;
}

export function parseClassDescriptorToLevelAndStream(
  rawText: string,
  fallbackLegacyLevel?: GradeLevel
): ParsedStreamInfo {
  const norm = normalizeArabicText(rawText);

  let levelCode: LevelCode | undefined;
  if (
    norm.includes('اولي') ||
    norm.includes('1 ثا') ||
    norm.includes('1ثا') ||
    norm.includes('1 ج م') ||
    norm.includes('1ج م') ||
    /\b1\s*as\b/i.test(norm) ||
    /^1(?:\s|[^\d]|$)/.test(norm)
  ) {
    levelCode = '1AS';
  } else if (
    norm.includes('ثانيه') ||
    norm.includes('2 ثا') ||
    norm.includes('2ثا') ||
    /\b2\s*as\b/i.test(norm) ||
    /^2(?:\s|[^\d]|$)/.test(norm)
  ) {
    levelCode = '2AS';
  } else if (
    norm.includes('ثالثه') ||
    norm.includes('3 ثا') ||
    norm.includes('3ثا') ||
    norm.includes('بكالوريا') ||
    /\b3\s*as\b/i.test(norm) ||
    /^3(?:\s|[^\d]|$)/.test(norm)
  ) {
    levelCode = '3AS';
  }

  let streamId: StreamId | undefined;
  if (norm.includes('لغات اجنبيه') || norm.includes('لغات') || /\b\d\s*ل(?:\s|\d|$)/.test(norm)) {
    streamId = 'FOREIGN_LANG';
  } else if (
    norm.includes('تسيير واقتصاد') ||
    norm.includes('تسيير و اقتصاد') ||
    norm.includes('تسيير') ||
    /\b\d\s*ت\s*ا/.test(norm)
  ) {
    streamId = 'MGMT_ECO';
  } else if (
    norm.includes('تقني رياضي') ||
    norm.includes('هندسه ميكانيكيه') ||
    norm.includes('هندسه كهربائيه') ||
    norm.includes('هندسه مدنيه') ||
    norm.includes('هندسه الطرائق') ||
    /\b\d\s*ت\s*ر/.test(norm)
  ) {
    streamId = 'ENGINEERING';
  } else if (
    norm.includes('رياضيات') ||
    norm.includes('رياضي') ||
    /^([23])\s*ر(?:\s|\d|$)/.test(norm)
  ) {
    streamId = 'MATH';
  } else if (
    norm.includes('علوم تجريبيه') ||
    norm.includes('ع تجريبيه') ||
    norm.includes('تجريبيه') ||
    /^([23])\s*ع(?:\s|\d|$)/.test(norm)
  ) {
    streamId = 'EXP_SCI';
  } else if (
    norm.includes('اداب وفلسفه') ||
    norm.includes('اداب و فلسفه') ||
    norm.includes('فلسفه') ||
    /^([23])\s*ا\s*ف/.test(norm)
  ) {
    streamId = 'LIT_PHIL';
  } else if (
    norm.includes('جذع مشترك اداب') ||
    norm.includes('ج م اداب') ||
    norm.includes('اداب')
  ) {
    streamId = levelCode === '2AS' || levelCode === '3AS' ? 'LIT_PHIL' : 'TC_ARTS';
    if (!levelCode) levelCode = '1AS';
  } else if (
    norm.includes('جذع مشترك علوم') ||
    norm.includes('علوم وتكنولوجيا') ||
    norm.includes('ج م ع') ||
    norm.includes('ج م علوم') ||
    norm.includes('علوم')
  ) {
    streamId = levelCode === '2AS' || levelCode === '3AS' ? 'EXP_SCI' : 'TC_SCI';
    if (!levelCode) levelCode = '1AS';
  }

  const resolved = resolveLevelAndStream({
    levelCode,
    streamId,
    legacyGradeLevel: fallbackLegacyLevel,
  });

  const shortLabels: Record<StreamId, Record<LevelCode, string>> = {
    TC_SCI: { '1AS': '1 ج.م علوم', '2AS': '2 علوم تجريبية', '3AS': '3 علوم تجريبية' },
    TC_ARTS: { '1AS': '1 ج.م آداب', '2AS': '2 آداب وفلسفة', '3AS': '3 آداب وفلسفة' },
    EXP_SCI: { '1AS': '1 ج.م علوم', '2AS': '2 علوم تجريبية', '3AS': '3 علوم تجريبية' },
    MATH: { '1AS': '1 ج.م علوم', '2AS': '2 رياضيات', '3AS': '3 رياضيات' },
    ENGINEERING: { '1AS': '1 ج.م علوم', '2AS': '2 تقني رياضي', '3AS': '3 تقني رياضي' },
    MGMT_ECO: { '1AS': '1 ج.م علوم', '2AS': '2 تسيير واقتصاد', '3AS': '3 تسيير واقتصاد' },
    LIT_PHIL: { '1AS': '1 ج.م آداب', '2AS': '2 آداب وفلسفة', '3AS': '3 آداب وفلسفة' },
    FOREIGN_LANG: { '1AS': '1 ج.م آداب', '2AS': '2 لغات أجنبية', '3AS': '3 لغات أجنبية' },
    ARTS: { '1AS': '1 ج.م آداب', '2AS': '2 فنون', '3AS': '3 فنون' },
    UNCLASSIFIED: { '1AS': '1 ثانوي', '2AS': '2 ثانوي', '3AS': '3 ثانوي' },
  };

  const streamDef = STREAMS_BY_ID[resolved.streamId];
  return {
    levelCode: resolved.levelCode,
    streamId: resolved.streamId,
    shortStreamLabel:
      shortLabels[resolved.streamId]?.[resolved.levelCode] ||
      `${resolved.levelCode} ${resolved.streamId}`,
    streamLabelAr: streamDef?.labelAr || 'علوم تجريبية',
  };
}

export function parseAlgerianClass(rawText: string): {
  level: GradeLevel | null;
  levelNumber: 1 | 2 | 3 | null;
  officialStream: string | null;
  levelCode: LevelCode;
  streamId: StreamId;
  stream: string;
  groupNumber: number | null;
  canonicalName: string;
} {
  const norm = normalizeArabicText(rawText);
  if (!norm) {
    return {
      level: null,
      levelNumber: null,
      officialStream: null,
      levelCode: '1AS',
      streamId: 'TC_SCI',
      stream: '',
      groupNumber: null,
      canonicalName: '',
    };
  }
  const hasLevelCue = /[123]|اولي|ثانيه|ثالثه|ج\s*م|بكالوريا/.test(norm);
  const parsed = parseClassDescriptorToLevelAndStream(rawText);
  const groupNumber = extractGroupNumber(rawText);
  const level = hasLevelCue
    ? mapLevelAndStreamToLegacyGradeLevel(parsed.levelCode, parsed.streamId)
    : null;
  const levelNumber: 1 | 2 | 3 | null = !hasLevelCue
    ? null
    : parsed.levelCode === '1AS'
    ? 1
    : parsed.levelCode === '2AS'
    ? 2
    : 3;
  const canonicalName = groupNumber
    ? `${parsed.shortStreamLabel} ${groupNumber}`
    : `${parsed.shortStreamLabel} 1`;

  return {
    level,
    levelNumber,
    officialStream: parsed.streamLabelAr || null,
    levelCode: parsed.levelCode,
    streamId: parsed.streamId,
    stream: parsed.streamLabelAr,
    groupNumber,
    canonicalName,
  };
}

export function getCanonicalClassName(
  rawTextOrLevel: string | number,
  streamOrGroup?: string | number | null,
  groupNumArg?: number | null
): string {
  if (typeof rawTextOrLevel === 'number') {
    const levelNum = rawTextOrLevel;
    const streamStr = typeof streamOrGroup === 'string' ? streamOrGroup : '';
    const gNum = typeof groupNumArg === 'number' && groupNumArg > 0 ? groupNumArg : 1;
    const info = parseClassDescriptorToLevelAndStream(`${levelNum} ${streamStr}`);
    return `${info.shortStreamLabel} ${gNum}`;
  }
  const parsed = parseAlgerianClass(rawTextOrLevel);
  const fallbackGroup = typeof streamOrGroup === 'number' ? streamOrGroup : undefined;
  const groupNum = parsed.groupNumber ?? fallbackGroup ?? 1;
  const info = parseClassDescriptorToLevelAndStream(rawTextOrLevel);
  return `${info.shortStreamLabel} ${groupNum}`;
}

export function detectSubjectFromRakmanaHeader(rawHeaderText: string): {
  subjectId?: SubjectId;
  variantId?: VariantId;
} {
  const norm = normalizeArabicText(rawHeaderText);
  if (!norm) return {};

  for (const variant of Object.values(SUBJECT_VARIANTS)) {
    const vNorm = normalizeArabicText(variant.labelAr);
    if (vNorm && norm.includes(vNorm)) {
      return {
        subjectId: variant.subjectId,
        variantId: variant.id,
      };
    }
  }

  if (norm.includes('ميكانيك')) return { subjectId: 'TECHNOLOGY', variantId: 'MECHANICAL' };
  if (norm.includes('كهرباء') || norm.includes('كهربائيه')) return { subjectId: 'TECHNOLOGY', variantId: 'ELECTRICAL' };
  if (norm.includes('مدنيه') && norm.includes('هندسه')) return { subjectId: 'TECHNOLOGY', variantId: 'CIVIL' };
  if (norm.includes('طرائق')) return { subjectId: 'TECHNOLOGY', variantId: 'PROCESS' };
  if (norm.includes('المانيه')) return { subjectId: 'THIRD_LANG', variantId: 'GERMAN' };
  if (norm.includes('اسبانيه')) return { subjectId: 'THIRD_LANG', variantId: 'SPANISH' };
  if (norm.includes('ايطاليه')) return { subjectId: 'THIRD_LANG', variantId: 'ITALIAN' };
  if (norm.includes('امازيغيه')) return { subjectId: 'AMAZIGH' };

  for (const subject of SUBJECTS) {
    const labelNorm = normalizeArabicText(subject.labelAr);
    const shortNorm = normalizeArabicText(subject.shortAr);
    if ((labelNorm && norm.includes(labelNorm)) || (shortNorm && norm.includes(shortNorm))) {
      return { subjectId: subject.id };
    }
  }

  return {};
}

export function extractGroupNumber(rawText: string): number | null {
  const norm = normalizeArabicText(rawText);
  const match =
    norm.match(/(?:الفوج|فوج|قسم|القسم|الفرقه)\s*(\d+)/) ||
    norm.match(/[-_/]\s*(\d+)\s*$/) ||
    norm.match(/\s(\d+)\s*$/) ||
    norm.match(/^[123]\s*[^\d]+\s*(\d+)$/);
  if (match && match[1]) {
    const num = Number.parseInt(match[1], 10);
    if (!Number.isNaN(num) && num > 0 && num < 50) {
      return num;
    }
  }
  return null;
}
