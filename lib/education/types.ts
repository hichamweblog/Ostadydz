import type { GradeLevel } from '../types';

export type VerificationStatus =
  | 'OFFICIAL_VERIFIED'  // مطابق لوثيقة رسمية مختومة أو نص قرار رسمي
  | 'TEACHER_CONFIRMED'  // أكّده أستاذ المادة داخل التطبيق (يُخزَّن في educationOverrides)
  | 'MULTI_SOURCE'       // مصدران مستقلان فأكثر متطابقان (جدول الوزارة + FET)
  | 'SINGLE_SOURCE'      // مصدر واحد
  | 'CONFLICTING'        // مصادر متعارضة (تُوثَّق في notes)
  | 'UNVERIFIED';        // لا مصدر

export type SourceKind =
  | 'DECISION'
  | 'MINISTRY_STATEMENT'
  | 'MINISTRY_TABLE_IMAGE'
  | 'TIMETABLE_TOOL_SHEET'
  | 'SECONDARY_WEBSITE'
  | 'TEACHER';

export interface SourceRef {
  id: string;
  kind: SourceKind;
  title: string;
  url?: string;
  date?: string;
  note?: string;
}

export type LevelCode = '1AS' | '2AS' | '3AS';

export type StreamId =
  | 'TC_SCI'        // جذع مشترك علوم وتكنولوجيا (1AS)
  | 'TC_ARTS'       // جذع مشترك آداب (1AS)
  | 'EXP_SCI'       // علوم تجريبية (2AS, 3AS)
  | 'MATH'          // رياضيات (2AS, 3AS)
  | 'ENGINEERING'   // تقني رياضي / هندسة (2AS, 3AS)
  | 'MGMT_ECO'      // تسيير واقتصاد (2AS, 3AS)
  | 'LIT_PHIL'      // آداب وفلسفة (2AS, 3AS)
  | 'FOREIGN_LANG'  // لغات أجنبية (2AS, 3AS)
  | 'ARTS'          // فنون (2AS, 3AS — غير مفعّلة افتراضياً حتى التحقق الكامل)
  | 'UNCLASSIFIED'; // غير مصنف — يطلب تحديداً صريحاً من الأستاذ

export type SubjectId =
  | 'ARABIC'
  | 'MATH'
  | 'FRENCH'
  | 'ENGLISH'
  | 'ISLAMIC'
  | 'HIST_GEO'
  | 'NATURAL_SCI'
  | 'PHYSICS'
  | 'PHILOSOPHY'
  | 'PE'
  | 'ART_EDU'
  | 'COMPUTER_SCI'
  | 'TECHNOLOGY'
  | 'ACCOUNTING_FIN'
  | 'ECON_MGMT'
  | 'LAW'
  | 'THIRD_LANG'
  | 'AMAZIGH'
  | 'ARTS_SPECIALTY';

export type VariantId =
  | 'CIVIL'       // هندسة مدنية
  | 'ELECTRICAL'  // هندسة كهربائية
  | 'MECHANICAL'  // هندسة ميكانيكية
  | 'PROCESS'     // هندسة الطرائق
  | 'SPANISH'     // لغة إسبانية
  | 'GERMAN'      // لغة ألمانية
  | 'ITALIAN';    // لغة إيطالية

export interface VariantDef {
  id: VariantId;
  subjectId: SubjectId;
  labelAr: string;
  shortAr: string;
  aliases: string[];
}

export interface SubjectDef {
  id: SubjectId;
  labelAr: string;
  shortAr: string;
  officialCode?: string; // ARB, MAT, FRA, ENG, SI, H/G, SN, PHY, SPO, TEC, INF, DES, AMZ, PHI, GCF, ECO, DRO, LE3
  aliases: string[];
  hasPractical: boolean;
  hasOral: boolean;
  variants?: VariantId[];
  defaultSchemeId: string;
  defaultDomains: string[]; // الميادين أو المجالات المقترحة عند بناء الوحدات
  curriculum: 'OFFICIAL_PACK' | 'TEACHER_SUPPLIED';
  active?: boolean;
}

export interface StreamDef {
  id: StreamId;
  levels: LevelCode[];
  labelAr: string;
  shortAr: string;
  aliases: string[];
  legacyGradeLevel?: Partial<Record<LevelCode, GradeLevel>>;
  effectiveFrom: string;
  effectiveTo?: string;
  active: boolean;
  verification: VerificationStatus;
  sources: SourceRef[];
}

export interface HoursDef {
  total: number;                  // مجموع ساعات التلميذ أسبوعياً
  classHours?: number;            // حصص القسم كاملاً (نظري)
  groupHours?: number;            // حصص التفويج (أعمال تطبيقية / مخبرية)
  teacherHours?: number;          // ساعات الأستاذ عند اختلافها بسبب التفويج
  sessionSplit?: number[];        // التقسيم الأسبوعي للحصص مثل [2, 1, 1, 1]
  morningOnlySessions?: number[]; // عدد أو فهارس الحصص الصباحية
}

export interface OfferingDef {
  frameworkId: string; // 'DZ_SEC_2006'
  levelCode: LevelCode;
  streamId: StreamId;
  subjectId: SubjectId;
  variantId?: VariantId;
  optional?: boolean;
  coefficient: number | null;
  hours: HoursDef | null;
  schemeId: string;
  verification: {
    coefficient: VerificationStatus;
    hours: VerificationStatus;
    scheme: VerificationStatus;
  };
  sources: SourceRef[];
  notes?: string;
}

export type ComponentKind =
  | 'CONTINUOUS'
  | 'DEVOIR'
  | 'PRACTICAL'
  | 'ORAL'
  | 'EXAM'
  | 'PROJECT'
  | 'CUSTOM';

export interface ComponentDef {
  key: string; // 'continuous' | 'devoir' | 'practical' | 'oral' | 'exam'
  kind: ComponentKind;
  labelAr: string;
  shortAr?: string;
  weight: number;
  required: boolean;
  count?: {
    min: number;
    max: number;
    default: number;
    aggregate: 'MEAN';
  };
  storage: 'continuousEval' | 'quiz' | 'exam' | 'extraMarks';
  rakmanaCode?: string;
  rakmanaHeaderPattern?: string;
}

export interface ContinuousCriterion {
  key: string;
  labelAr: string;
  max: number;
}

export interface AssessmentSchemeDef {
  id: string;
  labelAr: string;
  descriptionAr: string;
  components: ComponentDef[];
  continuousCriteria?: ContinuousCriterion[];
  maxScore: 20;
  verification: VerificationStatus;
  sources: SourceRef[];
  notes?: string;
}

export interface RegulationFramework {
  id: string;
  labelAr: string;
  status: 'ACTIVE' | 'DRAFT' | 'REVOKED';
  academicYears: string[];
  sources: SourceRef[];
  notes?: string;
}

export type AssessmentSchemeId = string;

export interface SchemeOverride {
  schemeId?: string;
  devoirCount?: number;
  enablePracticalColumn?: boolean;
  enableOralColumn?: boolean;
  examWeight?: number;
  components?: Array<{
    key: string;
    enabled?: boolean;
    weight?: number;
    labelAr?: string;
  }>;
  confirmedAt?: string;
}

export interface EducationOverrides {
  version: 1;
  schemes: Record<string, SchemeOverride>;
  schemeBySubject?: Partial<Record<SubjectId, SchemeOverride>>;
  weeklyHours?: Record<string, number>;
  effectiveWeeks?: number;
}

/**
 * قوالب الإسناد التربوي المتعدد الشائعة في التعليم الثانوي الجزائري
 * (المنشور الوزاري رقم 837 المؤرخ في أوت 2005 وتنظيم الخرائط التربوية)
 */
export interface AssignmentBundleDef {
  id: string;
  labelAr: string;
  descriptionAr: string;
  primarySubjectId: SubjectId;
  subjectIds: SubjectId[];
  notes?: string;
}

/**
 * مسار المنهاج والتوزيع السنوي لمادة معينة في مستوى وشعبة محددة
 */
export interface CurriculumTrack {
  trackKey: string; // `${subjectId}:${levelCode}:${streamId}`
  subjectId: SubjectId;
  subjectLabelAr: string;
  levelCode: LevelCode;
  levelLabelAr: string;
  streamId: StreamId;
  streamLabelAr: string;
  legacyLevel: GradeLevel;
  weeklyHours: number;
  classHours?: number;
  groupHours?: number;
  annualHours: number;
  effectiveWeeks: number;
  coefficient: number | null;
  subtitle: string;
}
