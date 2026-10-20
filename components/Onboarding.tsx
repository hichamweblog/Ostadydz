'use client';

import React, { useState, useCallback } from 'react';
import { useAppState } from '@/hooks/app-state-context';
import { AccessibleDialog } from './AccessibleDialog';
import { buildPracticalTrialState } from '@/lib/practical-trial-seed';
import { showToast } from './Toast';
import {
  ACTIVE_SUBJECTS,
  ASSIGNMENT_BUNDLES,
  getRelatedSubjectsForAssignment,
  SUBJECTS_BY_ID,
  SUBJECT_VARIANTS,
  type SubjectId,
  type VariantId,
} from '@/lib/education';
import { X, ArrowLeft, Users, School, Sparkles, BookOpen, Check, Layers } from 'lucide-react';

interface OnboardingProps {
  onComplete?: () => void;
  onOpenSetup?: () => void;
}

export function Onboarding({ onComplete, onOpenSetup }: OnboardingProps) {
  const { state, updateStateAndWait } = useAppState();
  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState(state.profile.name === 'أستاذ المادة' ? '' : state.profile.name);
  const [schoolName, setSchoolName] = useState(state.profile.schoolName || '');
  const [stateName, setStateName] = useState(state.profile.stateName || '');

  const initialSubjects: SubjectId[] =
    state.profile.taughtSubjectIds ??
    state.profile.subjectIds ??
    (state.profile.primarySubjectId ? [state.profile.primarySubjectId] : []);

  const [selectedSubjects, setSelectedSubjects] = useState<SubjectId[]>(initialSubjects);
  const [primarySubjectId, setPrimarySubjectId] = useState<SubjectId | undefined>(
    state.profile.primarySubjectId ?? initialSubjects[0]
  );
  const [variantId, setVariantId] = useState<VariantId | undefined>(state.profile.variantId);
  const [subjectError, setSubjectError] = useState<string | null>(null);

  const steps = [
    {
      title: 'مرحبًا بك في مُعين الأستاذ!',
      description: 'دفتر العمل الرقمي الشامل لأساتذة التعليم الثانوي العام والتكنولوجي (القرار 186/2006)',
      icon: Sparkles,
    },
    {
      title: 'المواد المسندة والتخصص',
      description: 'اختر مادتك الأساسية أو حزمة الإسناد المتعدد لضبط المعاملات والمواقيت آلياً',
      icon: BookOpen,
    },
    {
      title: 'بياناتك الشخصية',
      description: 'هذه البيانات ستظهر في الوثائق الرسمية المطبوعة',
      icon: Users,
    },
    {
      title: 'هيا نبدأ!',
      description: 'يمكنك إضافة أقسامك واستيراد قوائم الرقمنة الآن',
      icon: School,
    },
  ];

  const toggleSubject = (subjectId: SubjectId) => {
    setSubjectError(null);
    setSelectedSubjects(prev => {
      if (prev.includes(subjectId)) {
        const next = prev.filter(id => id !== subjectId);
        if (primarySubjectId === subjectId) {
          setPrimarySubjectId(next[0]);
        }
        return next;
      } else {
        const next = [...prev, subjectId];
        if (!primarySubjectId) {
          setPrimarySubjectId(subjectId);
        }
        return next;
      }
    });
  };

  const applyBundle = (bundlePrimary: SubjectId, bundleSubjects: SubjectId[]) => {
    setSubjectError(null);
    setPrimarySubjectId(bundlePrimary);
    setSelectedSubjects(bundleSubjects);
  };

  const saveAndDismiss = async () => {
    setIsSaving(true);
    try {
      const effectivePrimary = primarySubjectId ?? selectedSubjects[0];
      const primaryMeta = effectivePrimary ? SUBJECTS_BY_ID[effectivePrimary] : undefined;
      await updateStateAndWait(prev => ({
        ...prev,
        activeSubjectId: effectivePrimary ?? prev.activeSubjectId ?? null,
        profile: {
          ...prev.profile,
          name: name.trim() || prev.profile.name,
          schoolName: schoolName.trim() || prev.profile.schoolName,
          stateName: stateName.trim() || prev.profile.stateName,
          primarySubjectId: effectivePrimary,
          subjectId: effectivePrimary,
          taughtSubjectIds: selectedSubjects,
          subjectIds: selectedSubjects,
          variantId,
          subjectName: primaryMeta?.labelAr ?? prev.profile.subjectName,
        },
        onboardingDismissed: true,
      }));
      onComplete?.();
      return true;
    } catch (error) {
      console.error('Failed to save onboarding data:', error);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleNext = async () => {
    if (step === 1 && selectedSubjects.length === 0) {
      setSubjectError('يرجى اختيار مادة واحدة على الأقل للمتابعة.');
      return;
    }
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }

    const saved = await saveAndDismiss();
    if (saved) onOpenSetup?.();
  };

  const handleLoadPracticalTrial = async () => {
    setIsSaving(true);
    try {
      await updateStateAndWait((prev) =>
        buildPracticalTrialState(prev, {
          name,
          schoolName,
          stateName,
          primarySubjectId: primarySubjectId ?? selectedSubjects[0],
          taughtSubjectIds: selectedSubjects.length ? selectedSubjects : undefined,
          variantId,
        }),
      );
      showToast('تم تجهيز مساحة العمل النموذجية (3 أقسام، 24 تلميذاً، نقاط، وتوقيت أسبوعي) للتجريب الفوري!', 'success');
      onComplete?.();
    } catch (error) {
      console.error('Failed to seed practical trial workspace:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = useCallback(async () => {
    setIsSaving(true);
    try {
      await updateStateAndWait(prev => ({ ...prev, onboardingDismissed: true }));
      onComplete?.();
    } finally {
      setIsSaving(false);
    }
  }, [updateStateAndWait, onComplete]);

  const currentStep = steps[step];
  const Icon = currentStep.icon;

  const needsVariantSubjects = selectedSubjects.filter(
    id => (SUBJECTS_BY_ID[id]?.variants?.length ?? 0) > 0
  );
  const relatedSuggestions = primarySubjectId
    ? getRelatedSubjectsForAssignment(primarySubjectId).filter(id => !selectedSubjects.includes(id))
    : [];

  return (
    <AccessibleDialog
      open
      titleId="onboarding-title"
      onClose={handleSkip}
      className="w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="relative bg-gradient-to-br from-[var(--primary)] to-[var(--accent-navy)] px-6 py-7 text-white">
        <button
          onClick={handleSkip}
          className="absolute top-4 left-4 min-h-11 min-w-11 p-2 hover:bg-white/10 rounded-xl transition-colors flex items-center justify-center"
          aria-label="إغلاق"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-center mb-3">
          <div className="bg-white/20 rounded-2xl p-3.5">
            <Icon className="w-10 h-10" />
          </div>
        </div>

        <h2 id="onboarding-title" className="text-xl font-bold text-center">
          {currentStep.title}
        </h2>
        <p className="text-white/85 text-center mt-1.5 text-sm">{currentStep.description}</p>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mt-5">
          {steps.map((_, idx) => (
            <div
              key={idx}
              className={`h-2 rounded-full transition-all ${
                idx === step ? 'w-8 bg-white' : 'w-2 bg-white/40'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        {step === 0 && (
          <div className="space-y-4 text-center">
            <div className="bg-[var(--primary-soft)] rounded-xl p-4">
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                يدعم <strong>مُعين الأستاذ</strong> جميع مواد التعليم الثانوي العام والتكنولوجي (18 مادة) وفق أحكام <strong>القرار الوزاري رقم 186 المؤرخ في 23 مارس 2006</strong>، مع دعم كامل لإسناد أكثر من مادة للأستاذ الواحد.
              </p>
            </div>
            <p className="text-xs text-slate-500">
              يتم ضبط المعاملات، المواقيت الأسبوعية، أعمدة التقويم، والتوزيع السنوي آلياً حسب المواد المسندة إليك.
            </p>
            <div className="pt-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleLoadPracticalTrial()}
                className="w-full min-h-12 px-4 py-3 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary-soft)]/50 hover:bg-[var(--primary-soft)] text-[var(--primary)] font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>تجريب المنصة فوراً ببيانات نموذجية جاهزة (أقسام، تلاميذ، نقاط، وتوقيت)</span>
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            {/* Quick Assignment Bundles */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <Layers className="w-4 h-4 text-[var(--primary)]" />
                <span>حزم الإسناد التربوي المتعدد الشائعة (اختيار سريع):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ASSIGNMENT_BUNDLES.map(bundle => {
                  const isActiveBundle =
                    bundle.subjectIds.length === selectedSubjects.length &&
                    bundle.subjectIds.every(s => selectedSubjects.includes(s));
                  return (
                    <button
                      key={bundle.id}
                      type="button"
                      onClick={() => applyBundle(bundle.primarySubjectId, [...bundle.subjectIds])}
                      className={`text-right p-2.5 rounded-xl border text-xs transition-all ${
                        isActiveBundle
                          ? 'bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--primary)] font-bold'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <div className="font-bold">{bundle.labelAr}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                        {bundle.descriptionAr}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* All 18 Subjects Grid */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                أو اختر مادة واحدة أو عدة مواد مسندة إليك (يمكنك تعديلها في أي وقت من الإعدادات):
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto p-1">
                {ACTIVE_SUBJECTS.map(subj => {
                  const isChecked = selectedSubjects.includes(subj.id);
                  const isPrimary = primarySubjectId === subj.id;
                  return (
                    <button
                      key={subj.id}
                      type="button"
                      onClick={() => toggleSubject(subj.id)}
                      className={`min-h-11 px-3 py-2 rounded-xl border text-right text-xs font-semibold transition-all flex items-center justify-between gap-2 ${
                        isChecked
                          ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate">{subj.labelAr}</span>
                      {isChecked && (
                        <span className="shrink-0 inline-flex items-center gap-1">
                          {isPrimary && selectedSubjects.length > 1 && (
                            <span className="text-[10px] bg-white/25 px-1.5 py-0.5 rounded">
                              أساسية
                            </span>
                          )}
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Related Subject Suggestion */}
            {relatedSuggestions.length > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-emerald-900 font-medium">
                  هل أُسندت إليك أيضاً مادة مكملة للنصاب؟
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {relatedSuggestions.map(relId => (
                    <button
                      key={relId}
                      type="button"
                      onClick={() => toggleSubject(relId)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-xs font-bold hover:bg-emerald-100"
                    >
                      + إضافة {SUBJECTS_BY_ID[relId]?.labelAr}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Variant Selector if Technology or Third Language is selected */}
            {needsVariantSubjects.length > 0 && (
              <div>
                <label
                  htmlFor="onboarding-variant-select"
                  className="block text-xs font-bold text-slate-700 mb-1.5"
                >
                  التخصص الفرعي (للهندسة أو اللغة الأجنبية الثالثة):
                </label>
                <select
                  id="onboarding-variant-select"
                  value={variantId || ''}
                  onChange={e =>
                    setVariantId((e.target.value || undefined) as VariantId | undefined)
                  }
                  className="w-full min-h-11 px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
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

            {subjectError && (
              <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl p-2.5">
                {subjectError}
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="onboarding-teacher-name"
                className="block text-sm font-semibold text-slate-700 mb-2"
              >
                الاسم الكامل <span className="text-slate-400">(اختياري)</span>
              </label>
              <input
                id="onboarding-teacher-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="مثال: أحمد بن محمد"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none transition-all text-base"
                dir="rtl"
                autoComplete="name"
              />
            </div>

            <div>
              <label
                htmlFor="onboarding-school-name"
                className="block text-sm font-semibold text-slate-700 mb-2"
              >
                اسم المؤسسة <span className="text-slate-400">(اختياري)</span>
              </label>
              <input
                id="onboarding-school-name"
                type="text"
                value={schoolName}
                onChange={e => setSchoolName(e.target.value)}
                placeholder="مثال: ثانوية ابن خلدون"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none transition-all text-base"
                dir="rtl"
                autoComplete="organization"
              />
            </div>

            <div>
              <label
                htmlFor="onboarding-state-name"
                className="block text-sm font-semibold text-slate-700 mb-2"
              >
                الولاية <span className="text-slate-400">(اختياري)</span>
              </label>
              <input
                id="onboarding-state-name"
                type="text"
                value={stateName}
                onChange={e => setStateName(e.target.value)}
                placeholder="مثال: تلمسان"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none transition-all text-base"
                dir="rtl"
                autoComplete="address-level1"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 text-center">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-2xl font-bold text-[var(--primary)]">1</div>
                <div className="text-xs text-slate-600 mt-1">أضف أقسامك</div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-2xl font-bold text-[var(--primary)]">2</div>
                <div className="text-xs text-slate-600 mt-1">استورد التلاميذ</div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-2xl font-bold text-[var(--primary)]">3</div>
                <div className="text-xs text-slate-600 mt-1">بدّل بين المواد بضغطة</div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-2xl font-bold text-[var(--primary)]">4</div>
                <div className="text-xs text-slate-600 mt-1">احسب النقاط والتوزيع</div>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              سنفتح لك شاشة الأقسام مباشرة لتبدأ باستيراد بيانات الرقمنة أو إضافة قسم يدوياً، أو يمكنك توليد بيانات نموذجية لمادتك المختارة:
            </p>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleLoadPracticalTrial()}
              className="w-full min-h-11 px-4 py-2.5 rounded-xl border border-[var(--primary)] bg-[var(--primary-soft)]/60 hover:bg-[var(--primary-soft)] text-[var(--primary)] font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>تعبئة بيانات نموذجية لمادتي المختارة للتجريب الفوري</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 bg-slate-50 flex items-center justify-between gap-3">
        <button
          onClick={handleSkip}
          className="min-h-11 px-3 text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors"
        >
          تخطي
        </button>

        <button
          onClick={handleNext}
          disabled={isSaving}
          className="flex min-h-11 items-center gap-2 px-6 py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--primary)]/60 text-white rounded-xl font-semibold transition-colors"
        >
          {step === steps.length - 1 ? (
            <>
              إعداد الأقسام الآن
              <Sparkles className="w-4 h-4" />
            </>
          ) : (
            <>
              التالي
              <ArrowLeft className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </AccessibleDialog>
  );
}
