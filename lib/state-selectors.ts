import {
  normalizeSubjectList,
  resolveClassAssignedSubjects,
  type SubjectId,
} from './education';
import type { AppState } from './storage';
import {
  getEffectiveClassSubjectId,
  type ClassLessonProgress,
  type ClassRoom,
  type SessionRecord,
  type Student,
  type StudentGrade,
  type TimetableSlot,
} from './types';

export function selectActiveClassId(state: AppState): string | null {
  if (state.activeClassId && state.classes.some(cls => cls.id === state.activeClassId)) {
    return state.activeClassId;
  }
  return state.classes[0]?.id ?? null;
}

export function selectActiveClass(state: AppState): ClassRoom | undefined {
  const activeClassId = selectActiveClassId(state);
  return state.classes.find(cls => cls.id === activeClassId);
}

export function selectTeacherSubjectIds(state: AppState): SubjectId[] {
  return normalizeSubjectList(
    state.profile.taughtSubjectIds ?? state.profile.subjectIds,
    state.profile.primarySubjectId
  );
}

export function selectClassAssignedSubjectIds(
  state: AppState,
  cls?: ClassRoom | null
): SubjectId[] {
  const targetClass = cls ?? selectActiveClass(state);
  const teacherSubjectIds = selectTeacherSubjectIds(state);
  if (!targetClass) return teacherSubjectIds;

  return resolveClassAssignedSubjects({
    classSubjectIds: targetClass.assignedSubjectIds ?? targetClass.subjectIds,
    teacherSubjectIds,
    primarySubjectId: state.profile.primarySubjectId,
    levelCode: targetClass.levelCode,
    streamId: targetClass.streamId,
    legacyGradeLevel: targetClass.level,
  });
}

export function selectEffectiveSubjectId(
  state: AppState,
  cls?: ClassRoom | null
): SubjectId | undefined {
  const targetClass = cls ?? selectActiveClass(state);
  return getEffectiveClassSubjectId(
    targetClass,
    state.profile,
    state.activeSubjectId ?? undefined
  );
}

export function selectStudentsByClass(state: AppState, classId: string | null): Student[] {
  if (!classId) return [];
  return state.students
    .filter(student => student.classId === classId)
    .sort((a, b) => a.numberInList - b.numberInList);
}

export function selectSessionsByClass(state: AppState, classId: string | null): SessionRecord[] {
  if (!classId) return [];
  return state.sessions.filter(session => session.classId === classId);
}

export function selectTimetableByClass(state: AppState, classId: string | null): TimetableSlot[] {
  if (!classId) return [];
  return state.timetable.filter(slot => slot.classId === classId);
}

export function selectLessonProgressByClass(
  state: AppState,
  classId: string | null
): ClassLessonProgress[] {
  if (!classId) return [];
  return state.lessonProgress.filter(progress => progress.classId === classId);
}

export function selectGradesByClassAndTrimester(
  state: AppState,
  classId: string | null,
  trimester: 1 | 2 | 3,
  subjectId?: SubjectId
): StudentGrade[] {
  if (!classId) return [];
  const targetClass = state.classes.find(c => c.id === classId);
  const assignedSubjects = selectClassAssignedSubjectIds(state, targetClass);
  const effectiveSubject = subjectId ?? selectEffectiveSubjectId(state, targetClass);

  return state.grades.filter(grade => {
    if (grade.classId !== classId || grade.trimester !== trimester) {
      return false;
    }
    if (!effectiveSubject || assignedSubjects.length <= 1) {
      return !grade.subjectId || grade.subjectId === effectiveSubject;
    }
    if (!grade.subjectId) {
      return effectiveSubject === (state.profile.primarySubjectId ?? assignedSubjects[0]);
    }
    return grade.subjectId === effectiveSubject;
  });
}
