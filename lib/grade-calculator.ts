import {
  resolveEffectiveScheme,
  type EducationOverrides,
  type LevelCode,
  type StreamId,
  type SubjectId,
} from './education';
import { getDefaultEstimation } from './pedagogical-evaluations';
import type { GradeLevel, Student, StudentGrade } from './types';

export interface GradeCalculationOptions {
  subjectId?: SubjectId;
  levelCode?: LevelCode;
  streamId?: StreamId;
  legacyLevel?: GradeLevel;
  overrides?: EducationOverrides;
  devoir2?: number | null;
  practicalWork?: number | null;
  oralExpression?: number | null;
}

export const DEFAULT_CC_CONFIG = {
  behaviorMax: 5,
  attendanceMax: 5,
  notebookMax: 5,
  participationMax: 5,
  disruptionDeduction: 0.5,
  unwrittenLessonDeduction: 0.5,
  unexcusedAbsenceDeduction: 0.5,
  lateDeduction: 0.5,
  lackOfParticipationDeduction: 0.5,
  participationBonus: 0.5,
  exemptRuleSecondQuiz: 'EXEMPT' as const,
};

export function validateMarkInRange(
  mark: number | undefined | null,
  max = 20
): number | undefined {
  if (mark === undefined || mark === null) {
    return undefined;
  }
  const num = Number(mark);
  if (Number.isNaN(num) || !Number.isFinite(num) || num < 0 || num > max) {
    return undefined;
  }
  return Math.round(num * 100) / 100;
}

export function clampMark(mark: number | undefined | null, max = 20): number | undefined {
  if (mark === undefined || mark === null || Number.isNaN(Number(mark))) {
    return undefined;
  }
  const num = Number(mark);
  return Math.min(max, Math.max(0, Math.round(num * 100) / 100));
}

export function calculateContinuousEvaluation(
  behavior = 5,
  attendance = 5,
  notebook = 5,
  participation = 5
): number {
  const b = Math.min(5, Math.max(0, Number(behavior) || 0));
  const a = Math.min(5, Math.max(0, Number(attendance) || 0));
  const n = Math.min(5, Math.max(0, Number(notebook) || 0));
  const p = Math.min(5, Math.max(0, Number(participation) || 0));
  const total = b + a + n + p;
  return Math.min(20, Math.max(0, Math.round(total * 100) / 100));
}

export function calculateContinuousEval(grade: Partial<StudentGrade>): number | undefined {
  if (grade.continuousEval !== undefined && grade.continuousEval !== null) {
    return validateMarkInRange(grade.continuousEval, 20);
  }

  const bRaw = grade.behavior ?? grade.behaviorScore;
  const aRaw = grade.attendance ?? grade.attendanceScore;
  const nRaw = grade.notebook ?? grade.notebookScore;
  const pRaw = grade.participation ?? grade.participationScore;

  const hasSubComponents =
    bRaw !== undefined || aRaw !== undefined || nRaw !== undefined || pRaw !== undefined;

  if (!hasSubComponents) {
    return undefined;
  }

  const b = clampMark(bRaw ?? 5, 5) ?? 5;
  const a = clampMark(aRaw ?? 5, 5) ?? 5;
  const n = clampMark(nRaw ?? 5, 5) ?? 5;
  const p = clampMark(pRaw ?? 5, 5) ?? 5;

  return Math.min(20, Math.max(0, Math.round((b + a + n + p) * 100) / 100));
}

export function resolveDevoirAverage(
  grade: Partial<StudentGrade>,
  includeSecondQuiz = false
): number | undefined {
  const q1 = validateMarkInRange(grade.quiz, 20);
  if (grade.quiz !== undefined && grade.quiz !== null && q1 === undefined) {
    return undefined;
  }
  const rawQ2 = grade.devoir2 ?? grade.extraMarks?.devoir2 ?? grade.extraMarks?.quiz2;
  const q2 = includeSecondQuiz ? validateMarkInRange(rawQ2, 20) : undefined;
  if (includeSecondQuiz && rawQ2 !== undefined && rawQ2 !== null && q2 === undefined) {
    return undefined;
  }

  if (q1 !== undefined && q2 !== undefined) {
    return Math.round(((q1 + q2) / 2) * 100) / 100;
  }
  return q1 !== undefined ? q1 : q2;
}

export function calculateTermAverage(
  grade: Partial<StudentGrade> | undefined,
  options?: GradeCalculationOptions
): number | null {
  if (!grade) return null;

  if (grade.overrideAverage !== undefined && grade.overrideAverage !== null) {
    return validateMarkInRange(grade.overrideAverage, 20) ?? null;
  }

  const cc = calculateContinuousEval(grade);
  const exam = validateMarkInRange(grade.exam, 20);

  if (options?.subjectId || options?.overrides || grade.subjectId) {
    const resolved = resolveEffectiveScheme({
      subjectId: options?.subjectId ?? grade.subjectId,
      levelCode: options?.levelCode,
      streamId: options?.streamId,
      legacyGradeLevel: options?.legacyLevel,
      overrides: options?.overrides,
    });

    const includeSecondQuiz = resolved.devoirCount >= 2;
    const devoir = resolveDevoirAverage(
      {
        ...grade,
        devoir2: options?.devoir2 ?? grade.devoir2,
      },
      includeSecondQuiz
    );
    const tp = validateMarkInRange(
      options?.practicalWork ??
        grade.practicalWork ??
        grade.extraMarks?.tp ??
        grade.extraMarks?.practical,
      20
    );
    const oral = validateMarkInRange(
      options?.oralExpression ?? grade.oralExpression ?? grade.extraMarks?.oral,
      20
    );

    let weightedSum = 0;
    let totalWeight = 0;

    for (const comp of resolved.activeComponents) {
      let markValue: number | undefined;
      switch (comp.kind) {
        case 'CONTINUOUS':
          markValue = cc;
          break;
        case 'DEVOIR':
          markValue = devoir;
          break;
        case 'PRACTICAL':
          markValue = tp;
          break;
        case 'ORAL':
          markValue = oral;
          break;
        case 'EXAM':
          markValue = exam;
          break;
      }

      if (markValue === undefined) {
        return null;
      }

      weightedSum += markValue * comp.weight;
      totalWeight += comp.weight;
    }

    if (totalWeight <= 0) return null;
    const avg = weightedSum / totalWeight;
    return Math.min(20, Math.max(0, Math.round(avg * 100) / 100));
  }

  const hasSecondQuiz =
    grade.devoir2 !== undefined ||
    grade.extraMarks?.devoir2 !== undefined ||
    grade.extraMarks?.quiz2 !== undefined;
  const quiz = resolveDevoirAverage(grade, hasSecondQuiz);
  if (cc === undefined || quiz === undefined || exam === undefined) {
    return null;
  }

  const avg = (cc + quiz + exam * 2) / 4;
  return Math.min(20, Math.max(0, Math.round(avg * 100) / 100));
}

export function calculateStudentAverage(
  gradeOrCc?: Partial<StudentGrade> | number | null,
  quizOrOptions?: number | GradeCalculationOptions | null,
  examMark?: number | null,
  optionsArg?: GradeCalculationOptions
): number | null {
  if (typeof gradeOrCc === 'number' || gradeOrCc === null || gradeOrCc === undefined) {
    if (
      typeof gradeOrCc !== 'number' ||
      typeof quizOrOptions !== 'number' ||
      typeof examMark !== 'number'
    ) {
      return null;
    }
    return calculateTermAverage(
      {
        continuousEval: gradeOrCc,
        quiz: quizOrOptions,
        exam: examMark,
        devoir2: optionsArg?.devoir2,
        practicalWork: optionsArg?.practicalWork,
        oralExpression: optionsArg?.oralExpression,
      },
      optionsArg
    );
  }

  const options =
    quizOrOptions && typeof quizOrOptions === 'object'
      ? (quizOrOptions as GradeCalculationOptions)
      : optionsArg;
  return calculateTermAverage(gradeOrCc, options);
}

export function getObservation(
  average: number | null | undefined,
  customSubjectId?: SubjectId
): string {
  if (average === null || average === undefined || Number.isNaN(average)) {
    return '';
  }
  void customSubjectId;
  return getDefaultEstimation(average);
}

export interface CouncilBandStat {
  label: string;
  min: number;
  max: number;
  count: number;
  percentage: number;
}

export interface CouncilStatistics {
  totalStudents: number;
  evaluatedCount: number;
  evaluatedStudents: number;
  classAverage: number;
  averageScore: number;
  highestAverage: number;
  highestScore: number;
  lowestAverage: number;
  lowestScore: number;
  passCount: number;
  passRate: number;
  standardDeviation: number;
  lessThan8: number;
  between8and999: number;
  between8and10: number;
  between10and1199: number;
  between10and12: number;
  between12and1399: number;
  between12and14: number;
  between14and1599: number;
  between14and16: number;
  above16: number;
  moreThan16: number;
  greaterThan16: number;
  bands: CouncilBandStat[];
  topStudentName: string;
  lowestStudentName: string;
  topStudents: { student: Student; average: number }[];
  strugglingStudents: { student: Student; average: number }[];
}

export function calculateCouncilStatistics(
  classIdOrStudents: string | Student[],
  trimesterOrGrades: number | StudentGrade[],
  studentsOrOptions?: Student[] | GradeCalculationOptions,
  gradesArg?: StudentGrade[],
  absencesMap?: Record<string, number>,
  optionsArg?: GradeCalculationOptions
): CouncilStatistics {
  let students: Student[];
  let grades: StudentGrade[];
  let options: GradeCalculationOptions | undefined;

  if (typeof classIdOrStudents === 'string') {
    const classId = classIdOrStudents;
    const trimester = Number(trimesterOrGrades) || 1;
    const allStudents = Array.isArray(studentsOrOptions) ? studentsOrOptions : [];
    const allGrades = Array.isArray(gradesArg) ? gradesArg : [];
    students = allStudents.filter(s => s.classId === classId);
    grades = allGrades.filter(
      g =>
        g.classId === classId &&
        g.trimester === trimester &&
        (!optionsArg?.subjectId || !g.subjectId || g.subjectId === optionsArg.subjectId)
    );
    options = optionsArg;
    void absencesMap;
  } else {
    students = classIdOrStudents;
    grades = Array.isArray(trimesterOrGrades) ? trimesterOrGrades : [];
    options =
      studentsOrOptions && !Array.isArray(studentsOrOptions) ? studentsOrOptions : undefined;
  }

  const gradeByStudent = new Map<string, StudentGrade>();
  for (const g of grades) {
    gradeByStudent.set(g.studentId, g);
  }

  const evaluated: { student: Student; average: number }[] = [];
  for (const st of students) {
    const g = gradeByStudent.get(st.id);
    const avg = g?.calculatedAverage ?? calculateTermAverage(g, options);
    if (avg !== null && avg !== undefined && !Number.isNaN(avg)) {
      evaluated.push({ student: st, average: avg });
    }
  }

  const totalStudents = students.length;
  const evaluatedCount = evaluated.length;

  if (evaluatedCount === 0) {
    return {
      totalStudents,
      evaluatedCount: 0,
      evaluatedStudents: 0,
      classAverage: 0,
      averageScore: 0,
      highestAverage: 0,
      highestScore: 0,
      lowestAverage: 0,
      lowestScore: 0,
      passCount: 0,
      passRate: 0,
      standardDeviation: 0,
      lessThan8: 0,
      between8and999: 0,
      between8and10: 0,
      between10and1199: 0,
      between10and12: 0,
      between12and1399: 0,
      between12and14: 0,
      between14and1599: 0,
      between14and16: 0,
      above16: 0,
      moreThan16: 0,
      greaterThan16: 0,
      bands: [],
      topStudentName: '-',
      lowestStudentName: '-',
      topStudents: [],
      strugglingStudents: [],
    };
  }

  const averages = evaluated.map(e => e.average);
  const sum = averages.reduce((acc, v) => acc + v, 0);
  const classAverage = Math.round((sum / evaluatedCount) * 100) / 100;
  const highestAverage = Math.max(...averages);
  const lowestAverage = Math.min(...averages);
  const passCount = averages.filter(v => v >= 10).length;
  const passRate = Math.round((passCount / evaluatedCount) * 10000) / 100;

  const variance =
    averages.reduce((acc, v) => acc + Math.pow(v - classAverage, 2), 0) / evaluatedCount;
  const standardDeviation = Math.round(Math.sqrt(variance) * 100) / 100;

  const lessThan8 = averages.filter(v => v < 8).length;
  const between8and999 = averages.filter(v => v >= 8 && v < 10).length;
  const between10and1199 = averages.filter(v => v >= 10 && v < 12).length;
  const between12and1399 = averages.filter(v => v >= 12 && v < 14).length;
  const between14and1599 = averages.filter(v => v >= 14 && v < 16).length;
  const above16 = averages.filter(v => v >= 16).length;

  const pct = (count: number) => Math.round((count / evaluatedCount) * 10000) / 100;

  const bands: CouncilBandStat[] = [
    { label: 'أقل من 08', min: 0, max: 7.99, count: lessThan8, percentage: pct(lessThan8) },
    { label: '08.00 - 09.99', min: 8, max: 9.99, count: between8and999, percentage: pct(between8and999) },
    { label: '10.00 - 11.99', min: 10, max: 11.99, count: between10and1199, percentage: pct(between10and1199) },
    { label: '12.00 - 13.99', min: 12, max: 13.99, count: between12and1399, percentage: pct(between12and1399) },
    { label: '14.00 - 15.99', min: 14, max: 15.99, count: between14and1599, percentage: pct(between14and1599) },
    { label: '16.00 فما فوق', min: 16, max: 20, count: above16, percentage: pct(above16) },
  ];

  const sortedDesc = [...evaluated].sort((a, b) => b.average - a.average);
  const sortedAsc = [...evaluated].sort((a, b) => a.average - b.average);

  const topStudents = sortedDesc.slice(0, 5);
  const strugglingStudents = sortedAsc.filter(e => e.average < 10).slice(0, 5);

  return {
    totalStudents,
    evaluatedCount,
    evaluatedStudents: evaluatedCount,
    classAverage,
    averageScore: classAverage,
    highestAverage,
    highestScore: highestAverage,
    lowestAverage,
    lowestScore: lowestAverage,
    passCount,
    passRate,
    standardDeviation,
    lessThan8,
    between8and999,
    between8and10: between8and999,
    between10and1199,
    between10and12: between10and1199,
    between12and1399,
    between12and14: between12and1399,
    between14and1599,
    between14and16: between14and1599,
    above16,
    moreThan16: above16,
    greaterThan16: above16,
    bands,
    topStudentName: topStudents[0]?.student.fullName || '-',
    lowestStudentName: sortedAsc[0]?.student.fullName || '-',
    topStudents,
    strugglingStudents,
  };
}
