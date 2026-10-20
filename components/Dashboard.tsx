'use client';

import React, { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/app-state-context';
import { AppState, exportBackupJSON, isDemoState } from '@/lib/storage';
import { getLocalDateString } from '@/lib/date-utils';
import { resolveOrCreateSession, isSessionDocumented } from '@/lib/session-flow';
import {
  addDaysIso,
  getExcludedDayLabel,
  isDateExcluded,
  isoWeekday,
} from '@/lib/academic-calendar';
import { SanadTab } from './SidebarSanad';
import { OFFICIAL_CURRICULUM } from '@/lib/curriculum-data';
import { ConfirmDialog } from './ConfirmDialog';
import { ResponsiveOverlay } from './ResponsiveOverlay';
import { showToast } from './Toast';
import { buildPracticalTrialState } from '@/lib/practical-trial-seed';
import { v4 as uuidv4 } from 'uuid';
import { type UrgentTask } from '@/lib/dashboard-tasks';
import {
  selectActiveClass,
  selectLessonProgressByClass,
  selectSessionsByClass,
  selectStudentsByClass,
  selectTimetableByClass,
} from '@/lib/state-selectors';
import {
  Clock,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  Users,
  LayoutGrid,
  ArrowLeft,
  CalendarDays,
  CalendarRange,
  Printer,
  Edit3,
  BarChart3,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  Download,
  ExternalLink,
  ShieldCheck,
  Sparkles
} from 'lucide-react';

interface DashboardProps {
  onNavigate: (tab: SanadTab) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  onNavigate,
}) => {
  const { state, updateState: onUpdateState, resetWorkspace } = useAppState();
  const defaultTasks: UrgentTask[] = [
      { id: 't-1', text: 'تصدير قائمة التلاميذ (2 ع ت) للرقمنة', done: false },
      { id: 't-2', text: 'تجهيز مذكرة الفقه وأصوله (الربا)', done: true },
      { id: 't-3', text: 'تحليل نتائج مجلس قسم 3 آداب وفلسفة', done: false }
    ];
  const tasks = state.dashboardTasks || defaultTasks;

  const [newTaskText, setNewTaskText] = useState('');
  const [showTaskInput, setShowTaskInput] = useState(false);
  const [isTodaySessionsModalOpen, setIsTodaySessionsModalOpen] = useState(false);
  const [taskToDeleteId, setTaskToDeleteId] = useState<string | null>(null);
  const [resetWorkspaceRequested, setResetWorkspaceRequested] = useState(false);

  const saveTasks = (newTasks: UrgentTask[]) => {
    onUpdateState((previous) => ({ ...previous, dashboardTasks: newTasks }));
  };

  const toggleTask = (id: string) => {
    const updated = tasks.map(t => (t.id === id ? { ...t, done: !t.done } : t));
    saveTasks(updated);
  };

  const addTask = () => {
    if (!newTaskText.trim()) return;
    const updated = [
      ...tasks,
      { id: `t-${uuidv4()}`, text: newTaskText.trim(), done: false }
    ];
    saveTasks(updated);
    setNewTaskText('');
    setShowTaskInput(false);
  };

  const deleteTask = (id: string) => {
    const updated = tasks.filter(t => t.id !== id);
    saveTasks(updated);
    setTaskToDeleteId(null);
  };

  // Quick JSON Backup Handler
  const handleQuickBackup = () => {
    const jsonStr = exportBackupJSON(state);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `معين_نسخة_احتياطية_${state.profile.name || 'أستاذ'}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Day calculations (Algerian week: Sunday=0 ... Thursday=4, Friday=5 & Saturday=6 are weekend)
  const now = new Date();
  const rawDay = now.getDay();
  const isFriday = rawDay === 5;
  const isSaturday = rawDay === 6;
  const isWeekend = isFriday || isSaturday;
  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const monthNames = [
    'جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان',
    'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر' ];
  const dateFormatted = `${dayNames[now.getDay()]}، ${now.getDate()} ${monthNames[now.getMonth()]} ${now.getFullYear()}`;

  // Days covered by the official calendar (holidays, breaks, examinations) are excluded
  // from teaching sessions automatically — no slot is proposed and nothing nags to document.
  const todayIso = getLocalDateString();
  const todayExclusion = getExcludedDayLabel(state.calendarSettings?.holidays.filter(h => !h.levels?.length), todayIso);

  // Today's slots (only on school days Sunday..Thursday, never on excluded days)
  const todaySlots = isWeekend || todayExclusion
    ? []
    : state.timetable
        .filter(slot => slot.dayOfWeek === rawDay && !isDateExcluded(state.calendarSettings?.holidays, todayIso, state.classes.find(c => c.id === slot.classId)?.level))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}`;

  const activeSlot = isWeekend || todayExclusion
    ? null
    : (todaySlots.find(s => s.startTime <= currentTimeStr && currentTimeStr < s.endTime) ??
       todaySlots.find(s => s.startTime > currentTimeStr) ??
       null);
  const activeSlotClass = activeSlot ? state.classes.find(c => c.id === activeSlot.classId) : null;

  // Next upcoming slot (for weekend or when today's classes finish)
  const nextUpcoming = (() => {
    if (state.timetable.length === 0) return null;
    for (let offset = 1; offset <= 60; offset++) {
      const targetIsoDate = addDaysIso(todayIso, offset);
      const targetDay = isoWeekday(targetIsoDate);
      if (targetDay === null || targetDay === 5 || targetDay === 6) continue; // Skip weekend
      const daySlots = state.timetable
        .filter(s => s.dayOfWeek === targetDay && !isDateExcluded(state.calendarSettings?.holidays, targetIsoDate, state.classes.find(c => c.id === s.classId)?.level))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (daySlots.length > 0) {
        const slot = daySlots[0];
        const cls = state.classes.find(c => c.id === slot.classId);
        return {
          slot,
          classRoom: cls,
          dayName: dayNames[targetDay],
          isTomorrow: offset === 1,
        };
      }
    }
    return null;
  })();

  const teacherTitle = (state.profile.name || 'أستاذ المادة').includes('أستاذ')
    ? (state.profile.name || 'أستاذ المادة')
    : `الأستاذ(ة) ${state.profile.name}`;
  const activeClass = selectActiveClass(state);
  const activeClassStudents = selectStudentsByClass(state, activeClass?.id ?? null);
  const activeClassSessions = selectSessionsByClass(state, activeClass?.id ?? null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const activeClassSlots = selectTimetableByClass(state, activeClass?.id ?? null)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  const activeClassCompletedUnits = selectLessonProgressByClass(state, activeClass?.id ?? null)
    .filter(progress => progress.status === 'COMPLETED').length;
  const classSummaries = state.classes.map(cls => ({
    ...cls,
    studentCount: state.students.filter(student => student.classId === cls.id).length,
    hasTimetable: state.timetable.some(slot => slot.classId === cls.id)
  }));

  // Upcoming topic
  const classProgress = state.lessonProgress.filter(p => p.classId === activeSlot?.classId);
  const completedUnitIds = new Set(
    classProgress.filter(p => p.status === 'COMPLETED').map(p => p.unitId)
  );
  const classUnits = OFFICIAL_CURRICULUM.filter(u => u.level === activeSlotClass?.level);
  const currentUnit = classUnits.find(u => !completedUnitIds.has(u.id)) || classUnits[0];

  const isDemoData = isDemoState(state);
  const onboardingSteps = [
    ...(isDemoData ? [{
      label: 'حذف بيانات البداية',
      done: false,
      action: 'reset' as const,
    }] : []),
    {
      label: 'إعداد الملف المهني',
      done: state.profile.name !== 'أستاذ المادة' && Boolean(state.profile.name.trim()),
      tab: 'settings' as SanadTab
    },
    {
      label: 'استيراد الأقسام والتلاميذ',
      done: !isDemoData && state.classes.length > 0 && state.students.length > 0,
      tab: 'classes' as SanadTab
    },
    {
      label: 'ضبط استعمال الزمن',
      done: !isDemoData && state.timetable.length > 0,
      tab: 'timetable' as SanadTab
    }
  ];
  const completedOnboardingSteps = onboardingSteps.filter(step => step.done).length;
  const onboardingComplete = completedOnboardingSteps === onboardingSteps.length;
  const showOnboarding = !state.onboardingDismissed && !onboardingComplete;
  const nextAction = !state.classes.length
    ? {
        label: 'استيراد الأقسام والتلاميذ',
        description: 'ابدأ بإضافة بيانات أقسامك حتى تعمل بقية الأدوات بشكل صحيح.',
        tab: 'classes' as SanadTab
      }
    : classSummaries.some(cls => cls.studentCount === 0)
      ? {
          label: 'إضافة قوائم التلاميذ',
          description: 'لديك قسم يحتاج إلى قائمة تلاميذ قبل تسجيل الحضور.',
          tab: 'classes' as SanadTab
        }
      : classSummaries.some(cls => !cls.hasTimetable)
        ? {
            label: 'ضبط استعمال الزمن',
            description: 'أكمل توقيت الأقسام لتظهر حصص اليوم والإجراءات المقترحة.',
            tab: 'timetable' as SanadTab
          }
        : activeSlot
          ? {
              label: 'ابدأ حصة اليوم',
              description: `الحصة القادمة: ${activeSlotClass?.name || 'القسم النشط'} عند ${activeSlot.startTime}.`,
              tab: 'attendance' as SanadTab
            }
          : {
              label: 'فتح دفتر النصوص',
              description: 'سجّل آخر حصة أو راجع الحصص السابقة للقسم النشط.',
              tab: 'sessions' as SanadTab
            };

  const handleStartTodayFlow = () => {
    if (activeSlot) {
      // Starting a class is optimistic and offline-first: create locally, open
      // attendance immediately, and let the regular outbox sync in background.
      onUpdateState(previous =>
        resolveOrCreateSession(previous, activeSlot, getLocalDateString()).state
      );
      onNavigate('attendance');
      return;
    }

    const targetClassId = activeClass?.id || state.classes[0]?.id || null;
    if (targetClassId) {
      onUpdateState(prev => ({ ...prev, activeClassId: targetClassId }));
      onNavigate('attendance');
      return;
    }
    onNavigate(nextAction.tab);
  };

  const handleRunNextAction = () => {
    if (nextAction.tab === 'attendance') {
      handleStartTodayFlow();
      return;
    }
    onNavigate(nextAction.tab);
  };

  const handleLoadPracticalTrial = () => {
    onUpdateState((prev) => buildPracticalTrialState(prev));
    showToast('تم تعبئة مساحة العمل ببيانات نموذجية متكاملة (أقسام، تلاميذ، نقاط، حصص، وتوقيت) للتجريب الفوري!', 'success');
  };

  return (
    <div className="flex flex-col space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6 md:py-8" id="academic-dashboard">
      {/* Onboarding Banner for New Teachers */}
      {showOnboarding && (
        <div className="order-1 bg-gradient-to-r from-[var(--primary)] to-[var(--color-navy)] rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.35),transparent_42%)]"></div>
          <div className="relative z-10">
            <div className="text-2xl font-black mb-3">مرحباً بك في منصة «معين الأستاذ»</div>
            <p className="text-sm text-white/90 mb-6 max-w-3xl leading-relaxed">
              {isDemoData
                ? 'هذه بيانات تجريبية للتعرف على المنصة. احذفها أولاً، ثم أكمل خطوات إعداد مساحة عملك الفعلية.'
                : 'يمكنك البدء بإعداد أقسامك واستيراد قوائم الرقمنة، أو تعبئة بيانات نموذجية متكاملة بنقرة واحدة لتجريب جميع أدوات المنصة فوراً.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-5">
              {onboardingSteps.map((step, index) => (
                <button
                  key={step.label}
                  type="button"
                  onClick={() => {
                    if (step.action === 'reset') {
                      setResetWorkspaceRequested(true);
                      return;
                    }
                    onNavigate(step.tab);
                  }}
                  className="text-right rounded-xl border border-white/20 bg-black/10 hover:bg-white/15 p-3 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <div className="flex items-center gap-2 text-xs font-bold">
                    {step.done ? <CheckCircle2 className="w-4 h-4 text-emerald-200" aria-hidden="true" /> : <span className="w-4 h-4 rounded-full border border-white/70 text-[10px] flex items-center justify-center">{index + 1}</span>}
                    <span>{step.label}</span>
                  </div>
                  <div className="text-[10px] text-white/70 mt-1">{step.done ? 'مكتمل' : 'ابدأ الآن ←'}</div>
                </button>
              ))}
            </div>
            <div className="h-1.5 rounded-full bg-white/20 mb-5 overflow-hidden" aria-label={`اكتمل ${completedOnboardingSteps} من ${onboardingSteps.length} خطوات`}>
              <div className="h-full rounded-full bg-emerald-200 transition-all" style={{ width: `${(completedOnboardingSteps / onboardingSteps.length) * 100}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {state.classes.length === 0 && (
                <button
                  type="button"
                  onClick={handleLoadPracticalTrial}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-[var(--primary)] shadow-md hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>تعبئة بيانات نموذجية للتجريب الفوري</span>
                </button>
              )}
              {isDemoData && (
                <button
                    type="button"
                    onClick={() => setResetWorkspaceRequested(true)}
                    className="px-3 py-2 text-xs font-bold text-white/80 hover:text-white underline underline-offset-4 cursor-pointer"
                  >
                    حذف بيانات البداية والبدء من جديد
                </button>
              )}
              <button
                type="button"
                onClick={() => onUpdateState(prev => ({ ...prev, onboardingDismissed: true }))}
                className="px-3 py-2 text-xs font-bold text-white/80 hover:text-white underline underline-offset-4 cursor-pointer"
              >
                إخفاء الإرشادات
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 1. Today Command Center */}
      <section className="order-2 overflow-hidden rounded-3xl border border-[var(--primary)]/20 bg-gradient-to-br from-[var(--bg-surface)] via-[var(--primary-soft)]/55 to-white p-5 shadow-xs" aria-labelledby="dashboard-today-title">
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-center">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/20 bg-white/80 px-3 py-1 text-[11px] font-bold text-[var(--primary)]">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{dateFormatted}</span>
            </div>
            <div>
              <h2 id="dashboard-today-title" className="text-2xl font-black tracking-tight text-[var(--text-primary)] sm:text-3xl">
                {isFriday ? `جمعة مباركة، ${teacherTitle}` :
                 isSaturday ? `عطلة نهاية أسبوع طيبة، ${teacherTitle}` :
                 todayExclusion ? 'يوم مستثنى من الحصص' :
                 activeSlot ? 'جاهز لحصة اليوم؟' :
                 `أهلاً بك، ${teacherTitle}`}
              </h2>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-7 text-[var(--text-secondary)]">
                {isFriday ? (
                  nextUpcoming
                    ? `عطلة نهاية أسبوع مباركة وطيبة. لا توجد حصص دراسية اليوم؛ أولى حصص الأسبوع القادم يوم ${nextUpcoming.dayName} مع ${nextUpcoming.classRoom?.name || 'القسم'} (${nextUpcoming.slot.startTime} - ${nextUpcoming.slot.endTime}).`
                    : 'عطلة نهاية أسبوع مباركة وطيبة. لا توجد حصص مبرمجة اليوم، يمكنك استغلال هذا الوقت للتحضير البيداغوجي وتجهيز المذكرات.'
                ) : isSaturday ? (
                  nextUpcoming
                    ? `عطلة نهاية أسبوع مريحة. لا توجد حصص دراسية اليوم؛ تبدأ الدراسة غداً ${nextUpcoming.dayName} مع قسم ${nextUpcoming.classRoom?.name || 'القسم'} (${nextUpcoming.slot.startTime} - ${nextUpcoming.slot.endTime}).`
                    : 'عطلة نهاية أسبوع مريحة. لا توجد حصص مبرمجة اليوم، استعد للأسبوع القادم بمراجعة التحاضير والمذكرات.'
                ) : todayExclusion ? (
                  `اليوم مستثنى آلياً من الحصص: ${todayExclusion}. لا تُطلب أي توثيقات لهذا اليوم، وإن أردت ترك أثر رسمي يمكنك توثيق حصة ملغاة بالسبب نفسه من دفتر النصوص.`
                ) : activeSlot ? (
                  `الحصة ${activeSlotClass?.name || 'القادمة'} من ${activeSlot.startTime} إلى ${activeSlot.endTime}. يمكنك بدء الحضور ثم متابعة دفتر النصوص مباشرة.`
                ) : (
                  nextAction.description
                )}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {isWeekend || todayExclusion ? (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate('prep')}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-black text-white shadow-lg shadow-[var(--primary)]/20 transition-transform active:scale-[0.98]"
                  >
                    <BookOpen className="h-5 w-5" aria-hidden="true" />
                    التحضير البيداغوجي
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('timetable')}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--border-default)] bg-white px-4 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--bg-surface-subtle)]"
                  >
                    <CalendarDays className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                    {nextUpcoming ? `حصص ${nextUpcoming.dayName}` : 'جدول التوقيت'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleStartTodayFlow}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-black text-white shadow-lg shadow-[var(--primary)]/20 transition-transform active:scale-[0.98]"
                  >
                    <PlayCircle className="h-5 w-5" aria-hidden="true" />
                    {activeSlot ? 'ابدأ الحصة الآن' : state.classes.length ? 'فتح الحضور' : 'إعداد مساحة العمل'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsTodaySessionsModalOpen(true)}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--border-default)] bg-white px-4 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--bg-surface-subtle)]"
                  >
                    <Edit3 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                    حصص اليوم
                  </button>
                </>
              )}
              {state.classes.length === 0 && (
                <button
                  type="button"
                  onClick={handleLoadPracticalTrial}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--primary)] bg-[var(--primary-soft)]/60 px-4 text-xs font-black text-[var(--primary)] hover:bg-[var(--primary-soft)] transition-colors cursor-pointer"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  تعبئة بيانات نموذجية للتجريب
                </button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-xs backdrop-blur">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
              <div>
                <div className="text-[11px] font-bold text-[var(--text-tertiary)]">
                  {isWeekend ? 'الحصة القادمة' : 'القسم/الحصة التالية'}
                </div>
                <div className="mt-1 text-base font-black text-[var(--text-primary)]">
                  {isWeekend
                    ? (nextUpcoming ? `${nextUpcoming.dayName}: ${nextUpcoming.classRoom?.name || 'قسم مسند'}` : 'لا توجد حصص')
                    : (activeSlotClass?.name || activeClass?.name || 'لم يحدد قسم بعد')}
                </div>
              </div>
              <div className="rounded-xl bg-[var(--primary-soft)] p-3 text-[var(--primary)]">
                <Clock className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-3 text-center text-xs">
              <div className="rounded-xl bg-[var(--bg-surface-subtle)] p-2">
                <div className="font-mono text-sm font-black text-[var(--text-primary)]">
                  {isWeekend ? 'عطلة' : todaySlots.length}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
                  {isWeekend ? 'نهاية الأسبوع' : 'حصص اليوم'}
                </div>
              </div>
              <div className="rounded-xl bg-[var(--bg-surface-subtle)] p-2">
                <div className="font-mono text-sm font-black text-[var(--text-primary)]">{state.students.length}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-secondary)]">تلاميذ</div>
              </div>
              <div className="rounded-xl bg-[var(--bg-surface-subtle)] p-2">
                <div className="font-mono text-sm font-black text-[var(--text-primary)]">
                  {isWeekend && nextUpcoming
                    ? nextUpcoming.slot.startTime
                    : (activeSlot ? activeSlot.startTime : currentTimeStr)}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
                  {isWeekend && nextUpcoming ? 'توقيت الحصة' : 'التوقيت'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {state.lastWorkspace && state.classes.some(item => item.id === state.lastWorkspace?.classId) && (
        <section className="order-3 rounded-2xl border border-[var(--primary)]/25 bg-white p-4 shadow-xs" aria-labelledby="resume-work-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div id="resume-work-title" className="text-[11px] font-bold text-[var(--text-secondary)]">متابعة آخر عمل</div>
              <div className="mt-1 text-sm font-black text-[var(--text-primary)]">
                {state.lastWorkspace.route === 'grades' ? 'دفتر النقاط' : state.lastWorkspace.route === 'sessions' ? 'دفتر النصوص' : 'الحضور'}
                {' — '}
                {state.classes.find(item => item.id === state.lastWorkspace?.classId)?.name}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const workspace = state.lastWorkspace;
                if (!workspace) return;
                onUpdateState(previous => ({ ...previous, activeClassId: workspace.classId }));
                onNavigate(workspace.route);
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-xs font-black text-white"
            >
              متابعة
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {/* 3. Compact Stat Cards — الأقسام | التلاميذ | حصص اليوم | الدفتر */}
      <div className="order-3 mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <button onClick={() => onNavigate('classes')} className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-white p-3 text-right shadow-xs transition-colors hover:bg-slate-50 cursor-pointer group">
          <div className="w-9 h-9 shrink-0 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] flex items-center justify-center group-hover:scale-110 transition-transform"><LayoutGrid className="w-4 h-4" /></div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-slate-500 leading-none mb-1">الأقسام</div>
            <div className="text-sm font-black text-slate-900 leading-none">{state.classes.length}</div>
          </div>
        </button>
        <button onClick={() => onNavigate('students')} className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-white p-3 text-right shadow-xs transition-colors hover:bg-slate-50 cursor-pointer group">
          <div className="w-9 h-9 shrink-0 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] flex items-center justify-center group-hover:scale-110 transition-transform"><Users className="w-4 h-4" /></div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-slate-500 leading-none mb-1">التلاميذ</div>
            <div className="text-sm font-black text-slate-900 leading-none">{state.students.length}</div>
          </div>
        </button>
        <button
          onClick={() => {
            if (isWeekend) {
              onNavigate('timetable');
            } else {
              setIsTodaySessionsModalOpen(true);
            }
          }}
          className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-white p-3 text-right shadow-xs transition-colors hover:bg-slate-50 cursor-pointer group"
        >
          <div className="w-9 h-9 shrink-0 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] flex items-center justify-center group-hover:scale-110 transition-transform"><CalendarDays className="w-4 h-4" /></div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-slate-500 leading-none mb-1">
              {isWeekend ? 'اليوم' : 'حصص اليوم'}
            </div>
            <div className="text-sm font-black text-slate-900 leading-none">
              {isWeekend ? 'عطلة' : todaySlots.length}
            </div>
          </div>
        </button>
        <button onClick={() => onNavigate('sessions')} className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-white p-3 text-right shadow-xs transition-colors hover:bg-slate-50 cursor-pointer group">
          <div className="w-9 h-9 shrink-0 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform"><Edit3 className="w-4 h-4" /></div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-slate-500 leading-none mb-1">الدفتر</div>
            <div className="text-sm font-black text-slate-900 leading-none">{state.sessions.length}</div>
          </div>
        </button>
      </div>

      <section className="order-4 rounded-2xl border border-[var(--primary)]/25 bg-[var(--primary-soft)]/55 p-5 shadow-xs" aria-labelledby="dashboard-next-action-title">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 id="dashboard-next-action-title" className="font-black text-sm text-[var(--text-primary)]">
              الخطوة التالية المقترحة
            </h2>
            <p className="text-xs font-bold text-[var(--primary)] mt-1">{nextAction.label}</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-1">{nextAction.description}</p>
          </div>
          <button
            type="button"
            onClick={handleRunNextAction}
            className="min-h-11 px-5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            تنفيذ الآن ←
          </button>
        </div>
      </section>

      {/* Sections hub: keep the most frequent class actions one click away. */}
      <section className="order-5 grid grid-cols-1 gap-4" aria-labelledby="dashboard-classes-title">
        <div className="bg-white rounded-2xl border border-[var(--border-default)] p-5 shadow-xs">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h2 id="dashboard-classes-title" className="font-black text-sm text-[var(--text-primary)]">
                القسم النشط
              </h2>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                الإجراءات اليومية للقسم الذي تعمل عليه الآن
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {state.classes.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="dashboard-active-class-select" className="sr-only">تغيير القسم النشط</label>
                  <select
                    id="dashboard-active-class-select"
                    value={activeClass?.id || ''}
                    onChange={(e) => {
                      const newId = e.target.value;
                      onUpdateState(prev => ({ ...prev, activeClassId: newId }));
                      const targetClass = state.classes.find(c => c.id === newId);
                      if (targetClass) {
                        showToast(`تم تفعيل قسم ${targetClass.name} كقسم نشط`, 'success');
                      }
                    }}
                    className="min-h-9 px-2.5 py-1 rounded-xl border border-[var(--primary)]/30 bg-white font-bold text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] cursor-pointer shadow-2xs"
                  >
                    {state.classes.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.stream})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                onClick={() => onNavigate('classes')}
                className="text-xs font-bold text-[var(--primary)] hover:underline cursor-pointer"
              >
                إدارة الأقسام
              </button>
            </div>
          </div>

          {activeClass ? (
            <>
              <div className="rounded-xl border border-[var(--primary)]/25 bg-[var(--primary-soft)]/45 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-[var(--text-primary)]">{activeClass.name}</div>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-1">
                      {activeClass.stream} • {activeClassStudents.length} تلميذاً
                    </div>
                  </div>
                  <Users className="w-5 h-5 text-[var(--primary)] shrink-0" aria-hidden="true" />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4">
                  <div className="rounded-lg bg-white/75 px-2 py-2 text-center">
                    <div className="text-lg font-black text-[var(--text-primary)]">{activeClassSessions.length}</div>
                    <div className="text-[10px] text-[var(--text-secondary)]">حصص موثقة</div>
                  </div>
                  <div className="rounded-lg bg-white/75 px-2 py-2 text-center">
                    <div className="text-lg font-black text-[var(--text-primary)]">{activeClassCompletedUnits}</div>
                    <div className="text-[10px] text-[var(--text-secondary)]">وحدات منجزة</div>
                  </div>
                  <div className="rounded-lg bg-white/75 px-2 py-2 text-center">
                    <div className="text-lg font-black text-[var(--text-primary)]">{activeClassSlots.length}</div>
                    <div className="text-[10px] text-[var(--text-secondary)]">حصص أسبوعية</div>
                  </div>
                </div>
                <div className="mt-3 rounded-lg bg-white/60 px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                  <span className="font-bold text-[var(--text-primary)]">آخر نشاط: </span>
                  {activeClassSessions[0]
                    ? `${activeClassSessions[0].date} — ${(activeClassSessions[0].accomplishments || 'حصة موثقة').slice(0, 100)}`
                    : 'لم تُسجل حصة بعد لهذا القسم.'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {[
                  { label: 'الحضور', tab: 'attendance' as SanadTab, icon: CheckCircle2 },
                  { label: 'دفتر النصوص', tab: 'sessions' as SanadTab, icon: Edit3 },
                  { label: 'النقاط', tab: 'grades' as SanadTab, icon: BarChart3 },
                  { label: 'التلاميذ', tab: 'classes' as SanadTab, icon: Users }
                ].map(action => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => onNavigate(action.tab)}
                      className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface-subtle)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] text-xs font-bold text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    >
                      <Icon className="w-3.5 h-3.5 text-[var(--primary)]" aria-hidden="true" />
                      {action.label}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface-subtle)] p-5 text-center">
              <p className="text-xs font-bold text-[var(--text-primary)]">لم تتم إضافة أقسام بعد</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1">أضف الأقسام يدوياً أو استوردها من ملف الرقمنة.</p>
              <button
                type="button"
                onClick={() => onNavigate('classes')}
                className="mt-3 min-h-11 px-4 rounded-xl bg-[var(--primary)] text-white text-xs font-bold cursor-pointer"
              >
                إعداد الأقسام الآن
              </button>
            </div>
          )}
        </div>

      </section>

      {/* 3. Main Two-Column Clean Layout */}
      <div className="order-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* RIGHT COLUMN (8 COLS): Current/Next Class Card + Today's Schedule + Recent Sessions */}
        <div className="lg:col-span-8 space-y-6">
          {/* Active / Next Slot Hero Card */}
          <div className="bg-white rounded-2xl border border-[var(--border-default)] p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--primary)] animate-pulse" />
                <h3 className="font-black text-sm text-[var(--text-primary)] font-display">
                  {activeSlot ? 'الحصة الجارية الآن أو القادمة' : 'برنامج اليوم'}
                </h3>
              </div>
              <span className="text-xs font-mono text-[var(--text-secondary)]">{currentTimeStr}</span>
            </div>

            {activeSlot ? (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--bg-surface-subtle)] p-4 rounded-xl border border-[var(--border-default)]">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black text-[var(--text-primary)]">
                        {activeSlotClass?.name || 'قسم ثانوي'}
                      </span>
                      {activeSlotClass?.stream && (
                        <span className="text-xs text-[var(--text-secondary)] font-semibold">
                          ({activeSlotClass.stream})
                        </span>
                      )}
                      {activeSlot.room && (
                        <span className="text-xs text-[var(--text-secondary)] bg-white px-2 py-0.5 rounded border border-[var(--border-default)]">
                          قاعة {activeSlot.room}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] font-medium">
                      الموضوع المقرر في الحصة الجارية أو القادمة: <span className="font-bold text-[var(--text-primary)]">{currentUnit ? currentUnit.title : 'الوحدة التعلمية المبرمجة'}</span>
                    </p>
                  </div>

                  <div className="text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-white border border-[var(--border-default)] text-[var(--text-primary)] self-start sm:self-auto shrink-0">
                    {activeSlot.startTime} - {activeSlot.endTime}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      if (activeSlotClass) {
                        onUpdateState(prev => ({ ...prev, activeClassId: activeSlotClass.id }));
                      }
                      onNavigate('attendance');
                    }}
                    className="flex-1 py-3 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs active:scale-[0.99]" id="btn-open-attendance" >
                    <PlayCircle className="w-4 h-4" />
                    <span>ابدأ حصة اليوم</span>
                  </button>

                  <button
                    onClick={() => onNavigate('timetable')}
                    className="px-4 py-3 rounded-xl bg-white hover:bg-[var(--bg-surface-subtle)] border border-[var(--border-default)] text-[var(--text-primary)] font-bold text-xs transition-colors cursor-pointer" >
                    جدول الحصص
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-[var(--text-secondary)] bg-[var(--bg-surface-subtle)] rounded-xl border border-dashed border-[var(--border-default)]">
                لا توجد حصص مبرمجة في هذا التوقيت.
              </div>
            )}
          </div>

          {/* Today's Schedule Overview */}
          {todaySlots.length > 1 && (
            <div className="bg-white rounded-2xl border border-[var(--border-default)] p-6 shadow-xs space-y-4">
              <h4 className="font-black text-sm text-[var(--text-primary)] font-display flex items-center justify-between">
                <span>باقي حصص اليوم ({dayNames[rawDay]})</span>
                <span className="text-xs text-[var(--text-secondary)] font-normal font-sans">
                  {todaySlots.length} حصص
                </span>
              </h4>

              <div className="space-y-2">
                {todaySlots.map(slot => {
                  const cls = state.classes.find(c => c.id === slot.classId);
                  const isCurrent = slot.id === activeSlot?.id;
                  return (
                    <div
                      key={slot.id}
                      className={`flex items-center justify-between p-3 rounded-xl border text-xs transition-colors ${
                        isCurrent
                          ? 'bg-[var(--primary-soft)]/60 border-[var(--primary)] font-bold' : 'bg-[var(--bg-page)] border-[var(--border-default)] text-[var(--text-secondary)]' }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[var(--text-primary)] font-semibold">{slot.startTime} - {slot.endTime}</span>
                        <span className="font-bold text-[var(--text-primary)]">{cls?.name || 'قسم'}</span>
                        <span className="text-[var(--text-secondary)] hidden sm:inline">{cls?.stream}</span>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded ${
                        isCurrent ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-secondary)]' }`}>
                        {isCurrent ? 'الحصة الحالية' : 'مجدولة'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Recorded Sessions */}
          <div className="bg-white rounded-2xl border border-[var(--border-default)] p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-sm text-[var(--text-primary)] font-display">
                آخر الحصص الموثقة في الدفتر اليومي
              </h4>
              <button
                onClick={() => onNavigate('sessions')}
                className="text-xs font-bold text-[var(--primary)] hover:underline flex items-center gap-1 cursor-pointer" >
                <span>فتح الدفتر اليومي</span>
                <ArrowLeft className="w-3 h-3" />
              </button>
            </div>

            <div className="divide-y divide-[var(--border-subtle)] text-xs">
              {(() => {
                const documentedSessions = state.sessions.filter(isSessionDocumented);
                if (documentedSessions.length === 0) {
                  return (
                    <p className="text-xs text-[var(--text-secondary)] py-4 text-center">لم يتم تسجيل حصص بعد في الدفتر اليومي.</p>
                  );
                }
                return documentedSessions.slice(0, 3).map(ses => {
                  const cls = state.classes.find(c => c.id === ses.classId);
                  const isCancelled = ses.sessionStatus === 'CANCELLED';
                  return (
                    <div key={ses.id} className="py-3 flex items-center justify-between gap-4 first:pt-0 last:pb-0">
                      <div>
                        <div className="font-bold text-[var(--text-primary)]">{cls?.name || 'قسم'} • {ses.customTopic || 'حصة عادية'}</div>
                        <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{ses.date} ({ses.startTime} - {ses.endTime})</div>
                      </div>
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
                        isCancelled
                          ? 'text-rose-700 bg-rose-50 border border-rose-200'
                          : 'text-[var(--primary)] bg-[var(--primary-soft)]'
                      }`}>
                        {isCancelled ? 'ملغاة' : 'موثقة'}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>

        {/* LEFT COLUMN (4 COLS): Core Pedagogical Tools & Quick Checklist */}
        <div className="lg:col-span-4 space-y-6">
          {/* 4 Clean Action Cards */}
          <div className="bg-white rounded-2xl border border-[var(--border-default)] p-5 shadow-xs space-y-3">
            <h4 className="font-black text-xs text-[var(--text-secondary)] tracking-wider uppercase">
              الأدوات البيداغوجية
            </h4>

            <div className="space-y-2 text-xs font-bold">
              {/* Card 1: دفتر العلامات */}
              <button
                onClick={() => onNavigate('grades')}
                className="w-full p-3 rounded-xl bg-[var(--bg-surface-subtle)] hover:bg-[var(--primary-soft)] border border-[var(--border-default)] hover:border-[var(--primary)] text-[var(--text-primary)] flex items-center justify-between transition-all cursor-pointer group" >
                <div className="flex items-center gap-2.5">
                  <BarChart3 className="w-4 h-4 text-[var(--primary)]" />
                  <span>دفتر التنقيط والعلامات</span>
                </div>
                <ArrowLeft className="w-3.5 h-3.5 text-[var(--text-secondary)] group-hover:-translate-x-1 transition-transform" />
              </button>

              {/* Card 2: المنهاج والتوزيع السنوي */}
              <button
                onClick={() => onNavigate('curriculum')}
                className="w-full p-3 rounded-xl bg-[var(--bg-surface-subtle)] hover:bg-[var(--primary-soft)] border border-[var(--border-default)] hover:border-[var(--primary)] text-[var(--text-primary)] flex items-center justify-between transition-all cursor-pointer group" >
                <div className="flex items-center gap-2.5">
                  <BookOpen className="w-4 h-4 text-[var(--primary)]" />
                  <span>البرامج والمنهاج الوزاري</span>
                </div>
                <ArrowLeft className="w-3.5 h-3.5 text-[var(--text-secondary)] group-hover:-translate-x-1 transition-transform" />
              </button>

              {/* Card 3: مجالس الأقسام */}
              <button
                onClick={() => onNavigate('council')}
                className="w-full p-3 rounded-xl bg-[var(--bg-surface-subtle)] hover:bg-[var(--primary-soft)] border border-[var(--border-default)] hover:border-[var(--primary)] text-[var(--text-primary)] flex items-center justify-between transition-all cursor-pointer group" >
                <div className="flex items-center gap-2.5">
                  <Users className="w-4 h-4 text-[var(--primary)]" />
                  <span>تحليل نتائج مجالس الأقسام</span>
                </div>
                <ArrowLeft className="w-3.5 h-3.5 text-[var(--text-secondary)] group-hover:-translate-x-1 transition-transform" />
              </button>

              {/* Card 4: التوزيع السنوي والتدرجات */}
              <button
                onClick={() => onNavigate('annual_dist')}
                className="w-full p-3 rounded-xl bg-[var(--bg-surface-subtle)] hover:bg-[var(--primary-soft)] border border-[var(--border-default)] hover:border-[var(--primary)] text-[var(--text-primary)] flex items-center justify-between transition-all cursor-pointer group" >
                <div className="flex items-center gap-2.5">
                  <CalendarRange className="w-4 h-4 text-[var(--primary)]" />
                  <span>التوزيع السنوي والتدرجات</span>
                </div>
                <ArrowLeft className="w-3.5 h-3.5 text-[var(--text-secondary)] group-hover:-translate-x-1 transition-transform" />
              </button>
            </div>
          </div>

          {/* Urgent Tasks & Follow-up Checklist */}
          <div className="bg-white rounded-2xl border border-[var(--border-default)] p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
              <h4 className="font-black text-xs text-[var(--text-secondary)] tracking-wider uppercase flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span>متابعات ومهام عاجلة</span>
              </h4>
              <button
                onClick={() => setShowTaskInput(!showTaskInput)}
                className="text-xs text-[var(--primary)] hover:underline font-bold flex items-center gap-0.5 cursor-pointer" >
                <Plus className="w-3 h-3" />
                <span>إضافة</span>
              </button>
            </div>

            {showTaskInput && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text" placeholder="مهمة جديدة..." value={newTaskText}
                  onChange={e => setNewTaskText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-xs font-medium focus:outline-[var(--primary)]" autoFocus
                />
                <button
                  onClick={addTask}
                  className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-bold cursor-pointer" >
                  حفظ
                </button>
              </div>
            )}

            <div className="space-y-2 text-xs">
              {tasks.map(task => (
                <div
                  key={task.id}
                  className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                    task.done
                      ? 'bg-[var(--bg-page)] border-[var(--border-default)] text-[var(--text-secondary)] line-through' : 'bg-white border-[var(--border-default)] text-[var(--text-primary)]' }`}
                >
                  <button
                    onClick={() => toggleTask(task.id)}
                    className="flex items-center gap-2 text-right flex-1 cursor-pointer" >
                    {task.done ? (
                      <CheckSquare className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                    )}
                    <span className="font-medium">{task.text}</span>
                  </button>
                  <button
                    onClick={() => setTaskToDeleteId(task.id)}
                    className="text-[var(--text-secondary)] hover:text-rose-600 p-1 cursor-pointer transition-colors" >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Unified phone bottom-sheet / desktop dialog for today's sessions. */}
      <ResponsiveOverlay
        open={isTodaySessionsModalOpen}
        title={`حصص اليوم المبرمجة (${dayNames[now.getDay()]})`}
        overlayId="today-sessions"
        onClose={() => setIsTodaySessionsModalOpen(false)}
      >
        <div className="space-y-4 p-5" dir="rtl">
            <p className="text-xs text-slate-600">
              حدد الحصة التي ترغب في توثيقها بالدفتر اليومي أو رصد حضور تلامذتها:
            </p>

            <div className="space-y-2.5 max-h-80 overflow-y-auto">
              {todaySlots.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  {todayExclusion
                    ? `اليوم مستثنى آلياً من الحصص: ${todayExclusion}. لا توجد حصة واجبة التوثيق.`
                    : isWeekend
                      ? `اليوم ${dayNames[now.getDay()]} عطلة نهاية الأسبوع؛ لا توجد حصص دراسية مبرمجة.`
                      : `لا توجد حصص مبرمجة ليوم ${dayNames[now.getDay()]} في جدول التوقيت الأسبوعي.`}
                </div>
              ) : (
                todaySlots.map((slot, idx) => {
                  const cls = state.classes.find(c => c.id === slot.classId);
                  const isRecorded = state.sessions.some(
                    s => s.classId === slot.classId && s.date === getLocalDateString()
                  );

                  return (
                    <div
                      key={slot.id}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-[var(--primary-soft)]/50 hover:border-[var(--primary)] transition-all flex items-center justify-between gap-3" >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-900">
                            {slot.startTime} - {slot.endTime}
                          </span>
                          <span className="font-black text-sm text-slate-900">{cls?.name || 'قسم'}</span>
                          {cls?.stream && (
                            <span className="text-xs text-slate-500 hidden sm:inline">({cls.stream})</span>
                          )}
                        </div>
                        {slot.room && (
                          <div className="text-[11px] text-slate-500">
                            القاعة: {slot.room}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {isRecorded ? (
                          <span className="text-[11px] font-bold text-[var(--primary)] bg-[var(--primary-soft)] px-2.5 py-1 rounded-lg">
                            تم التدوين ✓
                          </span>
                        ) : null}
                        <button
                          onClick={() => {
                            if (slot.classId) {
                              onUpdateState(prev => ({ ...prev, activeClassId: slot.classId }));
                            }
                            setIsTodaySessionsModalOpen(false);
                            onNavigate('sessions');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold transition-colors cursor-pointer shadow-xs" >
                          تدوين بالدفتر اليومي
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
              <button
                onClick={() => {
                  setIsTodaySessionsModalOpen(false);
                  onNavigate('timetable');
                }}
                className="text-[var(--primary)] hover:underline font-bold flex items-center gap-1 cursor-pointer" >
                <span>فتح جدول الحصص الأسبوعي الكامل</span>
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsTodaySessionsModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer" >
                إغلاق
              </button>
            </div>
        </div>
      </ResponsiveOverlay>

      <ConfirmDialog
        isOpen={Boolean(taskToDeleteId)}
        title="تأكيد حذف المهمة"
        message="هل أنت متأكد من حذف هذه المهمة من قائمة المتابعة؟"
        onCancel={() => setTaskToDeleteId(null)}
        onConfirm={() => {
          if (taskToDeleteId) {
            deleteTask(taskToDeleteId);
          }
        }}
      />
      <ConfirmDialog
        isOpen={resetWorkspaceRequested}
        title="حذف مساحة العمل"
        message="سيتم حذف الأقسام والتلاميذ والدرجات والحضور والجلسات والجدول والملفات الخاصة بهذه المساحة. لا يمكن التراجع عن هذا الإجراء."
        onCancel={() => setResetWorkspaceRequested(false)}
        onConfirm={() => {
          void resetWorkspace()
            .then(() => {
              setResetWorkspaceRequested(false);
              showToast('تم تنظيف مساحة العمل. يمكنك الآن استيراد بياناتك.', 'success');
            })
            .catch((error: unknown) => {
              console.error('Workspace reset failed:', error);
              showToast('تعذر تنظيف مساحة العمل بالكامل. لم يتم إعلان نجاح الحذف.', 'error');
            });
        }}
      />
    </div>
  );
};
