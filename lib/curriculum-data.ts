import {
  resolveLevelAndStream,
  resolveWeeklyHours,
  STREAMS_BY_ID,
  SUBJECTS_BY_ID,
  type EducationOverrides,
  type LevelCode,
  type StreamId,
  type SubjectId,
} from './education';
import curriculum1AsArtsJson from './data/curriculum-1as-arts.json';
import curriculum1AsScienceJson from './data/curriculum-1as-science.json';
import curriculum2AsJson from './data/curriculum-2as.json';
import curriculum3AsJson from './data/curriculum-3as.json';
import { getLocalMemorandum } from './local-memoranda-map';
import type { CurriculumUnit, GradeLevel } from './types';

function enrichJsonUnits(
  rawUnits: unknown[],
  levelCode: LevelCode,
  streamId: StreamId,
): CurriculumUnit[] {
  const trackKey = `ISLAMIC:${levelCode}:${streamId}`;
  return (rawUnits as CurriculumUnit[]).map((u) => {
    const localMemo = getLocalMemorandum({ id: u.id, level: u.level });
    return {
      ...u,
      subjectId: 'ISLAMIC' as SubjectId,
      levelCode,
      streamId,
      trackKey,
      hourlyVolume: u.hourlyVolume ?? u.suggestedHours ?? 2,
      suggestedHours: u.suggestedHours ?? u.hourlyVolume ?? 2,
      trimester: (u.trimester ?? u.sectionNumber ?? 1) as 1 | 2 | 3,
      sectionNumber: u.sectionNumber ?? u.trimester ?? 1,
      elements: u.elements ?? u.targetedResources ?? [],
      learningObjectives: u.learningObjectives ?? u.targetedResources ?? [],
      pdfUrl: u.pdfUrl ?? localMemo?.pdfUrl,
      pdfFileName: u.pdfFileName ?? localMemo?.fileName,
      memorandumPdfUrl: u.memorandumPdfUrl ?? u.pdfUrl ?? localMemo?.pdfUrl,
    };
  });
}

export const OFFICIAL_CURRICULUM_1AS_SCIENCE: CurriculumUnit[] = enrichJsonUnits(
  curriculum1AsScienceJson as unknown[],
  '1AS',
  'TC_SCI',
);

export const OFFICIAL_CURRICULUM_1AS_ARTS: CurriculumUnit[] = enrichJsonUnits(
  curriculum1AsArtsJson as unknown[],
  '1AS',
  'TC_ARTS',
);

export const OFFICIAL_CURRICULUM_2AS: CurriculumUnit[] = enrichJsonUnits(
  curriculum2AsJson as unknown[],
  '2AS',
  'EXP_SCI',
);

export const OFFICIAL_CURRICULUM_3AS: CurriculumUnit[] = enrichJsonUnits(
  curriculum3AsJson as unknown[],
  '3AS',
  'EXP_SCI',
);

export const OFFICIAL_CURRICULUM: CurriculumUnit[] = [
  ...OFFICIAL_CURRICULUM_1AS_SCIENCE,
  ...OFFICIAL_CURRICULUM_1AS_ARTS,
  ...OFFICIAL_CURRICULUM_2AS,
  ...OFFICIAL_CURRICULUM_3AS,
];

export const ALL_OFFICIAL_UNITS: CurriculumUnit[] = OFFICIAL_CURRICULUM;

export const OFFICIAL_LEVELS: Array<{
  id: GradeLevel;
  levelCode: LevelCode;
  streamId: StreamId;
  name: string;
  shortName: string;
  weeklyHours: number;
  annualHours: number;
}> = [
  {
    id: '1AS_SCIENCE',
    levelCode: '1AS',
    streamId: 'TC_SCI',
    name: 'السنة الأولى ثانوي — جذع مشترك علوم وتكنولوجيا',
    shortName: '1 ج.م علوم وتكنولوجيا',
    weeklyHours: 1,
    annualHours: 27,
  },
  {
    id: '1AS_ARTS',
    levelCode: '1AS',
    streamId: 'TC_ARTS',
    name: 'السنة الأولى ثانوي — جذع مشترك آداب',
    shortName: '1 ج.م آداب',
    weeklyHours: 2,
    annualHours: 54,
  },
  {
    id: '2AS',
    levelCode: '2AS',
    streamId: 'EXP_SCI',
    name: 'السنة الثانية ثانوي — جميع الشعب',
    shortName: '2 ثانوي',
    weeklyHours: 2,
    annualHours: 54,
  },
  {
    id: '3AS',
    levelCode: '3AS',
    streamId: 'EXP_SCI',
    name: 'السنة الثالثة ثانوي — بكالوريا (جميع الشعب)',
    shortName: '3 ثانوي (بكالوريا)',
    weeklyHours: 2,
    annualHours: 54,
  },
];

export async function loadAllCurriculum(): Promise<CurriculumUnit[]> {
  return OFFICIAL_CURRICULUM;
}

/**
 * دمج الوحدات الرسمية والمخصصة مع إمكانية التصفية حسب المادة (أو إرجاع الكل عند عدم التحديد)
 */
export function getMergedCurriculumUnits(
  customUnits: CurriculumUnit[] = [],
  subjectId?: SubjectId | null,
): CurriculumUnit[] {
  const customMap = new Map<string, CurriculumUnit>();
  for (const unit of customUnits) {
    customMap.set(unit.id, {
      ...unit,
      hourlyVolume: unit.hourlyVolume ?? unit.suggestedHours ?? 2,
      suggestedHours: unit.suggestedHours ?? unit.hourlyVolume ?? 2,
      sectionNumber: unit.sectionNumber ?? unit.trimester ?? 1,
      trimester: (unit.trimester ?? unit.sectionNumber ?? 1) as 1 | 2 | 3,
      elements: unit.elements ?? unit.targetedResources ?? [],
      targetedResources: unit.targetedResources ?? unit.elements ?? [],
    });
  }

  // إذا حدد الأستاذ مادة غير العلوم الإسلامية، نرجع الوحدات الخاصة بتلك المادة فقط
  if (subjectId && subjectId !== 'ISLAMIC') {
    return Array.from(customMap.values())
      .filter((u) => u.subjectId === subjectId)
      .sort((a, b) => (a.sectionNumber || 1) - (b.sectionNumber || 1) || a.unitNumber - b.unitNumber);
  }

  // للعلوم الإسلامية أو الوضع العام: ندمج الحزمة الرسمية مع الوحدات المخصصة
  const mergedIslamic = OFFICIAL_CURRICULUM.map((official) => {
    const customOverride = customMap.get(official.id);
    if (customOverride) {
      customMap.delete(official.id);
      return {
        ...official,
        ...customOverride,
        subjectId: customOverride.subjectId || 'ISLAMIC',
      };
    }
    return official;
  });

  const remainingCustom = Array.from(customMap.values()).filter((u) =>
    subjectId === 'ISLAMIC' ? !u.subjectId || u.subjectId === 'ISLAMIC' : true,
  );

  return [...mergedIslamic, ...remainingCustom];
}

/**
 * توليد وحدات ابتدائية منظمة لأي مادة من المواد الـ 18 عند رغبة الأستاذ في الانطلاق من قالب قياسي
 */
export function buildStarterUnitsForTrack(params: {
  subjectId: SubjectId;
  levelCode: LevelCode;
  streamId: StreamId;
  legacyLevel?: GradeLevel;
  weeklyHours?: number;
}): CurriculumUnit[] {
  const subjectDef = SUBJECTS_BY_ID[params.subjectId];
  const streamDef = STREAMS_BY_ID[params.streamId];
  const { legacyGradeLevel } = resolveLevelAndStream({
    levelCode: params.levelCode,
    streamId: params.streamId,
    legacyGradeLevel: params.legacyLevel,
  });

  if (params.subjectId === 'ISLAMIC') {
    return getUnitsForTrack({
      subjectId: 'ISLAMIC',
      levelCode: params.levelCode,
      streamId: params.streamId,
      legacyLevel: legacyGradeLevel,
    });
  }

  const domains = subjectDef?.defaultDomains?.length
    ? subjectDef.defaultDomains
    : ['المجال التعلمي الأول', 'المجال التعلمي الثاني', 'المجال التعلمي الثالث'];

  const hoursPerWeek =
    params.weeklyHours ??
    resolveWeeklyHours({
      subjectId: params.subjectId,
      levelCode: params.levelCode,
      streamId: params.streamId,
    }).total;

  const trackKey = `${params.subjectId}:${params.levelCode}:${params.streamId}`;
  const streamLabel = streamDef?.shortAr || params.streamId;

  const units: CurriculumUnit[] = [];
  let unitNumber = 1;

  const trimesters: Array<1 | 2 | 3> = [1, 2, 3];
  for (const trimester of trimesters) {
    const sectionName =
      trimester === 1
        ? 'المقطع الأول (الفصل الأول: سبتمبر - ديسمبر)'
        : trimester === 2
        ? 'المقطع الثاني (الفصل الثاني: جانفي - مارس)'
        : 'المقطع الثالث (الفصل الثالث: أفريل - ماي)';
    for (let i = 0; i < 3; i++) {
      const domain = domains[(unitNumber - 1) % domains.length];
      const suggestedHours = Math.max(2, hoursPerWeek * 2);
      units.push({
        id: `starter-${params.subjectId}-${params.levelCode}-${params.streamId}-u${unitNumber}`,
        level: legacyGradeLevel,
        subjectId: params.subjectId,
        levelCode: params.levelCode,
        streamId: params.streamId,
        trackKey,
        sectionNumber: trimester,
        sectionName,
        unitNumber,
        domain,
        title: `الوحدة التعلمية ${unitNumber} (${subjectDef?.shortAr || params.subjectId} — ${streamLabel})`,
        hourlyVolume: suggestedHours,
        suggestedHours,
        trimester,
        learningObjective: `تمكين المتعلم من التحكم في كفاءات ${domain} وفق منهاج ${subjectDef?.labelAr || ''}.`,
        targetedCompetence: `تمكين المتعلم من التحكم في كفاءات ${domain} وفق منهاج ${subjectDef?.labelAr || ''}.`,
        targetCompetency: `تمكين المتعلم من التحكم في كفاءات ${domain} وفق منهاج ${subjectDef?.labelAr || ''}.`,
        targetedResources: [
          'الوضعية الانطلاقية وبناء المفاهيم الأساسية',
          'النشاطات التعلمية والتطبيقات الموجهة',
          'التقويم المرحلي ومعالجة الصعوبات',
        ],
        elements: [
          'الوضعية الانطلاقية وبناء المفاهيم الأساسية',
          'النشاطات التعلمية والتطبيقات الموجهة',
          'التقويم المرحلي ومعالجة الصعوبات',
        ],
        learningObjectives: [
          'استيعاب المفاهيم الأساسية للوحدة التعلمية وتوظيفها',
          'إنجاز التطبيقات والأنشطة المقررة بدقة منهجية',
        ],
        implementationMechanisms: ['الوضعية المشكلة', 'الحوار والمناقشة', 'العمل الفوجي التعاوني'],
        teachingStrategies: ['الوضعية المشكلة', 'الحوار والمناقشة', 'العمل الفوجي التعاوني'],
        didacticTools: ['الكتاب المدرسي المقرر', 'السبورة والوثائق المرفقة'],
        indicators: ['مدى قدرة المتعلم على توظيف مكتسبات الوحدة في وضعيات جديدة'],
        evaluationIndicators: ['مدى قدرة المتعلم على توظيف مكتسبات الوحدة في وضعيات جديدة'],
        isCompleted: false,
      });
      unitNumber++;
    }
  }

  return units;
}

/**
 * استرجاع وحدات المنهاج لمسار معين (مادة + مستوى + شعبة) مع دمج التعديلات المخصصة للأستاذ
 */
export function getUnitsForTrack(params: {
  subjectId?: SubjectId | null;
  levelCode?: LevelCode | null;
  streamId?: StreamId | null;
  legacyLevel?: GradeLevel | null;
  customUnits?: CurriculumUnit[];
}): CurriculumUnit[] {
  const { levelCode, streamId, legacyGradeLevel } = resolveLevelAndStream({
    levelCode: params.levelCode,
    streamId: params.streamId,
    legacyGradeLevel: params.legacyLevel,
  });

  const subjectId = params.subjectId || undefined;
  const trackKey = subjectId ? `${subjectId}:${levelCode}:${streamId}` : undefined;
  const customUnits = params.customUnits || [];

  if (!subjectId || subjectId === 'ISLAMIC') {
    const merged = getMergedCurriculumUnits(customUnits, 'ISLAMIC');
    return merged.filter((u) => u.level === legacyGradeLevel);
  }

  const matched = customUnits.filter((u) => {
    if (u.subjectId !== subjectId) return false;
    if (u.trackKey && trackKey) {
      return u.trackKey === trackKey;
    }
    if (u.levelCode && u.streamId) {
      return u.levelCode === levelCode && u.streamId === streamId;
    }
    return u.level === legacyGradeLevel;
  });

  return [...matched]
    .map((u) => ({
      ...u,
      hourlyVolume: u.hourlyVolume ?? u.suggestedHours ?? 2,
      suggestedHours: u.suggestedHours ?? u.hourlyVolume ?? 2,
      sectionNumber: u.sectionNumber ?? u.trimester ?? 1,
      trimester: (u.trimester ?? u.sectionNumber ?? 1) as 1 | 2 | 3,
      elements: u.elements ?? u.targetedResources ?? [],
      targetedResources: u.targetedResources ?? u.elements ?? [],
    }))
    .sort((a, b) => (a.sectionNumber || 1) - (b.sectionNumber || 1) || a.unitNumber - b.unitNumber);
}

export function getUnitsForLevel(
  level: GradeLevel,
  customUnits?: CurriculumUnit[],
  subjectId?: SubjectId | null,
  levelCode?: LevelCode | null,
  streamId?: StreamId | null,
): CurriculumUnit[] {
  return getUnitsForTrack({
    subjectId,
    levelCode,
    streamId,
    legacyLevel: level,
    customUnits,
  });
}

export function getLevelName(
  level: GradeLevel,
  levelCode?: LevelCode | null,
  streamId?: StreamId | null,
): string {
  const resolved = resolveLevelAndStream({
    levelCode,
    streamId,
    legacyGradeLevel: level,
  });
  const streamDef = STREAMS_BY_ID[resolved.streamId];
  if (streamDef && resolved.streamId !== 'UNCLASSIFIED') {
    const levelPrefix =
      resolved.levelCode === '1AS'
        ? 'السنة الأولى ثانوي'
        : resolved.levelCode === '2AS'
        ? 'السنة الثانية ثانوي'
        : 'السنة الثالثة ثانوي';
    return `${levelPrefix} — ${streamDef.labelAr}`;
  }

  switch (level) {
    case '1AS_SCIENCE':
      return 'السنة الأولى ثانوي — جذع مشترك علوم وتكنولوجيا';
    case '1AS_ARTS':
      return 'السنة الأولى ثانوي — جذع مشترك آداب';
    case '2AS':
      return 'السنة الثانية ثانوي';
    case '3AS':
      return 'السنة الثالثة ثانوي (بكالوريا)';
  }
}

export function getLevelShortName(
  level: GradeLevel,
  levelCode?: LevelCode | null,
  streamId?: StreamId | null,
): string {
  const resolved = resolveLevelAndStream({
    levelCode,
    streamId,
    legacyGradeLevel: level,
  });
  const streamDef = STREAMS_BY_ID[resolved.streamId];
  if (streamDef && resolved.streamId !== 'UNCLASSIFIED') {
    const num = resolved.levelCode === '1AS' ? '1' : resolved.levelCode === '2AS' ? '2' : '3';
    return `${num} ثانوي (${streamDef.shortAr})`;
  }

  switch (level) {
    case '1AS_SCIENCE':
      return '1 ج.م علوم وتكنولوجيا';
    case '1AS_ARTS':
      return '1 ج.م آداب';
    case '2AS':
      return '2 ثانوي';
    case '3AS':
      return '3 ثانوي';
  }
}

/**
 * حساب الحجم الساعي الأسبوعي لمادة في مستوى وشعبة محددة وفق القرار 186 المؤرخ في 23 مارس 2006
 */
export function getWeeklyHours(
  levelOrClass?:
    | GradeLevel
    | {
        level?: GradeLevel;
        levelCode?: LevelCode;
        streamId?: StreamId;
        weeklyHours?: number;
      }
    | null,
  optionsOrSubjectId?:
    | {
        subjectId?: SubjectId | null;
        levelCode?: LevelCode | null;
        streamId?: StreamId | null;
        overrides?: EducationOverrides | null;
      }
    | SubjectId
    | null,
  overridesArg?: EducationOverrides | null,
): number {
  const isClassObj = typeof levelOrClass === 'object' && levelOrClass !== null;
  const legacyGradeLevel = isClassObj ? levelOrClass.level || '2AS' : levelOrClass || '2AS';
  const classLevelCode = isClassObj ? levelOrClass.levelCode : undefined;
  const classStreamId = isClassObj ? levelOrClass.streamId : undefined;

  const options =
    typeof optionsOrSubjectId === 'string' || !optionsOrSubjectId
      ? {
          subjectId: optionsOrSubjectId ?? undefined,
          levelCode: classLevelCode,
          streamId: classStreamId,
          overrides: overridesArg,
        }
      : {
          ...optionsOrSubjectId,
          levelCode: optionsOrSubjectId.levelCode ?? classLevelCode,
          streamId: optionsOrSubjectId.streamId ?? classStreamId,
        };

  const hours = resolveWeeklyHours({
    legacyGradeLevel,
    subjectId: options.subjectId,
    levelCode: options.levelCode,
    streamId: options.streamId,
    overrides: options.overrides,
  });
  return hours.total;
}

export function getAnnualTeachingWeeks(overrides?: EducationOverrides | null): number {
  return overrides?.effectiveWeeks ?? 27;
}

export function getAnnualStatutoryHours(
  level?: GradeLevel | null,
  options?: {
    subjectId?: SubjectId | null;
    levelCode?: LevelCode | null;
    streamId?: StreamId | null;
    overrides?: EducationOverrides | null;
  },
): number {
  return getWeeklyHours(level, options) * getAnnualTeachingWeeks(options?.overrides);
}
