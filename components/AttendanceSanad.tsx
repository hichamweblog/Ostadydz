'use client';

import { showToast } from '@/components/Toast';
import { useAppState } from '@/hooks/app-state-context';
import React, { useEffect, useState } from 'react';
import { exportToDocx, triggerHapticFeedback } from '@/lib/utils';
import { AppState } from '@/lib/storage';
import { getExcludedDayLabel, isDateExcluded } from '@/lib/academic-calendar';
import { getLocalDateString } from '@/lib/date-utils';
import { AttendanceStatus, SessionRecord, Student } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import {
  UserCheck,
  Calendar,
  Clock,
  Sparkles,
  Printer,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock3,
  HelpCircle,
  Plus,
  Users,
  Search,
  Filter,
  LayoutGrid,
  List,
  AlertTriangle,
  BookX,
  UserMinus,
  Star,
  Save
} from 'lucide-react';

interface AttendanceSanadProps {
  onNavigateToTimetable?: () => void;
  onNavigateToSessions?: (sessionId?: string) => void;
}

export const AttendanceSanad: React.FC<AttendanceSanadProps> = ({
  onNavigateToTimetable,
  onNavigateToSessions
}) => {
  const { state, updateState: onUpdateState, updateStateAndWait } = useAppState();
  const [selectedClassId, setSelectedClassId] = useState<string>(
    state.activeClassId || (state.classes[0]?.id || '')
  );

  useEffect(() => {
    if (state.activeClassId && state.activeClassId !== selectedClassId) {
      // Sync navigation context when another screen changes the active class.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedClassId(state.activeClassId);
    }
  }, [state.activeClassId, selectedClassId]);

  const activeClass = state.classes.find(c => c.id === selectedClassId) || state.classes[0];
  const classStudents = state.students
    .filter(s => s.classId === selectedClassId)
    .sort((a, b) => a.numberInList - b.numberInList);

  const classSessions = state.sessions
    .filter(s => s.classId === selectedClassId)
    .sort((a, b) => b.date.localeCompare(a.date));

  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    classSessions[0]?.id || '' );
  const [searchQuery, setSearchQuery] = useState('');
  const [attendanceMode, setAttendanceMode] = useState<'quick' | 'detailed'>('quick');
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [bulkUndo, setBulkUndo] = useState<{
    sessionId: string;
    attendance: Record<string, AttendanceStatus>;
  } | null>(null);

  const activeSession = classSessions.find(s => s.id === selectedSessionId) || classSessions[0];
  const activeAttendance = activeSession?.attendance || {};

  const handleCycleStatus = (studentId: string) => {
    const current = activeAttendance[studentId] || 'PRESENT';
    const nextStatus = current === 'ABSENT' ? 'PRESENT' : 'ABSENT';
    handleSetStudentStatus(studentId, nextStatus);
  };

  const handleSelectClass = (classId: string) => {
    setSelectedClassId(classId);
    onUpdateState(prev => ({ ...prev, activeClassId: classId }));
  };

  // Calculate cumulative stats per student in this class across all sessions
  const studentStatsMap: Record<string, { absent: number; unwrittenLessons: number; disruptions: number; goodParticipation: number }> = {};
  for (const s of classStudents) {
    studentStatsMap[s.id] = { absent: 0, unwrittenLessons: 0, disruptions: 0, goodParticipation: 0 };
  }
  for (const session of classSessions) {
    if (session.attendance) {
      for (const [studentId, status] of Object.entries(session.attendance)) {
        if (!studentStatsMap[studentId]) studentStatsMap[studentId] = { absent: 0, unwrittenLessons: 0, disruptions: 0, goodParticipation: 0 };
        if (status === 'ABSENT') studentStatsMap[studentId].absent++;
      }
    }
    if (session.unwrittenLessons) {
      for (const studentId of session.unwrittenLessons) {
        if (!studentStatsMap[studentId]) studentStatsMap[studentId] = { absent: 0, unwrittenLessons: 0, disruptions: 0, goodParticipation: 0 };
        studentStatsMap[studentId].unwrittenLessons++;
      }
    }
    if (session.disruptions) {
      for (const studentId of session.disruptions) {
        if (!studentStatsMap[studentId]) studentStatsMap[studentId] = { absent: 0, unwrittenLessons: 0, disruptions: 0, goodParticipation: 0 };
        studentStatsMap[studentId].disruptions++;
      }
    }
    if (session.goodParticipation) {
      for (const studentId of session.goodParticipation) {
        if (!studentStatsMap[studentId]) studentStatsMap[studentId] = { absent: 0, unwrittenLessons: 0, disruptions: 0, goodParticipation: 0 };
        studentStatsMap[studentId].goodParticipation++;
      }
    }
  }

  // Handle setting status for a student in active session
  const handleSetStudentStatus = async (studentId: string, status: AttendanceStatus) => {
    if (!activeSession) return;
    
    triggerHapticFeedback();

    try {
      await updateStateAndWait(prev => ({
        ...prev,
        sessions: prev.sessions.map(ses => ses.id === activeSession.id
          ? { ...ses, attendance: { ...(ses.attendance || {}), [studentId]: status } }
          : ses)
      }));
    } catch (error) {
      console.error('Attendance status sync failed:', error);
      showToast('تعذر حفظ حالة الحضور في السحابة.', 'error');
    }
  };

  const handleToggleBehavior = async (studentId: string, behaviorType: 'disruptions' | 'unwrittenLessons' | 'poorParticipation' | 'goodParticipation') => {
    if (!activeSession) return;

    try {
      await updateStateAndWait(prev => ({
        ...prev,
        sessions: prev.sessions.map(ses => {
        if (ses.id === activeSession.id) {
          const arr = ses[behaviorType] || [];
          const exists = arr.includes(studentId);
          let newArr = exists ? arr.filter(id => id !== studentId) : [...arr, studentId];
          
          let updatedSes = { ...ses, [behaviorType]: newArr };

          // Mutually exclusive participation marks
          if (behaviorType === 'goodParticipation' && !exists) {
            updatedSes.poorParticipation = (ses.poorParticipation || []).filter(id => id !== studentId);
          } else if (behaviorType === 'poorParticipation' && !exists) {
            updatedSes.goodParticipation = (ses.goodParticipation || []).filter(id => id !== studentId);
          }

          return updatedSes;
        }
        return ses;
        })
      }));
    } catch (error) {
      console.error('Attendance behavior sync failed:', error);
      showToast('تعذر حفظ متابعة التلميذ في السحابة.', 'error');
    }
  };

  // Mark all students present in active session
  const handleMarkAllPresent = async () => {
    if (!activeSession) return;
    setBulkUndo({
      sessionId: activeSession.id,
      attendance: { ...(activeSession.attendance || {}) },
    });
    const allPresentMap: Record<string, AttendanceStatus> = {};
    for (const s of classStudents) {
      allPresentMap[s.id] = 'PRESENT';
    }

    try {
      await updateStateAndWait(prev => ({
        ...prev,
        sessions: prev.sessions.map(ses => {
        if (ses.id === activeSession.id) {
          return {
            ...ses,
            attendance: allPresentMap
          };
        }
        return ses;
        })
      }));
    } catch (error) {
      console.error('Mark all present sync failed:', error);
      showToast('تعذر حفظ الحضور الجماعي في السحابة.', 'error');
    }
  };

  const handleUndoBulkAttendance = async () => {
    if (!bulkUndo) return;
    const snapshot = bulkUndo;
    setBulkUndo(null);
    try {
      await updateStateAndWait(previous => ({
        ...previous,
        sessions: previous.sessions.map(session =>
          session.id === snapshot.sessionId
            ? { ...session, attendance: { ...snapshot.attendance } }
            : session
        ),
      }));
      showToast('تم التراجع عن تحديد الحضور الجماعي.', 'success');
    } catch (error) {
      console.error('Undo bulk attendance failed:', error);
      showToast('تعذر التراجع عن العملية.', 'error');
    }
  };

  // Finish attendance and continue the same session in the lesson log.
  const handleFinishAttendance = async () => {
    if (!activeSession) return;
    setIsSavingAll(true);
    try {
      await updateStateAndWait(prev => ({
        ...prev,
        sessions: prev.sessions.map(ses => ses.id === activeSession.id
          ? {
              ...ses,
              attendance: { ...(activeAttendance || {}) },
              unwrittenLessons: [...(activeSession.unwrittenLessons || [])],
              disruptions: [...(activeSession.disruptions || [])],
              poorParticipation: [...(activeSession.poorParticipation || [])],
              goodParticipation: [...(activeSession.goodParticipation || [])],
            }
          : ses)
      }));
      showToast(`تم إنهاء الحضور: ${absentCount} غائب، ${presentCount} حاضر.`, 'success');
      onNavigateToSessions?.(activeSession.id);
    } catch (error) {
      console.error('Save all attendance sync failed:', error);
      showToast('تعذر حفظ كامل بيانات الحصة في السحابة.', 'error');
    } finally {
      setIsSavingAll(false);
    }
  };

  // Create a session for today, deriving its time from the timetable whenever possible.
  const handleCreateTodaySession = async () => {
    const today = new Date();
    const todayStr = getLocalDateString(today);
    const excluded = getExcludedDayLabel(state.calendarSettings?.holidays, todayStr, activeClass?.level);
    if (excluded) {
      showToast(`اليوم مستثنى من الحصص: ${excluded}`, 'warning');
      return;
    }
    const currentTime = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`;
    const todayClassSlots = state.timetable
      .filter(slot => slot.classId === selectedClassId && slot.dayOfWeek === today.getDay())
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const inferredSlot =
      todayClassSlots.find(slot => slot.startTime <= currentTime && currentTime < slot.endTime) ??
      todayClassSlots.find(slot => slot.startTime > currentTime) ??
      todayClassSlots[0];
    const inferredStartTime = inferredSlot?.startTime ?? '08:00';
    const existingSession = state.sessions.find(session =>
      session.classId === selectedClassId &&
      session.date === todayStr &&
      session.startTime === inferredStartTime
    );
    if (existingSession) {
      setSelectedSessionId(existingSession.id);
      return;
    }

    const newSession: SessionRecord = {
      id: uuidv4(),
      classId: selectedClassId,
      date: todayStr,
      startTime: inferredStartTime,
      endTime: inferredSlot?.endTime ?? '09:00',
      sessionGoals: 'تسجيل الحضور والمتابعة اليومية',
      accomplishments: '',
      nextSteps: '',
      teacherNotes: '', attendance: {},
      };

    setSelectedSessionId(newSession.id);
    try {
      await updateStateAndWait(prev => ({
        ...prev,
        activeClassId: selectedClassId,
        sessions: [newSession, ...prev.sessions]
      }));
    } catch (error) {
      console.error('Create session sync failed:', error);
      showToast('تعذر إنشاء الحصة في السحابة.', 'error');
    }
  };

  // Generate sessions for the active trimester according to the weekly timetable
  const handleGenerateTrimesterSessions = () => {
    const timetableForClass = state.timetable.filter(s => s.classId === selectedClassId);
    if (timetableForClass.length === 0) {
      showToast('يرجى أولاً إضافة حصص لهذا الفوج في جدول التوقيت ليتسنى توليدها تلقائياً.', 'warning');
      return;
    }

    const termDates = state.calendarSettings?.termDates || {
      term1Start: '2026-09-01',
      term1End: '2026-12-15',
      term2Start: '2026-12-16',
      term2End: '2027-03-15',
      term3Start: '2027-03-16',
      term3End: '2027-06-30' };

    let start = new Date(termDates.term1Start);
    let end = new Date(termDates.term1End);
    if (state.activeTrimester === 2) {
      start = new Date(termDates.term2Start);
      end = new Date(termDates.term2End);
    } else if (state.activeTrimester === 3) {
      start = new Date(termDates.term3Start);
      end = new Date(termDates.term3End);
    }

    const newSessions: SessionRecord[] = [];
    const cur = new Date(start);

    // Keep a generous safety limit while allowing two weekly lessons to cover a full trimester.
    let count = 0;
    while (cur <= end && count < 100) {
      const dayOfWeek = cur.getDay(); // 0=Sun ... 4=Thu
      const matchingSlots = timetableForClass
        .filter(t => t.dayOfWeek === dayOfWeek)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (matchingSlots.length > 0) {
        const dateStr = getLocalDateString(cur);
        for (const matchSlot of matchingSlots) {
          if (isDateExcluded(state.calendarSettings?.holidays, dateStr, activeClass?.level)) continue;
          if (count >= 100) break;
          const exists = [...state.sessions, ...newSessions].some(
            s =>
              s.classId === selectedClassId &&
              s.date === dateStr &&
              s.startTime === matchSlot.startTime &&
              s.endTime === matchSlot.endTime
          );
          if (exists) continue;

          newSessions.push({
            id: uuidv4(),
            classId: selectedClassId,
            date: dateStr,
            startTime: matchSlot.startTime,
            endTime: matchSlot.endTime,
            sessionGoals: '',
            accomplishments: '',
            nextSteps: '',
            teacherNotes: '',
            attendance: {},
          });
          count++;
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (newSessions.length > 0) {
      void updateStateAndWait(prev => ({
        ...prev,
        activeClassId: selectedClassId,
        sessions: [...newSessions, ...prev.sessions]
      }))
        .then(() => {
          setSelectedSessionId(newSessions[0].id);
          showToast(`تم حفظ ${newSessions.length} حصة في طابور المزامنة للفصل ${state.activeTrimester}.`, 'success');
        })
        .catch((error: unknown) => {
          console.error('Generated sessions sync failed:', error);
          showToast(error instanceof Error ? error.message : 'تعذر تأكيد الحصص في السحابة.', 'error');
        });
    } else {
      showToast('جميع حصص هذا الفصل مولدة مسبقاً.', 'warning');
    }
    setShowGenerateConfirm(false);
  };

  const filteredStudents = classStudents.filter(s =>
    s.fullName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Active session stats
  const absentCount = Object.values(activeAttendance).filter(v => v === 'ABSENT').length;
  // الحضور = إجمالي التلاميذ - عدد الغائبين
  const presentCount = classStudents.length - absentCount;

  // Export official attendance sheet to Word (.docx) with clean table and RTL visual columns
  const handleExportDoc = () => {
    const studentRows = classStudents
      .map(student => {
        const status = activeAttendance[student.id] || 'PRESENT';
        const stats = studentStatsMap[student.id] || { absent: 0, late: 0, excused: 0 };
        const isGood = activeSession?.goodParticipation?.includes(student.id);
        const isPoor = activeSession?.poorParticipation?.includes(student.id);
        const isDisruptive = activeSession?.disruptions?.includes(student.id);
        const isNoLessons = activeSession?.unwrittenLessons?.includes(student.id);

        const behaviorParts: string[] = [];
        if (isGood) behaviorParts.push('مشارك ونشيط');
        if (isPoor) behaviorParts.push('مستوى ضعيف يحتاج متابعة');
        if (isNoLessons) behaviorParts.push('بدون كراس');
        if (isDisruptive) behaviorParts.push('سلوك غير منضبط');

        const statusLabel =
          status === 'ABSENT' ? '<span style="color: #dc2626; font-weight: bold;">غائب</span>' : status === 'LATE' ? '<span style="color: #d97706; font-weight: bold;">متأخر</span>' : status === 'EXCUSED' ? '<span style="color: #2563eb; font-weight: bold;">مبرر</span>' : '<span style="color: #16a34a;">حاضر</span>';

        const statsText = `غ: ${stats.absent} | شغب: ${stats.disruptions} | كراس: ${stats.unwrittenLessons}`;
          
          return `
            <tr>
              <td style="border: 1px solid #d5dfdc; padding: 6px; text-align: center;">${student.numberInList}</td>
              <td style="border: 1px solid #d5dfdc; padding: 6px;"><b>${student.fullName}</b></td>
              <td style="border: 1px solid #d5dfdc; padding: 6px; text-align: center;">${statusLabel}</td>
              <td style="border: 1px solid #d5dfdc; padding: 6px;">${behaviorParts.join('، ') || '-'}</td>
              <td style="border: 1px solid #d5dfdc; padding: 6px; text-align: center; direction: ltr;">${statsText}</td>
            </tr>
          `;
      })
      .join('');

    const html = `
      <div dir="rtl" style="font-family: 'Amiri', 'Traditional Arabic', serif; color: #000000; padding: 5px;">
        <table style="width: 100%; border: none; margin-bottom: 10px; font-size: 9.5pt;">
          <tr>
            <td style="width: 33%; text-align: right; vertical-align: top; line-height: 1.4;">
              المؤسسة: <b>${state.profile.schoolName || 'ثانوية التعليم الثانوي'}</b><br/>
              الأستاذ(ة): <b>${state.profile.name || 'أستاذ المادة'}</b><br/>
              المادة: <b>العلوم الإسلامية</b>
            </td>
            <td style="width: 34%; text-align: center; vertical-align: middle;">
              <div style="margin: 0; font-size: 12pt; color: #0d2c3b; text-decoration: underline;">ورقة رصد الغياب والمتابعة اليومية</div>
              <div style="font-size: 10.5pt; font-weight: bold; margin-top: 2px;">
                القسم: <b>${activeClass?.name || 'فوج تربوي'}</b> (${activeClass?.stream || ''}) — القاعة: <b>${activeClass?.roomNumber || '...'}</b>
              </div>
            </td>
            <td style="width: 33%; text-align: left; vertical-align: top; line-height: 1.4;">
              الموسم الدراسي: <b>${state.profile.academicYear || '2026/2027'}</b><br/>
              التاريخ: <b>${activeSession?.date || '..../..../2026 م'}</b><br/>
              التوقيت: <b>${activeSession ? `${activeSession.startTime} - ${activeSession.endTime}` : '...... إلى ......'}</b>
            </td>
          </tr>
        </table>

        <div style="height: 1.5px; background-color: #0d2c3b; margin-bottom: 10px;"></div>

        <table style="width: 100%; border-collapse: collapse; border: 1px solid #000; font-size: 10pt;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold;">
              <th style="border: 1px solid #000; padding: 6px; width: 8%; text-align: center;">الرقم</th>
              <th style="border: 1px solid #000; padding: 6px; width: 32%; text-align: right;">اسم ولقب التلميذ</th>
              <th style="border: 1px solid #000; padding: 6px; width: 14%; text-align: center;">حالة الحصة</th>
              <th style="border: 1px solid #000; padding: 6px; width: 14%; text-align: center;">الغياب والتأخر التراكمي</th>
              <th style="border: 1px solid #000; padding: 6px; width: 32%; text-align: right;">الملاحظات وتقويم الانضباط</th>
            </tr>
          </thead>
          <tbody>
            ${studentRows}
          </tbody>
        </table>

        <div style="margin-top: 12px; padding: 8px; border: 1px solid #94a3b8; background-color: #f8fafc; font-size: 9.5pt;">
          <b>إحصاء الحصة:</b> تعداد الفوج: <b>${classStudents.length}</b> تلميذ &nbsp;|&nbsp; 
          الحاضرون: <b style="color: #16a34a;">${presentCount}</b> &nbsp;|&nbsp; 
          الغائبون: <b style="color: #dc2626;">${absentCount}</b>
        </div>

        <table style="width: 100%; border: none; margin-top: 20px; font-size: 10pt;">
          <tr>
            <td style="width: 50%; text-align: center; vertical-align: top; border: 1px dashed #cbd5e1; padding: 12px;">
              <b>توقيع أستاذ(ة) المادة:</b>
              <p style="margin: 30px 0 0; font-size: 8.5pt; color: #64748b;">حرر في: ${activeSession?.date || '..../..../2026 م'}</p>
            </td>
            <td style="width: 50%; text-align: center; vertical-align: top; border: 1px dashed #cbd5e1; padding: 12px;">
              <b>تأشيرة مستشار التربية / ناظر الدروس:</b>
              <p style="margin: 30px 0 0; font-size: 8.5pt; color: #64748b;">(الختم والملاحظة)</p>
            </td>
          </tr>
        </table>
      </div>
    `;

    exportToDocx(html, `ورقة_الغياب_${activeClass?.name || 'فوج'}_${activeSession?.date || 'حصة'}`);
  };

  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="attendance-sanad-view">

      {/* Top Class Selector & Action Ribbon (Screenshot 6) */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] text-[var(--primary)] flex items-center justify-center font-bold">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">الفوج المعروض:</div>
            <select
              value={selectedClassId}
              onChange={e => {
                handleSelectClass(e.target.value);
                const nextSes = state.sessions.find(s => s.classId === e.target.value);
                if (nextSes) setSelectedSessionId(nextSes.id);
              }}
              className="block w-full max-w-full min-w-0 text-wrap whitespace-normal font-bold text-slate-900 bg-transparent text-base focus:outline-none border-b border-dashed border-[var(--primary)] cursor-pointer" >
              {state.classes.map(cls => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} - {cls.stream}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-stretch sm:items-center gap-2 flex-wrap">
          {/* Generate sessions button */}
          <button
            onClick={() => handleGenerateTrimesterSessions()}
            className="min-h-11 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-[var(--primary)] bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)] border border-[var(--primary)]/20 transition-colors cursor-pointer" >
            <Sparkles className="w-3.5 h-3.5" />
            <span>توليد حصص الفصل {state.activeTrimester}</span>
          </button>

          {/* New session button */}
          <button
            onClick={handleCreateTodaySession}
            className="min-h-11 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] transition-colors shadow-xs cursor-pointer" >
            <Plus className="w-4 h-4" />
            <span>حصة جديدة اليوم</span>
          </button>
        </div>
      </div>

      {/* If No sessions exist for class */}
      {classSessions.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center space-y-3">
          <Clock3 className="w-8 h-8 text-gold mx-auto" />
          <h3 className="font-bold text-amber-900 text-sm">
            لا توجد حصص مسجلة لهذا الفوج حتى الآن
          </h3>
          <p className="text-xs text-amber-700 max-w-md mx-auto">
            يمكنك توليد حصص الفصل تلقائياً وفق جدول التوقيت، أو إضافة حصة جديدة يدوياً للبدء برصد الحضور.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={handleGenerateTrimesterSessions}
              className="px-4 py-2 bg-[var(--primary)] text-white text-xs font-bold rounded-xl shadow-xs hover:bg-[var(--primary-hover)] cursor-pointer" >
              توليد حصص الفصل {state.activeTrimester}
            </button>
            {onNavigateToTimetable && (
              <button
                onClick={onNavigateToTimetable}
                className="px-4 py-2 bg-white border border-amber-300 text-amber-900 text-xs font-bold rounded-xl hover:bg-amber-100 cursor-pointer" >
                الذهاب إلى جدول التوقيت
              </button>
            )}
          </div>
        </div>
      )}

      {/* Session Active Toolbar */}
      {activeSession && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            {/* Session Selector */}
            <div className="flex flex-col gap-2 w-full sm:flex-1">
              <span className="text-xs font-bold text-slate-700 shrink-0">تحديد الحصة:</span>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                    value={selectedSessionId}
                    onChange={e => setSelectedSessionId(e.target.value)}
                    className="w-full sm:flex-1 px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 text-[11px] sm:text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] cursor-pointer" >
                    {classSessions.map(ses => (
                      <option key={ses.id} value={ses.id}>
                    {ses.date} ({ses.startTime}-{ses.endTime}) {ses.sessionGoals ? `- ${ses.sessionGoals.slice(0, 30)}...` : ''}
                      </option>
                    ))}
                  </select>

                {/* Mark All Present */}
                <button
                  onClick={handleMarkAllPresent}
                  className="w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)] text-[var(--primary)] text-xs font-bold border border-[var(--primary)]/20 transition-colors cursor-pointer shrink-0" >
                  تحديد الكل «حاضر»
                </button>

                {/* Attendance is already auto-saved; this action advances the session workflow. */}
                <button
                  onClick={() => void handleFinishAttendance()}
                  disabled={isSavingAll}
                  className="w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold transition-colors cursor-pointer shrink-0 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1.5" >
                  <Save className="w-3.5 h-3.5" />
                  {isSavingAll ? 'جارٍ الإنهاء...' : 'إنهاء الحضور'}
                </button>
              </div>
            </div>

            {/* Quick Session Stats */}
            <div className="grid grid-cols-2 sm:flex items-center gap-1.5 sm:gap-2 text-xs w-full sm:w-auto">
              <div className="text-center sm:text-right px-2 py-1 rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] font-bold border border-[var(--primary)]/20">
                <span className="sm:hidden block text-[10px] text-[var(--primary)]">حاضر</span>
                <span className="hidden sm:inline">حاضر: </span>
                <span>{presentCount}</span>
              </div>
              <div className="text-center sm:text-right px-2 py-1 rounded-lg bg-rose-50 text-rose-800 font-bold border border-rose-200">
                <span className="sm:hidden block text-[10px] text-rose-700">غائب</span>
                <span className="hidden sm:inline">غائب: </span>
                <span>{absentCount}</span>
              </div>
            </div>
          </div>

          {bulkUndo?.sessionId === activeSession.id && (
            <div
              role="status"
              className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-4 py-2 text-xs font-bold text-[var(--text-primary)]"
            >
              <span>تم تحديد كل التلاميذ حاضرين.</span>
              <button
                type="button"
                onClick={() => void handleUndoBulkAttendance()}
                className="min-h-11 rounded-lg bg-white px-4 text-[var(--primary)] shadow-xs"
              >
                تراجع
              </button>
            </div>
          )}

          {/* Search bar and View Mode Switcher */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <div className="relative flex-1 w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                <input
                  type="text" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="بحث عن تلميذ..." className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-xl bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
              </div>
              <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1 text-[11px] font-black">
                <button
                  type="button"
                  onClick={() => setAttendanceMode('quick')}
                  className={`min-h-9 rounded-lg px-3 ${attendanceMode === 'quick' ? 'bg-white text-[var(--primary)] shadow-xs' : 'text-slate-500'}`}
                >
                  سريع
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceMode('detailed')}
                  className={`min-h-9 rounded-lg px-3 ${attendanceMode === 'detailed' ? 'bg-white text-[var(--primary)] shadow-xs' : 'text-slate-500'}`}
                >
                  مفصل
                </button>
              </div>

            </div>

            <button
              onClick={handleExportDoc}
              className="flex min-h-11 items-center justify-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-xs" >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              <span>تصدير إلى ملف docx</span>
            </button>
            {onNavigateToSessions && (
              <button
                type="button"
                onClick={() => onNavigateToSessions(activeSession?.id)}
                className="flex min-h-11 items-center justify-center gap-1.5 px-3.5 py-2 bg-[var(--primary)] border border-[var(--primary)] rounded-xl text-xs font-bold text-white hover:bg-[var(--primary-hover)] cursor-pointer shadow-xs"
              >
                متابعة في دفتر النصوص
              </button>
            )}
          </div>

          {/* Conditional View: Table vs Seating Plan */}
          <div id="attendance-doc">
          <div className="space-y-3">
              {/* 1. Mobile-First Card View (Screens < 768px): ZERO Horizontal Scrolling */}
              <div className="block md:hidden space-y-2.5">
                {filteredStudents.map(student => {
                  const status = activeAttendance[student.id] || 'PRESENT';
                  const stats = studentStatsMap[student.id] || { absent: 0, unwrittenLessons: 0, disruptions: 0, goodParticipation: 0 };
                  const deductionPoints = (stats.absent * 0.5) + (stats.unwrittenLessons * 0.5) + (stats.disruptions * 0.5);
                  const bonusPoints = stats.goodParticipation * 0.5;
                  const estimatedImpact = bonusPoints - deductionPoints;

                  return (
                    <div
                      key={student.id}
                      className="p-3 bg-white rounded-xl border border-[var(--border-default)] shadow-xs space-y-2.5 transition-all" >
                      {/* Top Row: Number, Name, Repeater, & Stats */}
                      <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-3">
                        <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
                          <span className="w-7 h-7 rounded-xl bg-slate-100 text-slate-700 font-mono font-bold text-xs flex items-center justify-center shrink-0 border border-slate-200">
                            {student.numberInList}
                          </span>
                          <div className="min-w-0 flex-1">
                            <h4 className="font-bold text-sm text-[var(--text-primary)] whitespace-normal break-words leading-tight">
                              {student.fullName}
                            </h4>
                            {student.isRepeater && (
                              <span className="inline-block text-[9px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-semibold mt-0.5">
                                معيد
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Badges: Total Absences & Delays */}
                        <div className="flex items-center gap-1 shrink-0 text-[11px] font-bold font-mono flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded-lg border ${
                              stats.absent > 0
                                ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-400 border-slate-200' }`}
                            title="مجموع الغيابات" >
                            {stats.absent} غ
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-lg border ${
                              stats.disruptions > 0 || stats.unwrittenLessons > 0
                                ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-400 border-slate-200' }`}
                            title="مجموع التأخرات" >
                            شغب: {stats.disruptions} | كراس: {stats.unwrittenLessons}
                          </span>
                          {estimatedImpact !== 0 && (
                            <span className={`text-[10px] font-semibold ${estimatedImpact > 0 ? 'text-[var(--primary)]' : 'text-rose-600'}`}>
                              ({estimatedImpact > 0 ? '+' : ''}{estimatedImpact.toFixed(2)})
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Unified Attendance & Behavior Buttons (Mobile) */}
                      <div className={`grid ${attendanceMode === 'detailed' ? 'grid-cols-4' : 'grid-cols-1'} gap-1.5`}>
                                <button
                                  type="button"
                                  onClick={() => handleSetStudentStatus(student.id, status === 'ABSENT' ? 'PRESENT' : 'ABSENT')}
                                  aria-pressed={status === 'ABSENT'}
                                  className={`min-h-11 px-1 py-2 rounded-xl font-bold text-[10px] transition-all cursor-pointer border ${
                                    status === 'ABSENT' ? 'bg-rose-500 text-white border-rose-600 shadow-xs' : 'border-slate-200 bg-white text-slate-600 hover:text-rose-600 hover:border-rose-300' }`}
                                  title="تسجيل غياب" >
                                  الغياب -
                                </button>
                                {attendanceMode === 'detailed' && (
                                  <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleBehavior(student.id, 'unwrittenLessons')}
                                  aria-pressed={Boolean(activeSession.unwrittenLessons?.includes(student.id))}
                                  className={`min-h-11 px-1 py-2 rounded-xl font-bold text-[10px] transition-all cursor-pointer border ${
                                    activeSession.unwrittenLessons?.includes(student.id)
                                      ? 'bg-[var(--accent-gold)] text-[var(--accent-navy)] border-[var(--accent-gold)] shadow-xs' : 'border-slate-200 bg-white text-slate-600 hover:text-amber-700 hover:border-amber-300' }`}
                                  title="لم يكتب الدرس / الكراس" >
                                  الكراس -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleBehavior(student.id, 'disruptions')}
                                  aria-pressed={Boolean(activeSession.disruptions?.includes(student.id))}
                                  className={`min-h-11 px-1 py-2 rounded-xl font-bold text-[10px] transition-all cursor-pointer border ${
                                    activeSession.disruptions?.includes(student.id)
                                      ? 'bg-[var(--text-primary)] text-white border-[var(--text-primary)] shadow-xs' : 'border-slate-200 bg-white text-slate-600 hover:text-[var(--text-primary)] hover:border-slate-400' }`}
                                  title="شغب وسلوك سيء" >
                                  شغب -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleBehavior(student.id, 'goodParticipation')}
                                  aria-pressed={Boolean(activeSession.goodParticipation?.includes(student.id))}
                                  className={`min-h-11 px-1 py-2 rounded-xl font-bold text-[10px] transition-all cursor-pointer border ${
                                    activeSession.goodParticipation?.includes(student.id)
                                      ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-xs' : 'border-slate-200 bg-white text-slate-600 hover:text-[var(--primary)] hover:border-[var(--primary)]' }`}
                                  title="مشاركة إيجابية" >
                                  مشاركة +
                                </button>
                                  </>
                                )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 2. Desktop Table View (Screens >= 768px) */}
              <div className="hidden md:block bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                        <th className="p-3 w-14 text-center">الرقم</th>
                        <th className="p-3">اسم ولقب التلميذ</th>
                        <th className="p-3 text-center">حالة الحصة والتقويم السلوكي</th>
                        <th className="p-3 text-center">مجموع الغيابات</th>
                        <th className="p-3 text-center">مجموع السلوك</th>
                        <th className="p-3 text-center">أثر التقويم المقدر</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredStudents.map(student => {
                        const status = activeAttendance[student.id] || null;
                        const stats = studentStatsMap[student.id] || { absent: 0, unwrittenLessons: 0, disruptions: 0, goodParticipation: 0 };
                  const deductionPoints = (stats.absent * 0.5) + (stats.unwrittenLessons * 0.5) + (stats.disruptions * 0.5);
                  const bonusPoints = stats.goodParticipation * 0.5;
                  const estimatedImpact = bonusPoints - deductionPoints;

                        return (
                          <tr key={student.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="p-3 text-center font-mono font-bold text-slate-500">
                              {student.numberInList}
                            </td>
                            <td className="p-3 font-bold text-slate-900">
                              {student.fullName}
                              {student.isRepeater && (
                                <span className="mr-2 text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-semibold">
                                  معيد
                                </span>
                              )}
                            </td>
                            {/* Unified Attendance & Behavior Buttons */}
                            <td className="p-2 text-center">
                              <div className="inline-flex flex-wrap items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSetStudentStatus(student.id, status === 'ABSENT' ? 'PRESENT' : 'ABSENT')}
                                  aria-pressed={status === 'ABSENT'}
                                  className={`min-h-10 px-3 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer border ${
                                    status === 'ABSENT' ? 'bg-rose-500 text-white border-rose-600 shadow-xs' : 'border-slate-200 bg-white text-slate-500 hover:text-rose-600 hover:border-rose-300' }`}
                                  title="تسجيل غياب" >
                                  الغياب -
                                </button>
                                {attendanceMode === 'detailed' && (
                                  <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleBehavior(student.id, 'unwrittenLessons')}
                                  aria-pressed={Boolean(activeSession.unwrittenLessons?.includes(student.id))}
                                  className={`min-h-10 px-3 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer border ${
                                    activeSession.unwrittenLessons?.includes(student.id)
                                      ? 'bg-[var(--accent-gold)] text-[var(--accent-navy)] border-[var(--accent-gold)] shadow-xs' : 'border-slate-200 bg-white text-slate-500 hover:text-amber-700 hover:border-amber-300' }`}
                                  title="لم يكتب الدرس / الكراس" >
                                  الكراس -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleBehavior(student.id, 'disruptions')}
                                  aria-pressed={Boolean(activeSession.disruptions?.includes(student.id))}
                                  className={`min-h-10 px-3 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer border ${
                                    activeSession.disruptions?.includes(student.id)
                                      ? 'bg-[var(--text-primary)] text-white border-[var(--text-primary)] shadow-xs' : 'border-slate-200 bg-white text-slate-500 hover:text-[var(--text-primary)] hover:border-slate-400' }`}
                                  title="شغب وسلوك سيء" >
                                  شغب -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleBehavior(student.id, 'goodParticipation')}
                                  aria-pressed={Boolean(activeSession.goodParticipation?.includes(student.id))}
                                  className={`min-h-10 px-3 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer border ${
                                    activeSession.goodParticipation?.includes(student.id)
                                      ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-xs' : 'border-slate-200 bg-white text-slate-500 hover:text-[var(--primary)] hover:border-[var(--primary)]' }`}
                                  title="مشاركة إيجابية" >
                                  مشاركة +
                                </button>
                                  </>
                                )}
                              </div>
                            </td>
                            {/* Cumulative Absences */}
                            <td className="p-3 text-center font-bold">
                              <span className={stats.absent >= 3 ? 'text-rose-600' : 'text-slate-700'}>
                                {stats.absent} غ
                              </span>
                            </td>
                            {/* Cumulative Delays */}
                            <td className="p-3 text-center font-bold text-slate-700">
                              شغب: {stats.disruptions} | كراس: {stats.unwrittenLessons}
                            </td>
                            {/* Estimated Penalty in Continuous Eval */}
                            <td className="p-3 text-center font-bold font-mono text-sm border-r border-slate-100 bg-slate-50/50">
                              {estimatedImpact > 0 ? (
                                <span className="text-[var(--primary)] font-bold">+{estimatedImpact.toFixed(2)} ن</span>
                              ) : estimatedImpact < 0 ? (
                                <span className="text-rose-600 font-bold">{estimatedImpact.toFixed(2)} ن</span>
                              ) : (
                                <span className="text-slate-400">0.00</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

              {/* Seating Guide Legend */}
              <div className="bg-white rounded-xl p-3 border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-3 text-slate-600 font-medium">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-slate-900 ml-1">دليل الحالات:</span>
                  <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[10px] whitespace-nowrap">الغياب -</span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px] whitespace-nowrap">الكراس -</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-bold text-[10px] whitespace-nowrap">شغب -</span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--primary-soft)] text-[var(--primary)] font-bold text-[10px] whitespace-nowrap">مشاركة +</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  💡 انقر مباشرة على حالة التلميذ لتبديلها فوراً أثناء سير الحصة
                </div>
              </div>
          </div>
        </div>
      )}
    </div>
  );
};
