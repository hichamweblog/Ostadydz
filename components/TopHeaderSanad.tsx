"use client";

import { useAppState } from '@/hooks/app-state-context';
import { getSubjectDisplayName, type SubjectId } from "@/lib/education";
import { AlertCircle, BookOpen, Calendar, CheckCircle2, Cloud, Menu, RefreshCw, Search } from "lucide-react";
import React, { useEffect } from "react";
import { PWAInstallButton } from "./PWAInstallButton";
import { SanadTab } from "./SidebarSanad";
import {
  selectActiveClass,
  selectClassAssignedSubjectIds,
  selectEffectiveSubjectId,
  selectStudentsByClass,
  selectTeacherSubjectIds,
} from "@/lib/state-selectors";
import type { CloudSyncStatus } from "@/hooks/useCloudAppState";

interface TopHeaderSanadProps {
  currentTab: SanadTab;
  onOpenSearch: () => void;
  onToggleMobileSidebar: () => void;
  cloudStatus?: CloudSyncStatus;
  syncError?: string | null;
  onRetrySync?: () => void;
  onOpenConflict?: () => void;
}

const TAB_TITLES: Record<SanadTab, { title: string; subtitle?: string }> = {
  dashboard: {
    title: "لوحة التحكم",
    subtitle: "متابعة الحصص والأفواج والمهام اليومية",
  },
  classes: {
    title: "الأقسام المسندة",
    subtitle: "إدارة الأقسام المسندة والحصص الأسبوعية",
  },
  students: {
    title: "قوائم التلاميذ",
    subtitle: "إدارة قوائم التلاميذ واستيرادها",
  },
  attendance: {
    title: "التقويم المستمر والحضور",
    subtitle: "معايير التقويم المستمر (السلوك، الكراس، المشاركة، الغيابات)",
  },
  grades: {
    title: "دفتر النقاط",
    subtitle: "التقويم المستمر، الفروض، الأعمال التطبيقية، والاختبارات",
  },
  council: {
    title: "مجالس الأقسام",
    subtitle: "إحصائيات النتائج ونسب النجاح الرسمية",
  },
  sessions: {
    title: "دفتر النصوص",
    subtitle: "سجل الحصص اليومي ودفتر الملاحظات",
  },
  annual_dist: {
    title: "التوزيع السنوي",
    subtitle: "التدرج السنوي للتعلمات والمقاطع البيداغوجية",
  },
  curriculum: {
    title: "المنهاج",
    subtitle: "المنهاج والوحدات التعليمية المعتمدة للمادة",
  },
  timetable: { title: "جدول التوقيت", subtitle: "شبكة الحصص الأسبوعية" },
  settings: { title: "الإعدادات", subtitle: "إعدادات التطبيق والملف المهني" },
  prep: {
    title: "المذكرات",
    subtitle: "الاطلاع على المذكرات التعليمية وإدارتها",
  },
  documents: {
    title: "الوثائق",
    subtitle: "تصدير الوثائق والتقارير جاهزة للطباعة",
  },
};

export const TopHeaderSanad: React.FC<TopHeaderSanadProps> = ({
  currentTab,
  onOpenSearch,
  onToggleMobileSidebar,
  cloudStatus = "ready",
  syncError,
  onRetrySync,
  onOpenConflict,
}) => {
  const { state, updateState } = useAppState();
  const currentInfo = TAB_TITLES[currentTab] || { title: "معين" };
  const activeClass = selectActiveClass(state);
  const activeClassStudentCount = selectStudentsByClass(state, activeClass?.id ?? null).length;
  const teacherSubjectIds = selectTeacherSubjectIds(state);
  const classSubjectIds = selectClassAssignedSubjectIds(state, activeClass);
  const switchableSubjectIds =
    currentTab === "curriculum" || currentTab === "annual_dist" || currentTab === "prep"
      ? teacherSubjectIds
      : classSubjectIds.length > 0
      ? classSubjectIds
      : teacherSubjectIds;
  const effectiveSubjectId = selectEffectiveSubjectId(state, activeClass);
  const effectiveVariantId = effectiveSubjectId
    ? activeClass?.subjectVariantById?.[effectiveSubjectId] ??
      state.profile.subjectVariantsById?.[effectiveSubjectId] ??
      state.profile.variantBySubjectId?.[effectiveSubjectId]
    : undefined;
  const effectiveSubjectLabel = effectiveSubjectId
    ? getSubjectDisplayName(effectiveSubjectId, effectiveVariantId, true)
    : undefined;

  const handleSelectActiveSubject = (nextSubjectId: SubjectId) => {
    updateState((prev) => ({
      ...prev,
      activeSubjectId: nextSubjectId,
    }));
  };

  // Algerian date formatting
  const today = new Date();
  const dayNames = [
    "الأحد",
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
  ];
  const monthNames = [
    "جانفي",
    "فيفري",
    "مارس",
    "أفريل",
    "ماي",
    "جوان",
    "جويلية",
    "أوت",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ];
  const gregorianDate = `${dayNames[today.getDay()]} ${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()} م`;
  const syncStatus = {
    loading: { label: "جاري التحميل", className: "text-[var(--text-secondary)]" },
    ready: { label: "متزامن", className: "text-[var(--success)]" },
    "sync-pending": { label: "قيد المزامنة", className: "text-[var(--warning)]" },
    "sync-failed": { label: "فشل المزامنة", className: "text-[var(--danger)]" },
    conflict: { label: "تعارض يحتاج مراجعة", className: "text-[var(--danger)]" },
    "local-only": { label: "محلي فقط", className: "text-[var(--warning)]" },
  }[cloudStatus];

  // Automatic Hijri date
  const hijriDate = (() => {
    try {
      const formatter = new Intl.DateTimeFormat("ar-DZ-u-ca-islamic-umalqura", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const formatted = formatter
        .format(today)
        .replace(/\s+/g, " ")
        .replace(/AH/gi, "هـ")
        .trim();
      return formatted.endsWith("هـ") ? formatted : `${formatted} هـ`;
    } catch {
      return state.profile.hijriYear || "1448 هـ";
    }
  })();

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  return (
    <header className="sticky top-0 z-30 print:hidden bg-[var(--bg-surface)]/90 backdrop-blur-xl supports-[backdrop-filter]:bg-[var(--bg-surface)]/80 border-b border-[var(--border-default)] transition-colors">
      <div className="h-16 px-3 sm:px-6 md:px-8 w-full max-w-[30rem] md:max-w-7xl mx-auto flex items-center justify-between gap-3 md:gap-4">
        {/* Right Side: Menu toggle & Page Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onToggleMobileSidebar}
            className="min-h-11 min-w-11 p-2 rounded-xl lg:hidden text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-subtle)] transition-colors cursor-pointer shrink-0 flex items-center justify-center"
            aria-label="فتح القائمة">
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-black text-[var(--text-primary)] tracking-tight truncate leading-tight">
              {currentInfo.title}
            </h1>
            {currentInfo.subtitle && (
              <p className="text-[10px] text-[var(--text-tertiary)] hidden sm:block truncate leading-tight">
                {currentInfo.subtitle}
              </p>
            )}
            {activeClass && currentTab !== "dashboard" && (
              <div className="text-[10px] text-[var(--primary)] font-bold truncate mt-0.5 flex items-center gap-1.5">
                <span>
                  القسم الحالي: {activeClass.name} • {activeClassStudentCount} تلميذاً
                </span>
                {effectiveSubjectLabel && (
                  <span className="text-[var(--text-secondary)]">• {effectiveSubjectLabel}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Left Side: Quick Subject Switcher + Gregorian/Hijri Date + Search + Sync */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {switchableSubjectIds.length > 1 && (
            <div
              className="flex items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface-subtle)] p-1"
              role="group"
              aria-label="مبدل المادة السريع">
              <BookOpen className="w-3.5 h-3.5 text-[var(--primary)] mr-1 hidden sm:inline shrink-0" />
              {switchableSubjectIds.map((subId) => {
                const isSelected = effectiveSubjectId === subId;
                const variantId =
                  activeClass?.subjectVariantById?.[subId] ??
                  state.profile.subjectVariantsById?.[subId] ??
                  state.profile.variantBySubjectId?.[subId];
                const label = getSubjectDisplayName(subId, variantId, true);
                return (
                  <button
                    key={subId}
                    type="button"
                    onClick={() => handleSelectActiveSubject(subId)}
                    className={`min-h-8 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-[var(--primary)] text-white shadow-xs"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                    }`}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {/* Automatic Gregorian + Hijri Date */}
          <div className="hidden md:flex flex-col items-end pl-3 border-l border-[var(--border-default)] text-right">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
              <Calendar className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
              <span>{gregorianDate}</span>
            </div>
            <div className="text-[11px] font-amiri font-bold text-[var(--primary)]">
              {hijriDate}
            </div>
          </div>

          {/* Quick Search Button */}
          <button
            onClick={onOpenSearch}
            className="flex min-h-11 items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-subtle)] border border-[var(--border-default)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer shadow-xs whitespace-nowrap"
            title="بحث شامل (Ctrl+K)">
            <Search className="w-4 h-4 text-[var(--text-secondary)]" />
            <span className="hidden sm:inline font-medium">بحث</span>
            <kbd className="hidden lg:inline-block px-1.5 py-0.5 rounded bg-[var(--bg-surface-subtle)] border border-[var(--border-default)] text-[10px] font-mono text-[var(--text-secondary)]">
              Ctrl+K
            </kbd>
          </button>

          <PWAInstallButton />
          <div
            className={`flex min-h-10 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${syncStatus.className} border-current/20 bg-[var(--bg-surface-subtle)]`}
            title={syncError || syncStatus.label}
            aria-live="polite">
            {cloudStatus === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> :
              cloudStatus === "sync-pending" || cloudStatus === "loading" ? <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" /> :
              cloudStatus === "sync-failed" || cloudStatus === "conflict" ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> :
              <Cloud className="h-3.5 w-3.5 shrink-0" />}
            <span className="hidden sm:inline">{syncStatus.label}</span>
            {cloudStatus === "conflict" && onOpenConflict && (
              <button type="button" onClick={onOpenConflict} className="min-h-8 px-1 underline underline-offset-2 shrink-0 cursor-pointer">
                مراجعة
              </button>
            )}
            {(cloudStatus === "sync-failed" || cloudStatus === "local-only") && onRetrySync && (
              <button
                type="button"
                onClick={onRetrySync}
                className="min-h-8 px-1 underline underline-offset-2 shrink-0 cursor-pointer"
                aria-label="إعادة محاولة المزامنة">
                إعادة المحاولة
              </button>
            )}
          </div>

        </div>
      </div>
    </header>
  );
};
