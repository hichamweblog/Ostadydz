'use client';

import React, { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/app-state-context';
import { calculateContinuousEvaluation, calculateStudentAverage } from '@/lib/grade-calculator';
import { triggerHapticFeedback } from '@/lib/utils';
import {
  getClassCoefficient,
  getSubjectDisplayName,
  getWeeklyHours,
  Student,
  StudentGrade,
} from '@/lib/types';
import {
  resolveEffectiveScheme,
  resolveLevelAndStream,
  type SubjectId,
} from '@/lib/education';
import {
  selectClassAssignedSubjectIds,
  selectEffectiveSubjectId,
} from '@/lib/state-selectors';
import { SubjectSwitcherBar } from './SubjectSwitcherBar';
import { normalizeGradeInput as normalizeNumerals } from '@/lib/grade-input';
import {
  PEDAGOGICAL_TIERS,
  getScoreTier,
  getDefaultEstimation,
  getDefaultGuidance,
} from '@/lib/pedagogical-evaluations';
import {
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  X,
  Search,
  Sparkles,
  PenLine,
  ListFilter,
  Sliders,
} from 'lucide-react';

/**
 * قائمة منسدلة ذكية للتقديرات تشمل كل الاحتمالات الوزارية مصنفة حسب النقطة
 */
const EstimationDropdown: React.FC<{
  studentId: string;
  value: string;
  avg: number | null;
  onChange: (val: string) => void;
}> = ({ studentId, value, avg, onChange }) => {
  const [isCustom, setIsCustom] = useState(false);
  const currentTier = getScoreTier(avg);
  const tierInfo = PEDAGOGICAL_TIERS[currentTier];

  const ratedTiers = Object.values(PEDAGOGICAL_TIERS).filter(t => t.tier !== 'UNRATED');
  const allKnown = ratedTiers.flatMap(t => t.estimations);
  const isCustomValue = Boolean(value && !allKnown.includes(value));

  if (isCustom) {
    return (
      <div className="flex items-center gap-1 w-full" id={`est-custom-${studentId}`}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="اكتب التقدير مخصصاً..."
          className="w-full text-xs px-2 py-1 rounded-lg border border-gold bg-amber-50/50 font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-gold shadow-2xs"
          autoFocus
        />
        <button
          type="button"
          onClick={() => setIsCustom(false)}
          title="العودة للقائمة المنسدلة"
          className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-100 cursor-pointer rounded shrink-0 transition-colors"
        >
          <ListFilter className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 w-full" id={`est-select-container-${studentId}`}>
      <select
        value={value}
        onChange={e => {
          if (e.target.value === '__CUSTOM__') {
            setIsCustom(true);
          } else {
            onChange(e.target.value);
          }
        }}
        className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-300 bg-white font-bold text-slate-800 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold cursor-pointer shadow-2xs transition-colors"
      >
        <option value="">-- اختر التقدير --</option>

        {avg !== null && (
          <optgroup label={`⭐ موصى بها حسب النقطة (${tierInfo.label})`}>
            {tierInfo.estimations.map((est, i) => (
              <option key={`rec-${i}`} value={est}>
                {est}
              </option>
            ))}
          </optgroup>
        )}

        {ratedTiers.map(t => (
          <optgroup key={t.tier} label={`فئة: ${t.label}`}>
            {t.estimations.map((est, i) => (
              <option key={`${t.tier}-${i}`} value={est}>
                {est}
              </option>
            ))}
          </optgroup>
        ))}

        {isCustomValue && (
          <optgroup label="تقدير مخصص مسجل حالياً">
            <option value={value}>{value}</option>
          </optgroup>
        )}

        <optgroup label="تخصيص">
          <option value="__CUSTOM__">✍️ كتابة تقدير مخصص...</option>
        </optgroup>
      </select>

      <button
        type="button"
        onClick={() => setIsCustom(true)}
        title="كتابة يدوية مخصصة"
        className="p-1 text-slate-400 hover:text-amber-700 hover:bg-slate-100 cursor-pointer rounded shrink-0 transition-colors"
      >
        <PenLine className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

/**
 * قائمة منسدلة ذكية للإرشادات تشمل كل الاحتمالات والتوجيهات البيداغوجية حسب النقطة
 */
const GuidanceDropdown: React.FC<{
  studentId: string;
  value: string;
  avg: number | null;
  onChange: (val: string) => void;
}> = ({ studentId, value, avg, onChange }) => {
  const [isCustom, setIsCustom] = useState(false);
  const currentTier = getScoreTier(avg);
  const tierInfo = PEDAGOGICAL_TIERS[currentTier];

  const ratedTiers = Object.values(PEDAGOGICAL_TIERS).filter(t => t.tier !== 'UNRATED');
  const allKnown = ratedTiers.flatMap(t => t.guidanceList);
  const isCustomValue = Boolean(value && !allKnown.includes(value));

  if (isCustom) {
    return (
      <div className="flex items-center gap-1 w-full" id={`guidance-custom-${studentId}`}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="اكتب الإرشاد البيداغوجي..."
          className="w-full text-xs px-2.5 py-1 rounded-lg border border-gold bg-amber-50/50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-gold shadow-2xs"
          autoFocus
        />
        <button
          type="button"
          onClick={() => setIsCustom(false)}
          title="العودة للقائمة المنسدلة"
          className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-100 cursor-pointer rounded shrink-0 transition-colors"
        >
          <ListFilter className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 w-full" id={`guidance-select-container-${studentId}`}>
      <select
        value={value}
        onChange={e => {
          if (e.target.value === '__CUSTOM__') {
            setIsCustom(true);
          } else {
            onChange(e.target.value);
          }
        }}
        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold cursor-pointer shadow-2xs transition-colors"
      >
        <option value="">-- اختر الإرشاد --</option>

        {avg !== null && (
          <optgroup label={`🎯 إرشادات موصى بها حسب النقطة (${tierInfo.label})`}>
            {tierInfo.guidanceList.map((g, i) => (
              <option key={`rec-g-${i}`} value={g}>
                {g}
              </option>
            ))}
          </optgroup>
        )}

        {ratedTiers.map(t => (
          <optgroup key={`g-grp-${t.tier}`} label={`إرشادات فئة: ${t.label}`}>
            {t.guidanceList.map((g, i) => (
              <option key={`${t.tier}-g-${i}`} value={g}>
                {g}
              </option>
            ))}
          </optgroup>
        ))}

        {isCustomValue && (
          <optgroup label="إرشاد مخصص مسجل حالياً">
            <option value={value}>{value}</option>
          </optgroup>
        )}

        <optgroup label="تخصيص">
          <option value="__CUSTOM__">✍️ كتابة إرشاد مخصص...</option>
        </optgroup>
      </select>

      <button
        type="button"
        onClick={() => setIsCustom(true)}
        title="كتابة يدوية مخصصة"
        className="p-1 text-slate-400 hover:text-amber-700 hover:bg-slate-100 cursor-pointer rounded shrink-0 transition-colors"
      >
        <PenLine className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

interface DraftRow {
  continuousEval: string;
  quiz: string;
  devoir2: string;
  practicalWork: string;
  oralExpression: string;
  exam: string;
  estimation: string;
  guidance: string;
  remarks: string;
}

const EMPTY_DRAFT_ROW: DraftRow = {
  continuousEval: '',
  quiz: '',
  devoir2: '',
  practicalWork: '',
  oralExpression: '',
  exam: '',
  estimation: '',
  guidance: '',
  remarks: '',
};

type GradeColumnKey =
  | 'continuousEval'
  | 'quiz'
  | 'devoir2'
  | 'practicalWork'
  | 'oralExpression'
  | 'exam';

function matchesSubjectGrade(
  grade: StudentGrade,
  activeSubjectId: SubjectId | undefined,
  assignedSubjects: SubjectId[],
  primarySubjectId?: SubjectId
): boolean {
  if (!activeSubjectId || assignedSubjects.length <= 1) {
    return !grade.subjectId || grade.subjectId === activeSubjectId;
  }
  if (!grade.subjectId) {
    return activeSubjectId === (primarySubjectId ?? assignedSubjects[0]);
  }
  return grade.subjectId === activeSubjectId;
}

function buildDraft(
  students: Student[],
  grades: StudentGrade[],
  classId: string,
  trimester: 1 | 2 | 3,
  activeSubjectId?: SubjectId,
  assignedSubjects: SubjectId[] = [],
  primarySubjectId?: SubjectId
): Record<string, DraftRow> {
  const filtered = students.filter(s => s.classId === classId);
  const draft: Record<string, DraftRow> = {};
  for (const st of filtered) {
    const g = grades.find(
      x =>
        x.studentId === st.id &&
        x.trimester === trimester &&
        matchesSubjectGrade(x, activeSubjectId, assignedSubjects, primarySubjectId)
    );
    const practicalVal =
      g?.practicalWork ??
      (typeof g?.extraMarks?.practical === 'number' ? g.extraMarks.practical : null);
    const oralVal =
      g?.oralExpression ??
      (typeof g?.extraMarks?.oral === 'number' ? g.extraMarks.oral : null);

    draft[st.id] = {
      continuousEval:
        g?.continuousEval !== null && g?.continuousEval !== undefined
          ? String(g.continuousEval)
          : '',
      quiz: g?.quiz !== null && g?.quiz !== undefined ? String(g.quiz) : '',
      devoir2: g?.devoir2 !== null && g?.devoir2 !== undefined ? String(g.devoir2) : '',
      practicalWork:
        practicalVal !== null && practicalVal !== undefined ? String(practicalVal) : '',
      oralExpression: oralVal !== null && oralVal !== undefined ? String(oralVal) : '',
      exam: g?.exam !== null && g?.exam !== undefined ? String(g.exam) : '',
      estimation: g?.estimation || '',
      guidance: g?.guidance || '',
      remarks: g?.remarks || '',
    };
  }
  return draft;
}

export const GradesAndEvaluation: React.FC = () => {
  const { state, updateState: onUpdateState, updateStateAndWait } = useAppState();
  const [selectedClassId, setSelectedClassId] = useState<string>(
    state.activeClassId || (state.classes[0]?.id || '')
  );
  const [selectedTrimester, setSelectedTrimester] = useState<1 | 2 | 3>(
    state.activeTrimester || 1
  );

  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'pending'>('saved');
  const [mobileActiveTab, setMobileActiveTab] = useState<GradeColumnKey>(
    state.lastWorkspace?.route === 'grades'
      ? (state.lastWorkspace.gradeColumn || 'continuousEval')
      : 'continuousEval'
  );
  const [searchStudent, setSearchStudent] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const gradeInputRefs = React.useRef<Record<string, HTMLInputElement | null>>({});
  const [isExporting, setIsExporting] = useState(false);
  const isDirtyRef = React.useRef(false);

  const activeClass = state.classes.find(c => c.id === selectedClassId);
  const assignedSubjects = selectClassAssignedSubjectIds(state, activeClass);
  const activeSubjectId = selectEffectiveSubjectId(state, activeClass);
  const resolvedLevelStream = resolveLevelAndStream(activeClass);
  const effectiveScheme = resolveEffectiveScheme(
    activeSubjectId ?? 'ISLAMIC',
    resolvedLevelStream.levelCode,
    resolvedLevelStream.streamId,
    state.educationOverrides
  );

  const showDevoir2 = effectiveScheme.devoirCount >= 2;
  const showPractical = effectiveScheme.hasPractical;
  const showOral = effectiveScheme.hasOral;

  const classStudents = state.students
    .filter(s => s.classId === selectedClassId)
    .sort((a, b) => a.numberInList - b.numberInList);

  const calcDraftAverage = (d: DraftRow): number | null => {
    const ce = d.continuousEval !== '' ? Number(d.continuousEval) : null;
    const q = d.quiz !== '' ? Number(d.quiz) : null;
    const d2 = d.devoir2 !== '' ? Number(d.devoir2) : null;
    const tp = d.practicalWork !== '' ? Number(d.practicalWork) : null;
    const oral = d.oralExpression !== '' ? Number(d.oralExpression) : null;
    const ex = d.exam !== '' ? Number(d.exam) : null;

    return calculateStudentAverage(
      {
        continuousEval: ce,
        quiz: q,
        devoir2: showDevoir2 ? d2 : null,
        practicalWork: showPractical ? tp : null,
        oralExpression: showOral ? oral : null,
        exam: ex,
        subjectId: activeSubjectId,
      },
      {
        subjectId: activeSubjectId,
        levelCode: resolvedLevelStream.levelCode,
        streamId: resolvedLevelStream.streamId,
        overrides: state.educationOverrides,
      }
    );
  };

  const focusNextGradeInput = (studentId: string) => {
    const visibleStudents = classStudents.filter(student =>
      student.fullName.toLowerCase().includes(searchStudent.toLowerCase())
    );
    const currentIndex = visibleStudents.findIndex(student => student.id === studentId);
    const nextStudent = visibleStudents[currentIndex + 1];
    if (!nextStudent) return;
    const nextInput = gradeInputRefs.current[`${mobileActiveTab}:${nextStudent.id}`];
    nextInput?.focus();
    nextInput?.select();
  };

  const [gradesDraft, setGradesDraft] = useState(() =>
    buildDraft(
      state.students,
      state.grades,
      state.activeClassId || (state.classes[0]?.id || ''),
      state.activeTrimester || 1,
      activeSubjectId,
      assignedSubjects,
      state.profile.primarySubjectId
    )
  );

  const prevGradesRef = React.useRef(state.grades);
  const prevSubjectRef = React.useRef(activeSubjectId);

  useEffect(() => {
    let changed = false;
    let nextClassId = selectedClassId;
    let nextTri = selectedTrimester;

    if (state.activeClassId && state.activeClassId !== selectedClassId) {
      nextClassId = state.activeClassId;
      changed = true;
    }
    if (state.activeTrimester && state.activeTrimester !== selectedTrimester) {
      nextTri = state.activeTrimester;
      changed = true;
    }
    if (prevSubjectRef.current !== activeSubjectId) {
      changed = true;
      prevSubjectRef.current = activeSubjectId;
    }

    if (changed || (!isDirtyRef.current && prevGradesRef.current !== state.grades)) {
      setSelectedClassId(nextClassId);
      setSelectedTrimester(nextTri);
      isDirtyRef.current = false;
      const targetCls = state.classes.find(c => c.id === nextClassId);
      const targetAssigned = selectClassAssignedSubjectIds(state, targetCls);
      const targetSubj = selectEffectiveSubjectId(state, targetCls);
      setGradesDraft(
        buildDraft(
          state.students,
          state.grades,
          nextClassId,
          nextTri,
          targetSubj,
          targetAssigned,
          state.profile.primarySubjectId
        )
      );
    }
    prevGradesRef.current = state.grades;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.activeClassId,
    state.activeTrimester,
    activeSubjectId,
    selectedClassId,
    selectedTrimester,
    state.students,
    state.grades,
  ]);

  const handleMobileGradeTab = (column: GradeColumnKey) => {
    setMobileActiveTab(column);
    if (column === 'continuousEval' || column === 'quiz' || column === 'exam') {
      onUpdateState(previous => ({
        ...previous,
        lastWorkspace: {
          route: 'grades',
          classId: selectedClassId,
          gradeColumn: column,
          updatedAt: new Date().toISOString(),
        },
      }));
    }
  };

  const handleSelectClass = async (newClassId: string) => {
    if (isDirtyRef.current) {
      try {
        await persistDraftGrades();
      } catch (error) {
        console.error('Failed to persist grades before class switch:', error);
        setToastMessage('تعذر حفظ النقاط قبل تغيير القسم. يرجى المحاولة مرة أخرى.');
        setSaveToast(true);
        setTimeout(() => setSaveToast(false), 4000);
        return;
      }
    }
    setSelectedClassId(newClassId);
    isDirtyRef.current = false;
    onUpdateState(prev => ({ ...prev, activeClassId: newClassId }));
    const nextCls = state.classes.find(c => c.id === newClassId);
    const nextAssigned = selectClassAssignedSubjectIds(state, nextCls);
    const nextSubj = selectEffectiveSubjectId(state, nextCls);
    setGradesDraft(
      buildDraft(
        state.students,
        state.grades,
        newClassId,
        selectedTrimester,
        nextSubj,
        nextAssigned,
        state.profile.primarySubjectId
      )
    );
  };

  const handleSelectTrimester = async (newTri: 1 | 2 | 3) => {
    if (isDirtyRef.current) {
      try {
        await persistDraftGrades();
      } catch (error) {
        console.error('Failed to persist grades before trimester switch:', error);
        setToastMessage('تعذر حفظ النقاط قبل تغيير الفصل. يرجى المحاولة مرة أخرى.');
        setSaveToast(true);
        setTimeout(() => setSaveToast(false), 4000);
        return;
      }
    }
    setSelectedTrimester(newTri);
    isDirtyRef.current = false;
    setGradesDraft(
      buildDraft(
        state.students,
        state.grades,
        selectedClassId,
        newTri,
        activeSubjectId,
        assignedSubjects,
        state.profile.primarySubjectId
      )
    );
  };

  // Precompute stats per student for continuous evaluation calculation
  const classSessions = state.sessions.filter(
    s =>
      s.classId === selectedClassId &&
      (!activeSubjectId ||
        assignedSubjects.length <= 1 ||
        !s.subjectId ||
        s.subjectId === activeSubjectId)
  );
  const studentStatsMap: Record<
    string,
    {
      absent: number;
      late: number;
      excused: number;
      disruptions: number;
      unwritten: number;
      poorPart: number;
      goodPart: number;
    }
  > = {};

  for (const s of classStudents) {
    studentStatsMap[s.id] = {
      absent: 0,
      late: 0,
      excused: 0,
      disruptions: 0,
      unwritten: 0,
      poorPart: 0,
      goodPart: 0,
    };
  }

  for (const session of classSessions) {
    if (session.attendance) {
      for (const [studentId, status] of Object.entries(session.attendance)) {
        if (!studentStatsMap[studentId])
          studentStatsMap[studentId] = {
            absent: 0,
            late: 0,
            excused: 0,
            disruptions: 0,
            unwritten: 0,
            poorPart: 0,
            goodPart: 0,
          };
        if (status === 'ABSENT') studentStatsMap[studentId].absent++;
        else if (status === 'LATE') studentStatsMap[studentId].late++;
        else if (status === 'EXCUSED') studentStatsMap[studentId].excused++;
      }
    }
    if (session.disruptions) {
      for (const studentId of session.disruptions) {
        if (studentStatsMap[studentId]) studentStatsMap[studentId].disruptions++;
      }
    }
    if (session.unwrittenLessons) {
      for (const studentId of session.unwrittenLessons) {
        if (studentStatsMap[studentId]) studentStatsMap[studentId].unwritten++;
      }
    }
    if (session.poorParticipation) {
      for (const studentId of session.poorParticipation) {
        if (studentStatsMap[studentId]) studentStatsMap[studentId].poorPart++;
      }
    }
    if (session.goodParticipation) {
      for (const studentId of session.goodParticipation) {
        if (studentStatsMap[studentId]) studentStatsMap[studentId].goodPart++;
      }
    }
  }

  const calcAutoContinuousEval = (studentId: string): number => {
    const stats = studentStatsMap[studentId];
    if (!stats) return 20;

    const rules = state.calendarSettings?.evaluationRules;
    const behaviorScore = Math.max(
      0,
      (rules?.behaviorMax ?? 5) - stats.disruptions * (rules?.disruptionDeduction ?? 0.5)
    );
    const attendanceScore = Math.max(
      0,
      (rules?.attendanceMax ?? 5) -
        stats.absent * (rules?.unexcusedAbsenceDeduction ?? 0.5) -
        stats.late * (rules?.lateDeduction ?? 0.5)
    );
    const notebookScore = Math.max(
      0,
      (rules?.notebookMax ?? 5) - stats.unwritten * (rules?.unwrittenLessonDeduction ?? 0.5)
    );
    const participationScore = Math.max(
      0,
      (rules?.participationMax ?? 5) -
        stats.poorPart * (rules?.lackOfParticipationDeduction ?? 0) +
        stats.goodPart * (rules?.participationBonus ?? 0.5)
    );

    return calculateContinuousEvaluation(
      Math.min(rules?.behaviorMax ?? 5, behaviorScore),
      Math.min(rules?.attendanceMax ?? 5, attendanceScore),
      Math.min(rules?.notebookMax ?? 5, notebookScore),
      Math.min(rules?.participationMax ?? 5, participationScore)
    );
  };

  const handleAutoFillContinuousEval = () => {
    let count = 0;
    isDirtyRef.current = true;
    setGradesDraft(prev => {
      const next = { ...prev };
      for (const st of classStudents) {
        const d = next[st.id] || { ...EMPTY_DRAFT_ROW };
        if (d.continuousEval === '') {
          next[st.id] = { ...d, continuousEval: String(calcAutoContinuousEval(st.id)) };
          count++;
        }
      }
      return next;
    });
    setToastMessage(`تم حساب التقويم آلياً لـ (${count}) تلميذ بدون تغيير النقاط المدخلة يدوياً.`);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3500);
  };

  const handleUseAutoContinuousEval = (studentId: string) => {
    const autoScore = calcAutoContinuousEval(studentId);
    isDirtyRef.current = true;
    setGradesDraft(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { ...EMPTY_DRAFT_ROW }),
        continuousEval: String(autoScore),
      },
    }));
    setToastMessage(`تم وضع النقطة الآلية ${autoScore} في خانة التقويم المستمر. يمكنك تعديلها يدوياً.`);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3000);
  };

  const handleGradeChange = (
    studentId: string,
    field: GradeColumnKey,
    value: string
  ) => {
    const normalized = normalizeNumerals(value);
    if (
      normalized !== '' &&
      (isNaN(Number(normalized)) || Number(normalized) < 0 || Number(normalized) > 20)
    ) {
      setToastMessage('تنبيه: يجب أن تكون العلامة محصورة بين 0 و 20.');
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3500);
      return;
    }
    isDirtyRef.current = true;
    setGradesDraft(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { ...EMPTY_DRAFT_ROW }),
        [field]: normalized,
      },
    }));
  };

  const handleTextFieldChange = (
    studentId: string,
    field: 'estimation' | 'guidance' | 'remarks',
    value: string
  ) => {
    isDirtyRef.current = true;
    setGradesDraft(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { ...EMPTY_DRAFT_ROW }),
        [field]: value,
      },
    }));
  };

  const handleAutoFillPedagogicalFields = () => {
    let count = 0;
    isDirtyRef.current = true;
    setGradesDraft(prev => {
      const next = { ...prev };
      for (const st of classStudents) {
        const d = next[st.id] || { ...EMPTY_DRAFT_ROW };
        const avg = calcDraftAverage(d);
        if (avg !== null) {
          next[st.id] = {
            ...d,
            estimation: getDefaultEstimation(avg),
            guidance: getDefaultGuidance(avg),
          };
          count++;
        }
      }
      return next;
    });
    setToastMessage(`تم تطبيق التقديرات والإرشادات آلياً لـ (${count}) تلميذ حسب نقاطهم ومعدلاتهم بنجاح!`);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3500);
  };

  const persistDraftGrades = async () => {
    await updateStateAndWait(prev => {
      const updatedGradesList: StudentGrade[] = [...prev.grades];

      for (const student of classStudents) {
        const draft = gradesDraft[student.id] || { ...EMPTY_DRAFT_ROW };
        const ceVal = draft.continuousEval !== '' ? Number(draft.continuousEval) : null;
        const qVal = draft.quiz !== '' ? Number(draft.quiz) : null;
        const d2Val = draft.devoir2 !== '' ? Number(draft.devoir2) : null;
        const tpVal = draft.practicalWork !== '' ? Number(draft.practicalWork) : null;
        const oralVal = draft.oralExpression !== '' ? Number(draft.oralExpression) : null;
        const exVal = draft.exam !== '' ? Number(draft.exam) : null;

        const calcAvg = calcDraftAverage(draft);
        const estVal = draft.estimation || (calcAvg !== null ? getDefaultEstimation(calcAvg) : '');
        const guidanceVal = draft.guidance || (calcAvg !== null ? getDefaultGuidance(calcAvg) : '');

        const existingIndex = updatedGradesList.findIndex(
          g =>
            g.studentId === student.id &&
            g.trimester === selectedTrimester &&
            matchesSubjectGrade(g, activeSubjectId, assignedSubjects, prev.profile.primarySubjectId)
        );

        const existingGrade = existingIndex >= 0 ? updatedGradesList[existingIndex] : undefined;
        const subjSuffix =
          activeSubjectId && assignedSubjects.length > 1 ? `-${activeSubjectId}` : '';

        const gradeObj: StudentGrade = {
          ...existingGrade,
          id: existingGrade?.id || `gr-${student.id}-t${selectedTrimester}${subjSuffix}`,
          studentId: student.id,
          classId: selectedClassId,
          subjectId: activeSubjectId ?? existingGrade?.subjectId,
          trimester: selectedTrimester,
          continuousEval: ceVal,
          quiz: qVal,
          devoir2: showDevoir2 ? d2Val : existingGrade?.devoir2,
          practicalWork: showPractical ? tpVal : existingGrade?.practicalWork,
          oralExpression: showOral ? oralVal : existingGrade?.oralExpression,
          exam: exVal,
          calculatedAverage: calcAvg,
          estimation: estVal,
          guidance: guidanceVal,
        };

        if (existingIndex >= 0) {
          updatedGradesList[existingIndex] = gradeObj;
        } else {
          updatedGradesList.push(gradeObj);
        }
      }

      return {
        ...prev,
        grades: updatedGradesList,
      };
    });
  };

  const persistDraftGradesRef = React.useRef(persistDraftGrades);
  useEffect(() => {
    persistDraftGradesRef.current = persistDraftGrades;
  });

  useEffect(() => {
    if (!isDirtyRef.current) return;
    setSaveStatus('pending');
    let isMounted = true;
    const timer = window.setTimeout(() => {
      if (!isMounted) return;
      setSaveStatus('saving');
      void persistDraftGradesRef.current()
        .then(() => {
          if (!isMounted) return;
          isDirtyRef.current = false;
          setSaveStatus('saved');
        })
        .catch((error: unknown) => {
          if (!isMounted) return;
          console.error('Grades sync failed:', error);
          setSaveStatus('pending');
          setToastMessage('تعذر حفظ النقاط في السحابة. التغييرات لم تُفقد — ستتم إعادة المحاولة تلقائيًا.');
          setSaveToast(true);
        });
    }, 500);
    return () => {
      isMounted = false;
      window.clearTimeout(timer);
    };
  }, [gradesDraft]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isDirtyRef.current) {
        void persistDraftGradesRef.current().catch(() => {});
      }
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        void persistDraftGradesRef.current().catch(() => {});
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (isDirtyRef.current) {
        void persistDraftGradesRef.current().catch(() => {});
      }
    };
  }, []);

  const handleSaveAllGrades = async () => {
    triggerHapticFeedback();
    setSaveStatus('saving');
    try {
      await persistDraftGrades();
      setSaveStatus('saved');
      const incompleteCount = classStudents.filter(student => {
        const draft = gradesDraft[student.id];
        return !draft || calcDraftAverage(draft) === null;
      }).length;
      setToastMessage(
        incompleteCount > 0
          ? `تم حفظ النقاط. أُجّل حساب المعدل لـ ${incompleteCount} تلميذ حتى تكتمل عناصر التقويم المطلوبة.`
          : `تم حفظ وحساب كافة علامات ومعدلات الفصل ${selectedTrimester} بنجاح!`
      );
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3500);
    } catch (error: unknown) {
      console.error('Grades sync failed:', error);
      setSaveStatus('pending');
      setToastMessage('تعذر حفظ النقاط في السحابة.');
      setSaveToast(true);
    }
  };

  const handleDigitizationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeClass) return;

    setIsExporting(true);
    try {
      await handleSaveAllGrades();

      const trimesterGrades = [...state.grades.filter(g => g.trimester === selectedTrimester)];

      Object.entries(gradesDraft).forEach(([studentId, draft]) => {
        const ce = draft.continuousEval !== '' ? Number(draft.continuousEval) : null;
        const q = draft.quiz !== '' ? Number(draft.quiz) : null;
        const d2 = draft.devoir2 !== '' ? Number(draft.devoir2) : null;
        const tp = draft.practicalWork !== '' ? Number(draft.practicalWork) : null;
        const oral = draft.oralExpression !== '' ? Number(draft.oralExpression) : null;
        const ex = draft.exam !== '' ? Number(draft.exam) : null;
        const calculatedAverage = calcDraftAverage(draft);
        const est = draft.estimation;
        const gui = draft.guidance;

        const existingIdx = trimesterGrades.findIndex(
          g =>
            g.studentId === studentId &&
            g.classId === activeClass.id &&
            g.trimester === selectedTrimester &&
            matchesSubjectGrade(g, activeSubjectId, assignedSubjects, state.profile.primarySubjectId)
        );

        if (existingIdx !== -1) {
          trimesterGrades[existingIdx] = {
            ...trimesterGrades[existingIdx],
            subjectId: activeSubjectId ?? trimesterGrades[existingIdx].subjectId,
            continuousEval: ce,
            quiz: q,
            devoir2: showDevoir2 ? d2 : undefined,
            practicalWork: showPractical ? tp : undefined,
            oralExpression: showOral ? oral : undefined,
            exam: ex,
            calculatedAverage,
            estimation: est,
            guidance: gui,
          };
        } else {
          trimesterGrades.push({
            id: `grd-${studentId}-${selectedTrimester}-${activeSubjectId || 'default'}`,
            studentId,
            classId: activeClass.id,
            subjectId: activeSubjectId,
            trimester: selectedTrimester,
            continuousEval: ce,
            quiz: q,
            devoir2: showDevoir2 ? d2 : undefined,
            practicalWork: showPractical ? tp : undefined,
            oralExpression: showOral ? oral : undefined,
            exam: ex,
            calculatedAverage,
            estimation: est,
            guidance: gui,
          });
        }
      });

      const { injectGradesIntoFile } = await import('@/lib/excel-sync');
      const injectionResult = await injectGradesIntoFile(file, state.students, trimesterGrades);
      if (injectionResult.matchedStudents === 0) {
        throw new Error(
          'لم تتم مطابقة أي تلميذ داخل الملف الرسمي. لم يتم تنزيل ملف؛ تحقق من القسم أو رقم التعريف والاسم.'
        );
      }

      const url = URL.createObjectURL(injectionResult.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setToastMessage(
        `تم حقن ${injectionResult.gradesWritten} قيمة في ملف الرقمنة لـ ${injectionResult.matchedStudents} تلاميذ مع الحفاظ على القالب الأصلي.`
      );
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 4000);
    } catch (err: unknown) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : 'حدث خطأ أثناء حقن البيانات. تأكد من أنه ملف الرقمنة الرسمي الصحيح.';
      import('@/components/Toast').then(({ showToast }) => {
        showToast(message, 'error');
      });
    } finally {
      setIsExporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportExcel = async () => {
    if (!activeClass) return;

    const subjectTitle = getSubjectDisplayName(activeSubjectId, state.profile.variantId);
    const headers = [
      'رقم التعريف',
      'اللقب',
      'الاسم',
      'تاريخ الميلاد',
      'التقويم المستمر /20',
      showDevoir2 ? 'الفرض 1 /20' : 'الفرض المحروس /20',
      ...(showDevoir2 ? ['الفرض 2 /20'] : []),
      ...(showPractical ? ['الأعمال التطبيقية /20'] : []),
      ...(showOral ? ['التعبير الشفوي /20'] : []),
      'الاختبار /20',
      'المعدل الفصلي /20',
      'التقديرات',
      'الإرشادات',
    ];

    const rows = classStudents.map(st => {
      const draft = gradesDraft[st.id] || { ...EMPTY_DRAFT_ROW };
      const ce = draft.continuousEval !== '' ? Number(draft.continuousEval) : '';
      const q = draft.quiz !== '' ? Number(draft.quiz) : '';
      const d2 = draft.devoir2 !== '' ? Number(draft.devoir2) : '';
      const tp = draft.practicalWork !== '' ? Number(draft.practicalWork) : '';
      const oral = draft.oralExpression !== '' ? Number(draft.oralExpression) : '';
      const ex = draft.exam !== '' ? Number(draft.exam) : '';
      const avg = calcDraftAverage(draft);

      const [lastName, ...firstNameParts] = st.fullName.trim().split(/\s+/);
      return [
        st.registrationNumber || st.regNumber || '',
        lastName || '',
        firstNameParts.join(' '),
        st.birthDate || '',
        ce,
        q,
        ...(showDevoir2 ? [d2] : []),
        ...(showPractical ? [tp] : []),
        ...(showOral ? [oral] : []),
        ex,
        avg !== null ? avg : '',
        draft.estimation || (avg !== null ? getDefaultEstimation(avg) : ''),
        draft.guidance || (avg !== null ? getDefaultGuidance(avg) : ''),
      ];
    });

    const { utils, writeFile } = await import('xlsx');
    const lastColIdx = headers.length - 1;
    const ws = utils.aoa_to_sheet([
      ['الجمهورية الجزائرية الديمقراطية الشعبية'],
      ['وزارة التربية الوطنية'],
      [`كشف نقاط مادة ${subjectTitle} - ${activeClass.name} - الفصل ${selectedTrimester}`],
      headers,
      ...rows,
    ]);
    ws['!dir'] = 'rtl';
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastColIdx } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastColIdx } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastColIdx } },
    ];
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, `الرقمنة_فصل_${selectedTrimester}`);
    writeFile(
      wb,
      `كشف_علامات_${subjectTitle.replace(/\s+/g, '_')}_${activeClass.name.replace(/\s+/g, '_')}_فصل${selectedTrimester}.xlsx`
    );
  };

  const toggleSchemeOverrideOption = async (
    patch: Partial<{
      devoirCount: 1 | 2;
      enablePracticalColumn: boolean;
      enableOralColumn: boolean;
    }>
  ) => {
    const subjKey = activeSubjectId ?? 'ISLAMIC';
    await updateStateAndWait(prev => {
      const existing = prev.educationOverrides?.schemeBySubject?.[subjKey] || {};
      return {
        ...prev,
        educationOverrides: {
          version: 1,
          schemes: prev.educationOverrides?.schemes || {},
          ...prev.educationOverrides,
          schemeBySubject: {
            ...(prev.educationOverrides?.schemeBySubject || {}),
            [subjKey]: {
              ...existing,
              ...patch,
            },
          },
        },
      };
    });
  };

  const gradeSummary = classStudents.reduce(
    (summary, student) => {
      const draft = gradesDraft[student.id] || EMPTY_DRAFT_ROW;
      const average = calcDraftAverage(draft);
      if (average !== null) {
        summary.completed++;
        summary.averageTotal += average;
        if (average < 10) summary.belowTen++;
      } else {
        summary.incomplete++;
      }
      return summary;
    },
    { completed: 0, incomplete: 0, belowTen: 0, averageTotal: 0 }
  );
  const overallAverage =
    gradeSummary.completed > 0
      ? (gradeSummary.averageTotal / gradeSummary.completed).toFixed(2)
      : '-';

  const subjectCoeff = activeClass
    ? getClassCoefficient(activeClass, activeSubjectId, state.educationOverrides)
    : 2;
  const subjectHours = activeClass
    ? getWeeklyHours(activeClass, activeSubjectId, state.educationOverrides)
    : 2;

  const mobileColumns: Array<{ key: GradeColumnKey; label: string }> = [
    { key: 'continuousEval', label: 'التقويم' },
    { key: 'quiz', label: showDevoir2 ? 'الفرض 1' : 'الفرض' },
    ...(showDevoir2 ? [{ key: 'devoir2' as const, label: 'الفرض 2' }] : []),
    ...(showPractical ? [{ key: 'practicalWork' as const, label: 'التطبيقي' }] : []),
    ...(showOral ? [{ key: 'oralExpression' as const, label: 'الشفوي' }] : []),
    { key: 'exam', label: 'الاختبار' },
  ];

  return (
    <div
      className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6"
      id="grades-evaluation-view"
    >
      {/* Multi-Subject Switcher Bar for the Active Class */}
      <SubjectSwitcherBar classRoom={activeClass} />

      {/* Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full lg:w-auto">
          <input
            type="file"
            ref={fileInputRef}
            accept=".xlsx, .xls"
            onChange={handleDigitizationUpload}
            className="hidden"
          />

          <details className="group rounded-xl border border-slate-200 bg-slate-50 p-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-xs font-bold text-slate-700">
              <span>المزيد: معادلة المادة واستيراد وتصدير الرقمنة</span>
              <span className="transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="grid grid-cols-2 items-center gap-2 border-t border-slate-200 p-2 sm:flex sm:flex-wrap">
              <button
                onClick={() => setShowFormulaModal(true)}
                className="flex min-h-11 items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer transition-colors"
              >
                <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
                <span>المعادلة والأعمدة (÷{effectiveScheme.divisor})</span>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isExporting}
                className="flex min-h-11 items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
                title="ملء ملف الرقمنة (Excel) بالنقاط المحفوظة"
              >
                <Download className={`w-4 h-4 shrink-0 ${isExporting ? 'animate-bounce' : ''}`} />
                <span>ملء ملف الرقمنة</span>
              </button>

              <button
                onClick={handleExportExcel}
                className="col-span-2 sm:col-span-1 flex min-h-11 items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold shadow-xs cursor-pointer transition-colors"
                title="استخراج كشف النقاط كملف Excel"
                id="btn-export-grades-sheet"
              >
                <FileSpreadsheet className="w-4 h-4 text-[var(--primary)] shrink-0" />
                <span>استخراج كشف النقاط</span>
              </button>
            </div>
          </details>

          <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2">
            <button
              onClick={handleAutoFillContinuousEval}
              className="flex min-h-11 items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)] text-[var(--text-primary)] border border-[var(--primary)] text-xs font-bold cursor-pointer transition-colors shadow-2xs"
              title="حساب التقويم المستمر آلياً بناءً على الغيابات والسلوك المسجل في دفتر النصوص"
            >
              <Sparkles className="w-4 h-4 text-[var(--primary)] shrink-0" />
              <span>حساب التقويم آلياً</span>
            </button>

            <button
              onClick={handleAutoFillPedagogicalFields}
              className="flex min-h-11 items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
              title="ملء التقديرات والإرشادات آلياً لجميع تلاميذ القسم حسب نقاطهم ومعدلاتهم"
            >
              <Sparkles className="w-4 h-4 text-gold shrink-0" />
              <span>تطبيق التقديرات آلياً</span>
            </button>

            <button
              type="button"
              onClick={() => setShowFormulaModal(true)}
              className="flex min-h-11 items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
              title="تخصيص أعمدة التقويم ومعادلة المادة"
            >
              <Sliders className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>أعمدة التقويم (÷{effectiveScheme.divisor})</span>
            </button>

            <span
              className={`text-[11px] font-bold ${
                saveStatus === 'saved'
                  ? 'text-[var(--primary)]'
                  : saveStatus === 'saving'
                  ? 'text-amber-700'
                  : 'text-slate-500'
              }`}
              aria-live="polite"
            >
              {saveStatus === 'saved'
                ? '✓ محفوظ'
                : saveStatus === 'saving'
                ? '⟳ جارٍ الحفظ...'
                : '⏳ تغييرات غير محفوظة'}
            </span>
          </div>
        </div>
      </div>

      {saveToast && (
        <div
          role="alert"
          className={`p-3.5 rounded-xl font-bold text-xs flex items-center justify-between gap-3 shadow-md transition-all ${
            toastMessage.includes('تعذر') || toastMessage.includes('خطأ')
              ? 'bg-rose-600 text-white'
              : 'bg-[var(--primary)] text-white'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {toastMessage.includes('تعذر') || toastMessage.includes('خطأ') ? (
              <AlertCircle className="w-5 h-5 shrink-0 text-white" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-white" />
            )}
            <span className="truncate">
              {toastMessage || `تم حفظ وحساب كافة علامات ومعدلات الفصل ${selectedTrimester} بنجاح!`}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(toastMessage.includes('تعذر') || toastMessage.includes('خطأ')) && (
              <button
                type="button"
                onClick={handleSaveAllGrades}
                className="min-h-9 px-2.5 py-1 rounded-lg bg-white text-rose-700 hover:bg-rose-50 text-[11px] font-black transition-colors cursor-pointer"
              >
                إعادة المحاولة
              </button>
            )}
            <button
              type="button"
              onClick={() => setSaveToast(false)}
              className="min-h-9 min-w-9 p-1 rounded-lg hover:bg-white/20 text-white transition-colors cursor-pointer flex items-center justify-center"
              aria-label="إغلاق التنبيه"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="ملخص دفتر النقاط">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="text-[11px] font-bold text-slate-500">مكتمل</div>
          <div className="mt-1 text-lg font-black text-[var(--primary)]">{gradeSummary.completed}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="text-[11px] font-bold text-slate-500">ناقص</div>
          <div className="mt-1 text-lg font-black text-amber-700">{gradeSummary.incomplete}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="text-[11px] font-bold text-slate-500">المتوسط العام</div>
          <div className="mt-1 text-lg font-black text-slate-900">{overallAverage}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="text-[11px] font-bold text-slate-500">أقل من 10</div>
          <div className="mt-1 text-lg font-black text-rose-700">{gradeSummary.belowTen}</div>
        </div>
      </div>

      {/* Class & Trimester Filter Ribbon */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row gap-4 sm:justify-between items-start sm:items-center w-full sm:w-auto">
          <div className="space-y-0.5 w-full sm:w-auto">
            <span className="text-[11px] font-bold text-slate-500 block">اختر القسم:</span>
            <select
              value={selectedClassId}
              onChange={e => handleSelectClass(e.target.value)}
              className="w-full sm:w-auto bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 outline-none cursor-pointer"
            >
              {state.classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.stream})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-0.5 w-full sm:w-auto">
            <span className="text-[11px] font-bold text-slate-500 block">الفترة الدراسية:</span>
            <div className="flex items-center bg-slate-50 p-0.5 rounded-lg border border-slate-300 w-full sm:w-auto">
              {([1, 2, 3] as const).map(tri => (
                <button
                  key={tri}
                  onClick={() => handleSelectTrimester(tri)}
                  className={`flex-1 sm:flex-initial px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer text-center ${
                    selectedTrimester === tri
                      ? 'bg-[var(--accent-gold)] text-[var(--accent-navy)] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  الفصل {tri}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 text-xs text-slate-500 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
          <span>
            المادة النشطة:{' '}
            <strong className="text-[var(--primary)]">
              {getSubjectDisplayName(activeSubjectId, state.profile.variantId)}
            </strong>{' '}
            (م:{subjectCoeff} · {subjectHours}سا)
          </span>
          <span>•</span>
          <span>
            تعداد القسم: <strong className="text-slate-900">{classStudents.length} تلميذ</strong>
          </span>
        </div>
      </div>

      {/* Mobile Column Quick-Filter & Search Ribbon */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="text"
            value={searchStudent}
            onChange={e => setSearchStudent(e.target.value)}
            placeholder="بحث عن تلميذ لتنقيطه..."
            className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-xl bg-white text-xs focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        {/* Mobile Segmented Control */}
        <div className="md:hidden flex flex-wrap items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200 text-xs w-full mt-3 sm:mt-0 gap-1">
          {mobileColumns.map(col => (
            <button
              key={col.key}
              type="button"
              onClick={() => handleMobileGradeTab(col.key)}
              className={`flex-1 py-2 px-2 rounded-lg font-bold text-[11px] transition-all cursor-pointer text-center ${
                mobileActiveTab === col.key
                  ? 'bg-white text-[var(--primary)] shadow-xs border border-slate-200'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {col.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grades Container */}
      <div className="space-y-3">
        {classStudents.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 text-center py-12 text-slate-400 text-xs shadow-xs">
            لا يوجد تلاميذ مسجلين في هذا القسم. يرجى إضافتهم من تبويب «الأقسام والتوقيت».
          </div>
        ) : (
          <>
            {/* 1. Mobile-First Card View */}
            <div className="block md:hidden space-y-2">
              {classStudents
                .filter(s => s.fullName.toLowerCase().includes(searchStudent.toLowerCase()))
                .map(student => {
                  const draft = gradesDraft[student.id] || EMPTY_DRAFT_ROW;
                  const avg = calcDraftAverage(draft);
                  const requiredFields = [
                    draft.continuousEval,
                    draft.quiz,
                    ...(showDevoir2 ? [draft.devoir2] : []),
                    ...(showPractical ? [draft.practicalWork] : []),
                    ...(showOral ? [draft.oralExpression] : []),
                    draft.exam,
                  ];
                  const completedFields = requiredFields.filter(v => v !== '').length;

                  const activeColLabel =
                    mobileColumns.find(c => c.key === mobileActiveTab)?.label || 'العلامة';

                  return (
                    <div
                      key={student.id}
                      className="flex flex-col p-3 bg-white rounded-xl border border-slate-200 shadow-xs gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-mono font-bold text-xs flex items-center justify-center shrink-0 border border-slate-200">
                          {student.numberInList}
                        </span>
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm text-[var(--text-primary)] whitespace-normal break-words leading-tight">
                            {student.fullName}
                          </h4>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                                completedFields === requiredFields.length
                                  ? 'bg-[var(--success-soft)] text-[var(--success)]'
                                  : 'bg-amber-50 text-amber-800'
                              }`}
                            >
                              {completedFields}/{requiredFields.length} مكتملة
                            </span>
                            {student.isRepeater && (
                              <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
                                معيد
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full">
                        <span className="text-[11px] font-bold text-slate-500 flex-1">
                          {activeColLabel}
                        </span>
                        <input
                          ref={element => {
                            gradeInputRefs.current[`${mobileActiveTab}:${student.id}`] = element;
                          }}
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9٠-٩۰-۹.,٫]*"
                          placeholder="-"
                          value={draft[mobileActiveTab]}
                          onFocus={event => event.currentTarget.select()}
                          onChange={e =>
                            handleGradeChange(student.id, mobileActiveTab, e.target.value)
                          }
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              focusNextGradeInput(student.id);
                            }
                          }}
                          enterKeyHint="next"
                          aria-label={`${activeColLabel} - ${student.fullName}`}
                          className="w-24 text-center px-2 rounded-lg border border-slate-300 bg-slate-50 font-mono font-bold text-sm text-slate-900 focus:ring-2 focus:ring-gold focus:outline-none focus:bg-white transition-colors min-h-[44px]"
                        />
                      </div>

                      {mobileActiveTab === 'continuousEval' && (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-3 py-2">
                          <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                            المقترح آلياً:{' '}
                            <strong className="font-mono text-[var(--primary)]">
                              {calcAutoContinuousEval(student.id).toFixed(2)}
                            </strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUseAutoContinuousEval(student.id)}
                            className="min-h-8 rounded-md border border-[var(--primary)]/30 bg-white px-2 text-[10px] font-bold text-[var(--primary)] hover:bg-[var(--primary-soft)]"
                          >
                            استخدام المقترح
                          </button>
                        </div>
                      )}

                      {avg !== null && (
                        <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                          <span className="text-[11px] font-bold text-amber-800">المعدل الفصلي</span>
                          <span className="font-mono text-sm font-bold text-amber-900">
                            {avg.toFixed(2)}
                          </span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-2 w-full border-t border-slate-100 pt-3">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            التقديرات
                          </label>
                          <EstimationDropdown
                            studentId={student.id}
                            value={draft.estimation}
                            avg={avg}
                            onChange={val => handleTextFieldChange(student.id, 'estimation', val)}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            الإرشادات
                          </label>
                          <GuidanceDropdown
                            studentId={student.id}
                            value={draft.guidance}
                            avg={avg}
                            onChange={val => handleTextFieldChange(student.id, 'guidance', val)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* 2. Desktop Table View */}
            <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-100 text-slate-800 border-b border-slate-200 font-bold">
                    <tr>
                      <th className="py-3 px-3 w-10 text-center">#</th>
                      <th className="py-3 px-4 min-w-[160px]">اسم ولقب التلميذ</th>
                      <th className="py-3 px-2 w-24 text-center">
                        التقويم المستمر
                        <span className="block text-[10px] font-normal text-slate-500">(على 20)</span>
                      </th>
                      <th className="py-3 px-2 w-24 text-center">
                        {showDevoir2 ? 'الفرض 1' : 'الفرض المحروس'}
                        <span className="block text-[10px] font-normal text-slate-500">(على 20)</span>
                      </th>
                      {showDevoir2 && (
                        <th className="py-3 px-2 w-24 text-center">
                          الفرض 2
                          <span className="block text-[10px] font-normal text-slate-500">
                            (على 20)
                          </span>
                        </th>
                      )}
                      {showPractical && (
                        <th className="py-3 px-2 w-24 text-center">
                          الأعمال التطبيقية
                          <span className="block text-[10px] font-normal text-slate-500">
                            (على 20)
                          </span>
                        </th>
                      )}
                      {showOral && (
                        <th className="py-3 px-2 w-24 text-center">
                          التعبير الشفوي
                          <span className="block text-[10px] font-normal text-slate-500">
                            (على 20)
                          </span>
                        </th>
                      )}
                      <th className="py-3 px-2 w-24 text-center">
                        الاختبار الفصلي
                        <span className="block text-[10px] font-normal text-slate-500">
                          (على 20 × 2)
                        </span>
                      </th>
                      <th className="py-3 px-3 w-28 text-center bg-amber-50/70 border-x border-amber-200">
                        المعدل الفصلي
                        <span className="block text-[10px] font-normal text-amber-700">
                          (÷ {effectiveScheme.divisor})
                        </span>
                      </th>
                      <th className="py-3 px-3 min-w-[175px]">التقديرات</th>
                      <th className="py-3 px-4 min-w-[200px]">الإرشادات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {classStudents
                      .filter(s => s.fullName.toLowerCase().includes(searchStudent.toLowerCase()))
                      .map(student => {
                        const draft = gradesDraft[student.id] || EMPTY_DRAFT_ROW;
                        const avg = calcDraftAverage(draft);

                        return (
                          <tr
                            key={student.id}
                            className="hover:bg-slate-50/80 transition-colors h-[54px] max-h-[54px]"
                          >
                            <td className="p-1 px-2 text-center font-mono font-bold text-slate-500">
                              {student.numberInList}
                            </td>
                            <td className="p-1 px-2 font-bold text-slate-900">
                              {student.fullName}
                            </td>

                            {/* Continuous Evaluation */}
                            <td className="p-1 px-1 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.25"
                                  min="0"
                                  max="20"
                                  placeholder="-"
                                  value={draft.continuousEval}
                                  onChange={e =>
                                    handleGradeChange(student.id, 'continuousEval', e.target.value)
                                  }
                                  aria-label={`التقويم المستمر - ${student.fullName}`}
                                  className="w-18 text-center px-1 py-1 min-h-[40px] rounded-md border border-slate-300 font-mono font-bold text-slate-900 focus:outline-amber-600 focus:border-gold"
                                />
                                <div
                                  className="hidden sm:flex items-center gap-1 text-[9px] text-[var(--primary)] whitespace-nowrap"
                                  title="النقطة المقترحة"
                                >
                                  <span className="font-mono">
                                    {calcAutoContinuousEval(student.id).toFixed(2)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleUseAutoContinuousEval(student.id)}
                                    className="rounded border border-[var(--primary)]/30 bg-[var(--primary-soft)] px-1 py-0 font-bold hover:opacity-80"
                                  >
                                    تطبيق
                                  </button>
                                </div>
                              </div>
                            </td>

                            {/* Devoir 1 / Quiz */}
                            <td className="p-1 px-1 text-center">
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.25"
                                min="0"
                                max="20"
                                placeholder="-"
                                value={draft.quiz}
                                onChange={e =>
                                  handleGradeChange(student.id, 'quiz', e.target.value)
                                }
                                aria-label={`الفرض المحروس - ${student.fullName}`}
                                className="w-18 text-center px-1 py-1 min-h-[40px] rounded-md border border-slate-300 font-mono font-bold text-slate-900 focus:outline-amber-600 focus:border-gold"
                              />
                            </td>

                            {/* Devoir 2 */}
                            {showDevoir2 && (
                              <td className="p-1 px-1 text-center">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.25"
                                  min="0"
                                  max="20"
                                  placeholder="-"
                                  value={draft.devoir2}
                                  onChange={e =>
                                    handleGradeChange(student.id, 'devoir2', e.target.value)
                                  }
                                  aria-label={`الفرض الثاني - ${student.fullName}`}
                                  className="w-18 text-center px-1 py-1 min-h-[40px] rounded-md border border-slate-300 font-mono font-bold text-slate-900 focus:outline-amber-600 focus:border-gold"
                                />
                              </td>
                            )}

                            {/* Practical Work */}
                            {showPractical && (
                              <td className="p-1 px-1 text-center">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.25"
                                  min="0"
                                  max="20"
                                  placeholder="-"
                                  value={draft.practicalWork}
                                  onChange={e =>
                                    handleGradeChange(student.id, 'practicalWork', e.target.value)
                                  }
                                  aria-label={`الأعمال التطبيقية - ${student.fullName}`}
                                  className="w-18 text-center px-1 py-1 min-h-[40px] rounded-md border border-slate-300 font-mono font-bold text-slate-900 focus:outline-amber-600 focus:border-gold"
                                />
                              </td>
                            )}

                            {/* Oral Expression */}
                            {showOral && (
                              <td className="p-1 px-1 text-center">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.25"
                                  min="0"
                                  max="20"
                                  placeholder="-"
                                  value={draft.oralExpression}
                                  onChange={e =>
                                    handleGradeChange(student.id, 'oralExpression', e.target.value)
                                  }
                                  aria-label={`التعبير الشفوي - ${student.fullName}`}
                                  className="w-18 text-center px-1 py-1 min-h-[40px] rounded-md border border-slate-300 font-mono font-bold text-slate-900 focus:outline-amber-600 focus:border-gold"
                                />
                              </td>
                            )}

                            {/* Exam */}
                            <td className="p-1 px-1 text-center">
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.25"
                                min="0"
                                max="20"
                                placeholder="-"
                                value={draft.exam}
                                onChange={e =>
                                  handleGradeChange(student.id, 'exam', e.target.value)
                                }
                                aria-label={`الاختبار الفصلي - ${student.fullName}`}
                                className="w-18 text-center px-1 py-1 min-h-[40px] rounded-md border border-slate-300 font-mono font-bold text-slate-900 focus:outline-amber-600 focus:border-gold"
                              />
                            </td>

                            <td className="p-1 px-2 text-center bg-amber-50/50 border-x border-amber-200">
                              <span className="font-mono text-sm font-bold text-amber-900">
                                {avg !== null ? avg.toFixed(2) : '-'}
                              </span>
                            </td>

                            <td className="py-2 px-3">
                              <EstimationDropdown
                                studentId={student.id}
                                value={draft.estimation}
                                avg={avg}
                                onChange={val =>
                                  handleTextFieldChange(student.id, 'estimation', val)
                                }
                              />
                            </td>

                            <td className="py-2 px-4">
                              <GuidanceDropdown
                                studentId={student.id}
                                value={draft.guidance}
                                avg={avg}
                                onChange={val => handleTextFieldChange(student.id, 'guidance', val)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Explanatory & Interactive Formula Modal */}
      {showFormulaModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-slate-200"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                صيغة المعدل وأعمدة التقويم ({getSubjectDisplayName(activeSubjectId, state.profile.variantId)})
              </h3>
              <button
                onClick={() => setShowFormulaModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-2">
                <div className="text-[11px] font-bold text-amber-900">
                  الصيغة المطبّقة حالياً (القرار 186/2006):
                </div>
                <div className="font-mono text-sm font-bold text-amber-950">
                  {effectiveScheme.scheme.descriptionAr}
                </div>
                <div className="text-[11px] text-amber-800">
                  المعامل الرسمي للفوج: <strong>{subjectCoeff}</strong> • الحجم الساعي الأسبوعي:{' '}
                  <strong>{subjectHours} سا</strong> • المقسوم عليه: <strong>÷ {effectiveScheme.divisor}</strong>
                </div>
              </div>

              {/* Interactive column toggles for the active subject */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                <div className="font-bold text-slate-800">
                  تخصيص أعمدة الجدول والمعادلة لهذه المادة:
                </div>

                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>تفعيل عمود الفرض المحروس الثاني (حساب معدل الفرضين)</span>
                  <input
                    type="checkbox"
                    checked={showDevoir2}
                    onChange={e =>
                      void toggleSchemeOverrideOption({
                        devoirCount: e.target.checked ? 2 : 1,
                      })
                    }
                    className="w-4 h-4 accent-[var(--primary)]"
                  />
                </label>

                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>تفعيل عمود الأعمال التطبيقية المستقل (يزيد المقسوم عليه +1)</span>
                  <input
                    type="checkbox"
                    checked={showPractical}
                    onChange={e =>
                      void toggleSchemeOverrideOption({
                        enablePracticalColumn: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[var(--primary)]"
                  />
                </label>

                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>تفعيل عمود التعبير الشفوي المستقل (للغات — يزيد المقسوم عليه +1)</span>
                  <input
                    type="checkbox"
                    checked={showOral}
                    onChange={e =>
                      void toggleSchemeOverrideOption({
                        enableOralColumn: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[var(--primary)]"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowFormulaModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
