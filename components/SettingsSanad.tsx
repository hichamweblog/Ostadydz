"use client";

import { showToast } from "@/components/Toast";
import { useAppState } from '@/hooks/app-state-context';
import {
  backupNudge,
  formatAge,
  isBackupNudgeDismissed,
  pendingSummary,
  shortDeviceId,
  syncStatusSummary,
} from '@/lib/sync-status';
import {
  dismissBackupNudge,
  readBackupReminder,
  recordBackupExported,
  writeBackupReminder,
  type BackupReminder,
} from '@/lib/backup-reminder';
import {
  AppState,
  DEFAULT_CALENDAR_SETTINGS,
  exportBackupJSON,
  importBackupJSON,
} from "@/lib/storage";
import { createPdfBackupArchive, restorePdfBackupArchive } from "@/lib/backup-archive";
import { AcademicCalendarSettings, GradeLevel, HolidayType, OfficialHoliday } from "@/lib/types";
import {
  formatHolidayDates,
  holidayRange,
  holidayTypeLabel,
  withDerivedDateStr,
} from "@/lib/academic-calendar";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  CloudDownload,
  RefreshCw,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ProfessionalProfile } from "./ProfessionalProfile";
import { SubjectAssignmentSettings } from "./SubjectAssignmentSettings";
import { PWAInstallButton } from "./PWAInstallButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { SupabaseReadinessCard } from "./SupabaseReadinessCard";

interface SettingsSanadProps {
}

type SettingsTab = "profile" | "calendar" | "evaluation" | "backup";
const RESET_CONFIRMATION = "إعادة تعيين";

export const SettingsSanad: React.FC<SettingsSanadProps> = () => {
  const {
    state,
    ownerId,
    updateStateAndWait,
    replaceStateFromBackup,
    clearRosterData,
    resyncFromCloud,
    pendingCount,
    lastSyncedAt,
    refreshSyncStatus,
    syncDeviceId,
    syncNow,
    cloudStatus,
  } = useAppState();
  const [calendarSettings, setCalendarSettings] =
    useState<AcademicCalendarSettings>(
      state.calendarSettings || DEFAULT_CALENDAR_SETTINGS,
    );
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);
  const [holidayName, setHolidayName] = useState("");
  const [holidayType, setHolidayType] = useState<HolidayType>("national");
  const [holidayMode, setHolidayMode] = useState<"day" | "range">("day");
  const [holidayStart, setHolidayStart] = useState("");
  const [holidayEnd, setHolidayEnd] = useState("");
  const [holidayScope, setHolidayScope] = useState<"all" | "3AS" | "1AS2AS">("all");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showResyncConfirm, setShowResyncConfirm] = useState(false);
  const [showHolidaysConfirm, setShowHolidaysConfirm] = useState(false);
  const [showSuccessMsg, setShowSuccessMsg] = useState("");
  const [pendingImportedState, setPendingImportedState] = useState<AppState | null>(null);
  const [holidayToDeleteId, setHolidayToDeleteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [reminder, setReminder] = useState<BackupReminder | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [resetConfirmationText, setResetConfirmationText] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfArchiveInputRef = useRef<HTMLInputElement>(null);

  const handleSaveSettings = () => {
    void updateStateAndWait((prev) => ({
      ...prev,
      calendarSettings,
    }))
      .then(() => {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      })
      .catch((error: unknown) => {
        console.error("Calendar settings save failed:", error);
        showToast("تعذر حفظ إعدادات التقويم في السحابة.", "error");
      });
  };

  const handleClearClassesData = () => {
    setResetConfirmationText("");
    setShowResetConfirm(true);
  };

  const confirmClearClassesData = async () => {
    if (resetConfirmationText.trim() !== RESET_CONFIRMATION) return;
    try {
      await clearRosterData();
      setShowResetConfirm(false);
      setResetConfirmationText("");
      setShowSuccessMsg("تمت إعادة تعيين الأقسام والتلاميذ ومزامنتها بنجاح.");
      showToast("تمت إعادة تعيين الأقسام والتلاميذ ومزامنتها بنجاح.", "success");
      setTimeout(() => setShowSuccessMsg(""), 3000);
    } catch (error) {
      console.error("Roster reset failed:", error);
      setShowResetConfirm(false);
      setResetConfirmationText("");
      showToast("تعذر تأكيد إعادة تعيين الأقسام والتلاميذ في السحابة. يرجى التحقق من الاتصال وإعادة المحاولة.", "error");
    }
  };

  const handleResyncFromCloud = async () => {
    setShowResyncConfirm(false);
    try {
      await resyncFromCloud();
      showToast("تمت إعادة تحميل مساحة العمل من الخادم السحابي.", "success");
    } catch (error) {
      console.error("Cloud re-sync failed:", error);
      showToast(
        error instanceof Error ? error.message : "تعذرت إعادة المزامنة من السحابة.",
        "error",
      );
    }
  };

  const handleResetHolidays = () => {
    setShowHolidaysConfirm(true);
  };

  /** Persists a calendar-settings change immediately so an excluded day can never be lost. */
  const commitCalendarSettings = async (next: AcademicCalendarSettings): Promise<boolean> => {
    setCalendarSettings(next);
    try { await updateStateAndWait((prev) => ({
      ...prev,
      calendarSettings: next,
    }));
      return true;
    } catch (error) {
      console.error("Holiday update failed:", error);
      showToast("تعذر حفظ تعديل الرزنامة. لم يُعلن نجاح الرفع؛ أعد المحاولة.", "error");
      return false;
    }
  };

  const confirmResetHolidays = async () => {
    const saved = await commitCalendarSettings({
      ...calendarSettings,
      holidays: DEFAULT_CALENDAR_SETTINGS.holidays,
    });
    if (!saved) return;
    setShowHolidaysConfirm(false);
    showToast("تمت استعادة الرزنامة الرسمية 2026/2027 (العطل والاختبارات).", "success");
  };

  const openAddHoliday = () => {
    setEditingHolidayId(null);
    setHolidayName("");
    setHolidayType("national");
    setHolidayMode("day");
    setHolidayStart("");
    setHolidayEnd("");
    setHolidayScope("all");
    setIsHolidayModalOpen(true);
  };

  const openEditHoliday = (holiday: OfficialHoliday) => {
    const range = holidayRange(holiday);
    setEditingHolidayId(holiday.id);
    setHolidayName(holiday.name);
    setHolidayType(holiday.type);
    setHolidayScope(holiday.levels?.includes("3AS") ? "3AS" : holiday.levels?.length ? "1AS2AS" : "all");
    setHolidayMode(range && range.start !== range.end ? "range" : "day");
    setHolidayStart(range?.start || "");
    setHolidayEnd(range && range.start !== range.end ? range.end : "");
    setIsHolidayModalOpen(true);
  };

  const handleSaveHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = holidayName.trim();
    if (!name || !holidayStart) {
      showToast("يرجى إدخال اسم العطلة وتحديد تاريخ البداية من المفكرة.", "error");
      return;
    }
    if (holidayMode === "range" && (!holidayEnd || holidayEnd < holidayStart)) {
      showToast("تاريخ النهاية يجب ألا يسبق البداية.", "error");
      return;
    }
    const endDate =
      holidayMode === "range" && holidayEnd && holidayEnd > holidayStart
        ? holidayEnd
        : undefined;
    const entry = withDerivedDateStr({
      id: editingHolidayId || `h-${uuidv4()}`,
      name,
      type: holidayType,
      startDate: holidayStart,
      endDate,
      levels: holidayScope === "3AS" ? ["3AS"] : holidayScope === "1AS2AS" ? ["1AS_ARTS", "1AS_SCIENCE", "2AS"] as GradeLevel[] : undefined,
      provisional: calendarSettings.holidays.find(h => h.id === editingHolidayId)?.provisional,
      dateStr: "",
    });

    const nextHolidays = editingHolidayId
      ? calendarSettings.holidays.map((h) => (h.id === editingHolidayId ? entry : h))
      : [...calendarSettings.holidays, entry];
    if (!await commitCalendarSettings({ ...calendarSettings, holidays: nextHolidays })) return;
    setIsHolidayModalOpen(false);
    showToast(
      editingHolidayId
        ? "تم تعديل اليوم المستثنى وحفظه."
        : "تمت إضافة اليوم المستثنى؛ سيُستثنى من الحصص آلياً.",
      "success",
    );
  };

  const handleDeleteHoliday = async (id: string) => {
    const saved = await commitCalendarSettings({
      ...calendarSettings,
      holidays: calendarSettings.holidays.filter((h) => h.id !== id),
    });
    if (!saved) return;
    setHolidayToDeleteId(null);
    showToast("تم حذف اليوم المستثنى من الرزنامة.", "success");
  };

  // Sync panel + backup nudge derive everything from pure helpers so the wording rules stay
  // testable; the component only renders them.
  // Reading localStorage during render would break hydration, so the reminder is loaded in a
  // queued task and refreshed when the backup tab is open (age labels must not go stale).
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setReminder(readBackupReminder(ownerId));
      setNow(Date.now());
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ownerId]);

  useEffect(() => {
    if (activeTab !== "backup") return;
    void refreshSyncStatus();
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const statusSummary = syncStatusSummary(cloudStatus, pendingCount);
  const nudge = backupNudge(reminder?.lastBackupAt, now);
  const nudgeVisible = nudge.prominent && !isBackupNudgeDismissed(reminder?.dismissedAt, now);
  const [resyncBusy, setResyncBusy] = useState(false);
  const [syncNowBusy, setSyncNowBusy] = useState(false);

  const handleBackupRecorded = () => {
    setReminder(recordBackupExported(ownerId));
    setNow(Date.now());
  };

  const handleDismissNudge = () => {
    setReminder(dismissBackupNudge(ownerId));
    setNow(Date.now());
  };

  /** "مزامنة الآن": one press = immediate enqueue + flush, with a clear outcome toast. */
  const handleSyncNow = async () => {
    setSyncNowBusy(true);
    try {
      const result = await syncNow();
      await refreshSyncStatus();
      setNow(Date.now());
      if (result === "synced") {
        showToast("تمت المزامنة مع الخادم فوراً: لا توجد عمليات متبقية.", "success");
      } else if (result === "conflict") {
        showToast("يوجد تعارض معلّق ينتظر قرارك قبل إتمام المزامنة.", "warning");
      } else if (result === "offline") {
        showToast("لا يوجد اتصال بالخادم الآن؛ عملياتك محفوظة وستُرفع تلقائياً عند عودة الشبكة.", "warning");
      } else {
        showToast("تعذّر إتمام المزامنة كاملة الآن؛ ستُعاد المحاولة تلقائياً.", "error");
      }
    } catch (error) {
      console.error('Immediate sync failed:', error);
      showToast('تعذّر إتمام المزامنة. لم يُعلن نجاح الرفع؛ احتفظ بالجهاز وأعد المحاولة.', 'error');
    } finally {
      setSyncNowBusy(false);
    }
  };

  const handleResyncNow = async () => {
    setResyncBusy(true);
    try {
      await resyncFromCloud();
      await refreshSyncStatus();
    } finally {
      setResyncBusy(false);
    }
  };

  const handleExportJSON = () => {
    handleBackupRecorded();
    const json = exportBackupJSON(state);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moeen-al-oustadh-backup-${state.profile.academicYear.replace("/", "-")}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const imported = importBackupJSON(text);
        setPendingImportedState(imported);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "خطأ غير متوقع";
        showToast(`فشل استيراد الملف: ${message}`, "error");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    reader.readAsText(file);
  };

  const confirmImportJSON = async () => {
    if (!pendingImportedState) return;
    const stateToRestore = pendingImportedState;
    setPendingImportedState(null);
    try {
      await replaceStateFromBackup(stateToRestore);
      const hasPdfReferences = Object.values(stateToRestore.unitPdfFiles || {})
        .some((file) => Boolean(file.fileStorageKey || file.fileDataUrl));
      showToast(
        hasPdfReferences
          ? "تمت استعادة البيانات. استعد أرشيف PDF ZIP بشكل منفصل لإظهار الملفات المحلية."
          : "تمت استعادة البيانات بنجاح تام!",
        "success",
      );
    } catch (error) {
      console.error("Backup replacement failed:", error);
      showToast("تعذر استبدال البيانات الحالية. لم يتم إعلان نجاح الاستيراد.", "error");
    }
  };

  const handleExportPdfArchive = async () => {
    try {
      const archive = await createPdfBackupArchive(state, ownerId);
      const url = URL.createObjectURL(new Blob([archive.buffer as ArrayBuffer], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `moeen-al-oustadh-pdfs-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("تم تصدير أرشيف ملفات PDF بنجاح.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "تعذر تصدير ملفات PDF.", "error");
    }
  };

  const handleImportPdfArchive = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const restored = await restorePdfBackupArchive(file, ownerId);
      await updateStateAndWait(prev => ({
        ...prev,
        unitPdfFiles: { ...(prev.unitPdfFiles || {}), ...restored },
      }));
      showToast("تمت استعادة ملفات PDF بنجاح.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "تعذر استعادة ملفات PDF.", "error");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div
      className="space-y-6 w-full max-w-[30rem] md:max-w-5xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6"
      id="sanad-settings-view">
      {/* Settings actions toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-stretch sm:items-center gap-2 flex-wrap">
        <div className="flex w-full sm:w-auto items-stretch sm:items-center gap-2 flex-col sm:flex-row">
          <PWAInstallButton />
          <button
            onClick={handleSaveSettings}
            className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-2 px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer text-xs">
            <Save className="w-4 h-4" />
            <span>حفظ جميع الإعدادات</span>
          </button>
        </div>
      </div>

      {savedSuccess && (
        <div className="bg-[var(--primary-soft)] border border-[var(--primary)]/30 rounded-xl p-3 text-xs text-[var(--accent-navy)] font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[var(--primary)]" />
          <span>تم حفظ الإعدادات وقواعد الاحتساب بنجاح في التطبيق!</span>
        </div>
      )}

      {/* أقسام الإعدادات: كل قسم كزر مستقل (2×2 في الموبايل دون تمرير أفقي) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="أقسام الإعدادات">
        {([
          ["profile", "الملف المهني", UserRound],
          ["calendar", "التقويم الدراسي", Calendar],
          ["evaluation", "التقويم المستمر", ShieldCheck],
          ["backup", "النسخ الاحتياطي", Download],
        ] as const).map(([tab, label, Icon]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-center text-xs font-bold transition-colors cursor-pointer ${
              activeTab === tab
                ? "border-[var(--primary)]/40 bg-[var(--primary-soft)] text-[var(--accent-navy)] shadow-xs"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
            }`}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="leading-tight">{label}</span>
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <section aria-label="الملف المهني والمواد المسندة" className="space-y-6">
          <SubjectAssignmentSettings />
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 pt-2">
            <UserRound className="h-4 w-4 text-[var(--primary)]" />
            <span>البيانات الشخصية والمهنية</span>
          </div>
          <ProfessionalProfile />
        </section>
      )}

      {activeTab === "calendar" && (
        <section aria-label="التقويم الدراسي" className="space-y-6">
      {/* Section 1: السنوات الدراسية والفصول (Screenshot 1) */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[var(--primary)]" />
              السنوات الدراسية والفصول
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              السنة الدراسية الحالية:{" "}
              <span className="font-bold text-[var(--primary)]">
                {state.profile.academicYear || "2026/2027"}
              </span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-2">
          {/* Trimester 1 */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <div className="font-bold text-slate-800 text-sm flex items-center justify-between">
              <span>الفصل الأول</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--accent-navy)] font-bold">
                نشط حالياً
              </span>
            </div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ البداية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term1Start}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: {
                      ...prev.termDates,
                      term1Start: e.target.value,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ النهاية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term1End}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: { ...prev.termDates, term1End: e.target.value },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
          </div>

          {/* Trimester 2 */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <div className="font-bold text-slate-800 text-sm">الفصل الثاني</div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ البداية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term2Start}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: {
                      ...prev.termDates,
                      term2Start: e.target.value,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ النهاية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term2End}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: { ...prev.termDates, term2End: e.target.value },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
          </div>

          {/* Trimester 3 */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <div className="font-bold text-slate-800 text-sm">الفصل الثالث</div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ البداية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term3Start}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: {
                      ...prev.termDates,
                      term3Start: e.target.value,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ النهاية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term3End}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: { ...prev.termDates, term3End: e.target.value },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: العطل والأيام المستثناة (Screenshot 2) */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--primary)]" />
              العطل والأيام المستثناة في الجزائر
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              تُستثنى هذه الأيام تلقائياً من الحصص (لا تُقترح حصة ولا يُطلب توثيقها)،
              ويمكن تعديل كل يوم أو حذفه أو إضافته بتواريخ محددة (يوم واحد أو فترة).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetHolidays}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>استعادة الرزنامة الرسمية</span>
            </button>
            <button
              onClick={openAddHoliday}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)] text-white rounded-xl text-xs font-bold hover:bg-[var(--primary-hover)] cursor-pointer shadow-xs">
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة عطلة</span>
            </button>
          </div>
        </div>

        {/* Compact holiday timeline */}
        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
          {calendarSettings.holidays.map((holiday) => {
            const isExam = holiday.type === "exam";
            const isNational = holiday.type === "national";
            const isTerm = holiday.type === "term";

            return (
              <div
                key={holiday.id}
                className="group flex items-center gap-3 bg-white px-3 py-2.5 text-xs transition-colors hover:bg-slate-50">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  isExam ? "bg-orange-100 text-orange-700" : "bg-[var(--primary-soft)] text-[var(--primary)]"
                }`}>
                  <Clock className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate font-bold text-slate-800">{holiday.name}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    <span
                      className={`px-1.5 py-0.2 rounded-md font-semibold text-[10px] ${
                        isExam
                          ? "bg-orange-100 text-orange-800"
                          : isTerm
                            ? "bg-blue-100 text-navy"
                            : isNational
                              ? "bg-[var(--primary-soft)] text-[var(--accent-navy)]"
                              : "bg-purple-100 text-purple-800"
                      }`}>
                      {holidayTypeLabel(holiday.type)}
                    </span>
                    <span>{formatHolidayDates(holiday)}</span>
                    {holiday.provisional && <span className="text-amber-700">تاريخ ديني تقديري قابل للتعديل</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditHoliday(holiday)}
                    className="p-2 text-slate-500 transition-colors hover:text-[var(--primary)] cursor-pointer"
                    title="تعديل التاريخ أو الاسم">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setHolidayToDeleteId(holiday.id)}
                    className="p-2 text-slate-500 transition-colors hover:text-rose-600 cursor-pointer"
                    title="حذف">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
        </section>
      )}

      {activeTab === "evaluation" && (
        <section aria-label="التقويم المستمر" className="space-y-6">
      {/* Section 3: التقويم المستمر — قواعد التقويم المستمر */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />
              <span>التقويم المستمر</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              قواعد التقويم المستمر: السلوك (5) | الغيابات (5) | تنظيم الكراس
              (5) | المشاركة (5)
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[var(--primary-soft)] border border-[var(--primary)]/30 text-[var(--accent-navy)] text-xs font-bold w-fit">
            <span>المجموع الإجمالي:</span>
            <span className="font-mono text-sm">20 / 20</span>
          </div>
        </div>

        {/* The 4 Criteria Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {/* 1. السلوك (5) */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">
                1. السلوك
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-bold text-[var(--primary)]">
                5 / 5
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              الانضباط واحترام الحرم المدرسي. في حالة الشغب ينقص من السلوك.
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                خصم الشغب الواحد (نقاط):
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="5"
                value={
                  calendarSettings.evaluationRules.disruptionDeduction ?? 0.5
                }
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    evaluationRules: {
                      ...prev.evaluationRules,
                      disruptionDeduction: parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                افتراضياً 0.5 نقطة لكل مخالفة شغب
              </span>
            </div>
          </div>

          {/* 2. الغيابات (5) */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">
                2. الغيابات
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-bold text-[var(--primary)]">
                5 / 5
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              المواظبة والحضور. في حالة الغياب غير المبرر يُخصم آلياً.
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                خصم الغياب غير المبرر (نقاط):
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="5"
                value={
                  calendarSettings.evaluationRules.unexcusedAbsenceDeduction ??
                  0.5
                }
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    evaluationRules: {
                      ...prev.evaluationRules,
                      unexcusedAbsenceDeduction:
                        parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                افتراضياً 0.5 نقطة لكل غياب غير مبرر (مثل بقية قواعد الخصم)
              </span>
            </div>
          </div>

          {/* 3. تنظيم الكراس (5) */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">
                3. تنظيم الكراس
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-bold text-[var(--primary)]">
                5 / 5
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              كتابة الدروس والعناية بالدفتر. في حالة عدم كتابة الدروس ينقص من
              الكراس.
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                خصم عدم كتابة الدرس (نقاط):
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="5"
                value={
                  calendarSettings.evaluationRules.unwrittenLessonDeduction ??
                  1.0
                }
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    evaluationRules: {
                      ...prev.evaluationRules,
                      unwrittenLessonDeduction: parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                افتراضياً 0.5 نقطة لكل درس لم يُكتب
              </span>
            </div>
          </div>

          {/* 4. المشاركة (5) */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">
                4. المشاركة
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-bold text-[var(--primary)]">
                5 / 5
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              التفاعل الصفي والإجابة والتحضير. تضاف كنقاط إضافية ولا يخصم
              لعدمها.
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                علاوة المشاركة الإيجابية (نقاط):
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="5"
                value={
                  calendarSettings.evaluationRules.participationBonus ?? 0.5
                }
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    evaluationRules: {
                      ...prev.evaluationRules,
                      participationBonus: parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                افتراضياً 0.5 نقطة لكل مشاركة إيجابية
              </span>
            </div>
          </div>
        </div>

        {/* Options */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <input
            type="checkbox"
            id="guidance-alerts"
            checked={calendarSettings.evaluationRules.showGuidanceAlerts}
            onChange={(e) =>
              setCalendarSettings((prev) => ({
                ...prev,
                evaluationRules: {
                  ...prev.evaluationRules,
                  showGuidanceAlerts: e.target.checked,
                },
              }))
            }
            className="w-4 h-4 text-[var(--primary)] rounded cursor-pointer"
          />
          <label
            htmlFor="guidance-alerts"
            className="text-xs font-bold text-slate-700 cursor-pointer">
            إظهار تنبيهات الإرشاد البيداغوجي والتقديرات تلقائياً عند رصد النقاط
          </label>
        </div>
      </div>
        </section>
      )}

      {activeTab === "backup" && (
        <section aria-label="النسخ الاحتياطي" className="space-y-6">
          <SupabaseReadinessCard onSchemaReady={() => void refreshSyncStatus()} />
      {/* Section: حالة المزامنة */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-[var(--primary)]" />
            حالة المزامنة مع الخادم
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            كل تعديلاتك تُحفظ محلياً أولاً ثم تُرفع تلقائياً إلى الخادم، ويظهر هنا ما تبقّى.
          </p>
        </div>

        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl border p-4 space-y-1 ${
            statusSummary.tone === "ok"
              ? "border-emerald-200 bg-emerald-50/60"
              : statusSummary.tone === "busy"
                ? "border-sky-200 bg-sky-50/60"
                : statusSummary.tone === "warn"
                  ? "border-amber-200 bg-amber-50/60"
                  : "border-rose-200 bg-rose-50/60"
          }`}>
          <p className="text-sm font-bold text-slate-900">{statusSummary.label}</p>
          <p className="text-xs text-slate-600">{statusSummary.detail}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
            <div>
              <dt className="text-slate-500">عمليات بانتظار الرفع</dt>
              <dd className="font-bold text-slate-800">{pendingCount}</dd>
            </div>
            <div>
              <dt className="text-slate-500">آخر تأكيد من الخادم</dt>
              <dd className="font-bold text-slate-800">{lastSyncedAt ? formatAge(lastSyncedAt, now) : "لا يوجد بعد"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">معرّف هذا الجهاز</dt>
              <dd className="font-bold text-slate-800" title={syncDeviceId ?? undefined}>
                {shortDeviceId(syncDeviceId)}
              </dd>
            </div>
          </dl>
          <p className="text-[11px] text-slate-500 pt-1">{pendingSummary(pendingCount)}</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => void handleSyncNow()}
            disabled={syncNowBusy}
            className="flex items-center gap-2 px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-xs font-bold transition-opacity shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            <RefreshCw className={`w-4 h-4 ${syncNowBusy ? "animate-spin" : ""}`} />
            <span>{syncNowBusy ? "جارٍ المزامنة..." : "مزامنة الآن"}</span>
          </button>
          <button
            onClick={() => setShowResyncConfirm(true)}
            disabled={resyncBusy}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer disabled:opacity-50">
            <CloudDownload className="w-4 h-4 text-[var(--primary)]" />
            <span>إعادة تحميل كل البيانات من الخادم</span>
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          إعادة التحميل تلغي العمليات التي لم تُرفع بعد وتستبدلها بنسخة الخادم. استعملها فقط إذا
          لاحظت اختلافاً بين جهازين.
        </p>
      </div>

      {/* Section 4: النسخ الاحتياطي واستعادة البيانات */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Download className="w-4 h-4 text-[var(--primary)]" />
            النسخ الاحتياطي وحفظ البيانات دون إنترنت
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            تطبيق «معين» يعمل بنمط Offline-First ويخزن بياناتك محلياً في متصفحك.
            يمكنك تنزيل نسخة احتياطية لنقلها لجهاز آخر في أي وقت.
          </p>
        </div>

        {nudgeVisible && (
          <div
            role="status"
            className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${
              nudge.level === "overdue" ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60"
            }`}>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold">تذكير: </span>
              {nudge.message}
            </p>
            <button
              onClick={handleDismissNudge}
              className="shrink-0 text-[11px] font-bold text-slate-600 hover:text-slate-900 underline">
              تذكيري لاحقاً
            </button>
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          {nudge.level === "ok" ? nudge.message : "يُنصح بتصدير نسخة احتياطية كل أسبوع."}
        </p>

        <div className="flex items-center gap-3 pt-2 flex-wrap">
          <button
            onClick={handleExportJSON}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer">
            <Download className="w-4 h-4 text-[var(--primary)]" />
            <span>تصدير نسخة احتياطية (ملف JSON)</span>
          </button>

          <button
            onClick={() => void handleExportPdfArchive()}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer">
            <Download className="w-4 h-4 text-[var(--primary)]" />
            <span>تصدير ملفات PDF (ZIP)</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportJSON}
            accept=".json"
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer">
            <Upload className="w-4 h-4 text-[var(--primary)]" />
            <span>استعادة من نسخة احتياطية</span>
          </button>

          <input
            type="file"
            ref={pdfArchiveInputRef}
            onChange={handleImportPdfArchive}
            accept=".zip,application/zip"
            className="hidden"
          />

          <button
            onClick={() => pdfArchiveInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer">
            <Upload className="w-4 h-4 text-[var(--primary)]" />
            <span>استعادة ملفات PDF</span>
          </button>
        </div>
      </div>

      {/* Re-sync from cloud: the escape hatch when local and server data disagree */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <CloudDownload className="w-4 h-4 text-[var(--primary)]" />
            إعادة المزامنة الكاملة من السحابة
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            يعتمد التطبيق على الخادم السحابي كمصدر رسمي للبيانات. استخدم هذا الإجراء إذا لاحظت
            اختلافاً بين هذا الجهاز وحسابك على جهاز آخر؛ سيتم تجاهل أي تغييرات محلية لم تُزامن بعد
            وإعادة تحميل مساحة العمل كما هي في السحابة.
          </p>
        </div>
        <button
          onClick={() => setShowResyncConfirm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer">
          <CloudDownload className="w-4 h-4 text-[var(--primary)]" />
          <span>إعادة التحميل من السحابة</span>
        </button>
      </div>

      {/* Section: Danger Zone (منطقة العمليات الحساسة) */}
      <div className="border border-rose-200 bg-rose-50/70 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-rose-900">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
          <span>منطقة العمليات الحساسة (Danger Zone)</span>
        </div>
        <p className="text-xs text-rose-700 leading-relaxed font-medium">
          هذا الإجراء يقوم بحذف جميع بيانات الأقسام، والتلاميذ، والغيابات، والعلامات بشكل نهائي، مع الإبقاء على ملفك المهني وجدول التوقيت والمذكرات البيداغوجية.
        </p>
        <button
          onClick={handleClearClassesData}
          className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer text-xs"
          title="يحذف فقط ما يتعلق بالأقسام، التلاميذ، الغيابات والعلامات مع الاحتفاظ بحسابك وجدول التوقيت">
          <RotateCcw className="w-4 h-4" />
          <span>إعادة تعيين الأقسام والتلاميذ...</span>
        </button>
      </div>
    </section>
  )}

      {/* Add / Edit Holiday Modal */}
      {isHolidayModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl border border-slate-200 text-right space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">
              {editingHolidayId ? "تعديل عطلة / يوم مستثنى" : "إضافة عطلة / يوم مستثنى"}
            </h3>

            <form onSubmit={handleSaveHoliday} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  اسم العطلة أو السبب
                </label>
                <input
                  type="text"
                  required
                  value={holidayName}
                  onChange={(e) => setHolidayName(e.target.value)}
                  placeholder="مثال: اختبارات الفصل الأول / ندوة تربوية"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  النوع
                </label>
                <select
                  value={holidayType}
                  onChange={(e) => setHolidayType(e.target.value as HolidayType)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900">
                  <option value="national">مناسبة وطنية</option>
                  <option value="religious">مناسبة دينية</option>
                  <option value="term">عطلة فصلية / مدرسية</option>
                  <option value="exam">أيام اختبارات / فروض</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الأقسام المعنية</label>
                <select value={holidayScope} onChange={e => setHolidayScope(e.target.value as typeof holidayScope)} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900">
                  <option value="all">جميع المستويات</option>
                  <option value="3AS">السنة الثالثة ثانوي فقط</option>
                  <option value="1AS2AS">السنتان الأولى والثانية ثانوي</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  التحديد من المفكرة (calendar)
                </label>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  <button
                    type="button"
                    onClick={() => setHolidayMode("day")}
                    className={`min-h-9 px-2 rounded-lg font-bold transition-colors cursor-pointer ${
                      holidayMode === "day"
                        ? "bg-[var(--primary)] text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}>
                    يوم واحد
                  </button>
                  <button
                    type="button"
                    onClick={() => setHolidayMode("range")}
                    className={`min-h-9 px-2 rounded-lg font-bold transition-colors cursor-pointer ${
                      holidayMode === "range"
                        ? "bg-[var(--primary)] text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}>
                    فترة (من - إلى)
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-500 block mb-0.5">
                      {holidayMode === "day" ? "تاريخ اليوم" : "من تاريخ"}
                    </span>
                    <input
                      type="date"
                      required
                      value={holidayStart}
                      onChange={(e) => setHolidayStart(e.target.value)}
                      className="w-full px-2 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-mono"
                    />
                  </div>
                  {holidayMode === "range" && (
                    <div>
                      <span className="text-[10px] text-slate-500 block mb-0.5">إلى تاريخ</span>
                      <input
                        type="date"
                        required
                        min={holidayStart || undefined}
                        value={holidayEnd}
                        onChange={(e) => setHolidayEnd(e.target.value)}
                        className="w-full px-2 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-mono"
                      />
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                  تُستثنى هذه الأيام آلياً من الحصص: لا تُقترح حصة في دفتر النصوص ولا في
                  حصص اليوم، ويمكن توثيقها كحصة ملغاة بالسبب نفسه.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsHolidayModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 font-bold cursor-pointer">
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[var(--primary)] text-white font-bold rounded-xl hover:bg-[var(--primary-hover)] cursor-pointer">
                  {editingHolidayId ? "حفظ التعديل" : "إضافة"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Modals */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-rose-50 border-b border-rose-100 p-4 flex items-center gap-3">
              <div className="p-2 bg-rose-100 text-rose-700 rounded-full">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-rose-900">
                إعادة تعيين الأقسام
              </h3>
            </div>
            <div className="space-y-4 p-5 text-sm text-slate-700 leading-relaxed font-bold">
              هل أنت متأكد؟ سيتم مسح جميع بيانات الأقسام، والتلاميذ، والغيابات،
              والعلامات بشكل نهائي.
              <span className="text-slate-500 font-normal">
                ملاحظة: سيتم الإبقاء على ملفك المهني، وإعدادات التطبيق،
                والمذكرات والتحاضير البيداغوجية.
              </span>
              <div className="space-y-1.5">
                <label htmlFor="roster-reset-confirmation" className="block text-xs font-bold text-rose-800">
                  اكتب «{RESET_CONFIRMATION}» للمتابعة
                </label>
                <input
                  id="roster-reset-confirmation"
                  value={resetConfirmationText}
                  onChange={(event) => setResetConfirmationText(event.target.value)}
                  className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--danger)]"
                  autoComplete="off"
                  dir="rtl"
                />
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowResetConfirm(false);
                  setResetConfirmationText("");
                }}
                className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition-colors text-sm cursor-pointer">
                إلغاء
              </button>
              <button
                onClick={confirmClearClassesData}
                disabled={resetConfirmationText.trim() !== RESET_CONFIRMATION}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50 text-white font-bold transition-colors text-sm shadow-sm cursor-pointer">
                نعم، مسح البيانات نهائياً
              </button>
            </div>
          </div>
        </div>
      )}

      {showHolidaysConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-amber-50 border-b border-amber-100 p-4 flex items-center gap-3">
              <div className="p-2 bg-amber-100 text-amber-700 rounded-full">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-amber-900">
                استعادة قائمة العطل
              </h3>
            </div>
            <div className="p-5 text-sm text-slate-700 leading-relaxed font-bold">
              هل ترغب في استعادة قائمة العطل الرسمية المعتمدة لوزارة التربية
              الوطنية؟ سيتم إلغاء أي تعديلات قمت بها.
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowHolidaysConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition-colors text-sm cursor-pointer">
                إلغاء
              </button>
              <button
                onClick={confirmResetHolidays}
                className="px-4 py-2 rounded-xl bg-[var(--accent-gold)] hover:bg-[var(--accent-gold-hover)] text-[var(--accent-navy)] font-bold transition-colors text-sm shadow-sm cursor-pointer">
                نعم، استعادة
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessMsg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-[var(--primary)] text-white px-6 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-bold text-sm">{showSuccessMsg}</span>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(holidayToDeleteId)}
        title="تأكيد حذف العطلة"
        message="هل أنت متأكد من حذف هذه العطلة من الرزنامة؟"
        onCancel={() => setHolidayToDeleteId(null)}
        onConfirm={() => {
          if (holidayToDeleteId) {
            handleDeleteHoliday(holidayToDeleteId);
          }
        }}
      />
      <ConfirmDialog
        isOpen={showResyncConfirm}
        title="إعادة المزامنة من السحابة"
        message="سيتم تجاهل التغييرات المحلية غير المؤكدة (إن وجدت) وإعادة تحميل مساحة العمل من الخادم السحابي. هل تريد المتابعة؟"
        onCancel={() => setShowResyncConfirm(false)}
        onConfirm={() => void handleResyncFromCloud()}
      />
      <ConfirmDialog
        isOpen={Boolean(pendingImportedState)}
        title="استبدال بيانات التطبيق"
        message="سيتم استبدال الحالة الحالية بالنسخة المستوردة، وحذف عمليات المزامنة المحلية القديمة حتى لا تعود بيانات سابقة فوق النسخة الجديدة. ملفات PDF المحلية تحتاج إلى استعادة ملف ZIP بشكل منفصل."
        onCancel={() => setPendingImportedState(null)}
        onConfirm={() => void confirmImportJSON()}
      />
    </div>
  );
};
