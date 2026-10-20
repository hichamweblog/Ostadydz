import { v4 as uuidv4 } from 'uuid';
import {
  resolveWeeklyHours,
  SUBJECTS_BY_ID,
  type LevelCode,
  type StreamId,
  type SubjectId,
  type VariantId,
} from './education';
import { buildStarterUnitsForTrack, OFFICIAL_CURRICULUM_1AS_SCIENCE, OFFICIAL_CURRICULUM_2AS, OFFICIAL_CURRICULUM_3AS } from './curriculum-data';
import { calculateStudentAverage, getObservation } from './grade-calculator';
import type { AppState } from './storage';
import type {
  ClassLessonProgress,
  ClassRoom,
  CurriculumUnit,
  GradeLevel,
  LessonPlan,
  SessionRecord,
  Student,
  StudentGrade,
  TimetableSlot,
} from './types';

export interface PracticalTrialOptions {
  name?: string;
  schoolName?: string;
  stateName?: string;
  primarySubjectId?: SubjectId;
  taughtSubjectIds?: SubjectId[];
  variantId?: VariantId;
}

const SAMPLE_STUDENT_NAMES: Array<{ firstName: string; lastName: string; gender: 'M' | 'F'; birthDate: string }> = [
  { lastName: 'بن علي', firstName: 'محمد أمين', gender: 'M', birthDate: '2009-03-14' },
  { lastName: 'بوزيد', firstName: 'سارة', gender: 'F', birthDate: '2009-07-22' },
  { lastName: 'قاسمي', firstName: 'عبد الرحمان', gender: 'M', birthDate: '2008-11-05' },
  { lastName: 'مراد', firstName: 'آية', gender: 'F', birthDate: '2009-01-19' },
  { lastName: 'بلقاسم', firstName: 'ياسين', gender: 'M', birthDate: '2009-05-30' },
  { lastName: 'عماري', firstName: 'مريم', gender: 'F', birthDate: '2009-09-12' },
  { lastName: 'حماني', firstName: 'إلياس', gender: 'M', birthDate: '2008-12-25' },
  { lastName: 'سليماني', firstName: 'نور الهدى', gender: 'F', birthDate: '2009-04-08' },
  { lastName: 'تومي', firstName: 'آدم', gender: 'M', birthDate: '2009-08-17' },
  { lastName: 'رحماني', firstName: 'إيناس', gender: 'F', birthDate: '2009-02-27' },
  { lastName: 'بن يحيى', firstName: 'أسامة', gender: 'M', birthDate: '2010-01-11' },
  { lastName: 'شريف', firstName: 'سلسبيل', gender: 'F', birthDate: '2010-06-03' },
  { lastName: 'مختاري', firstName: 'أيمن', gender: 'M', birthDate: '2010-03-21' },
  { lastName: 'بن عمر', firstName: 'خديجة', gender: 'F', birthDate: '2010-10-09' },
  { lastName: 'زروقي', firstName: 'بلال', gender: 'M', birthDate: '2010-04-16' },
  { lastName: 'لعماري', firstName: 'فاطمة الزهراء', gender: 'F', birthDate: '2010-07-29' },
  { lastName: 'بومدين', firstName: 'حمزة', gender: 'M', birthDate: '2010-11-18' },
  { lastName: 'عيساوي', firstName: 'أماني', gender: 'F', birthDate: '2010-02-04' },
  { lastName: 'منصوري', firstName: 'صهيب', gender: 'M', birthDate: '2010-08-23' },
  { lastName: 'خليفي', firstName: 'شيماء', gender: 'F', birthDate: '2010-05-14' },
  { lastName: 'بوشوشة', firstName: 'زكريا', gender: 'M', birthDate: '2011-01-30' },
  { lastName: 'دراجي', firstName: 'ريان', gender: 'F', birthDate: '2011-03-12' },
  { lastName: 'عطوي', firstName: 'وليد', gender: 'M', birthDate: '2011-06-25' },
  { lastName: 'تواتي', firstName: 'هدى', gender: 'F', birthDate: '2011-09-07' },
];

export function buildPracticalTrialState(
  baseState: AppState,
  options: PracticalTrialOptions = {},
): AppState {
  const existingSubjects =
    options.taughtSubjectIds?.length
      ? options.taughtSubjectIds
      : baseState.profile.taughtSubjectIds?.length
      ? baseState.profile.taughtSubjectIds
      : baseState.profile.primarySubjectId
      ? [baseState.profile.primarySubjectId]
      : (['ISLAMIC'] as SubjectId[]);

  const primarySubjectId: SubjectId =
    options.primarySubjectId ??
    baseState.profile.primarySubjectId ??
    existingSubjects[0] ??
    'ISLAMIC';

  const taughtSubjectIds: SubjectId[] = Array.from(
    new Set<SubjectId>([primarySubjectId, ...existingSubjects]),
  );

  const primarySubjectMeta = SUBJECTS_BY_ID[primarySubjectId];
  const teacherName =
    options.name?.trim() ||
    (baseState.profile.name && baseState.profile.name !== 'أستاذ المادة'
      ? baseState.profile.name
      : 'عبد الرحمان بن خلدون');
  const schoolName =
    options.schoolName?.trim() ||
    baseState.profile.schoolName ||
    'ثانوية الأمير عبد القادر';
  const stateName =
    options.stateName?.trim() ||
    baseState.profile.stateName ||
    'الجزائر وسط';

  const classSpecs: Array<{
    name: string;
    level: GradeLevel;
    levelCode: LevelCode;
    streamId: StreamId;
    stream: string;
    roomNumber: string;
    color: string;
  }> = [
    {
      name: '3 ع ت 1',
      level: '3AS',
      levelCode: '3AS',
      streamId: 'EXP_SCI',
      stream: 'علوم تجريبية',
      roomNumber: 'قاعة 12',
      color: 'emerald',
    },
    {
      name: '2 آ ف 1',
      level: '2AS',
      levelCode: '2AS',
      streamId: 'LIT_PHIL',
      stream: 'آداب وفلسفة',
      roomNumber: 'قاعة 07',
      color: 'blue',
    },
    {
      name: '1 ج م ع ت 2',
      level: '1AS_SCIENCE',
      levelCode: '1AS',
      streamId: 'TC_SCI',
      stream: 'جذع مشترك علوم وتكنولوجيا',
      roomNumber: 'قاعة 04',
      color: 'amber',
    },
  ];

  const classes: ClassRoom[] = classSpecs.map((spec) => {
    const weeklyHours = resolveWeeklyHours({
      subjectId: primarySubjectId,
      levelCode: spec.levelCode,
      streamId: spec.streamId,
      overrides: baseState.educationOverrides,
    }).total;
    return {
      id: uuidv4(),
      name: spec.name,
      level: spec.level,
      levelCode: spec.levelCode,
      streamId: spec.streamId,
      stream: spec.stream,
      assignedSubjectIds: taughtSubjectIds,
      subjectIds: taughtSubjectIds,
      weeklyHours: Math.max(1, weeklyHours || 2),
      roomNumber: spec.roomNumber,
      academicYear: '2026 - 2027',
      color: spec.color,
    };
  });

  const students: Student[] = [];
  classes.forEach((cls, classIndex) => {
    const slice = SAMPLE_STUDENT_NAMES.slice(classIndex * 8, classIndex * 8 + 8);
    slice.forEach((person, idx) => {
      const regNum = `2026${classIndex + 1}${String(idx + 1).padStart(4, '0')}`;
      students.push({
        id: uuidv4(),
        classId: cls.id,
        numberInList: idx + 1,
        lastName: person.lastName,
        firstName: person.firstName,
        fullName: `${person.lastName} ${person.firstName}`,
        gender: person.gender,
        birthDate: person.birthDate,
        birthPlace: stateName,
        registrationNumber: regNum,
        regNumber: regNum,
      });
    });
  });

  // Build starter custom units for non-ISLAMIC subjects so Curriculum & Annual Distribution are populated
  const customUnits: CurriculumUnit[] = [...(baseState.customUnits || [])];
  for (const subjectId of taughtSubjectIds) {
    if (subjectId === 'ISLAMIC') continue;
    for (const cls of classes) {
      const starter = buildStarterUnitsForTrack({
        subjectId,
        levelCode: cls.levelCode || '3AS',
        streamId: cls.streamId || 'EXP_SCI',
        legacyLevel: cls.level,
        weeklyHours: cls.weeklyHours,
      });
      for (const unit of starter) {
        if (!customUnits.some((existing) => existing.id === unit.id)) {
          customUnits.push(unit);
        }
      }
    }
  }

  const getUnitsForClassAndSubject = (cls: ClassRoom, subjectId: SubjectId): CurriculumUnit[] => {
    if (subjectId === 'ISLAMIC') {
      if (cls.level === '3AS') return OFFICIAL_CURRICULUM_3AS;
      if (cls.level === '2AS') return OFFICIAL_CURRICULUM_2AS;
      return OFFICIAL_CURRICULUM_1AS_SCIENCE;
    }
    return customUnits.filter(
      (u) => u.subjectId === subjectId && u.levelCode === cls.levelCode && u.streamId === cls.streamId,
    );
  };

  // Timetable across Sunday..Thursday (0..4)
  const timetable: TimetableSlot[] = [
    {
      id: uuidv4(),
      classId: classes[0].id,
      subjectId: primarySubjectId,
      dayOfWeek: 0,
      startTime: '08:00',
      endTime: '09:00',
      room: classes[0].roomNumber,
      sessionType: 'LESSON',
    },
    {
      id: uuidv4(),
      classId: classes[1].id,
      subjectId: primarySubjectId,
      dayOfWeek: 0,
      startTime: '10:00',
      endTime: '11:00',
      room: classes[1].roomNumber,
      sessionType: 'LESSON',
    },
    {
      id: uuidv4(),
      classId: classes[2].id,
      subjectId: primarySubjectId,
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '10:00',
      room: classes[2].roomNumber,
      sessionType: 'LESSON',
    },
    {
      id: uuidv4(),
      classId: classes[0].id,
      subjectId: primarySubjectId,
      dayOfWeek: 2,
      startTime: '08:00',
      endTime: '09:00',
      room: classes[0].roomNumber,
      sessionType: 'LESSON',
    },
    {
      id: uuidv4(),
      classId: classes[1].id,
      subjectId: taughtSubjectIds[1] ?? primarySubjectId,
      dayOfWeek: 3,
      startTime: '11:00',
      endTime: '12:00',
      room: classes[1].roomNumber,
      sessionType: 'LESSON',
    },
    {
      id: uuidv4(),
      classId: classes[2].id,
      subjectId: primarySubjectId,
      dayOfWeek: 4,
      startTime: '10:00',
      endTime: '11:00',
      room: classes[2].roomNumber,
      sessionType: 'EXERCISES',
    },
  ];

  // Lesson Progress & Sessions
  const lessonProgress: ClassLessonProgress[] = [];
  const sessions: SessionRecord[] = [];
  const todayIso = new Date().toISOString().slice(0, 10);

  classes.forEach((cls) => {
    const units = getUnitsForClassAndSubject(cls, primarySubjectId);
    const classStudents = students.filter((s) => s.classId === cls.id);

    if (units[0]) {
      lessonProgress.push({
        id: uuidv4(),
        classId: cls.id,
        unitId: units[0].id,
        subjectId: primarySubjectId,
        status: 'COMPLETED',
        startedAt: '2026-09-22',
        completedAt: '2026-09-29',
        completedHours: 2,
      });
    }
    if (units[1]) {
      lessonProgress.push({
        id: uuidv4(),
        classId: cls.id,
        unitId: units[1].id,
        subjectId: primarySubjectId,
        status: 'IN_PROGRESS',
        startedAt: '2026-10-06',
        completedHours: 1,
      });
    }

    const attendanceMap: Record<string, 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'> = {};
    classStudents.forEach((st, idx) => {
      attendanceMap[st.id] = idx === 2 ? 'ABSENT' : idx === 5 ? 'LATE' : 'PRESENT';
    });

    sessions.push({
      id: uuidv4(),
      classId: cls.id,
      subjectId: primarySubjectId,
      unitId: units[0]?.id,
      partNumber: 1,
      sessionKind: 'unit',
      sessionStatus: 'COMPLETED',
      status: 'COMPLETED',
      sessionType: 'LESSON',
      date: todayIso,
      startTime: '08:00',
      endTime: '09:00',
      room: cls.roomNumber,
      title: units[0]?.title || `حصة تطبيقية — ${cls.name}`,
      sessionGoals:
        units[0]?.learningObjective ||
        'تحليل الوضعية الانطلاقية واستخراج المفاهيم والأحكام الأساسية للوحدة.',
      accomplishments:
        'تم تقديم الوضعية المشكلة، مناقشة السندات التربوية مع المتعلمين، وتدوين خلاصة العناصر الأساسية على السبورة.',
      nextSteps: 'إنجاز تطبيقات تقويمية مرحلية في بداية الحصة المقبلة.',
      teacherNotes: 'مشاركة متميزة وتفاعل إيجابي من أغلب فوج التلاميذ.',
      notes: 'مشاركة متميزة وتفاعل إيجابي من أغلب فوج التلاميذ.',
      attendance: attendanceMap,
      goodParticipation: classStudents.slice(0, 3).map((s) => s.id),
      unwrittenLessons: classStudents[6] ? [classStudents[6].id] : [],
    });
  });

  // Grades across assigned subjects for Trimester 1
  const grades: StudentGrade[] = [];
  for (const subjectId of taughtSubjectIds) {
    for (const cls of classes) {
      const classStudents = students.filter((s) => s.classId === cls.id);
      classStudents.forEach((st, idx) => {
        const behaviorScore = 5;
        const attendanceScore = idx === 2 ? 4 : 5;
        const notebookScore = idx === 6 ? 3.5 : 4.5;
        const participationScore = idx < 3 ? 5 : 4;
        const continuousEval = Number(
          (behaviorScore + attendanceScore + notebookScore + participationScore).toFixed(2),
        );
        const quiz = Number(Math.min(19.5, 11.5 + ((idx * 1.25) % 7.5)).toFixed(2));
        const practicalWork = Number(Math.min(19, 12.5 + ((idx * 1.1) % 6.5)).toFixed(2));
        const oralExpression = Number(Math.min(19, 13 + ((idx * 0.9) % 6)).toFixed(2));
        const exam = Number(Math.min(19, 10.5 + ((idx * 1.35) % 8.5)).toFixed(2));

        const calculatedAverage = calculateStudentAverage(continuousEval, quiz, exam, {
          subjectId,
          levelCode: cls.levelCode,
          streamId: cls.streamId,
          legacyLevel: cls.level,
          overrides: baseState.educationOverrides,
          practicalWork,
          oralExpression,
        });

        grades.push({
          id: uuidv4(),
          studentId: st.id,
          classId: cls.id,
          subjectId,
          trimester: 1,
          term: 1,
          behaviorScore,
          attendanceScore,
          notebookScore,
          participationScore,
          behavior: behaviorScore,
          attendance: attendanceScore,
          notebook: notebookScore,
          participation: participationScore,
          continuousEval,
          quiz,
          practicalWork,
          oralExpression,
          exam,
          calculatedAverage: calculatedAverage ?? null,
          remarks: calculatedAverage !== undefined && calculatedAverage !== null ? getObservation(calculatedAverage) : 'عمل مقبول',
        });
      });
    }
  }

  // Sample Lesson Plan
  const firstUnit = getUnitsForClassAndSubject(classes[0], primarySubjectId)[0];
  const lessonPlans: LessonPlan[] = firstUnit
    ? [
        {
          id: uuidv4(),
          classId: classes[0].id,
          unitId: firstUnit.id,
          subjectId: primarySubjectId,
          level: classes[0].level,
          levelCode: classes[0].levelCode,
          streamId: classes[0].streamId,
          title: firstUnit.title,
          domain: firstUnit.domain,
          targetCompetency:
            firstUnit.targetedCompetence ||
            'القدرة على تحليل السندات واستخلاص المفاهيم وتوظيفها في وضعيات دالة.',
          learningObjectives: firstUnit.elements?.slice(0, 3) || [
            'ضبط المفهوم الاصطلاحي للوحدة',
            'استنتاج العناصر والأحكام الأساسية',
            'توظيف المكتسبات في وضعيات تقويمية',
          ],
          teachingAids: ['السبورة', 'الكتاب المدرسي', 'بطاقات السندات التربوية'],
          problemSituation:
            'انطلاقاً من سياق واقعي مرتبط بحياة المتعلم، كيف يمكن توظيف معارف هذه الوحدة لحل الإشكالية المطروحة؟',
          phases: [
            {
              title: 'مرحلة الانطلاق وتقديم الوضعية المشكلة',
              durationMinutes: 10,
              teacherActivity: 'طرح الإشكالية ومناقشة المكتسبات القبلية وتوجيه المتعلمين.',
              studentActivity: 'قراءة السند، استخراج الإشكالية، وتقديم الفرضيات الأولية.',
              contentSummary: 'تهيئة المتعلمين وضبط عنوان الوحدة وعناصرها.',
            },
            {
              title: 'مرحلة بناء التعلمات والتحليل',
              durationMinutes: 35,
              teacherActivity: 'توزيع مهام العمل الفوجي، مرافقة النقاش، وتثبيت الخلاصات الجزئية.',
              studentActivity: 'تحليل السندات، استنباط المفاهيم، وتدوين الملخص على الكراس.',
              contentSummary: (firstUnit.elements || ['العنصر الأول', 'العنصر الثاني']).join(' • '),
            },
            {
              title: 'مرحلة التقويم المرحلي والاستثمار',
              durationMinutes: 15,
              teacherActivity: 'تقديم نشاط تقويمي ختامي وتصحيح التمثلات الخاطئة.',
              studentActivity: 'الإجابة الفردية عن الأسئلة التقويمية وتصويب الأخطاء.',
              contentSummary: 'تقويم مدى تحقق مؤشرات الكفاءة المستهدفة.',
            },
          ],
          homework: 'مراجعة عناصر الوحدة وحل التمرين التطبيقي ص 24.',
          updatedAt: new Date().toISOString(),
        },
      ]
    : [];

  return {
    ...baseState,
    activeSubjectId: primarySubjectId,
    activeClassId: classes[0].id,
    activeTrimester: 1,
    onboardingDismissed: true,
    profile: {
      ...baseState.profile,
      name: teacherName,
      schoolName,
      stateName,
      academicYear: '2026 - 2027',
      rank: baseState.profile.rank || 'أستاذ التعليم الثانوي',
      primarySubjectId,
      taughtSubjectIds,
      subjectIds: taughtSubjectIds,
      variantId: options.variantId ?? baseState.profile.variantId,
      subjectName: primarySubjectMeta?.labelAr ?? baseState.profile.subjectName,
    },
    classes,
    students,
    timetable,
    customUnits,
    lessonProgress,
    sessions,
    grades,
    lessonPlans,
    dashboardTasks: [
      { id: `t-${uuidv4()}`, text: `مراجعة سجل الحضور والنقاط لقسم ${classes[0].name}`, done: false },
      { id: `t-${uuidv4()}`, text: `تصدير التوزيع السنوي ومذكرة ${firstUnit?.title || 'الوحدة الأولى'}`, done: false },
      { id: `t-${uuidv4()}`, text: `تحليل نتائج مجلس القسم للفصل الأول (${classes[1].name})`, done: true },
    ],
  };
}
