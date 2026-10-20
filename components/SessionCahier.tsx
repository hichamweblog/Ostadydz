'use client';

import { ConfirmDialog } from './ConfirmDialog';
import { SubjectSwitcherBar } from './SubjectSwitcherBar';
import { useAppState } from '@/hooks/app-state-context';
import { showToast } from "@/components/Toast";
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { getLocalDateString } from '@/lib/date-utils';
import {
  CurriculumUnit,
  getSubjectDisplayName,
  SessionRecord,
  SessionStatus,
} from '@/lib/types';
import { selectEffectiveSubjectId } from '@/lib/state-selectors';
import { v4 as uuidv4 } from 'uuid';
import { getMergedCurriculumUnits, loadAllCurriculum } from '@/lib/curriculum-data';
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  BookOpen,
  Users,
  Lightbulb,
  Plus,
  Save,
  Trash2,
  Calendar,
  AlertCircle,
  HelpCircle,
  Sparkles,
  ArrowRight,
  History,
  FileText,
  FileEdit,
  Edit3,
  Search,
  Bold,
  List,
  ListOrdered,
  Quote,
  Check,
  ChevronDown,
  FileDown,
  Ban
} from 'lucide-react';
import { exportToDocx } from '@/lib/utils';
import {
  CANCELLATION_REASON_PRESETS,
  DEFAULT_CANCELLATION_REASON,
  ORIENTATION_SESSION_GOALS,
  ORIENTATION_SESSION_TOPIC,
  ORIENTATION_SESSION_UNIT_ID,
  SESSION_PART_NUMBERS,
  buildCancellationNote,
  buildSessionTitle,
  isOrientationSession,
  isSessionDocumented,
  normalizeSessionPart,
  readSessionPart,
} from '@/lib/session-flow';
import { getExcludedDayLabel } from '@/lib/academic-calendar';

interface SessionCahierProps {
  initialSessionId?: string;
  onClearInitialSession?: () => void;
  onNavigate?: (target: 'dashboard' | 'grades') => void;
}

interface FormattingBarProps {
  val: string;
  setter: React.Dispatch<React.SetStateAction<string>>;
}

const FormattingBar: React.FC<FormattingBarProps> = ({ setter }) => {
  const handleApply = (prefix: string, suffix: string = '') => {
    setter(prev => {
      if (!prev) return `${prefix}${suffix}`;
      return `${prev}\n${prefix}${suffix}`;
    });
  };

  return (
    <div className="flex items-center gap-1 bg-slate-50 border-b border-slate-200 px-2 py-1.5 rounded-t-xl text-slate-600 text-xs overflow-x-auto scrollbar-none">
      <button
        type="button" onClick={() => handleApply('**', '**')}
        className="min-h-[40px] min-w-[40px] px-2.5 py-1 rounded-lg hover:bg-slate-200 font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors shrink-0" title="نص عريض" >
        <Bold className="w-3.5 h-3.5" />
        <span className="text-xs">عريض</span>
      </button>
      <button
        type="button" onClick={() => handleApply('﴿ ', ' ﴾')}
        className="min-h-[40px] min-w-[40px] px-2.5 py-1 rounded-lg hover:bg-[var(--primary-soft)] text-[var(--primary)] font-bold cursor-pointer transition-colors shrink-0 text-xs" title="إدراج قوس آية قرآنية" >
        ﴿ آية ﴾
      </button>
      <button
        type="button" onClick={() => handleApply('« ', ' »')}
        className="min-h-[40px] min-w-[40px] px-2.5 py-1 rounded-lg hover:bg-blue-100 text-blue-800 font-bold cursor-pointer transition-colors shrink-0 text-xs" title="إدراج قوس حديث نبوي" >
        « حديث »
      </button>
      <button
        type="button" onClick={() => handleApply('• ')}
        className="min-h-[40px] min-w-[40px] px-2.5 py-1 rounded-lg hover:bg-slate-200 flex items-center justify-center gap-1 cursor-pointer transition-colors shrink-0" title="نقطة تعداد" >
        <List className="w-3.5 h-3.5" />
        <span className="text-xs">نقطة</span>
      </button>
      <button
        type="button" onClick={() => handleApply('1. ')}
        className="min-h-[40px] min-w-[40px] px-2.5 py-1 rounded-lg hover:bg-slate-200 flex items-center justify-center gap-1 cursor-pointer transition-colors shrink-0" title="ترقيم" >
        <ListOrdered className="w-3.5 h-3.5" />
        <span className="text-xs">ترقيم</span>
      </button>
    </div>
  );
};

// Helper to extract official objectives from curriculum database
function getObjectivesFromUnit(unit: CurriculumUnit): string {
  const parts: string[] = [];
  if (unit.learningObjective) {
    parts.push(`• الهدف التعلمي الأساسي: ${unit.learningObjective}`);
  }
  if (unit.targetedCompetence) {
    parts.push(`• الكفاءة المستهدفة: ${unit.targetedCompetence}`);
  }
  if (unit.targetedResources && unit.targetedResources.length > 0) {
    parts.push(`• الموارد المعرفية والمفاهيمية المستهدفة:`);
    unit.targetedResources.forEach(res => parts.push(`  - ${res}`));
  }
  if (unit.indicators && unit.indicators.length > 0) {
    parts.push(`• مؤشرات الكفاءة والتقويم:`);
    unit.indicators.forEach(ind => parts.push(`  - ${ind}`));
  }
  if (unit.referenceTexts && unit.referenceTexts.length > 0) {
    parts.push(`• السندات الشرعية المؤطرة:`);
    unit.referenceTexts.forEach(txt => parts.push(`  « ${txt} »`));
  }
  return parts.join('\n');
}

function getSessionNotes(session: SessionRecord): string {
  if (session.notes) return session.notes;
  if (session.teacherNotes) return session.teacherNotes;

  return [
    session.memoryWhatWorked && `ما نجح: ${session.memoryWhatWorked}`,
    session.memoryDifficulty && `الصعوبات: ${session.memoryDifficulty}`,
    session.memoryWhatFailed && `ما يحتاج تحسيناً: ${session.memoryWhatFailed}`,
    session.memoryNextTimeChange &&
      `التعديل المقترح للحصة القادمة: ${session.memoryNextTimeChange}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export const SessionCahier: React.FC<SessionCahierProps> = ({
  initialSessionId,
  onClearInitialSession,
  onNavigate,
}) => {
  const { state, updateStateAndWait } = useAppState();
  const activeClass = state.classes.find(c => c.id === state.activeClassId);
  const activeSubjectId = selectEffectiveSubjectId(state, activeClass);
  const activeSubjectTitle = getSubjectDisplayName(activeSubjectId);

  const [, setCurriculumLoaded] = useState(false);
  useEffect(() => {
    void loadAllCurriculum().then(() => setCurriculumLoaded(true));
  }, []);

  const availableUnits = getMergedCurriculumUnits(state.customUnits, activeSubjectId).filter(
    u => u.level === activeClass?.level
  );
  // Active form state for logging a session
  const todayStr = getLocalDateString();
  const [sessionDate, setSessionDate] = useState(todayStr);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('09:00');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(initialSessionId || null);
  const [partNumber, setPartNumber] = useState<number>(1);
  const [isUnitCompleted, setIsUnitCompleted] = useState<boolean>(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(() => getExcludedDayLabel(state.calendarSettings?.holidays, todayStr, activeClass?.level) ? 'CANCELLED' : 'COMPLETED');
  const [cancellationReason, setCancellationReason] = useState<string>(() => getExcludedDayLabel(state.calendarSettings?.holidays, todayStr, activeClass?.level) || '');
  const [unifiedNotes, setUnifiedNotes] = useState<string>('');

  // Curriculum Extraction Modal State
  const [curriculumSearch, setCurriculumSearch] = useState('');
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<number | 'all'>('all');

  const [savedSuccessMsg, setSavedSuccessMsg] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Sync editing session when initialSessionId changes or editingSessionId is set
  useEffect(() => {
    const targetId = editingSessionId || initialSessionId;
    if (targetId) {
      const ses = state.sessions.find(s => s.id === targetId);
      if (ses) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEditingSessionId(ses.id);
        setSessionDate(ses.date);
        setStartTime(ses.startTime || '08:00');
        setEndTime(ses.endTime || '09:00');
        setSelectedUnitId(isOrientationSession(ses) ? ORIENTATION_SESSION_UNIT_ID : ses.unitId || '');
        if (isOrientationSession(ses)) {
          setSelectedUnitId(ORIENTATION_SESSION_UNIT_ID);
        }
        if (ses.sessionStatus === 'CANCELLED') {
          setSessionStatus('CANCELLED');
          setCancellationReason(ses.cancellationReason || '');
          setIsUnitCompleted(false);
        } else {
          setSessionStatus('COMPLETED');
          setCancellationReason('');
          setPartNumber(readSessionPart(ses));
          const prog = state.lessonProgress.find(p => p.classId === ses.classId && p.unitId === ses.unitId);
          setIsUnitCompleted(prog?.status === 'COMPLETED');
        }

        const parts: string[] = [];
        if (ses.accomplishments?.trim()) {
          parts.push(ses.accomplishments.trim());
        }
        if (ses.nextSteps?.trim() && !ses.accomplishments?.includes(ses.nextSteps.trim())) {
          parts.push(`• التوجيهات والواجبات:\n${ses.nextSteps.trim()}`);
        }
        const legacyNotes = getSessionNotes(ses);
        if (legacyNotes?.trim() && !ses.accomplishments?.includes(legacyNotes.trim())) {
          parts.push(`• دفتر الملاحظات:\n${legacyNotes.trim()}`);
        }
        setUnifiedNotes(parts.join('\n\n'));
      }
    }
  }, [initialSessionId, editingSessionId, state.sessions, state.lessonProgress]);

  // Pre-select next uncompleted unit when no unit is selected
  const nextSuggestedUnitId = React.useMemo(() => {
    if (availableUnits.length === 0) return '';
    const completedUnitIds = new Set(
      state.lessonProgress
        .filter(p => p.classId === state.activeClassId && p.status === 'COMPLETED')
        .map(p => p.unitId)
    );
    const nextUnit = availableUnits.find(u => !completedUnitIds.has(u.id)) || availableUnits[0];
    return nextUnit?.id || '';
  }, [availableUnits, state.lessonProgress, state.activeClassId]);

  const hasPriorDocumentedSession = state.sessions.some(s => s.classId === state.activeClassId && s.id !== editingSessionId && isSessionDocumented(s) && s.date <= sessionDate);
  const isOrientationSelected = selectedUnitId === ORIENTATION_SESSION_UNIT_ID || (!selectedUnitId && !hasPriorDocumentedSession);
  const effectiveSelectedUnitId = isOrientationSelected
    ? ''
    : availableUnits.some(unit => unit.id === selectedUnitId)
      ? selectedUnitId
      : (nextSuggestedUnitId || availableUnits[0]?.id || '');
  const selectedUnitObj = availableUnits.find(u => u.id === effectiveSelectedUnitId);
  const sessionGoals = isOrientationSelected
    ? ORIENTATION_SESSION_GOALS
    : selectedUnitObj
      ? getObjectivesFromUnit(selectedUnitObj)
      : '';

  // Days covered by the official calendar (holidays / examinations) are excluded from
  // sessions automatically: the form pre-fills a cancelled session carrying the reason.
  const excludedDayLabel = getExcludedDayLabel(state.calendarSettings?.holidays, sessionDate, activeClass?.level);

  // Auto-suggest part number and unit completion status when creating a new session
  useEffect(() => {
    if (editingSessionId) return;
    if (isOrientationSelected) return;
    if (!effectiveSelectedUnitId || !state.activeClassId) return;

    const priorSessions = state.sessions.filter(
      s =>
        s.classId === state.activeClassId &&
        s.unitId === effectiveSelectedUnitId &&
        s.sessionStatus !== 'CANCELLED' &&
        isSessionDocumented(s)
    );
    const nextPart = normalizeSessionPart(priorSessions.length + 1);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPartNumber(nextPart);

    const totalHours = selectedUnitObj?.hourlyVolume || 2;
    setIsUnitCompleted(nextPart >= totalHours);
  }, [effectiveSelectedUnitId, state.activeClassId, editingSessionId, state.sessions, selectedUnitObj?.hourlyVolume, isOrientationSelected]);

  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setSelectedUnitId('');
    onClearInitialSession?.();
    setSessionDate(todayStr);
    setStartTime('08:00');
    setEndTime('09:00');
    setUnifiedNotes('');
    setPartNumber(1);
    setIsUnitCompleted(false);
    const todayReason = getExcludedDayLabel(state.calendarSettings?.holidays, todayStr, activeClass?.level);
    setSessionStatus(todayReason ? 'CANCELLED' : 'COMPLETED');
    setCancellationReason(todayReason || '');
  };

  // When selected unit changes, fill objectives automatically from curriculum DB
  const handleSelectUnit = (unitId: string) => {
    setSelectedUnitId(unitId);
  };

  const handleSessionDateChange = (date: string) => {
    setSessionDate(date);
    if (!date || !activeClass) return;

    const exclusion = getExcludedDayLabel(state.calendarSettings?.holidays, date, activeClass.level);
    if (!exclusion && !editingSessionId && cancellationReason === excludedDayLabel) {
      setSessionStatus('COMPLETED');
      setCancellationReason('');
    }
    if (exclusion && !editingSessionId) {
      // Excluded days carry no teaching session: document them as cancelled with the reason.
      setSessionStatus('CANCELLED');
      setCancellationReason(exclusion);
      setIsUnitCompleted(false);
    }

    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
    const linkedSlot = state.timetable
      .filter(slot => slot.classId === activeClass.id && slot.dayOfWeek === dayOfWeek)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
    if (linkedSlot) {
      setStartTime(linkedSlot.startTime);
      setEndTime(linkedSlot.endTime);
    }
  };

  // Check if the teacher has prior notes for this selected unit
  const previousMemoryForThisUnit = state.sessions.find(
    s => s.unitId === effectiveSelectedUnitId && (
      getSessionNotes(s)
    )
  );

  // Save or update Session
  const handleSaveSession = async () => {
    if (!state.activeClassId) {
      showToast('يرجى تحديد القسم أولاً', 'error');
      return;
    }

    if (excludedDayLabel && sessionStatus !== 'CANCELLED' && !editingSessionId) {
      showToast('هذا اليوم مستثنى من الحصص. عدّل الرزنامة إن لزم، أو وثّقه كحصة ملغاة.', 'warning');
      return;
    }
    const isCancelled = sessionStatus === 'CANCELLED';
    const effectiveReason = cancellationReason.trim() || DEFAULT_CANCELLATION_REASON;

    const existingSession = editingSessionId
      ? state.sessions.find(s => s.id === editingSessionId)
      : state.sessions.find(
          s =>
            s.classId === state.activeClassId &&
            s.date === sessionDate &&
            s.startTime === startTime &&
            !isSessionDocumented(s)
        );

    // A new session must never collide with an already-documented one on the cloud's unique key
    // `(workspace, class, date, start_time)`: the reconcile step would fold them into one row and
    // the earlier documentation would be overwritten. Pick a free slot instead and say so.
    let effectiveStartTime = startTime;
    let effectiveEndTime = endTime;
    let timeWasShifted = false;
    if (!existingSession) {
      const occupiedStarts = new Set(
        state.sessions
          .filter(s => s.classId === state.activeClassId && s.date === sessionDate && isSessionDocumented(s))
          .map(s => s.startTime)
      );
      if (occupiedStarts.has(effectiveStartTime)) {
        timeWasShifted = true;
        const dayOfWeek = new Date(`${sessionDate}T12:00:00`).getDay();
        const timetableCandidates = state.timetable
          .filter(slot => slot.classId === state.activeClassId && slot.dayOfWeek === dayOfWeek)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        const freeTimetableSlot = timetableCandidates.find(slot => !occupiedStarts.has(slot.startTime));
        if (freeTimetableSlot) {
          effectiveStartTime = freeTimetableSlot.startTime;
          effectiveEndTime = freeTimetableSlot.endTime;
        } else {
          const standardSlots = [
            ['08:00', '09:00'],
            ['09:00', '10:00'],
            ['10:00', '11:00'],
            ['11:00', '12:00'],
            ['13:00', '14:00'],
            ['14:00', '15:00'],
            ['15:00', '16:00'],
            ['16:00', '17:00'],
          ];
          const freeStandard = standardSlots.find(([st]) => !occupiedStarts.has(st));
          if (freeStandard) {
            effectiveStartTime = freeStandard[0];
            effectiveEndTime = freeStandard[1];
          } else {
            const [hhStr = '08', mmStr = '00'] = effectiveStartTime.split(':');
            let totalMinutes = parseInt(hhStr, 10) * 60 + parseInt(mmStr, 10) + 1;
            while (occupiedStarts.has(`${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`)) {
              totalMinutes += 1;
            }
            effectiveStartTime = `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
          }
        }
      }
    }

    const sessionTitle = isOrientationSelected
      ? (isCancelled ? buildSessionTitle(ORIENTATION_SESSION_TOPIC, 1, { cancelled: true, reason: effectiveReason }) : ORIENTATION_SESSION_TOPIC)
      : buildSessionTitle(selectedUnitObj?.title, partNumber, {
          cancelled: isCancelled,
          reason: effectiveReason,
        });

    const accomplishmentsToSave = isCancelled
      ? buildCancellationNote(effectiveReason, unifiedNotes)
      : unifiedNotes;

    try {
      await updateStateAndWait(prev => {
        let newSessions: SessionRecord[];
        if (existingSession) {
          newSessions = prev.sessions.map(s => {
            if (s.id === existingSession.id) {
              return {
                ...s,
                subjectId: s.subjectId ?? activeSubjectId,
                unitId: isOrientationSelected ? undefined : effectiveSelectedUnitId,
                customTopic: sessionTitle,
                partNumber: isCancelled || isOrientationSelected ? undefined : partNumber,
                sessionKind: isOrientationSelected ? 'orientation' : undefined,
                sessionStatus: isCancelled ? 'CANCELLED' : 'COMPLETED',
                cancellationReason: isCancelled ? effectiveReason : undefined,
                date: sessionDate,
                startTime: effectiveStartTime,
                endTime: effectiveEndTime,
                sessionGoals: isCancelled ? '' : sessionGoals,
                accomplishments: accomplishmentsToSave,
                nextSteps: '',
                teacherNotes: accomplishmentsToSave,
                notes: accomplishmentsToSave,
                summary: accomplishmentsToSave.slice(0, 200),
                completedAt: new Date().toISOString(),
              };
            }
            return s;
          });
        } else {
          const newSession: SessionRecord = {
            id: uuidv4(),
            classId: prev.activeClassId!,
            subjectId: activeSubjectId,
            unitId: isOrientationSelected ? undefined : effectiveSelectedUnitId,
            customTopic: sessionTitle,
            partNumber: isCancelled || isOrientationSelected ? undefined : partNumber,
            sessionKind: isOrientationSelected ? 'orientation' : undefined,
            sessionStatus: isCancelled ? 'CANCELLED' : 'COMPLETED',
            cancellationReason: isCancelled ? effectiveReason : undefined,
            date: sessionDate,
            startTime: effectiveStartTime,
            endTime: effectiveEndTime,
            sessionGoals: isCancelled ? '' : sessionGoals,
            accomplishments: accomplishmentsToSave,
            nextSteps: '',
            teacherNotes: accomplishmentsToSave,
            notes: accomplishmentsToSave,
            summary: accomplishmentsToSave.slice(0, 200),
            attendance: {},
            completedAt: new Date().toISOString(),
          };
          newSessions = [newSession, ...prev.sessions];
        }

        const existingProgIdx = prev.lessonProgress.findIndex(
          p => p.classId === prev.activeClassId && p.unitId === effectiveSelectedUnitId
        );
        const newProg = [...prev.lessonProgress];
        if (effectiveSelectedUnitId && !isCancelled) {
          if (isUnitCompleted) {
            if (existingProgIdx >= 0) {
              newProg[existingProgIdx] = {
                ...newProg[existingProgIdx],
                status: 'COMPLETED',
                completedAt: sessionDate
              };
            } else {
              newProg.push({
                id: uuidv4(),
                classId: prev.activeClassId!,
                unitId: effectiveSelectedUnitId,
                status: 'COMPLETED',
                completedAt: sessionDate
              });
            }
          } else {
            // Unit is in progress, do NOT mark completed!
            if (existingProgIdx >= 0) {
              newProg[existingProgIdx] = {
                ...newProg[existingProgIdx],
                status: 'IN_PROGRESS',
                startedAt: newProg[existingProgIdx].startedAt || sessionDate
              };
            } else {
              newProg.push({
                id: uuidv4(),
                classId: prev.activeClassId!,
                unitId: effectiveSelectedUnitId,
                status: 'IN_PROGRESS',
                startedAt: sessionDate
              });
            }
          }
        }

        return {
          ...prev,
          sessions: newSessions,
          lessonProgress: newProg
        };
      });

      setSavedSuccessMsg(true);
      setTimeout(() => setSavedSuccessMsg(false), 12000);
      setEditingSessionId(null);
      onClearInitialSession?.();
      setUnifiedNotes('');
      setSelectedUnitId('');
      setSessionStatus('COMPLETED');
      setCancellationReason('');
      if (timeWasShifted) {
        // Never silently move a session: the teacher must know the slot changed and why.
        setStartTime(effectiveStartTime);
        setEndTime(effectiveEndTime);
        showToast(
          `يوجد توثيق سابق في نفس التوقيت، فسُجلت هذه الحصة على ${effectiveStartTime} حفاظاً على التوثيق السابق.`,
          'warning'
        );
      }
      showToast(
        isCancelled
          ? 'تم توثيق الحصة الملغاة في دفتر النصوص بنجاح'
          : 'تم توثيق الحصة وتحديث دفتر النصوص بنجاح',
        'success'
      );
    } catch (error) {
      console.error('Session save failed:', error);
      showToast('تعذر حفظ الحصة في السحابة.', 'error');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setDeleteConfirmId(null);
    try {
      await updateStateAndWait(prev => ({
        ...prev,
        sessions: prev.sessions.filter(s => s.id !== sessionId)
      }));
    } catch (error) {
      console.error('Session delete failed:', error);
      showToast('تعذر حذف الحصة من السحابة.', 'error');
    }
  };

  // Only past sessions (date <= todayStr) for the active class & active subject
  const classPastSessions = useMemo(() => {
    return state.sessions
      .filter(
        s =>
          s.classId === state.activeClassId &&
          s.date <= todayStr &&
          (!activeSubjectId || !s.subjectId || s.subjectId === activeSubjectId)
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
  }, [state.sessions, state.activeClassId, todayStr, activeSubjectId]);

  // Only documented past sessions for official export
  const classDocumentedSessions = useMemo(() => {
    return classPastSessions.filter(isSessionDocumented);
  }, [classPastSessions]);

const handleExportCahierDoc = () => {
    const rowsHtml = classDocumentedSessions.map((s, idx) => {
      const unitObj = availableUnits.find(u => u.id === s.unitId);
      const title = s.customTopic || unitObj?.title || 'حصة تعلمية';
      const domain = unitObj?.domain || '—';
      const timeSlot = s.startTime && s.endTime ? `${s.startTime} - ${s.endTime}` : (s.startTime || '—');
      return `
        <tr>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: center; font-weight: bold;">${classDocumentedSessions.length - idx}</td>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: center;">${s.date}</td>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: center;">${timeSlot}</td>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: right;"><strong>${title}</strong></td>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: right;">${domain}</td>
        </tr>
      `;
    }).join('');

    const detailsHtml = classDocumentedSessions.map((s, idx) => {
      const unitObj = availableUnits.find(u => u.id === s.unitId);
      const title = s.customTopic || unitObj?.title || 'حصة تعلمية';
      const domain = unitObj?.domain || '—';
      const timeSlot = s.startTime && s.endTime ? `${s.startTime} - ${s.endTime}` : (s.startTime || '—');
      return `
        <div style="margin-bottom: 25px; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px;">
          <h3 style="color: #0d2c3b;">الحصة رقم ${classDocumentedSessions.length - idx}: ${title} (${s.date})</h3>
          <p><strong>التوقيت:</strong> ${timeSlot} | <strong>الميدان:</strong> ${domain}</p>
          ${s.sessionGoals ? `<h4>أهداف الحصة:</h4><p style="white-space: pre-wrap;">${s.sessionGoals}</p>` : ''}
          ${s.accomplishments ? `<h4>توثيق وملاحظات الحصة:</h4><p style="white-space: pre-wrap;">${s.accomplishments}</p>` : ''}
        </div>
      `;
    }).join('');

    const html = `
      <div dir="rtl" style="text-align: center; margin-bottom: 10px;">
        <div style="color: var(--primary);">دفتر النصوص وسجل الحصص اليومي — مادة: ${activeSubjectTitle}</div>
        <p><strong>المؤسسة:</strong> ${state.profile?.schoolName || 'ثانوية التعليم الثانوي'} | <strong>الأستاذ(ة):</strong> ${state.profile?.name || 'أستاذ المادة'} | <strong>السنة الدراسية:</strong> ${state.profile?.academicYear || '2026/2027'}</p>
        <p><strong>الفوج التربوي:</strong> ${activeClass?.name || 'القسم'} (${activeClass?.stream || ''}) | <strong>عدد الحصص الموثقة:</strong> ${classDocumentedSessions.length}</p>
      </div>
      <h3 style="margin: 8px 0 4px;">جدول الحصص المنجزة زمنياً:</h3>
      <table dir="rtl" style="width: 100%; border-collapse: collapse; margin-top: 4px;">
        <thead>
          <tr style="background-color: #f1f5f9; font-weight: bold;">
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: center; width: 8%;">الرقم</th>
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: center; width: 16%;">التاريخ</th>
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: center; width: 16%;">التوقيت</th>
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: right; width: 38%;">عنوان الوحدة / الدرس</th>
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: right; width: 22%;">الميدان</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <h3 style="margin: 8px 0 4px;">تفاصيل وسير الحصص المسجلة:</h3>
      ${detailsHtml}
    `;

    exportToDocx(html, `دفتر_نصوص_${activeSubjectTitle.replace(/\s+/g, '_')}_${activeClass?.name || 'القسم'}`);
  };

  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="session-cahier-view">
      {/* Multi-Subject Switcher */}
      <SubjectSwitcherBar classRoom={activeClass} />

      {/* Top action bar: Active class selector & Document Export */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="session-cahier-active-class" className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-[var(--primary)]" />
            <span>القسم:</span>
          </label>
          <select
            id="session-cahier-active-class"
            value={state.activeClassId || ''}
            onChange={(e) => {
              const newId = e.target.value;
              setSelectedUnitId('');
              void updateStateAndWait(prev => ({ ...prev, activeClassId: newId }));
              const cls = state.classes.find(c => c.id === newId);
              if (cls) {
                showToast(`تم تفعيل قسم ${cls.name} كقسم نشط`, 'success');
              }
            }}
            className="min-h-9 px-3 py-1 rounded-xl border border-[var(--primary)]/30 bg-white font-bold text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] cursor-pointer"
          >
            {state.classes.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.stream})
              </option>
            ))}
          </select>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            القسم النشط
          </span>
        </div>

        {classDocumentedSessions.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCahierDoc}
              className="min-h-9 px-3.5 py-1.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              title="تصدير دفتر النصوص كاملاً إلى ملف Word (.docx)"
            >
              <FileDown className="w-3.5 h-3.5 text-white/70" />
              <span>تصدير Word (.docx)</span>
            </button>
          </div>
        )}
      </div>

      {savedSuccessMsg && (
        <div className="rounded-2xl border border-[var(--primary)]/20 bg-[var(--primary-soft)] p-4 text-[var(--primary)] shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2 text-sm font-black">
            <CheckCircle2 className="h-5 w-5" />
            <span>اكتملت الحصة وتم توثيقها بنجاح.</span>
          </div>
          <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
            حُفظ دفتر النصوص وتقدم المنهاج، ويمكنك العودة إلى اليوم أو تحديث نقاط القسم.
          </p>
          {onNavigate && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => onNavigate('dashboard')} className="min-h-11 rounded-xl bg-[var(--primary)] px-5 text-xs font-black text-white">
                العودة إلى اليوم
              </button>
              <button type="button" onClick={() => onNavigate('grades')} className="min-h-11 rounded-xl border border-[var(--primary)]/30 bg-white px-5 text-xs font-black text-[var(--primary)]">
                فتح النقاط
              </button>
            </div>
          )}
        </div>
      )}

      {/* Session Entry Form */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4" id="session-entry-form-card">
            {!editingSessionId && !selectedUnitId && classDocumentedSessions.length === 0 && state.classes.length > 0 && (
              <div className="rounded-xl border border-[var(--primary)]/25 bg-[var(--primary-soft)] p-4">
                <div className="text-[11px] font-bold text-[var(--text-tertiary)]">الحصة الأولى من السنة الدراسية</div>
                <div className="mt-1 text-sm font-black text-[var(--text-primary)]">{ORIENTATION_SESSION_TOPIC}</div>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  هذه الحصة لا ترتبط بوحدة من المنهاج: تُخصص للتوجيهات العامة وتقديم البرنامج السنوي للتلاميذ.
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedUnitId(ORIENTATION_SESSION_UNIT_ID)}
                  className="mt-3 min-h-11 rounded-xl bg-[var(--primary)] px-4 text-xs font-black text-white"
                >
                  اعتماد حصة التقديم
                </button>
              </div>
            )}

            {!editingSessionId && selectedUnitObj && !selectedUnitId && classDocumentedSessions.length > 0 && (
              <div className="rounded-xl border border-[var(--primary)]/25 bg-[var(--primary-soft)] p-4">
                <div className="text-[11px] font-bold text-[var(--text-tertiary)]">الدرس التالي المقترح وفق تقدم المنهاج</div>
                <div className="mt-1 text-sm font-black text-[var(--text-primary)]">{selectedUnitObj.title}</div>
                <button
                  type="button"
                  onClick={() => setSelectedUnitId(selectedUnitObj.id)}
                  className="mt-3 min-h-11 rounded-xl bg-[var(--primary)] px-4 text-xs font-black text-white"
                >
                  اعتماد الدرس المقترح
                </button>
              </div>
            )}

            {editingSessionId && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl flex items-center justify-between gap-2 shadow-xs">
                <div className="flex items-center gap-2 text-xs font-bold">
                  <FileEdit className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>جاري توثيق وتعديل الحصة المحددة ({sessionDate} | {startTime} – {endTime})</span>
                </div>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-2.5 py-1 bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold rounded-lg cursor-pointer transition-colors"
                >
                  إلغاء التعديل / حصة جديدة
                </button>
              </div>
            )}

            <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-2">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[var(--primary)] shrink-0" />
                <span>بيانات الحصة والوحدة المقررة</span>
              </h3>
              <button
                type="button"
                onClick={handleSaveSession}
                className="inline-flex sm:hidden items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold shadow-xs cursor-pointer transition-all shrink-0"
                title="حفظ سريع للحصة"
              >
                <Save className="w-3.5 h-3.5" />
                <span>حفظ سريع</span>
              </button>
            </div>

            {/* Date, Time & Unit Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">تاريخ الحصة:</label>
                <input
                  type="date" value={sessionDate}
                  onChange={e => handleSessionDateChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-slate-900 focus:ring-1 focus:ring-[var(--primary)]" />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">من الساعة:</label>
                <input
                  type="time" value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-slate-900 focus:ring-1 focus:ring-[var(--primary)]" />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">إلى الساعة:</label>
                <input
                  type="time" value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-slate-900 focus:ring-1 focus:ring-[var(--primary)]" />
              </div>
            </div>

            {excludedDayLabel && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-1">
                <div className="flex items-center gap-2 font-black">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <span>يوم مستثنى من الحصص: {excludedDayLabel}</span>
                </div>
                <p className="font-medium leading-relaxed">
                  هذا اليوم مستثنى؛ لا تُنشأ فيه حصة دراسية جديدة. يمكنك توثيقه كحصة ملغاة بهذا السبب،
                  أو تعديل الرزنامة من الإعدادات. التوثيقات السابقة تبقى محفوظة ولا تُحذف.
                </p>
              </div>
            )}

            {/* Session Status Toggle: Completed vs Cancelled */}
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-sm">
              <label className="text-xs font-bold text-slate-700 block">
                حالة الحصة:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSessionStatus('COMPLETED')}
                  className={`min-h-10 px-3.5 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    sessionStatus === 'COMPLETED'
                      ? 'bg-[var(--primary)] text-white shadow-xs'
                      : 'bg-white border border-slate-300 text-slate-700 hover:border-[var(--primary)]'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>حصة منجزة (عادية)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSessionStatus('CANCELLED');
                    setIsUnitCompleted(false);
                  }}
                  className={`min-h-10 px-3.5 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    sessionStatus === 'CANCELLED'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-white border border-slate-300 text-slate-700 hover:border-rose-400 hover:text-rose-700'
                  }`}
                >
                  <Ban className="w-4 h-4" />
                  <span>حصة ملغاة (تعذّر إنجازها)</span>
                </button>
              </div>

              {sessionStatus === 'CANCELLED' && (
                <div className="mt-2.5 space-y-2.5 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                  <div>
                    <label className="text-xs font-bold text-rose-900 mb-1.5 block">
                      سبب إلغاء الحصة (اختر سبباً سريعاً أو دوّن السبب):
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {CANCELLATION_REASON_PRESETS.map(reason => (
                        <button
                          key={reason}
                          type="button"
                          onClick={() => setCancellationReason(reason)}
                          className={`min-h-8 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                            cancellationReason === reason
                              ? 'bg-rose-600 text-white shadow-2xs'
                              : 'bg-white border border-rose-200 text-rose-800 hover:border-rose-400 hover:bg-rose-100/60'
                          }`}
                        >
                          {reason}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={cancellationReason}
                      onChange={e => setCancellationReason(e.target.value)}
                      placeholder="اكتب سبب عدم إنجاز الحصة (مثال: الغياب، اجتماع، ندوة تربوية...)"
                      className="w-full px-3 py-2 rounded-xl border border-rose-300 bg-white text-xs font-bold text-slate-900 focus:ring-1 focus:ring-rose-500 focus:outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-rose-800 font-medium leading-relaxed">
                    عند حفظ الحصة كملغاة، يتم توثيقها في الدفتر اليومي مع ذكر السبب، ولا تُحتسب الوحدة التعلمية كمنجزة في التدرج السنوي.
                  </p>
                </div>
              )}
            </div>

            {/* Lesson / Unit Picker */}
            <div className="space-y-1 text-sm">
              <label className="font-bold text-slate-700 flex items-center justify-between">
                <span>
                  {sessionStatus === 'CANCELLED'
                    ? 'موضوع الدرس المبرمج للحصة (اختياري):'
                    : 'موضوع الدرس / الوحدة التعلمية المقررة:'}
                </span>
                {isOrientationSelected ? (
                  <span className="text-[var(--primary)] font-semibold">حصة توجيهية دون وحدة</span>
                ) : selectedUnitObj ? (
                  <span className="text-[var(--primary)] font-semibold">
                    الميدان: {selectedUnitObj.domain} • الحجم: {selectedUnitObj.hourlyVolume} سا
                  </span>
                ) : null}
              </label>
              <select
                value={isOrientationSelected ? ORIENTATION_SESSION_UNIT_ID : effectiveSelectedUnitId}
                onChange={e => handleSelectUnit(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 focus:ring-1 focus:ring-[var(--primary)] cursor-pointer bg-white" >
                <option value={ORIENTATION_SESSION_UNIT_ID}>
                  الحصة الأولى: تقديم توجيهات عامة + تقديم البرنامج (دون وحدة)
                </option>
                {availableUnits.map(unit => (
                  <option key={unit.id} value={unit.id}>
                    الوحدة {unit.unitNumber}: {unit.title} ({unit.domain})
                  </option>
                ))}
              </select>
            </div>

            {/* Part selector & Unit completion toggle */}
            {sessionStatus !== 'CANCELLED' && !isOrientationSelected && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
                <div>
                  <label className="text-xs font-bold text-slate-700 mb-1.5 block">
                    رقم الحصة من الوحدة (الجزء):
                  </label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {SESSION_PART_NUMBERS.map(num => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => {
                          setPartNumber(num);
                          const totalHours = selectedUnitObj?.hourlyVolume || 2;
                          setIsUnitCompleted(num >= totalHours);
                        }}
                        className={`min-h-9 px-3 rounded-lg text-xs font-black transition-all cursor-pointer ${
                          partNumber === num
                            ? 'bg-[var(--primary)] text-white shadow-xs'
                            : 'bg-white border border-slate-300 text-slate-700 hover:border-[var(--primary)]'
                        }`}
                      >
                        حصة ({num})
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    عنوان التدوين بالدفتر: <span className="font-bold text-[var(--primary)]">{selectedUnitObj?.title || 'الوحدة'} ({partNumber})</span>
                  </p>
                </div>

                <div className="flex flex-col justify-center">
                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-[var(--primary)]/20 bg-white hover:bg-[var(--primary-soft)]/20 transition-colors cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isUnitCompleted}
                      onChange={e => setIsUnitCompleted(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-[var(--primary)] focus:ring-[var(--primary)] cursor-pointer"
                    />
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-900 block">
                        تم إتمام الوحدة كاملة (تسجيل الإنجاز في المنهاج)
                      </span>
                      <span className="text-[11px] text-slate-500 block leading-tight">
                        {isUnitCompleted
                          ? '✓ سيتم احتساب الوحدة كمنجزة بالكامل في المنهاج والتوزيع السنوي.'
                          : '⏳ الوحدة جارية (حصة جزئية) ولن تُسجل كمكتملة في المنهاج حتى إتمامها.'}
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* Show the latest note for this unit as a writing aid */}
            {previousMemoryForThisUnit && (
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs space-y-1">
                <div className="font-black text-amber-900 flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 text-amber-600" />
                  <span>ملاحظة سابقة لنفس هذا الدرس:</span>
                </div>
                <p className="text-sm leading-7 text-[var(--text-primary)] whitespace-pre-line">
                  {getSessionNotes(previousMemoryForThisUnit)}
                </p>
              </div>
            )}

            {/* Objectives (Static View) */}
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap pb-0.5">
                <label className="font-bold text-slate-700 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-[var(--primary)]" />
                  <span>الأهداف التعلمية المسطرة للحصة:</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-normal text-[10px] hidden sm:inline">مستخرجة آلياً من قاعدة البيانات</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden p-3 min-h-[60px]">
                {sessionGoals ? (
                  <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 font-medium">{sessionGoals}</div>
                ) : (
                  <span className="text-slate-400 italic">اختر وحدة تعليمية لعرض أهدافها...</span>
                )}
              </div>
            </div>

            {/* ONE UNIFIED TEXT AREA: توثيق الحصة وما تم إنجازه + التوجيهات والواجبات + دفتر الملاحظات */}
            <div className="space-y-2 text-sm">
              <label className="font-bold text-slate-800 flex items-center justify-between flex-wrap gap-2">
                <span className="flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4 text-[var(--primary)]" />
                  <span>توثيق وملاحظات الحصة (خانة كتابة موحدة):</span>
                </span>
                <span className="text-slate-400 font-normal text-[10px]">
                  ما تم إنجازه + التوجيهات والواجبات + دفتر الملاحظات في خانة واحدة
                </span>
              </label>

              {/* Quick Template Chips */}
              <div className="flex flex-wrap gap-1.5 pb-1">
                {[
                  { label: '+ ما تم إنجازه:', text: '• ما تم إنجازه: ' },
                  { label: '+ التوجيهات والواجبات:', text: '• التوجيهات والواجبات: ' },
                  { label: '+ ملاحظة:', text: '• ملاحظة: ' },
                  { label: 'إنجاز عناصر الدرس', text: 'تم إنجاز عناصر الدرس المبرمجة مع التلاميذ.' },
                  { label: 'نشاط تطبيقي ومناقشة', text: 'نشاط تطبيقي ومناقشة جماعية وحل وضعيات تقويمية.' },
                  { label: 'واجب منزلي قصير', text: 'واجب منزلي قصير: مراجعة العناصر وتلخيص المكتسبات.' },
                ].map(chip => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => {
                      setUnifiedNotes(prev => {
                        if (!prev.trim()) return chip.text;
                        return `${prev}\n${chip.text}`;
                      });
                    }}
                    className="min-h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-bold text-slate-700 hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)] transition-colors cursor-pointer"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Unified Formatting Bar & Textarea */}
              <div className="rounded-xl border border-slate-300 overflow-hidden focus-within:ring-1 focus-within:ring-[var(--primary)] focus-within:border-[var(--primary)] shadow-2xs">
                <FormattingBar val={unifiedNotes} setter={setUnifiedNotes} />
                <textarea
                  rows={6}
                  value={unifiedNotes}
                  onChange={e => setUnifiedNotes(e.target.value)}
                  placeholder="دوّن هنا ما تم إنجازه، التوجيهات والواجبات للحصة القادمة، وملاحظاتك البيداغوجية بكل حرية..."
                  className="w-full px-3.5 py-3 text-sm leading-7 text-slate-900 border-0 focus:outline-none resize-y bg-white font-medium"
                />
              </div>
            </div>

            {/* Submit button */}
            <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 -mx-5 border-t border-[var(--border-default)] bg-[var(--bg-surface)]/95 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
              <button
                onClick={handleSaveSession}
                className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-black shadow-md cursor-pointer transition-all" id="btn-save-session-record" >
                <Save className="w-4 h-4" />
                <span>{editingSessionId ? 'إنهاء الحصة وتأكيد التوثيق' : 'إنهاء الحصة وحفظها في الدفتر اليومي'}</span>
              </button>
            </div>
      </div>

      {/* Historical Sessions Log */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-700" />
            <span>سجل الحصص السابقة لقسم {activeClass?.name} ({classPastSessions.length} حصة)</span>
          </h3>
          {classPastSessions.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                {classDocumentedSessions.length} موثقة
              </span>
              {classPastSessions.length - classDocumentedSessions.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300 font-bold">
                  {classPastSessions.length - classDocumentedSessions.length} غير موثقة
                </span>
              )}
            </div>
          )}
        </div>

        {classPastSessions.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400">
            لم تسجل بعد أي حصة سابقة لهذا القسم. استخدم النموذج أعلاه لتدوين أول حصة.
          </div>
        ) : (
          <div className="space-y-3">
            {classPastSessions.map(ses => {
              const unit = availableUnits.find(u => u.id === ses.unitId);
              const isDocumented = isSessionDocumented(ses);
              const isEditingThis = ses.id === editingSessionId;
              const title = ses.customTopic || unit?.title || (ses.sessionGoals ? ses.sessionGoals.slice(0, 40) : 'حصة غير محددة');

              return (
                <div
                  key={ses.id}
                  className={`p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 text-sm rounded-xl transition-all ${
                    isEditingThis
                      ? 'bg-amber-50/80 border-2 border-amber-400 shadow-xs'
                      : !isDocumented
                      ? 'bg-amber-50/40 border border-amber-200/90 hover:bg-amber-50/70'
                      : 'bg-slate-50/60 hover:bg-slate-50 border border-slate-200/70'
                  }`}
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-slate-800 bg-white border border-slate-200 px-2 py-0.5 rounded-lg text-xs shadow-2xs">
                        {ses.date}
                      </span>
                      <span className="text-slate-500 font-mono text-xs">
                        {ses.startTime} – {ses.endTime}
                      </span>
                      <span className="font-bold text-slate-900">
                        {title}
                      </span>
                      {ses.sessionStatus === 'CANCELLED' ? (
                        <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-800 rounded-full border border-rose-200 inline-flex items-center gap-1">
                          <Ban className="w-3 h-3 text-rose-600" />
                          <span>ملغاة{ses.cancellationReason ? `: ${ses.cancellationReason}` : ''}</span>
                        </span>
                      ) : isDocumented ? (
                        <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>موثقة</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full border border-amber-300 inline-flex items-center gap-1">
                          <span>غير موثقة</span>
                        </span>
                      )}
                    </div>

                    {isDocumented ? (
                      <>
                        {ses.accomplishments && (
                          <p className="text-sm leading-6 text-slate-700 whitespace-pre-line bg-white/80 rounded-lg p-2.5 border border-slate-100 mt-1">
                            {ses.accomplishments}
                          </p>
                        )}
                        {ses.nextSteps && !ses.accomplishments?.includes(ses.nextSteps) && (
                          <p className="text-xs leading-5 text-slate-500 whitespace-pre-line mt-0.5">
                            <span className="font-semibold text-slate-600">التوجيهات: </span>
                            {ses.nextSteps}
                          </p>
                        )}
                        {getSessionNotes(ses) && !ses.accomplishments?.includes(getSessionNotes(ses)!) && (
                          <p className="text-xs leading-5 text-amber-800 whitespace-pre-line rounded-lg bg-amber-50 px-2 py-1 mt-0.5">
                            <span className="font-semibold text-amber-900">دفتر الملاحظات: </span>
                            {getSessionNotes(ses)}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-amber-700 font-medium">
                        هذه الحصة مرت وفق جدول الحصص ولم يتم توثيق محتواها في دفتر النصوص بعد.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSessionId(ses.id);
                        const formElem = document.getElementById('session-entry-form-card');
                        if (formElem) {
                          formElem.scrollIntoView({ behavior: 'smooth' });
                        } else {
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        !isDocumented
                          ? 'bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white shadow-xs'
                          : 'bg-white hover:bg-[var(--primary-soft)] text-slate-700 hover:text-[var(--primary)] border border-slate-200'
                      }`}
                      title="توثيق / تعديل الحصة"
                    >
                      <FileEdit className="w-3.5 h-3.5" />
                      <span>{isDocumented ? 'تعديل' : 'توثيق الآن'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(ses.id)}
                      className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer transition-colors"
                      title="حذف الحصة"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
          <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="تأكيد الحذف" message="هل أنت متأكد من حذف هذا السجل من الدفتر اليومي؟" onConfirm={() => { if (deleteConfirmId) handleDeleteSession(deleteConfirmId); }}
        onCancel={() => setDeleteConfirmId(null)}
      />
</div>
  );
};
