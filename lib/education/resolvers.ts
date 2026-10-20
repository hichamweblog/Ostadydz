import { OFFERINGS_2006 } from './data/offerings-2006';
import { SCHEMES_BY_ID } from './data/schemes';
import { ACTIVE_STREAMS, LEVEL_LABELS, LEVEL_SHORT_LABELS, STREAMS_BY_ID } from './data/streams';
import { ACTIVE_SUBJECTS, SUBJECT_VARIANTS, SUBJECTS_BY_ID } from './data/subjects';
import type {
  AssessmentSchemeDef,
  ComponentDef,
  CurriculumTrack,
  EducationOverrides,
  HoursDef,
  LevelCode,
  OfferingDef,
  StreamDef,
  StreamId,
  SubjectDef,
  SubjectId,
  VariantDef,
  VariantId,
} from './types';
import type { GradeLevel } from '../types';

export function getSubjectDef(subjectId?: SubjectId | string | null): SubjectDef | undefined {
  if (!subjectId) return undefined;
  return SUBJECTS_BY_ID[subjectId as SubjectId];
}

export function getVariantDef(variantId?: VariantId | string | null): VariantDef | undefined {
  if (!variantId) return undefined;
  return SUBJECT_VARIANTS[variantId as VariantId];
}

export function getStreamDef(streamId?: StreamId | string | null): StreamDef | undefined {
  if (!streamId) return undefined;
  return STREAMS_BY_ID[streamId as StreamId];
}

export function getSubjectDisplayName(
  subjectId?: SubjectId | string | null,
  variantId?: VariantId | string | null,
  short = false,
): string {
  const subject = getSubjectDef(subjectId);
  if (!subject) return 'لم تُحدّد المادة بعد';
  const baseLabel = short ? subject.shortAr : subject.labelAr;
  const variant = getVariantDef(variantId);
  if (variant && variant.subjectId === subject.id) {
    return `${baseLabel} (${short ? variant.shortAr : variant.labelAr})`;
  }
  return baseLabel;
}

/**
 * استرجاع العرض الرسمي وفق القرار 186/2006 لمستوى وشعبة ومادة محددة
 */
export function resolveOffering(params: {
  levelCode?: LevelCode | null;
  streamId?: StreamId | null;
  subjectId?: SubjectId | null;
  legacyGradeLevel?: GradeLevel | null;
}): OfferingDef | undefined {
  const subjectId = params.subjectId;
  if (!subjectId) return undefined;

  const { levelCode, streamId } = resolveLevelAndStream({
    levelCode: params.levelCode,
    streamId: params.streamId,
    legacyGradeLevel: params.legacyGradeLevel,
  });

  const exact = OFFERINGS_2006.find(
    (o) => o.levelCode === levelCode && o.streamId === streamId && o.subjectId === subjectId,
  );
  if (exact) return exact;

  // في حال كان القسم غير مصنف الشعبة (مثلاً 2AS عام)، نبحث عن عرض في نفس المستوى
  const sameLevel = OFFERINGS_2006.filter(
    (o) => o.levelCode === levelCode && o.subjectId === subjectId,
  );
  if (sameLevel.length > 0) {
    return sameLevel[0];
  }

  return OFFERINGS_2006.find((o) => o.subjectId === subjectId);
}

/**
 * تحويل آمن ثنائي الاتجاه بين (levelCode, streamId) و GradeLevel القديم
 */
export function resolveLevelAndStream(
  params?: {
    levelCode?: LevelCode | null;
    streamId?: StreamId | null;
    legacyGradeLevel?: GradeLevel | null;
    level?: GradeLevel | null;
  } | null,
): { levelCode: LevelCode; streamId: StreamId; legacyGradeLevel: GradeLevel } {
  const legacyArg = params?.legacyGradeLevel ?? params?.level;
  let levelCode: LevelCode = params?.levelCode || '1AS';
  let streamId: StreamId = params?.streamId || 'TC_SCI';

  if (!params?.levelCode && legacyArg) {
    if (legacyArg === '1AS_SCIENCE') {
      levelCode = '1AS';
      streamId = params?.streamId || 'TC_SCI';
    } else if (legacyArg === '1AS_ARTS') {
      levelCode = '1AS';
      streamId = params?.streamId || 'TC_ARTS';
    } else if (legacyArg === '2AS') {
      levelCode = '2AS';
      streamId = params?.streamId || 'EXP_SCI';
    } else if (legacyArg === '3AS') {
      levelCode = '3AS';
      streamId = params?.streamId || 'EXP_SCI';
    }
  } else if (params?.levelCode && !params?.streamId) {
    if (params.levelCode === '1AS') {
      streamId = legacyArg === '1AS_ARTS' ? 'TC_ARTS' : 'TC_SCI';
    } else {
      streamId = 'EXP_SCI';
    }
  }

  // تأكد من توافق الشعبة مع المستوى
  if (levelCode === '1AS' && streamId !== 'TC_SCI' && streamId !== 'TC_ARTS' && streamId !== 'UNCLASSIFIED') {
    streamId = 'TC_SCI';
  }
  if ((levelCode === '2AS' || levelCode === '3AS') && (streamId === 'TC_SCI' || streamId === 'TC_ARTS')) {
    streamId = 'EXP_SCI';
  }

  const legacyGradeLevel: GradeLevel =
    levelCode === '1AS'
      ? streamId === 'TC_ARTS'
        ? '1AS_ARTS'
        : '1AS_SCIENCE'
      : levelCode === '2AS'
      ? '2AS'
      : '3AS';

  return { levelCode, streamId, legacyGradeLevel };
}

/**
 * استرجاع الشعب المتاحة لمستوى معين أو لمادة معينة
 */
export function getStreamsForLevel(levelCode: LevelCode, subjectId?: SubjectId | null): StreamDef[] {
  const streamsForLevel = ACTIVE_STREAMS.filter((stream) => stream.levels.includes(levelCode));
  if (!subjectId) return streamsForLevel;

  const validStreamIds = new Set(
    OFFERINGS_2006.filter((o) => o.levelCode === levelCode && o.subjectId === subjectId).map(
      (o) => o.streamId,
    ),
  );
  const filtered = streamsForLevel.filter((s) => validStreamIds.has(s.id));
  return filtered.length > 0 ? filtered : streamsForLevel;
}

/**
 * استرجاع العروض الرسمية المقررة في مستوى وشعبة محددة وفق القرار 186/2006
 */
export function getSubjectsForStream(levelCode: LevelCode, streamId: StreamId): OfferingDef[] {
  return OFFERINGS_2006.filter((o) => o.levelCode === levelCode && o.streamId === streamId);
}

/**
 * استرجاع المواد المقررة رسمياً في مستوى وشعبة محددة وفق القرار 186/2006
 */
export function getSubjectsForLevelAndStream(
  levelCode: LevelCode,
  streamId: StreamId,
): SubjectDef[] {
  const offerings = getSubjectsForStream(levelCode, streamId);
  const subjectIds = new Set(offerings.map((o) => o.subjectId));
  return ACTIVE_SUBJECTS.filter((s) => subjectIds.has(s.id));
}

/**
 * استنتاج المواد التي يدرّسها الأستاذ لفوج معين:
 * 1. إذا كان الفوج يملك `subjectIds` صريحة ومختارة، نستخدمها.
 * 2. وإلا نأخذ تقاطع مواد الأستاذ المسندة `teacherSubjectIds` مع المواد المقررة لشعبة الفوج.
 * 3. إذا لم يوجد تقاطع (مثلاً قسم غير مصنف)، نعيد مواد الأستاذ المسندة كاملة.
 */
export function resolveClassAssignedSubjects(params: {
  classSubjectIds?: SubjectId[] | null;
  teacherSubjectIds?: SubjectId[] | null;
  primarySubjectId?: SubjectId | null;
  levelCode?: LevelCode | null;
  streamId?: StreamId | null;
  legacyGradeLevel?: GradeLevel | null;
}): SubjectId[] {
  const teacherList = normalizeSubjectList(params.teacherSubjectIds, params.primarySubjectId);

  if (params.classSubjectIds && params.classSubjectIds.length > 0) {
    const valid = params.classSubjectIds.filter((id) => Boolean(SUBJECTS_BY_ID[id]));
    if (valid.length > 0) return valid;
  }

  if (teacherList.length <= 1) {
    return teacherList;
  }

  const { levelCode, streamId } = resolveLevelAndStream({
    levelCode: params.levelCode,
    streamId: params.streamId,
    legacyGradeLevel: params.legacyGradeLevel,
  });

  if (streamId === 'UNCLASSIFIED') {
    return teacherList;
  }

  const streamSubjectIds = new Set(
    OFFERINGS_2006.filter((o) => o.levelCode === levelCode && o.streamId === streamId).map(
      (o) => o.subjectId,
    ),
  );

  const intersection = teacherList.filter((id) => streamSubjectIds.has(id));
  return intersection.length > 0 ? intersection : teacherList;
}

export function normalizeSubjectList(
  subjectIds?: SubjectId[] | null,
  primarySubjectId?: SubjectId | null,
): SubjectId[] {
  const result: SubjectId[] = [];
  if (primarySubjectId && SUBJECTS_BY_ID[primarySubjectId]) {
    result.push(primarySubjectId);
  }
  if (Array.isArray(subjectIds)) {
    for (const id of subjectIds) {
      if (SUBJECTS_BY_ID[id] && !result.includes(id)) {
        result.push(id);
      }
    }
  }
  return result;
}

/**
 * استرجاع المعامل الرسمي لمادة في مستوى وشعبة محددة
 */
export function resolveCoefficient(params: {
  levelCode?: LevelCode | null;
  streamId?: StreamId | null;
  subjectId?: SubjectId | null;
  legacyGradeLevel?: GradeLevel | null;
}): number | null {
  const offering = resolveOffering(params);
  return offering?.coefficient ?? null;
}

/**
 * استرجاع الحجم الساعي الأسبوعي لمادة في مستوى وشعبة محددة مع مراعاة تعديلات الأستاذ
 */
export function resolveWeeklyHours(params: {
  levelCode?: LevelCode | null;
  streamId?: StreamId | null;
  subjectId?: SubjectId | null;
  legacyGradeLevel?: GradeLevel | null;
  overrides?: EducationOverrides | null;
}): HoursDef {
  const { levelCode, streamId } = resolveLevelAndStream(params);
  const subjectId = params.subjectId;
  const trackKey = subjectId ? `${subjectId}:${levelCode}:${streamId}` : `${levelCode}:${streamId}`;

  const customTotal = params.overrides?.weeklyHours?.[trackKey];
  const offering = resolveOffering({ ...params, levelCode, streamId });

  if (typeof customTotal === 'number' && customTotal > 0) {
    return {
      ...(offering?.hours ?? { total: customTotal, classHours: customTotal }),
      total: customTotal,
    };
  }

  if (offering?.hours) {
    return offering.hours;
  }

  // احتياطي آمن
  if (levelCode === '1AS' && streamId === 'TC_SCI' && (!subjectId || subjectId === 'ISLAMIC')) {
    return { total: 1, classHours: 1 };
  }
  return { total: 2, classHours: 2 };
}

/**
 * استرجاع جميع العروض الرسمية المقررة لمادة معينة عبر المستويات والشعب وفق القرار 186/2006
 */
export function getOfferingsForSubject(subjectId?: SubjectId | null): OfferingDef[] {
  if (!subjectId) return [];
  return OFFERINGS_2006.filter((o) => o.subjectId === subjectId);
}

/**
 * استرجاع مخطط التقويم الفصلي لمادة مع تطبيق تخصيصات الأستاذ (`educationOverrides`)
 */
export function resolveEffectiveScheme(
  paramsOrSubjectId?:
    | {
        subjectId?: SubjectId | null;
        levelCode?: LevelCode | null;
        streamId?: StreamId | null;
        legacyGradeLevel?: GradeLevel | null;
        overrides?: EducationOverrides | null;
      }
    | SubjectId
    | null,
  levelCodeArg?: LevelCode | null,
  streamIdArg?: StreamId | null,
  overridesArg?: EducationOverrides | null,
): {
  scheme: AssessmentSchemeDef;
  activeComponents: ComponentDef[];
  devoirCount: number;
  divisor: number;
  hasPractical: boolean;
  hasOral: boolean;
  formulaDescriptionAr: string;
} {
  const params =
    typeof paramsOrSubjectId === 'string' || !paramsOrSubjectId
      ? {
          subjectId: paramsOrSubjectId ?? undefined,
          levelCode: levelCodeArg,
          streamId: streamIdArg,
          overrides: overridesArg,
        }
      : paramsOrSubjectId;

  const offering = resolveOffering(params);
  const subject = getSubjectDef(params.subjectId);
  const overrideBySubject = params.subjectId
    ? params.overrides?.schemeBySubject?.[params.subjectId]
    : undefined;
  const overrideKey = params.subjectId || offering?.schemeId || subject?.defaultSchemeId || 'STD4';
  const overrideFromSchemes = params.overrides?.schemes?.[overrideKey];
  const override = {
    ...overrideFromSchemes,
    ...overrideBySubject,
  };

  const baseSchemeId =
    override.schemeId ||
    offering?.schemeId ||
    subject?.defaultSchemeId ||
    'STD4';
  const baseScheme = SCHEMES_BY_ID[baseSchemeId] || SCHEMES_BY_ID.STD4;

  const devoirCount = Math.max(
    1,
    Math.min(
      2,
      override?.devoirCount ??
        baseScheme.components.find((c) => c.key === 'devoir')?.count?.default ??
        1,
    ),
  );

  const activeComponents: ComponentDef[] = [];

  for (const comp of baseScheme.components) {
    const compOverride = override?.components?.find((c) => c.key === comp.key);
    let enabled = compOverride?.enabled ?? true;
    if (comp.key === 'practical' && typeof override?.enablePracticalColumn === 'boolean') {
      enabled = override.enablePracticalColumn;
    }
    if (comp.key === 'oral' && typeof override?.enableOralColumn === 'boolean') {
      enabled = override.enableOralColumn;
    }
    if (!enabled && comp.key !== 'exam') {
      continue;
    }
    let weight =
      typeof compOverride?.weight === 'number' && compOverride.weight > 0
        ? compOverride.weight
        : comp.weight;
    if (comp.key === 'exam' && typeof override?.examWeight === 'number' && override.examWeight > 0) {
      weight = override.examWeight;
    }
    const labelAr = compOverride?.labelAr?.trim() || comp.labelAr;

    activeComponents.push({
      ...comp,
      weight,
      labelAr,
    });
  }

  // If teacher explicitly enabled Practical or Oral on a scheme that didn't have it by default
  if (
    override?.enablePracticalColumn === true &&
    !activeComponents.some((c) => c.key === 'practical')
  ) {
    activeComponents.splice(Math.max(0, activeComponents.length - 1), 0, {
      key: 'practical',
      kind: 'PRACTICAL',
      labelAr: 'الأعمال التطبيقية',
      shortAr: 'تطبيقي',
      weight: 1,
      required: true,
      storage: 'extraMarks',
    });
  }

  if (override?.enableOralColumn === true && !activeComponents.some((c) => c.key === 'oral')) {
    activeComponents.splice(Math.max(0, activeComponents.length - 1), 0, {
      key: 'oral',
      kind: 'ORAL',
      labelAr: 'التعبير الشفوي',
      shortAr: 'شفوي',
      weight: 1,
      required: true,
      storage: 'extraMarks',
    });
  }

  const divisor = activeComponents.reduce((sum, c) => sum + c.weight, 0) || 4;
  const hasPractical = activeComponents.some((c) => c.key === 'practical' || c.kind === 'PRACTICAL');
  const hasOral = activeComponents.some((c) => c.key === 'oral' || c.kind === 'ORAL');

  const partsLabel = activeComponents
    .map((c) => {
      if (c.key === 'devoir' && devoirCount === 2) {
        return c.weight > 1 ? `(معدل الفرضين × ${c.weight})` : 'معدل الفرضين';
      }
      return c.weight > 1 ? `${c.labelAr} × ${c.weight}` : c.labelAr;
    })
    .join(' + ');

  const formulaDescriptionAr = `(${partsLabel}) ÷ ${divisor}`;

  return {
    scheme: baseScheme,
    activeComponents,
    devoirCount,
    divisor,
    hasPractical,
    hasOral,
    formulaDescriptionAr,
  };
}

/**
 * توليد المسارات التدريسية (المستويات والشعب) لمادة معينة لبناء المنهاج والتوزيع السنوي
 * - بالنسبة للعلوم الإسلامية (أو المواد المشتركة الكثيفة)، يمكن تجميع مسارات 2AS و3AS أو عرض الشعب المقررة
 * - بالنسبة لبقية المواد التي يختلف حجمها الساعي ومعاملها حسب الشعبة، يتم إنشاء مسار واضح لكل (مستوى + شعبة) مقررة فيها المادة.
 */
export function getCurriculumTracksForSubject(
  subjectId?: SubjectId | null,
  overrides?: EducationOverrides | null,
): CurriculumTrack[] {
  const effectiveWeeks = overrides?.effectiveWeeks ?? 27;

  if (!subjectId) {
    return [];
  }

  // بالنسبة لمادة العلوم الإسلامية نستخدم المسارات الأربعة القياسية المتوافقة مع الحزمة الرسمية المدمجة،
  // مع السماح أيضاً باستعراض أي شعبة
  if (subjectId === 'ISLAMIC') {
    const tracks: Array<{ levelCode: LevelCode; streamId: StreamId; legacyLevel: GradeLevel; label: string }> = [
      { levelCode: '1AS', streamId: 'TC_SCI', legacyLevel: '1AS_SCIENCE', label: '1 ثانوي — ج.م علوم وتكنولوجيا' },
      { levelCode: '1AS', streamId: 'TC_ARTS', legacyLevel: '1AS_ARTS', label: '1 ثانوي — ج.م آداب' },
      { levelCode: '2AS', streamId: 'EXP_SCI', legacyLevel: '2AS', label: '2 ثانوي — جميع الشعب المشتركة' },
      { levelCode: '3AS', streamId: 'EXP_SCI', legacyLevel: '3AS', label: '3 ثانوي — جميع الشعب (بكالوريا)' },
    ];

    return tracks.map((t) => {
      const hours = resolveWeeklyHours({
        subjectId: 'ISLAMIC',
        levelCode: t.levelCode,
        streamId: t.streamId,
        overrides,
      });
      const coef = resolveCoefficient({
        subjectId: 'ISLAMIC',
        levelCode: t.levelCode,
        streamId: t.streamId,
      });
      return {
        trackKey: `ISLAMIC:${t.levelCode}:${t.streamId}`,
        subjectId: 'ISLAMIC',
        subjectLabelAr: SUBJECTS_BY_ID.ISLAMIC.labelAr,
        levelCode: t.levelCode,
        levelLabelAr: LEVEL_SHORT_LABELS[t.levelCode],
        streamId: t.streamId,
        streamLabelAr: t.label,
        legacyLevel: t.legacyLevel,
        weeklyHours: hours.total,
        classHours: hours.classHours,
        groupHours: hours.groupHours,
        annualHours: hours.total * effectiveWeeks,
        effectiveWeeks,
        coefficient: coef,
        subtitle: formatTrackSubtitle(hours, coef, effectiveWeeks),
      };
    });
  }

  const subjectOfferings = OFFERINGS_2006.filter((o) => o.subjectId === subjectId);
  const subjectDef = SUBJECTS_BY_ID[subjectId];

  // نجمع الشعب التي تتطابق في المستوى والحجم الساعي والمعامل لتسهيل بناء المنهاج دون تكرار ممل،
  // مع إبقاء الشعب المختلفة في الحجم الساعي أو المعامل منفصلة بوضوح.
  const tracks: CurriculumTrack[] = [];

  for (const offering of subjectOfferings) {
    const streamDef = STREAMS_BY_ID[offering.streamId];
    if (!streamDef || !streamDef.active) continue;

    const hours = resolveWeeklyHours({
      subjectId,
      levelCode: offering.levelCode,
      streamId: offering.streamId,
      overrides,
    });
    const { legacyGradeLevel } = resolveLevelAndStream({
      levelCode: offering.levelCode,
      streamId: offering.streamId,
    });

    tracks.push({
      trackKey: `${subjectId}:${offering.levelCode}:${offering.streamId}`,
      subjectId,
      subjectLabelAr: subjectDef?.labelAr ?? subjectId,
      levelCode: offering.levelCode,
      levelLabelAr: LEVEL_SHORT_LABELS[offering.levelCode],
      streamId: offering.streamId,
      streamLabelAr: `${LEVEL_SHORT_LABELS[offering.levelCode]} — ${streamDef.shortAr}`,
      legacyLevel: legacyGradeLevel,
      weeklyHours: hours.total,
      classHours: hours.classHours,
      groupHours: hours.groupHours,
      annualHours: hours.total * effectiveWeeks,
      effectiveWeeks,
      coefficient: offering.coefficient,
      subtitle: formatTrackSubtitle(hours, offering.coefficient, effectiveWeeks),
    });
  }

  return tracks;
}

export function formatTrackSubtitle(
  hours: HoursDef,
  coefficient: number | null,
  effectiveWeeks = 27,
): string {
  const parts: string[] = [];
  if (hours.groupHours && hours.groupHours > 0) {
    const classPart = hours.classHours ? `${hours.classHours} نظري + ` : '';
    parts.push(`${hours.total} سا/أسبوع (${classPart}${hours.groupHours} تطبيقي)`);
  } else {
    parts.push(`${hours.total} ${hours.total === 1 ? 'ساعة أسبوعياً' : hours.total === 2 ? 'ساعتان أسبوعياً' : 'ساعات أسبوعياً'}`);
  }
  if (coefficient !== null) {
    parts.push(`المعامل ${coefficient}`);
  }
  parts.push(`${hours.total * effectiveWeeks} سا سنوياً`);
  return parts.join(' · ');
}

export function formatClassAcademicBadge(params: {
  levelCode?: LevelCode | null;
  streamId?: StreamId | null;
  legacyGradeLevel?: GradeLevel | null;
}): string {
  const { levelCode, streamId } = resolveLevelAndStream(params);
  const stream = getStreamDef(streamId);
  if (!stream || streamId === 'UNCLASSIFIED') {
    return LEVEL_LABELS[levelCode];
  }
  return `${LEVEL_SHORT_LABELS[levelCode]} · ${stream.shortAr}`;
}
