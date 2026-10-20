'use client';

import React, { useState } from 'react';
import {
  ACTIVE_STREAMS,
  ACTIVE_SUBJECTS,
  ASSESSMENT_SCHEMES,
  ASSIGNMENT_BUNDLES,
  getOfferingsForSubject,
  getRelatedSubjectsForAssignment,
  resolveEffectiveScheme,
  STREAMS_BY_ID,
  SUBJECTS_BY_ID,
  SUBJECT_VARIANTS,
  type AssessmentSchemeId,
  type LevelCode,
  type StreamId,
  type SubjectId,
  type VariantId,
} from '@/lib/education';
import { useAppState } from '@/hooks/app-state-context';
import { selectTeacherSubjectIds } from '@/lib/state-selectors';
import { showToast } from './Toast';
import {
  BookOpen,
  Calculator,
  Check,
  Clock,
  Layers,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Star,
} from 'lucide-react';

export function SubjectAssignmentSettings() {
  const { state, updateStateAndWait } = useAppState();
  const currentSubjects = selectTeacherSubjectIds(state);

  const [selectedSubjects, setSelectedSubjects] = useState<SubjectId[]>(currentSubjects);
  const [primarySubjectId, setPrimarySubjectId] = useState<SubjectId | undefined>(
    state.profile.primarySubjectId ?? currentSubjects[0]
  );
  const [variantId, setVariantId] = useState<VariantId | undefined>(state.profile.variantId);
  const [inspectedSubjectId, setInspectedSubjectId] = useState<SubjectId>(
    state.profile.primarySubjectId ?? currentSubjects[0] ?? 'ARABIC'
  );
  const [isSaving, setIsSaving] = useState(false);

  const toggleSubject = (subjectId: SubjectId) => {
    setSelectedSubjects(prev => {
      if (prev.includes(subjectId)) {
        const next = prev.filter(id => id !== subjectId);
        if (primarySubjectId === subjectId) {
          setPrimarySubjectId(next[0]);
        }
        if (inspectedSubjectId === subjectId && next[0]) {
          setInspectedSubjectId(next[0]);
        }
        return next;
      } else {
        const next = [...prev, subjectId];
        if (!primarySubjectId) {
          setPrimarySubjectId(subjectId);
        }
        setInspectedSubjectId(subjectId);
        return next;
      }
    });
  };

  const handleApplyBundle = (bundlePrimary: SubjectId, bundleSubjects: SubjectId[]) => {
    setPrimarySubjectId(bundlePrimary);
    setSelectedSubjects(bundleSubjects);
    setInspectedSubjectId(bundlePrimary);
  };

  const handleSaveAssignment = async () => {
    if (selectedSubjects.length === 0) {
      showToast('يرجى اختيار مادة واحدة على الأقل لحفظ الإسناد التربوي.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const effectivePrimary = primarySubjectId ?? selectedSubjects[0];
      const primaryMeta = effectivePrimary ? SUBJECTS_BY_ID[effectivePrimary] : undefined;

      await updateStateAndWait(prev => ({
        ...prev,
        activeSubjectId:
          prev.activeSubjectId && selectedSubjects.includes(prev.activeSubjectId)
            ? prev.activeSubjectId
            : effectivePrimary,
        profile: {
          ...prev.profile,
          primarySubjectId: effectivePrimary,
          subjectId: effectivePrimary,
          taughtSubjectIds: selectedSubjects,
          subjectIds: selectedSubjects,
          variantId,
          subjectName: primaryMeta?.labelAr ?? prev.profile.subjectName,
        },
      }));
      showToast('تم حفظ المواد المسندة وتحديث المعاملات والمواقيت بنجاح!', 'success');
    } catch (error) {
      console.error('Failed to save subject assignments:', error);
      showToast('تعذّر حفظ المواد المسندة.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const currentOverride = state.educationOverrides?.schemeBySubject?.[inspectedSubjectId] || {};
  const resolvedScheme = resolveEffectiveScheme(
    inspectedSubjectId,
    '2AS',
    'EXP_SCI',
    state.educationOverrides
  );

  const updateSubjectSchemeOverride = async (
    patch: Partial<{
      schemeId: AssessmentSchemeId;
      devoirCount: 1 | 2;
      enablePracticalColumn: boolean;
      enableOralColumn: boolean;
      examWeight: number;
    }>
  ) => {
    await updateStateAndWait(prev => {
      const existing = prev.educationOverrides?.schemeBySubject?.[inspectedSubjectId] || {};
      return {
        ...prev,
        educationOverrides: {
          version: 1,
          schemes: prev.educationOverrides?.schemes || {},
          ...prev.educationOverrides,
          schemeBySubject: {
            ...(prev.educationOverrides?.schemeBySubject || {}),
            [inspectedSubjectId]: {
              ...existing,
              ...patch,
            },
          },
        },
      };
    });
    showToast('تم تحديث معادلة التقويم للمادة بنجاح.', 'success');
  };

  const resetSubjectSchemeOverride = async () => {
    await updateStateAndWait(prev => {
      const nextSchemes = { ...(prev.educationOverrides?.schemeBySubject || {}) };
      delete nextSchemes[inspectedSubjectId];
      return {
        ...prev,
        educationOverrides: {
          version: 1,
          schemes: prev.educationOverrides?.schemes || {},
          ...prev.educationOverrides,
          schemeBySubject: nextSchemes,
        },
      };
    });
    showToast('تمت استعادة معادلة التقويم الافتراضية للمادة.', 'success');
  };

  const needsVariantSubjects = selectedSubjects.filter(
    id => (SUBJECTS_BY_ID[id]?.variants?.length ?? 0) > 0
  );
  const relatedSuggestions = primarySubjectId
    ? getRelatedSubjectsForAssignment(primarySubjectId).filter(id => !selectedSubjects.includes(id))
    : [];

  const subjectOfferings = getOfferingsForSubject(inspectedSubjectId);

  return (
    <div className="space-y-6">
      {/* 1. Teacher Assigned Subjects & Bundles */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[var(--primary)]" />
              <span>المواد المسندة للأستاذ وحزم الإسناد التربوي (القرار 186/2006)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              يدعم التطبيق تدريس مادة واحدة أو عدة مواد مسندة (مثل المحاسبة + الاقتصاد + القانون، أو التكنولوجيا + الإعلام الآلي، أو الفيزياء + تكنولوجيا 1AS).
            </p>
          </div>
          <button
            type="button"
            onClick={handleSaveAssignment}
            disabled={isSaving}
            className="min-h-11 px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>حفظ المواد المسندة ({selectedSubjects.length})</span>
          </button>
        </div>

        {/* Pedagogical Assignment Bundles */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <Layers className="w-4 h-4 text-[var(--primary)]" />
            <span>حزم الإسناد التربوي المشترك (المنشور الوزاري 837/2005 — اختيار سريع):</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {ASSIGNMENT_BUNDLES.map(bundle => {
              const isSelectedBundle =
                bundle.subjectIds.length === selectedSubjects.length &&
                bundle.subjectIds.every(id => selectedSubjects.includes(id));
              return (
                <button
                  key={bundle.id}
                  type="button"
                  onClick={() => handleApplyBundle(bundle.primarySubjectId, [...bundle.subjectIds])}
                  className={`text-right p-3 rounded-xl border transition-all flex flex-col justify-between gap-1.5 cursor-pointer ${
                    isSelectedBundle
                      ? 'bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--primary)]'
                      : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold">{bundle.labelAr}</span>
                    {isSelectedBundle && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--primary)] text-white text-[10px] font-bold">
                        مفعّلة
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {bundle.descriptionAr}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* All 18 Subjects Multi-Select Grid */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700">
              قائمة جميع مواد التعليم الثانوي العام والتكنولوجي (اضغط لإضافة أو إزالة مادة):
            </label>
            <span className="text-xs text-slate-500">
              المواد المحددة: <strong className="text-[var(--primary)]">{selectedSubjects.length}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {ACTIVE_SUBJECTS.map(subj => {
              const isSelected = selectedSubjects.includes(subj.id);
              const isPrimary = primarySubjectId === subj.id;
              return (
                <div
                  key={subj.id}
                  className={`rounded-xl border p-2.5 transition-all flex flex-col justify-between gap-2 ${
                    isSelected
                      ? 'bg-[var(--primary-soft)] border-[var(--primary)]'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSubject(subj.id)}
                    className="w-full text-right flex items-center justify-between gap-2 min-h-9 cursor-pointer"
                  >
                    <span
                      className={`text-xs font-bold ${
                        isSelected ? 'text-[var(--primary)]' : 'text-slate-700'
                      }`}
                    >
                      {subj.labelAr}
                    </span>
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center border ${
                        isSelected
                          ? 'bg-[var(--primary)] border-[var(--primary)] text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </span>
                  </button>

                  {isSelected && selectedSubjects.length > 1 && (
                    <div className="flex items-center justify-between pt-1.5 border-t border-emerald-200/60">
                      <button
                        type="button"
                        onClick={() => setPrimarySubjectId(subj.id)}
                        className={`text-[11px] font-semibold flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer ${
                          isPrimary
                            ? 'bg-[var(--primary)] text-white'
                            : 'text-slate-600 hover:bg-white'
                        }`}
                      >
                        <Star className="w-3 h-3" />
                        <span>{isPrimary ? 'المادة الأساسية' : 'تعيين كأساسية'}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Related Suggestions */}
        {relatedSuggestions.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
              <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>مواد كثيراً ما تُسند مع مادتك الأساسية لإكمال النصاب القانوني:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {relatedSuggestions.map(relId => (
                <button
                  key={relId}
                  type="button"
                  onClick={() => toggleSubject(relId)}
                  className="min-h-9 px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-xs font-bold hover:bg-emerald-100 cursor-pointer"
                >
                  + إسناد {SUBJECTS_BY_ID[relId]?.labelAr}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Variant Selection */}
        {needsVariantSubjects.length > 0 && (
          <div className="pt-2 border-t border-slate-100">
            <label
              htmlFor="settings-variant-select"
              className="block text-xs font-bold text-slate-700 mb-1.5"
            >
              التخصص الفرعي (للهندسة في التقني رياضي أو اللغة الأجنبية الثالثة):
            </label>
            <select
              id="settings-variant-select"
              value={variantId || ''}
              onChange={e =>
                setVariantId((e.target.value || undefined) as VariantId | undefined)
              }
              className="w-full sm:w-80 min-h-11 px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold bg-white"
            >
              <option value="">-- اختر التخصص الفرعي --</option>
              {Object.values(SUBJECT_VARIANTS)
                .filter(v => needsVariantSubjects.includes(v.subjectId))
                .map(v => (
                  <option key={v.id} value={v.id}>
                    {v.labelAr}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* 2. Evaluation Formula & Decision 186/2006 Matrix per Subject */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-[var(--primary)]" />
              <span>معادلة التقويم الفصلي وجدول المعاملات والمواقيت (القرار 186 لسنة 2006)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              اختر المادة لمعاينة معاملاتها ومواقيتها الرسمية وتخصيص أعمدة التقويم (الفرض الثاني، الأعمال التطبيقية، الشفوي).
            </p>
          </div>

          {/* Subject Inspector Selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(selectedSubjects.length > 0 ? selectedSubjects : ACTIVE_SUBJECTS.map(s => s.id)).map(
              subjId => {
                const active = subjId === inspectedSubjectId;
                return (
                  <button
                    key={subjId}
                    type="button"
                    onClick={() => setInspectedSubjectId(subjId)}
                    className={`min-h-10 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      active
                        ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {SUBJECTS_BY_ID[subjId]?.labelAr}
                  </button>
                );
              }
            )}
          </div>
        </div>

        {/* Formula Customization Panel */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[var(--primary)]" />
                <span>
                  مخطط التقويم الفصلي لمادة: {SUBJECTS_BY_ID[inspectedSubjectId]?.labelAr}
                </span>
              </div>
              <p className="text-xs text-[var(--primary)] font-bold mt-1">
                المعادلة المطبّقة حالياً: {resolvedScheme.scheme.descriptionAr} (المقسوم عليه: ÷ {resolvedScheme.divisor})
              </p>
            </div>
            <button
              type="button"
              onClick={resetSubjectSchemeOverride}
              className="min-h-9 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>استعادة الافتراضي</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {/* Scheme Preset */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1.5">
              <label className="block font-bold text-slate-700">القالب الأساسي</label>
              <select
                value={currentOverride.schemeId ?? resolvedScheme.scheme.id}
                onChange={e =>
                  void updateSubjectSchemeOverride({
                    schemeId: e.target.value as AssessmentSchemeId,
                  })
                }
                className="w-full min-h-10 px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-semibold"
              >
                {ASSESSMENT_SCHEMES.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.labelAr}
                  </option>
                ))}
              </select>
            </div>

            {/* Devoir Count */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1.5">
              <label className="block font-bold text-slate-700">عدد الفروض المحروسة</label>
              <select
                value={resolvedScheme.devoirCount}
                onChange={e =>
                  void updateSubjectSchemeOverride({
                    devoirCount: Number(e.target.value) as 1 | 2,
                  })
                }
                className="w-full min-h-10 px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-semibold"
              >
                <option value={1}>فرض محروس واحد (1)</option>
                <option value={2}>فرضان محروسان (الفرض 1 + الفرض 2)</option>
              </select>
            </div>

            {/* Practical Work Column Toggle */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-2">
              <div>
                <div className="font-bold text-slate-700">عمود الأعمال التطبيقية</div>
                <div className="text-[11px] text-slate-500">يُفعّل للمواد المخبرية والتكنولوجيا</div>
              </div>
              <input
                type="checkbox"
                checked={resolvedScheme.hasPractical}
                onChange={e =>
                  void updateSubjectSchemeOverride({
                    enablePracticalColumn: e.target.checked,
                  })
                }
                className="w-5 h-5 accent-[var(--primary)] cursor-pointer"
              />
            </div>

            {/* Oral Expression Column Toggle */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-2">
              <div>
                <div className="font-bold text-slate-700">عمود التعبير الشفوي</div>
                <div className="text-[11px] text-slate-500">يُفعّل للغات (العربية/الفرنسية/الإنجليزية...)</div>
              </div>
              <input
                type="checkbox"
                checked={resolvedScheme.hasOral}
                onChange={e =>
                  void updateSubjectSchemeOverride({
                    enableOralColumn: e.target.checked,
                  })
                }
                className="w-5 h-5 accent-[var(--primary)] cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Official Decision 186/2006 Matrix for the Inspected Subject */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <Clock className="w-4 h-4 text-[var(--primary)]" />
            <span>
              المعاملات والمواقيت الأسبوعية الرسمية لمادة «{SUBJECTS_BY_ID[inspectedSubjectId]?.labelAr}» حسب القرار 186 المؤرخ في 23 مارس 2006:
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                  <th className="py-2.5 px-3">المستوى</th>
                  <th className="py-2.5 px-3">الشعبة / الجذع المشترك</th>
                  <th className="py-2.5 px-3 text-center">المعامل الرسمي</th>
                  <th className="py-2.5 px-3 text-center">الحجم الساعي الأسبوعي</th>
                  <th className="py-2.5 px-3">تفصيل الحصص (نظري / أعمال تطبيقية)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subjectOfferings.map(off => {
                  const streamMeta = STREAMS_BY_ID[off.streamId as StreamId];
                  const variantMeta = off.variantId ? SUBJECT_VARIANTS[off.variantId] : undefined;
                  const totalH = off.hours?.total ?? 2;
                  const classH = off.hours?.classHours ?? totalH;
                  const groupH = off.hours?.groupHours ?? 0;
                  return (
                    <tr key={`${off.levelCode}-${off.streamId}-${off.variantId || 'base'}`} className="hover:bg-slate-50/70">
                      <td className="py-2 px-3 font-bold text-slate-800">{off.levelCode}</td>
                      <td className="py-2 px-3 text-slate-700">
                        {streamMeta?.labelAr || off.streamId}
                        {variantMeta && (
                          <span className="mr-1.5 px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-semibold">
                            {variantMeta.labelAr}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] font-bold">
                          {off.coefficient ?? '-'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center font-bold text-slate-800">
                        {totalH} سا
                      </td>
                      <td className="py-2 px-3 text-slate-500">
                        {classH} سا قسم كامل
                        {groupH > 0
                          ? ` + ${groupH} سا أعمال تطبيقية (تفويج)`
                          : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
