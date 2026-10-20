import {
  ACTIVE_STREAMS,
  ACTIVE_SUBJECTS,
  getSubjectDisplayName,
  resolveClassAssignedSubjects,
  resolveCoefficient,
  resolveLevelAndStream,
  resolveWeeklyHours,
  SUBJECT_VARIANTS,
  type EducationOverrides,
  type LevelCode,
  type StreamId,
  type SubjectId,
  type VariantId,
} from './education';

export type {
  EducationOverrides,
  LevelCode,
  StreamId,
  SubjectId,
  VariantId,
};

export {
  ACTIVE_STREAMS,
  ACTIVE_SUBJECTS,
  getSubjectDisplayName,
  SUBJECT_VARIANTS,
};

export type GradeLevel = '1AS_ARTS' | '1AS_SCIENCE' | '2AS' | '3AS';

export type Term = 1 | 2 | 3;

export type AppTheme = 'light' | 'emerald' | 'blue' | 'slate' | 'amber' | 'violet' | 'rose' | string;
export type DashboardStyle = 'classic' | 'modern' | 'compact' | 'executive' | string;

export const PROFESSIONAL_RANKS = [
  'أستاذ التعليم الثانوي',
  'أستاذ رئيسي للتعليم الثانوي',
  'أستاذ مكون في التعليم الثانوي',
] as const;

export type ProfessionalRank = (typeof PROFESSIONAL_RANKS)[number];

export interface TeacherProfile {
  name: string;
  firstNameAr?: string;
  lastNameAr?: string;
  firstNameEn?: string;
  lastNameEn?: string;
  title?: string;
  schoolName: string;
  stateName?: string;
  wilaya?: string;
  academicYear: string;
  hijriYear?: string;
  email?: string;
  phone?: string;
  phoneNumber?: string;
  rank?: string;
  echelon?: string;
  subject?: string;
  subjectName?: string;
  primarySubjectId?: SubjectId;
  taughtSubjectIds?: SubjectId[];
  subjectIds?: SubjectId[];
  variantId?: VariantId;
  subjectVariantsById?: Partial<Record<SubjectId, VariantId>>;
  variantBySubjectId?: Partial<Record<SubjectId, VariantId>>;
  inspectorName?: string;
  directorName?: string;
  inspectionDistrict?: string;
  installationDate?: string;
  firstAppointmentDate?: string;
  experienceYears?: number;
  birthDate?: string;
  birthPlace?: string;
  gender?: 'M' | 'F';
  familyStatus?: string;
  lastInspectionDate?: string;
  lastInspectionNote?: number | string;
  avatarUrl?: string;
  avatarStorageKey?: string;
  preferredView?: string;
}

export interface ClassRoom {
  id: string;
  name: string;
  level: GradeLevel;
  stream: string;
  levelCode?: LevelCode;
  streamId?: StreamId;
  assignedSubjectIds?: SubjectId[];
  subjectIds?: SubjectId[];
  subjectVariantById?: Partial<Record<SubjectId, VariantId>>;
  academicYear?: string;
  weeklyHours?: number;
  roomNumber?: string;
  studentCount?: number;
  color?: string;
  notes?: string;
}

export interface Student {
  id: string;
  classId: string;
  numberInList: number;
  lastName?: string;
  firstName?: string;
  fullName: string;
  gender?: 'M' | 'F';
  birthDate?: string;
  birthPlace?: string;
  registrationNumber?: string;
  regNumber?: string;
  isRepeater?: boolean;
  repeating?: boolean;
  guardianPhone?: string;
  specialCase?: 'NONE' | 'EXEMPT' | 'MEDICAL' | 'TRANSFERRED' | string;
  notes?: string;
}

export interface StudentGrade {
  id: string;
  studentId: string;
  classId: string;
  subjectId?: SubjectId;
  trimester: 1 | 2 | 3;
  term?: Term;
  behaviorScore?: number | null;
  attendanceScore?: number | null;
  notebookScore?: number | null;
  participationScore?: number | null;
  behavior?: number;
  attendance?: number;
  notebook?: number;
  participation?: number;
  continuousEval: number | null;
  quiz: number | null;
  devoir2?: number | null;
  practicalWork?: number | null;
  oralExpression?: number | null;
  exam: number | null;
  calculatedAverage?: number | null;
  extraMarks?: Record<string, number | undefined>;
  remarks?: string;
  estimation?: string;
  guidance?: string;
  followUpNotes?: string;
  overrideAverage?: number;
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export interface AttendanceRecord {
  studentId: string;
  status: AttendanceStatus;
  note?: string;
}

export type BehaviorType =
  | 'DISRUPTION'
  | 'UNWRITTEN_LESSON'
  | 'GOOD_PARTICIPATION'
  | 'LACK_OF_PARTICIPATION'
  | 'FORGOT_BOOK'
  | 'EXCELLENCE'
  | 'NOTEBOOK_CHECK'
  | 'POSITIVE'
  | 'NEGATIVE';

export interface SessionBehavior {
  id?: string;
  studentId: string;
  type: BehaviorType;
  note?: string;
  pointsDelta?: number;
  timestamp?: string;
}

export type SessionType =
  | 'LESSON'
  | 'EXERCISES'
  | 'REMEDIATION'
  | 'INTEGRATION'
  | 'EXAM'
  | 'HOLIDAY'
  | 'CATCHUP'
  | 'PRACTICAL';

export type SessionStatus = 'PLANNED' | 'COMPLETED' | 'POSTPONED' | 'CANCELLED';

export type SessionKind = 'unit' | 'orientation' | 'custom' | string;

export interface SessionRecord {
  id: string;
  classId: string;
  subjectId?: SubjectId;
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
  unitId?: string;
  partNumber?: number;
  sessionKind?: SessionKind;
  sessionStatus?: SessionStatus;
  cancellationReason?: string;
  customTopic?: string;
  sessionType?: SessionType;
  status?: SessionStatus;
  title?: string;
  summary?: string;
  sessionGoals: string;
  accomplishments: string;
  nextSteps: string;
  teacherNotes: string;
  notes?: string;
  homework?: string;
  assignments?: string;
  completedAt?: string;
  postponedTo?: string;
  memoryWhatWorked?: string;
  memoryDifficulty?: string;
  memoryWhatFailed?: string;
  memoryNextTimeChange?: string;
  attendance: Record<string, AttendanceStatus>;
  disruptions?: string[];
  unwrittenLessons?: string[];
  poorParticipation?: string[];
  goodParticipation?: string[];
  behaviors?: SessionBehavior[];
}

export interface CurriculumUnit {
  id: string;
  subjectId?: SubjectId;
  level: GradeLevel;
  levelCode?: LevelCode;
  streamId?: StreamId;
  trackKey?: string;
  sectionNumber?: number;
  unitNumber: number;
  domain: string;
  sectionName?: string;
  title: string;
  elements?: string[];
  targetedResources?: string[];
  learningObjective?: string;
  learningObjectives?: string[];
  targetedCompetence?: string;
  targetCompetency?: string;
  targetedCompetencies?: string[];
  implementationMechanisms?: string[];
  teachingStrategies?: string[];
  didacticTools?: string[];
  teacherDirectives?: string[];
  pedagogicalDirectives?: string[];
  referenceTexts?: string[];
  indicators?: string[];
  evaluationIndicators?: string[];
  hourlyVolume?: number;
  suggestedHours?: number;
  suggestedTerm?: Term;
  trimester?: 1 | 2 | 3;
  SuggestedWeek?: number;
  suggestedWeek?: number;
  memorandumUrl?: string;
  memorandumPdfUrl?: string;
  pdfUrl?: string;
  pdfFileName?: string;
  isCustom?: boolean;
  isCompleted?: boolean;
}

export interface LessonPhase {
  title: string;
  durationMinutes: number;
  teacherActivity: string;
  studentActivity: string;
  contentSummary: string;
  evaluationType?: string;
}

export interface LessonPlan {
  id: string;
  classId?: string;
  unitId: string;
  subjectId?: SubjectId;
  level?: GradeLevel;
  levelCode?: LevelCode;
  streamId?: StreamId;
  title: string;
  domain?: string;
  targetCompetency?: string;
  learningObjectives?: string[];
  teachingAids?: string[];
  references?: string[];
  problemSituation?: string;
  phases?: LessonPhase[];
  evaluationExercises?: string[];
  homework?: string;
  selfReflection?: string;
  updatedAt?: string;
  [key: string]: any;
}

export type LessonProgressStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PLANNED'
  | 'NEEDS_REMEDIAL';

export type LessonStatus = LessonProgressStatus;

export interface ClassLessonProgress {
  id: string;
  classId: string;
  unitId: string;
  subjectId?: SubjectId;
  status: LessonProgressStatus;
  startedAt?: string;
  completedAt?: string;
  completedHours?: number;
  completedElements?: string[];
  lastSessionDate?: string;
  notes?: string;
}

export interface TimetableSlot {
  id: string;
  classId: string;
  subjectId?: SubjectId;
  dayOfWeek: 0 | 1 | 2 | 3 | 4;
  startTime: string;
  endTime: string;
  room?: string;
  type?: string;
  sessionType?: SessionType;
  biweekly?: boolean;
}

export type HolidayType = 'national' | 'religious' | 'school' | 'exam' | 'term';

export interface OfficialHoliday {
  id: string;
  name: string;
  type: HolidayType;
  dateStr: string;
  startDate?: string;
  endDate?: string;
  levels?: GradeLevel[];
  provisional?: boolean;
}

export type HolidayPeriod = OfficialHoliday;

export interface ExamPeriod {
  id: string;
  term: Term;
  name: string;
  startDate: string;
  endDate: string;
}

export interface ContinuousEvalRules {
  behaviorMax: number;
  attendanceMax: number;
  notebookMax: number;
  participationMax: number;
  disruptionDeduction: number;
  unwrittenLessonDeduction: number;
  unexcusedAbsenceDeduction: number;
  lateDeduction: number;
  lackOfParticipationDeduction?: number;
  participationBonus: number;
  maxScore?: number;
  showGuidanceAlerts?: boolean;
  exemptRuleSecondQuiz: string;
}

export interface AcademicCalendarSettings {
  academicYear?: string;
  schoolStartDate?: string;
  schoolEndDate?: string;
  termDates: {
    term1Start: string;
    term1End: string;
    term2Start: string;
    term2End: string;
    term3Start: string;
    term3End: string;
  };
  term1Start?: string;
  term1End?: string;
  term2Start?: string;
  term2End?: string;
  term3Start?: string;
  term3End?: string;
  holidays: OfficialHoliday[];
  examPeriods?: ExamPeriod[];
  evaluationRules: ContinuousEvalRules;
  timetableSettings: {
    dayStart: string;
    dayEnd: string;
    activeDays: number[];
  };
}

export interface DashboardTask {
  id: string;
  text: string;
  done: boolean;
  title?: string;
  completed?: boolean;
  dueDate?: string;
  category?: string;
  createdAt?: string;
}

export const LEVEL_NAMES: Record<GradeLevel, string> = {
  '1AS_ARTS': 'السنة الأولى ثانوي - جذع مشترك آداب',
  '1AS_SCIENCE': 'السنة الأولى ثانوي - جذع مشترك علوم وتكنولوجيا',
  '2AS': 'السنة الثانية ثانوي (جميع الشعب)',
  '3AS': 'السنة الثالثة ثانوي (جميع الشعب)',
};

export const SHORT_LEVEL_NAMES: Record<GradeLevel, string> = {
  '1AS_ARTS': '1 ج.م آداب',
  '1AS_SCIENCE': '1 ج.م علوم وتكنولوجيا',
  '2AS': '2 ثانوي',
  '3AS': '3 ثانوي',
};

export function mapLevelAndStreamToLegacyGradeLevel(
  levelCode: LevelCode,
  streamId: StreamId
): GradeLevel {
  if (levelCode === '1AS') {
    return streamId === 'TC_ARTS' ? '1AS_ARTS' : '1AS_SCIENCE';
  }
  if (levelCode === '2AS') return '2AS';
  return '3AS';
}

export function getClassLevelAndStream(
  cls: Pick<ClassRoom, 'level' | 'levelCode' | 'streamId'>
): { levelCode: LevelCode; streamId: StreamId; legacyGradeLevel: GradeLevel } {
  return resolveLevelAndStream({
    levelCode: cls.levelCode,
    streamId: cls.streamId,
    legacyGradeLevel: cls.level,
  });
}

export function getEffectiveClassSubjectId(
  cls: Pick<ClassRoom, 'level' | 'levelCode' | 'streamId' | 'assignedSubjectIds' | 'subjectIds'> | undefined | null,
  profile: Pick<TeacherProfile, 'primarySubjectId' | 'taughtSubjectIds' | 'subjectIds'> | undefined | null,
  activeSubjectId?: SubjectId
): SubjectId | undefined {
  const taught =
    profile?.taughtSubjectIds && profile.taughtSubjectIds.length > 0
      ? profile.taughtSubjectIds
      : profile?.subjectIds && profile.subjectIds.length > 0
      ? profile.subjectIds
      : profile?.primarySubjectId
      ? [profile.primarySubjectId]
      : [];

  if (!cls) {
    if (activeSubjectId && (taught.length === 0 || taught.includes(activeSubjectId))) {
      return activeSubjectId;
    }
    return profile?.primarySubjectId ?? taught[0];
  }

  const assigned = resolveClassAssignedSubjects({
    levelCode: cls.levelCode,
    streamId: cls.streamId,
    legacyGradeLevel: cls.level,
    teacherSubjectIds: taught,
    primarySubjectId: profile?.primarySubjectId,
    classSubjectIds: cls.assignedSubjectIds ?? cls.subjectIds,
  });

  if (activeSubjectId && assigned.includes(activeSubjectId)) {
    return activeSubjectId;
  }
  if (profile?.primarySubjectId && assigned.includes(profile.primarySubjectId)) {
    return profile.primarySubjectId;
  }
  if (assigned.length > 0) {
    return assigned[0];
  }
  return activeSubjectId ?? profile?.primarySubjectId ?? taught[0];
}

export function getClassCoefficient(
  clsOrLevel?:
    | Partial<Pick<ClassRoom, 'level' | 'levelCode' | 'streamId'>>
    | GradeLevel
    | null,
  subjectId?: SubjectId | null,
  _overrides?: EducationOverrides | null
): number | null {
  if (!clsOrLevel) {
    return resolveCoefficient({ subjectId });
  }
  if (typeof clsOrLevel === 'string') {
    return resolveCoefficient({ legacyGradeLevel: clsOrLevel, subjectId });
  }
  return resolveCoefficient({
    levelCode: clsOrLevel.levelCode,
    streamId: clsOrLevel.streamId,
    legacyGradeLevel: clsOrLevel.level,
    subjectId,
  });
}

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
  overridesArg?: EducationOverrides | null
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

  return resolveWeeklyHours({
    legacyGradeLevel,
    subjectId: options.subjectId,
    levelCode: options.levelCode,
    streamId: options.streamId,
    overrides: options.overrides,
  }).total;
}
