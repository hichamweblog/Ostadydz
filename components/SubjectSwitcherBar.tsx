'use client';

import React from 'react';
import { BookOpen, Layers, Settings2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/hooks/app-state-context';
import {
  ACTIVE_SUBJECTS,
  SUBJECTS_BY_ID,
  SUBJECT_VARIANTS,
  type LevelCode,
  type StreamId,
  type SubjectId,
} from '@/lib/education';
import {
  selectClassAssignedSubjectIds,
  selectEffectiveSubjectId,
  selectTeacherSubjectIds,
} from '@/lib/state-selectors';
import {
  getClassCoefficient,
  getSubjectDisplayName,
  getWeeklyHours,
  type ClassRoom,
} from '@/lib/types';

interface SubjectSwitcherBarProps {
  /** Optional class context (shows subjects assigned to this class with their coeff & hours) */
  classRoom?: ClassRoom | null;
  /** Optional explicit level/stream context (e.g. Curriculum or Annual Distribution) */
  levelCode?: LevelCode;
  streamId?: StreamId;
  /** Optional controlled subjectId */
  selectedSubjectId?: SubjectId;
  /** Optional callback when subject changes */
  onChangeSubject?: (subjectId: SubjectId) => void;
  /** Show all 18 subjects if teacher hasn't configured specific subjects yet */
  allowAllFallback?: boolean;
  /** Compact mode for inline headers */
  compact?: boolean;
}

export function SubjectSwitcherBar({
  classRoom,
  levelCode,
  streamId,
  selectedSubjectId,
  onChangeSubject,
  allowAllFallback = false,
  compact = false,
}: SubjectSwitcherBarProps) {
  const { state, updateState } = useAppState();
  const router = useRouter();

  const teacherSubjects = selectTeacherSubjectIds(state);
  const classSubjects = classRoom
    ? selectClassAssignedSubjectIds(state, classRoom)
    : teacherSubjects;

  const availableSubjectIds: SubjectId[] =
    classSubjects.length > 0
      ? classSubjects
      : allowAllFallback
      ? ACTIVE_SUBJECTS.map(s => s.id)
      : [];

  const activeSubjectId =
    selectedSubjectId ??
    selectEffectiveSubjectId(state, classRoom) ??
    availableSubjectIds[0];

  const handleSelect = (subjectId: SubjectId) => {
    updateState(prev => ({
      ...prev,
      activeSubjectId: subjectId,
    }));
    onChangeSubject?.(subjectId);
  };

  if (availableSubjectIds.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-amber-900 text-sm font-medium">
          <BookOpen className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            لم يتم تحديد المواد المسندة بعد. اختر مادتك الأساسية أو حزمة الإسناد (وفق القرار 186/2006) لضبط المعاملات والمواقيت تلقائياً.
          </span>
        </div>
        <button
          type="button"
          onClick={() => router.push('/settings')}
          className="min-h-11 px-4 py-2 rounded-xl bg-amber-700 text-white text-xs font-bold hover:bg-amber-800 transition-colors flex items-center gap-1.5 shrink-0"
        >
          <Settings2 className="w-4 h-4" />
          <span>تحديد المواد المسندة</span>
        </button>
      </div>
    );
  }

  // If only 1 subject is assigned and we are in compact mode, show a clean badge with Decision 186/2006 metrics
  if (availableSubjectIds.length === 1 && compact && activeSubjectId) {
    const subjId = availableSubjectIds[0];
    const variantId =
      classRoom?.subjectVariantById?.[subjId] ?? state.profile.variantId;
    const coeff = classRoom
      ? getClassCoefficient(classRoom, subjId, state.educationOverrides)
      : levelCode && streamId
      ? getClassCoefficient({ levelCode, streamId }, subjId, state.educationOverrides)
      : null;
    const hours = classRoom
      ? getWeeklyHours(classRoom, subjId, state.educationOverrides)
      : levelCode && streamId
      ? getWeeklyHours({ levelCode, streamId }, subjId, state.educationOverrides)
      : null;

    return (
      <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[var(--primary-soft)] border border-emerald-200 text-[var(--primary)] text-xs font-bold">
        <BookOpen className="w-4 h-4 shrink-0" />
        <span>{getSubjectDisplayName(subjId, variantId)}</span>
        {coeff !== null && coeff > 0 && (
          <span className="px-2 py-0.5 rounded-md bg-white text-slate-700 border border-slate-200">
            المعامل: {coeff}
          </span>
        )}
        {hours !== null && hours > 0 && (
          <span className="px-2 py-0.5 rounded-md bg-white text-slate-700 border border-slate-200">
            {hours} سا/أسبوع
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`bg-white border border-slate-200 rounded-2xl ${
        compact ? 'p-2.5' : 'p-3.5'
      } shadow-xs flex flex-wrap items-center justify-between gap-3`}
      role="region"
      aria-label="مبدل المادة المسندة"
    >
      <div className="flex items-center gap-2 text-xs font-bold text-slate-600 shrink-0">
        <Layers className="w-4 h-4 text-[var(--primary)]" />
        <span>
          {classRoom
            ? `المواد المسندة للفوج (${availableSubjectIds.length}):`
            : `المادة الدراسية (${availableSubjectIds.length}):`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 flex-1">
        {availableSubjectIds.map(subjId => {
          const isSelected = subjId === activeSubjectId;
          const subjectMeta = SUBJECTS_BY_ID[subjId];
          if (!subjectMeta) return null;

          const variantId =
            classRoom?.subjectVariantById?.[subjId] ?? state.profile.variantId;
          const variantMeta = variantId ? SUBJECT_VARIANTS[variantId] : undefined;
          const displayLabel =
            variantMeta && variantMeta.subjectId === subjId
              ? `${subjectMeta.shortAr} (${variantMeta.labelAr})`
              : subjectMeta.labelAr;

          const coeff = classRoom
            ? getClassCoefficient(classRoom, subjId, state.educationOverrides)
            : levelCode && streamId
            ? getClassCoefficient({ levelCode, streamId }, subjId, state.educationOverrides)
            : null;
          const hours = classRoom
            ? getWeeklyHours(classRoom, subjId, state.educationOverrides)
            : levelCode && streamId
            ? getWeeklyHours({ levelCode, streamId }, subjId, state.educationOverrides)
            : null;

          return (
            <button
              key={subjId}
              type="button"
              onClick={() => handleSelect(subjId)}
              aria-pressed={isSelected}
              className={`min-h-11 px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border ${
                isSelected
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>{displayLabel}</span>
              {(coeff !== null && coeff > 0) || (hours !== null && hours > 0) ? (
                <span
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold ${
                    isSelected
                      ? 'bg-white/20 text-white'
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  {coeff !== null && coeff > 0 ? `م:${coeff}` : ''}
                  {coeff !== null && coeff > 0 && hours !== null && hours > 0 ? ' · ' : ''}
                  {hours !== null && hours > 0 ? `${hours}سا` : ''}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => router.push('/settings')}
        className="min-h-11 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors flex items-center gap-1.5 shrink-0"
        title="تعديل المواد المسندة والمعاملات"
      >
        <Settings2 className="w-4 h-4" />
        <span className="hidden sm:inline">إدارة الإسناد</span>
      </button>
    </div>
  );
}
