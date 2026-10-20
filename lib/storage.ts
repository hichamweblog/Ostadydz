import {
  AcademicCalendarSettings,
  AppTheme,
  ClassLessonProgress,
  ClassRoom,
  CurriculumUnit,
  DashboardStyle,
  EducationOverrides,
  LessonPlan,
  SessionRecord,
  Student,
  StudentGrade,
  SubjectId,
  TeacherProfile,
  TimetableSlot,
} from "./types";
import {
  OFFICIAL_HOLIDAYS_2026_2027,
  normalizeCalendarSettings,
} from "./academic-calendar";

export interface LastWorkspace {
  route: 'attendance' | 'sessions' | 'grades';
  classId: string | null;
  sessionId?: string;
  gradeColumn?: 'continuousEval' | 'quiz' | 'exam';
  updatedAt: string;
}

export interface AppState {
  profile: TeacherProfile;
  classes: ClassRoom[];
  timetable: TimetableSlot[];
  students: Student[];
  sessions: SessionRecord[];
  grades: StudentGrade[];
  lessonProgress: ClassLessonProgress[];
  customUnits: CurriculumUnit[];
  lessonPlans: LessonPlan[];
  dashboardTasks?: Array<{ id: string; text: string; done: boolean }>;
  unitPdfFiles?: {
    [unitId: string]: {
      fileName: string;
      fileDataUrl?: string;
      fileStorageKey?: string;
      cloudStoragePath?: string;
      fileUrl?: string;
      uploadedAt: string;
    };
  };
  activeClassId: string | null;
  activeSubjectId?: SubjectId | null;
  educationOverrides?: EducationOverrides;
  activeTrimester: 1 | 2 | 3;
  calendarSettings?: AcademicCalendarSettings;
  theme?: AppTheme;
  dashboardStyle?: DashboardStyle;
  sidebarCollapsed?: boolean;
  onboardingDismissed?: boolean;
  lastWorkspace?: LastWorkspace;
  deletedRecordIds?: string[];
  cloudRevision?: number;
}

const BACKUP_VERSION = "2.1.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function validateAppState(value: unknown): value is AppState {
  if (!isRecord(value)) return false;
  const validTrimester =
    value.activeTrimester === 1 ||
    value.activeTrimester === 2 ||
    value.activeTrimester === 3;
  const classes =
    isArray(value.classes) &&
    value.classes.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string",
    );
  const students =
    isArray(value.students) &&
    value.students.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.classId === "string" &&
        typeof item.fullName === "string",
    );
  const grades =
    isArray(value.grades) &&
    value.grades.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.studentId === "string" &&
        (item.continuousEval === null ||
          (typeof item.continuousEval === "number" &&
            item.continuousEval >= 0 &&
            item.continuousEval <= 20)) &&
        (item.quiz === null ||
          (typeof item.quiz === "number" &&
            item.quiz >= 0 &&
            item.quiz <= 20)) &&
        (item.exam === null ||
          (typeof item.exam === "number" && item.exam >= 0 && item.exam <= 20)) &&
        (item.devoir2 === undefined ||
          item.devoir2 === null ||
          (typeof item.devoir2 === "number" && item.devoir2 >= 0 && item.devoir2 <= 20)) &&
        (item.practicalWork === undefined ||
          item.practicalWork === null ||
          (typeof item.practicalWork === "number" && item.practicalWork >= 0 && item.practicalWork <= 20)) &&
        (item.oralExpression === undefined ||
          item.oralExpression === null ||
          (typeof item.oralExpression === "number" && item.oralExpression >= 0 && item.oralExpression <= 20)),
    );
  return (
    isRecord(value.profile) &&
    classes &&
    isArray(value.timetable) &&
    students &&
    isArray(value.sessions) &&
    grades &&
    isArray(value.lessonProgress) &&
    isArray(value.customUnits) &&
    isArray(value.lessonPlans) &&
    (value.activeClassId === null || typeof value.activeClassId === "string") &&
    validTrimester
  );
}

function normalizeImportedState(value: unknown): AppState {
  if (!validateAppState(value)) {
    throw new Error("النسخة الاحتياطية لا تطابق بنية بيانات التطبيق المعتمدة");
  }

  const defaults = getInitialState();
  const defaultCalendarSettings =
    defaults.calendarSettings ?? DEFAULT_CALENDAR_SETTINGS;
  return {
    ...defaults,
    ...value,
    profile: { ...defaults.profile, ...value.profile },
    classes: value.classes.map((item) => ({
      ...item,
      color: typeof item.color === "string" ? item.color : undefined,
    })),
    timetable: value.timetable,
    students: value.students,
    sessions: value.sessions,
    grades: value.grades,
    lessonProgress: value.lessonProgress,
    customUnits: value.customUnits,
    lessonPlans: value.lessonPlans,
    calendarSettings: normalizeCalendarSettings(
      isRecord(value.calendarSettings)
        ? (value.calendarSettings as unknown as AcademicCalendarSettings)
        : undefined,
      defaultCalendarSettings,
    ),
  };
}

export const DEFAULT_CALENDAR_SETTINGS: AcademicCalendarSettings = {
  termDates: {
    term1Start: "2026-09-01",
    term1End: "2026-12-15",
    term2Start: "2026-12-16",
    term2End: "2027-03-15",
    term3Start: "2027-03-16",
    term3End: "2027-06-30",
  },
  holidays: OFFICIAL_HOLIDAYS_2026_2027,
  evaluationRules: {
    behaviorMax: 5,
    attendanceMax: 5,
    notebookMax: 5,
    participationMax: 5,
    disruptionDeduction: 0.5,
    unwrittenLessonDeduction: 0.5,
    // Phase 6: unexcused absence now deducts 0.5 by default, like every other rule.
    unexcusedAbsenceDeduction: 0.5,
    lateDeduction: 0.5,
    participationBonus: 0.5,
    maxScore: 20,
    showGuidanceAlerts: true,
    exemptRuleSecondQuiz: "القاعدة المعتمدة: حساب معدل الفروض آلياً حسب مخطط المادة وتخصيصات الأستاذ",
  },
  timetableSettings: {
    dayStart: "08:00 AM",
    dayEnd: "05:00 PM",
    activeDays: [0, 1, 2, 3, 4],
  },
};

export const DEFAULT_PROFILE: TeacherProfile = {
  name: "أستاذ المادة",
  firstNameAr: "",
  lastNameAr: "",
  firstNameEn: "",
  lastNameEn: "",
  email: "",
  title: "أستاذ قسم أول",
  schoolName: "",
  stateName: "",
  academicYear: "2026/2027",
  hijriYear: "1448 هـ",
  experienceYears: 0,
  birthDate: "",
  birthPlace: "",
  gender: "M",
  familyStatus: "",
};

export const INITIAL_CLASSES: ClassRoom[] = [
  {
    id: "cls-3as-sci1",
    name: "3 علوم تجريبية 1",
    level: "3AS",
    stream: "علوم تجريبية",
    roomNumber: "القاعة 04",
    color: "#0d9488",
  },
  {
    id: "cls-3as-math1",
    name: "3 رياضيات 1",
    level: "3AS",
    stream: "رياضيات",
    roomNumber: "القاعة 06",
    color: "#0284c7",
  },
  {
    id: "cls-3as-lit1",
    name: "3 آداب وفلسفة 2",
    level: "3AS",
    stream: "آداب وفلسفة",
    roomNumber: "القاعة 12",
    color: "#d97706",
  },
  {
    id: "cls-2as-sci1",
    name: "2 علوم تجريبية 1",
    level: "2AS",
    stream: "علوم تجريبية",
    roomNumber: "القاعة 05",
    color: "#10b981",
  },
  {
    id: "cls-2as-lang1",
    name: "2 لغات أجنبية 1",
    level: "2AS",
    stream: "لغات أجنبية",
    roomNumber: "القاعة 08",
    color: "#8b5cf6",
  },
  {
    id: "cls-1as-arts1",
    name: "1 ج.م آداب 1",
    level: "1AS_ARTS",
    stream: "جذع مشترك آداب",
    roomNumber: "القاعة 02",
    color: "#ea580c",
  },
  {
    id: "cls-1as-sci1",
    name: "1 ج.م علوم 1",
    level: "1AS_SCIENCE",
    stream: "جذع مشترك علوم وتكنولوجيا",
    roomNumber: "القاعة 03",
    color: "#2563eb",
  },
];

export const INITIAL_TIMETABLE: TimetableSlot[] = [
  // الأحد
  {
    id: "tt-1",
    classId: "cls-3as-sci1",
    dayOfWeek: 0,
    startTime: "08:00",
    endTime: "09:00",
    room: "04",
  },
  {
    id: "tt-2",
    classId: "cls-1as-arts1",
    dayOfWeek: 0,
    startTime: "09:00",
    endTime: "10:00",
    room: "02",
  },
  {
    id: "tt-3",
    classId: "cls-2as-sci1",
    dayOfWeek: 0,
    startTime: "10:00",
    endTime: "11:00",
    room: "05",
  },
  {
    id: "tt-4",
    classId: "cls-3as-math1",
    dayOfWeek: 0,
    startTime: "13:30",
    endTime: "14:30",
    room: "06",
  },
  // الإثنين
  {
    id: "tt-5",
    classId: "cls-1as-sci1",
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:00",
    room: "03",
  },
  {
    id: "tt-6",
    classId: "cls-2as-lang1",
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "10:00",
    room: "08",
  },
  {
    id: "tt-7",
    classId: "cls-3as-lit1",
    dayOfWeek: 1,
    startTime: "10:00",
    endTime: "11:00",
    room: "12",
  },
  // الثلاثاء
  {
    id: "tt-8",
    classId: "cls-3as-sci1",
    dayOfWeek: 2,
    startTime: "08:00",
    endTime: "09:00",
    room: "04",
  },
  {
    id: "tt-9",
    classId: "cls-1as-arts1",
    dayOfWeek: 2,
    startTime: "09:00",
    endTime: "10:00",
    room: "02",
  },
  // الأربعاء
  {
    id: "tt-10",
    classId: "cls-2as-sci1",
    dayOfWeek: 3,
    startTime: "08:00",
    endTime: "09:00",
    room: "05",
  },
  {
    id: "tt-11",
    classId: "cls-3as-math1",
    dayOfWeek: 3,
    startTime: "10:00",
    endTime: "11:00",
    room: "06",
  },
  // الخميس
  {
    id: "tt-12",
    classId: "cls-3as-lit1",
    dayOfWeek: 4,
    startTime: "08:00",
    endTime: "09:00",
    room: "12",
  },
  {
    id: "tt-13",
    classId: "cls-2as-lang1",
    dayOfWeek: 4,
    startTime: "10:00",
    endTime: "11:00",
    room: "08",
  },
];

export const INITIAL_STUDENTS: Student[] = [
  // 3AS SCI 1
  {
    id: "std-3s1-01",
    classId: "cls-3as-sci1",
    numberInList: 1,
    fullName: "بن ددوش صهيب",
    gender: "M",
  },
  {
    id: "std-3s1-02",
    classId: "cls-3as-sci1",
    numberInList: 2,
    fullName: "سنوساوي نسرين أمال",
    gender: "F",
  },
  {
    id: "std-3s1-03",
    classId: "cls-3as-sci1",
    numberInList: 3,
    fullName: "عاشوري تسنيم نهى",
    gender: "F",
  },
  {
    id: "std-3s1-04",
    classId: "cls-3as-sci1",
    numberInList: 4,
    fullName: "قراوزان محمد ياسين",
    gender: "M",
  },
  {
    id: "std-3s1-05",
    classId: "cls-3as-sci1",
    numberInList: 5,
    fullName: "بوستة عبد الودود",
    gender: "M",
  },
  {
    id: "std-3s1-06",
    classId: "cls-3as-sci1",
    numberInList: 6,
    fullName: "خالدي غزلان",
    gender: "F",
  },
  {
    id: "std-3s1-07",
    classId: "cls-3as-sci1",
    numberInList: 7,
    fullName: "مزياني فاطمة الزهراء",
    gender: "F",
  },
  {
    id: "std-3s1-08",
    classId: "cls-3as-sci1",
    numberInList: 8,
    fullName: "برقة أحلام",
    gender: "F",
  },
  {
    id: "std-3s1-09",
    classId: "cls-3as-sci1",
    numberInList: 9,
    fullName: "بن دلة منيب محمد",
    gender: "M",
  },
  {
    id: "std-3s1-10",
    classId: "cls-3as-sci1",
    numberInList: 10,
    fullName: "بن يلس يحيى الهادي",
    gender: "M",
  },
  {
    id: "std-3s1-11",
    classId: "cls-3as-sci1",
    numberInList: 11,
    fullName: "بلبشير إيمان",
    gender: "F",
  },
  {
    id: "std-3s1-12",
    classId: "cls-3as-sci1",
    numberInList: 12,
    fullName: "عيسى نيهال",
    gender: "F",
  },

  // 1AS ARTS 1
  {
    id: "std-1a1-01",
    classId: "cls-1as-arts1",
    numberInList: 1,
    fullName: "براهيمي محمد مصطفى إسلام",
    gender: "M",
  },
  {
    id: "std-1a1-02",
    classId: "cls-1as-arts1",
    numberInList: 2,
    fullName: "بن حمو فاطمة الزهراء",
    gender: "F",
  },
  {
    id: "std-1a1-03",
    classId: "cls-1as-arts1",
    numberInList: 3,
    fullName: "لصقع أحمد",
    gender: "M",
  },
  {
    id: "std-1a1-04",
    classId: "cls-1as-arts1",
    numberInList: 4,
    fullName: "بونوة وائل نذير",
    gender: "M",
  },
  {
    id: "std-1a1-05",
    classId: "cls-1as-arts1",
    numberInList: 5,
    fullName: "أحميدي مريم فاطمة الزهراء",
    gender: "F",
  },
  {
    id: "std-1a1-06",
    classId: "cls-1as-arts1",
    numberInList: 6,
    fullName: "بن ديمراد سفيان",
    gender: "M",
  },
];

export const INITIAL_GRADES: StudentGrade[] = [
  {
    id: "gr-01",
    studentId: "std-3s1-01",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 17,
    quiz: 16,
    exam: 16.5,
    calculatedAverage: 16.5,
  },
  {
    id: "gr-02",
    studentId: "std-3s1-02",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 18,
    quiz: 18,
    exam: 18,
    calculatedAverage: 18.0,
  },
  {
    id: "gr-03",
    studentId: "std-3s1-03",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 19,
    quiz: 19.5,
    exam: 19.5,
    calculatedAverage: 19.38,
  },
  {
    id: "gr-04",
    studentId: "std-3s1-04",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 11,
    quiz: 6,
    exam: 8.5,
    calculatedAverage: 8.5,
  },
  {
    id: "gr-05",
    studentId: "std-3s1-05",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 10,
    quiz: 7,
    exam: 6,
    calculatedAverage: 7.25,
  },
  {
    id: "gr-06",
    studentId: "std-3s1-06",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 16,
    quiz: 17,
    exam: 16.5,
    calculatedAverage: 16.5,
  },
  {
    id: "gr-07",
    studentId: "std-3s1-07",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 14,
    quiz: 13,
    exam: 13,
    calculatedAverage: 13.25,
  },
  {
    id: "gr-08",
    studentId: "std-3s1-08",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 16.5,
    quiz: 16.5,
    exam: 16.5,
    calculatedAverage: 16.5,
  },
  {
    id: "gr-09",
    studentId: "std-3s1-09",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 18,
    quiz: 18.5,
    exam: 18,
    calculatedAverage: 18.13,
  },
  {
    id: "gr-10",
    studentId: "std-3s1-10",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 12,
    quiz: 11,
    exam: 10.5,
    calculatedAverage: 11.0,
  },
  {
    id: "gr-11",
    studentId: "std-3s1-11",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 12,
    quiz: 8,
    exam: 8.5,
    calculatedAverage: 9.25,
  },
  {
    id: "gr-12",
    studentId: "std-3s1-12",
    classId: "cls-3as-sci1",
    trimester: 1,
    continuousEval: 13,
    quiz: 12,
    exam: 11,
    calculatedAverage: 11.75,
  },
];

export const INITIAL_PROGRESS: ClassLessonProgress[] = [
  {
    id: "pr-1",
    classId: "cls-3as-sci1",
    unitId: "3as-u01",
    status: "COMPLETED",
    completedAt: "2025-09-21",
  },
  {
    id: "pr-2",
    classId: "cls-3as-sci1",
    unitId: "3as-u02",
    status: "COMPLETED",
    completedAt: "2025-09-28",
  },
  {
    id: "pr-3",
    classId: "cls-3as-sci1",
    unitId: "3as-u03",
    status: "COMPLETED",
    completedAt: "2025-10-05",
  },
  {
    id: "pr-4",
    classId: "cls-3as-sci1",
    unitId: "3as-u04",
    status: "COMPLETED",
    completedAt: "2025-10-12",
  },
  {
    id: "pr-5",
    classId: "cls-3as-sci1",
    unitId: "3as-u05",
    status: "COMPLETED",
    completedAt: "2025-10-19",
  },
  {
    id: "pr-6",
    classId: "cls-3as-sci1",
    unitId: "3as-u06",
    status: "COMPLETED",
    completedAt: "2025-10-26",
  },
  {
    id: "pr-7",
    classId: "cls-3as-sci1",
    unitId: "3as-u07",
    status: "COMPLETED",
    completedAt: "2025-11-02",
  },
  {
    id: "pr-8",
    classId: "cls-3as-sci1",
    unitId: "3as-u08",
    status: "IN_PROGRESS",
    startedAt: "2025-11-09",
  },
  { id: "pr-9", classId: "cls-3as-sci1", unitId: "3as-u09", status: "PLANNED" },

  {
    id: "pr-10",
    classId: "cls-1as-arts1",
    unitId: "1as-arts-u01",
    status: "COMPLETED",
    completedAt: "2025-09-28",
  },
  {
    id: "pr-11",
    classId: "cls-1as-arts1",
    unitId: "1as-arts-u02",
    status: "COMPLETED",
    completedAt: "2025-10-05",
  },
  {
    id: "pr-12",
    classId: "cls-1as-arts1",
    unitId: "1as-arts-u03",
    status: "IN_PROGRESS",
    startedAt: "2025-10-12",
  },
];

export const INITIAL_SESSIONS: SessionRecord[] = [
  {
    id: "ses-1",
    classId: "cls-3as-sci1",
    unitId: "3as-u07",
    date: "2025-11-02",
    startTime: "08:00",
    endTime: "09:00",
    sessionGoals:
      "بيان خصائص الرسالة الخاتمة وعلاقتها بالرسالات السماوية السابقة.",
    accomplishments:
      "تم إنجاز عنصر خصائص الشريعة ومناقشة أوجه النسخ والتصديق والتصحيح.",
    nextSteps:
      "إجراء تطبيق سريع حول التمييز بين النسخ والتحريف في الحصة القادمة.",
    teacherNotes: "",
    notes:
      "تفاعل ممتاز من تلاميذ القسم مع الأمثلة المعاصرة.\nضرب مثال المقارنة بين الشرائع السابقة والشريعة الخاتمة باستخدام جدول مقارن.\nالصعوبة: ضيق الوقت المتبقي لاستكمال الأسئلة الفردية الشفهية، وخلط بعض المتعلمين بين مفهوم النسخ ومفهوم التصحيح.\nالتعديل المقترح للحصة القادمة: البدء مباشرة بالنشاط المقارن وتخصيص 10 دقائق للتطبيق الكتابي.",
    attendance: {},
  },
];

export function getInitialState(): AppState {
  return {
    profile: DEFAULT_PROFILE,
    classes: INITIAL_CLASSES,
    timetable: INITIAL_TIMETABLE,
    students: INITIAL_STUDENTS,
    sessions: INITIAL_SESSIONS,
    grades: INITIAL_GRADES,
    lessonProgress: INITIAL_PROGRESS,
    customUnits: [],
    lessonPlans: [],
    unitPdfFiles: {},
    activeClassId: INITIAL_CLASSES[0]?.id || null,
    activeTrimester: 1,
    calendarSettings: DEFAULT_CALENDAR_SETTINGS,
    theme: "light",
    dashboardStyle: "executive",
    sidebarCollapsed: false,
    onboardingDismissed: false,
  };
}

export function getEmptyState(): AppState {
  const initial = getInitialState();
  return {
    ...initial,
    classes: [],
    timetable: [],
    students: [],
    sessions: [],
    grades: [],
    lessonProgress: [],
    customUnits: [],
    lessonPlans: [],
    unitPdfFiles: {},
    activeClassId: null,
    onboardingDismissed: false,
  };
}

export const INITIAL_STATE: AppState = getEmptyState();

export function isDemoState(state: AppState): boolean {
  // Check if the state contains demo-like IDs (starts with 'cls-' or 'std-' or matches seed IDs)
  // This protects against accidentally overwriting real user data with demo/seed data
  const seedClassIds = new Set(INITIAL_CLASSES.map(c => c.id));
  const seedStudentIds = new Set(INITIAL_STUDENTS.map(s => s.id));
  
  const hasDemoClasses = state.classes.some(c => 
    c.id.startsWith('cls-') || seedClassIds.has(c.id)
  );
  const hasDemoStudents = state.students.some(s => 
    s.id.startsWith('std-') || seedStudentIds.has(s.id)
  );
  
  return hasDemoClasses && hasDemoStudents;
}

export function exportBackupJSON(state: AppState): string {
  const data = {
    exportedAt: new Date().toISOString(),
    version: BACKUP_VERSION,
    app: "معين الأستاذ - التعليم الثانوي العام والتكنولوجي (الجزائر)",
    state,
  };
  return JSON.stringify(data, null, 2);
}

export function importBackupJSON(jsonStr: string): AppState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("ملف النسخة الاحتياطية ليس JSON صالحاً");
  }

  if (!isRecord(parsed) || !("state" in parsed)) {
    throw new Error("الملف المستورد لا يحتوي على بيانات التطبيق");
  }

  return normalizeImportedState(parsed.state);
}
