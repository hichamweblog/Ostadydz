'use client';

import { showToast } from '@/components/Toast';
import { useAppState } from '@/hooks/app-state-context';
import { binaryKeyForPdf, deleteBinaryFile, listStoredPdfUnitIds, loadPdfBinary, savePdfBinary } from '@/lib/binary-storage';
import { offlinePdfAvailability } from '@/lib/sync-status';
import { deleteTeacherMemorandum, getMemorandumUrl, uploadTeacherMemorandum } from '@/lib/supabase/memoranda-storage';
import { cancelMemorandaUpload } from '@/lib/supabase/memoranda-outbox';
import { ConfirmDialog } from './ConfirmDialog';
import { SubjectSwitcherBar } from './SubjectSwitcherBar';
import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  CurriculumUnit,
  getSubjectDisplayName,
  getWeeklyHours,
  GradeLevel,
} from '@/lib/types';
import {
  buildStarterUnitsForTrack,
  OFFICIAL_LEVELS,
  getMergedCurriculumUnits,
  loadAllCurriculum,
} from '@/lib/curriculum-data';
import { selectEffectiveSubjectId } from '@/lib/state-selectors';
import { resolveLevelAndStream } from '@/lib/education';
import { exportUnitToWordDoc } from '@/lib/doc-exporter';
import {AlertTriangle, 
  BookOpen,
  FileText,
  Upload,
  Download,
  Search,
  Trash2,
  ExternalLink,
  FileUp,
  Layers,
  Compass,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  AlertCircle,
  Calendar,
  Clock,
  Award,
  BookMarked,
  Sparkles,
  FileDown,
  Eye
} from 'lucide-react';

interface LessonPreparationProps {
  initialUnit?: CurriculumUnit | null;
  initialTab?: 'card' | 'pdf' | 'bank';
}

export const LessonPreparation: React.FC<LessonPreparationProps> = ({
  initialUnit,
  initialTab
}) => {
  const { state, updateStateAndWait, ownerId } = useAppState();
  const activeClass = state.classes.find(c => c.id === state.activeClassId);
  const activeSubjectId = selectEffectiveSubjectId(state, activeClass);
  const activeSubjectTitle = getSubjectDisplayName(activeSubjectId);

  const allUnits = useMemo(
    () => getMergedCurriculumUnits(state.customUnits, activeSubjectId),
    [state.customUnits, activeSubjectId]
  );
  const [curriculumLoaded, setCurriculumLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadAllCurriculum().then(() => {
      if (!cancelled) setCurriculumLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadedUnits = useMemo(
    () => (curriculumLoaded ? getMergedCurriculumUnits(state.customUnits, activeSubjectId) : allUnits),
    [allUnits, curriculumLoaded, state.customUnits, activeSubjectId]
  );

  // Selected level & unit state
  const [selectedLevel, setSelectedLevel] = useState<GradeLevel>(
    initialUnit?.level || activeClass?.level || '1AS_ARTS' );

  const unitsForLevel = useMemo(
    () => loadedUnits.filter(u => u.level === selectedLevel),
    [loadedUnits, selectedLevel]
  );

  const [selectedUnitId, setSelectedUnitId] = useState<string>(
    initialUnit?.id && initialUnit.level === selectedLevel
      ? initialUnit.id
      : unitsForLevel[0]?.id || '' );

  const effectiveSelectedUnitId = unitsForLevel.some(unit => unit.id === selectedUnitId)
    ? selectedUnitId
    : unitsForLevel[0]?.id || '';

  // Active view tab: 'card' (official ministerial card) | 'pdf' (embedded PDF) | 'bank' (reference bank)
  const [activeTab, setActiveTab] = useState<'card' | 'pdf' | 'bank'>(initialTab || 'card');
  const [searchQuery, setSearchQuery] = useState('');

  // Sync when prop changes
  useEffect(() => {
    if (initialTab) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(initialTab);
    }
  }, [initialTab, initialUnit]);
  const [pdfUploadNotice, setPdfUploadNotice] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<{ key: string; url: string } | undefined>();
  const [cloudPdfData, setCloudPdfData] = useState<{ unitId: string; url: string } | undefined>();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [offlineSaving, setOfflineSaving] = useState(false);
  const [storedOfflineUnitIds, setStoredOfflineUnitIds] = useState<string[]>([]);

  // Current selected unit
  const currentUnit: CurriculumUnit | undefined =
    unitsForLevel.find(u => u.id === effectiveSelectedUnitId) || unitsForLevel[0];

  // Current attached PDF: local bundled memorandum or teacher override.
  const attachedPdf = currentUnit ? state.unitPdfFiles?.[currentUnit.id] : undefined;
  const scopedPdfKey = currentUnit ? binaryKeyForPdf(currentUnit.id, ownerId) : undefined;
  const localPdfUrl =
    attachedPdf?.fileStorageKey && pdfData && (pdfData.key === attachedPdf.fileStorageKey || pdfData.key === scopedPdfKey)
      ? pdfData.url
      : attachedPdf?.fileDataUrl;
  const cloudPdfUrl = (cloudPdfData && currentUnit && cloudPdfData.unitId === currentUnit.id) ? cloudPdfData.url : undefined;
  const isLocalPdfPending = Boolean(attachedPdf?.fileStorageKey && !localPdfUrl);
  const offlineAvailability = offlinePdfAvailability(
    Object.keys(state.unitPdfFiles || {}),
    storedOfflineUnitIds,
  );
  const currentUnitStoredOffline = Boolean(currentUnit && storedOfflineUnitIds.includes(currentUnit.id));
  const activePdfUrl = isLocalPdfPending
    ? null
    : localPdfUrl ||
      attachedPdf?.fileUrl ||
      cloudPdfUrl ||
      currentUnit?.pdfUrl ||
      null;
  const directViewUrl = localPdfUrl || attachedPdf?.fileUrl || cloudPdfUrl || activePdfUrl;
  const directDownloadUrl = localPdfUrl || currentUnit?.pdfUrl;

  // Which attached memoranda are actually stored on this device (offline availability).
  useEffect(() => {
    let cancelled = false;
    void listStoredPdfUnitIds(ownerId).then((unitIds) => {
      if (!cancelled) setStoredOfflineUnitIds(unitIds);
    });
    return () => {
      cancelled = true;
    };
  }, [ownerId, attachedPdf?.fileStorageKey]);

  useEffect(() => {
    let cancelled = false;
    const unitId = currentUnit?.id;
    if (!unitId || !attachedPdf?.fileStorageKey) return;
    // Reads the owner-scoped key first (migrating a legacy unscoped entry if needed).
    void loadPdfBinary(unitId, ownerId).then(value => {
      if (!cancelled && value) setPdfData({ key: binaryKeyForPdf(unitId, ownerId), url: value });
    });
    return () => {
      cancelled = true;
    };
  }, [attachedPdf?.fileStorageKey, currentUnit?.id, ownerId]);

  useEffect(() => {
    let cancelled = false;
    const unitId = currentUnit?.id;
    if (!unitId) return;
    void getMemorandumUrl(unitId).then(url => {
      if (!cancelled && url) setCloudPdfData({ unitId, url });
    });
    return () => {
      cancelled = true;
    };
  }, [currentUnit?.id]);

  // Change level
  const handleSelectLevel = (lvl: GradeLevel) => {
    setSelectedLevel(lvl);
    const firstUnit = loadedUnits.find(u => u.level === lvl);
    if (firstUnit) {
      setSelectedUnitId(firstUnit.id);
    }
  };

  // Change unit
  const handleSelectUnit = (unitId: string) => {
    setSelectedUnitId(unitId);
    setPdfUploadNotice(null);
  };

  // Previous & Next unit navigation
  const currentIndex = unitsForLevel.findIndex(u => u.id === effectiveSelectedUnitId);
  const handlePrevUnit = () => {
    if (currentIndex > 0) {
      setSelectedUnitId(unitsForLevel[currentIndex - 1].id);
    }
  };
  const handleNextUnit = () => {
    if (currentIndex < unitsForLevel.length - 1) {
      setSelectedUnitId(unitsForLevel[currentIndex + 1].id);
    }
  };

  // Handle PDF file upload via file picker or drop
  const handleFileUpload = (file: File) => {
    if (!currentUnit) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      showToast('يرجى اختيار ملف بصيغة PDF فقط (.pdf)', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('حجم ملف PDF كبير جداً. الحد الأقصى المسموح هو 10 ميغابايت.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const fileName = file.name;
      const storageKey = binaryKeyForPdf(currentUnit.id, ownerId);

      try {
        await savePdfBinary(currentUnit.id, dataUrl, ownerId);
        setPdfData({ key: storageKey, url: dataUrl });
        const { storagePath } = await uploadTeacherMemorandum(currentUnit.id, file);
        await updateStateAndWait(prev => ({
          ...prev,
          unitPdfFiles: {
            ...(prev.unitPdfFiles || {}),
            [currentUnit.id]: {
              fileName,
              fileStorageKey: storageKey,
              uploadedAt: new Date().toISOString().split('T')[0],
              cloudStoragePath: storagePath,
            }
          }
        }));
        const url = await getMemorandumUrl(currentUnit.id);
        if (url) setCloudPdfData({ unitId: currentUnit.id, url });
        setPdfUploadNotice(`تم تأكيد إرفاق ملف المذكرة «${fileName}» في السحابة.`);
        setActiveTab('pdf');
        setTimeout(() => setPdfUploadNotice(null), 4000);
      } catch (error) {
        console.error('PDF upload failed:', error);
        showToast(error instanceof Error ? error.message : 'تعذر تأكيد حفظ ملف PDF في السحابة.', 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  /**
   * "Preserve offline PDFs with intent": pull the cloud copy into this device so the
   * memorandum opens in class without signal, instead of relying on the signed URL.
   */
  const handleSaveOfflineCopy = async () => {
    if (!currentUnit) return;
    const sourceUrl = cloudPdfUrl || attachedPdf?.fileUrl || currentUnit.pdfUrl;
    if (!sourceUrl) {
      showToast('لا يوجد ملف مذكرة مرفوع لهذه الوحدة بعد.', 'error');
      return;
    }
    setOfflineSaving(true);
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error('تعذر تنزيل الملف.');
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('تعذر قراءة الملف.'));
        reader.readAsDataURL(blob);
      });
      const key = await savePdfBinary(currentUnit.id, dataUrl, ownerId);
      setPdfData({ key, url: dataUrl });
      setStoredOfflineUnitIds((current) => (current.includes(currentUnit.id) ? current : [...current, currentUnit.id]));
      setPdfUploadNotice('تم حفظ نسخة على هذا الجهاز. ستعمل المذكرة دون إنترنت.');
      setTimeout(() => setPdfUploadNotice(null), 4000);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ نسخة دون إنترنت.', 'error');
    } finally {
      setOfflineSaving(false);
    }
  };

  // Delete attached PDF
  const handleDeletePdf = async () => {
    if (!currentUnit || !deleteConfirmId) return;
    setDeleteConfirmId(null);
    try {
      await cancelMemorandaUpload(ownerId ?? 'anon', currentUnit.id);
      if (attachedPdf?.cloudStoragePath) {
        await deleteTeacherMemorandum(attachedPdf.cloudStoragePath);
      }
      await updateStateAndWait(prev => {
      const nextPdfs = { ...(prev.unitPdfFiles || {}) };
      delete nextPdfs[currentUnit.id];
      return {
        ...prev,
        unitPdfFiles: nextPdfs
      };
      });
    } catch (error) {
      console.error('PDF delete failed:', error);
      showToast(error instanceof Error ? error.message : 'تعذر حذف ملف PDF من السحابة.', 'error');
      return;
    }
    if (attachedPdf?.fileStorageKey) {
      void deleteBinaryFile(attachedPdf.fileStorageKey);
    }
    setPdfData(undefined);
    setPdfUploadNotice('تمت إزالة ملف الـ PDF من هذه الوحدة.');
    setTimeout(() => setPdfUploadNotice(null), 3000);
  };

  // Word (.docx) Export of official lesson card
  const handleExportWord = () => {
    if (!currentUnit) return;
    exportUnitToWordDoc(currentUnit, state.profile);
  };

  // Filtered units in Reference Bank
  const filteredBankUnits = useMemo(() => {
    if (!searchQuery.trim()) return unitsForLevel;
    const q = searchQuery.toLowerCase();
    return unitsForLevel.filter(
      u =>
        u.title.toLowerCase().includes(q) ||
        u.domain.toLowerCase().includes(q) ||
        (u.learningObjective && u.learningObjective.toLowerCase().includes(q)) ||
        (u.targetedResources && u.targetedResources.some(r => r.toLowerCase().includes(q))) ||
        (u.referenceTexts && u.referenceTexts.some(t => t.toLowerCase().includes(q)))
    );
  }, [unitsForLevel, searchQuery]);

  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="lesson-preparation-container">
      {/* Multi-Subject Switcher */}
      <SubjectSwitcherBar classRoom={activeClass} allowAllFallback />

      {/* Top Header & Level Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          {OFFICIAL_LEVELS.map(lvl => {
            const isSelected = selectedLevel === lvl.id;
            const hrs = getWeeklyHours(lvl.id, {
              subjectId: activeSubjectId,
              overrides: state.educationOverrides,
            });
            return (
              <button
                key={lvl.id}
                onClick={() => handleSelectLevel(lvl.id)}
                className={`min-h-9 px-3.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--text-primary)] text-white border-[var(--text-primary)] shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900' }`}
              >
                <span>{lvl.id === '1AS_ARTS' ? `1AS آداب (${hrs} سا)` : lvl.id === '1AS_SCIENCE' ? `1AS علوم (${hrs} سا)` : lvl.id === '2AS' ? `2AS ثانية (${hrs} سا)` : `3AS بكالوريا (${hrs} سا)`}</span>
              </button>
            );
          })}
        </div>

        {unitsForLevel.length === 0 && activeSubjectId && activeSubjectId !== 'ISLAMIC' && (
          <button
            type="button"
            onClick={async () => {
              const resolved = resolveLevelAndStream({
                levelCode: activeClass?.levelCode,
                streamId: activeClass?.streamId,
                legacyGradeLevel: selectedLevel,
              });
              const starterUnits = buildStarterUnitsForTrack({
                subjectId: activeSubjectId,
                levelCode: resolved.levelCode,
                streamId: resolved.streamId,
                legacyLevel: selectedLevel,
              });
              await updateStateAndWait(prev => ({
                ...prev,
                customUnits: [
                  ...prev.customUnits.filter(
                    u => !(u.subjectId === activeSubjectId && u.level === selectedLevel)
                  ),
                  ...starterUnits,
                ],
              }));
              showToast(`تم توليد وحدات ومذكرات ابتدائية لمادة ${activeSubjectTitle} بنجاح!`, 'success');
            }}
            className="min-h-10 px-4 py-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>توليد وحدات لمادة {activeSubjectTitle}</span>
          </button>
        )}
      </div>

      {/* Main Unit Selection & Navigation Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <div className="flex flex-col gap-3">
          {/* Row 1: Label + Prev/Next navigation */}
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-[var(--primary)]" />
              <span>الوحدة التعلمية:</span>
            </label>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handlePrevUnit}
                disabled={currentIndex <= 0}
                className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer" title="الوحدة السابقة" >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextUnit}
                disabled={currentIndex >= unitsForLevel.length - 1}
                className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer" title="الوحدة التالية" >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Row 2: Full-width unit select dropdown */}
          <select
            value={effectiveSelectedUnitId}
            onChange={e => handleSelectUnit(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 focus:outline-[var(--text-primary)] focus:ring-1 focus:ring-[var(--text-primary)] cursor-pointer" >
            {unitsForLevel.map(unit => {
              const hasPdf = Boolean(state.unitPdfFiles?.[unit.id] || unit.pdfUrl);
              return (
                <option key={unit.id} value={unit.id}>
                  الوحدة {unit.unitNumber}: {unit.title} ({unit.hourlyVolume} سا) {hasPdf ? '— 📄 [مدمجة]' : ''}
                </option>
              );
            })}
          </select>

          {/* Tab Navigation: Official Card vs Embedded PDF vs Bank */}
          <div className="flex items-center gap-2 flex-wrap shrink-0 w-full sm:w-auto">
            <div role="tablist" className="flex flex-col sm:flex-row items-stretch sm:items-center w-full sm:w-auto gap-2">
              <button
                role="tab" aria-selected={activeTab === 'card'}
                onClick={() => setActiveTab('card')}
                className={`flex items-center justify-center w-full sm:w-auto gap-1.5 min-h-9 px-3.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'card' ? 'bg-[var(--primary-soft)] text-[var(--primary)] border-[var(--primary)]/40 shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900' }`}
              >
                <FileText className="w-3.5 h-3.5 text-[var(--primary)]" />
                <span>البطاقة</span>
              </button>

              <button
                role="tab" aria-selected={activeTab === 'pdf'}
                onClick={() => setActiveTab('pdf')}
                className={`flex items-center justify-center w-full sm:w-auto gap-1.5 min-h-9 px-3.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer relative ${
                  activeTab === 'pdf' ? 'bg-slate-900 text-white border-slate-900 shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900' }`}
              >
                <Upload className="w-3.5 h-3.5 text-blue-600" />
                <span>المذكرة</span>
                {activePdfUrl && (
                  <span className="w-2 h-2 rounded-full bg-[var(--primary)] animate-pulse" />
                )}
              </button>

              <button
                role="tab" aria-selected={activeTab === 'bank'}
                onClick={() => setActiveTab('bank')}
                className={`flex items-center justify-center w-full sm:w-auto gap-1.5 min-h-9 px-3.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'bank' ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900' }`}
              >
                <BookMarked className="w-3.5 h-3.5 text-gold" />
                <span>الفهرس</span>
              </button>
            </div>

            {/* Word .docx Export Action */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={handleExportWord}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--text-primary)] text-white hover:bg-[var(--primary-hover)] text-xs font-bold transition-all shadow-xs cursor-pointer" title="تصدير المذكرة كملف Word (.docx) جاهز للتحرير والطباعة" >
                <Download className="w-3.5 h-3.5 text-amber-300" />
                <span>تصدير Word (.docx)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Offline memorandum status + one-tap download */}
        <div className="mt-3 p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-slate-600 flex items-center gap-1.5">
            {offlineAvailability.complete ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>
                  كل المذكرات المرفقة ({offlineAvailability.available.length}) محفوظة على هذا
                  الجهاز وتعمل دون إنترنت.
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  {offlineAvailability.missing.length} من المذكرات المرفقة غير محفوظة على هذا
                  الجهاز ولن تُفتح دون إنترنت.
                </span>
              </>
            )}
          </p>
          {currentUnit && !currentUnitStoredOffline && (cloudPdfUrl || currentUnit.pdfUrl || attachedPdf?.fileUrl) && (
            <button
              onClick={() => void handleSaveOfflineCopy()}
              disabled={offlineSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer disabled:opacity-50">
              <Download className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>{offlineSaving ? 'جارٍ الحفظ…' : 'حفظ نسخة للعمل دون إنترنت'}</span>
            </button>
          )}
          {currentUnit && currentUnitStoredOffline && (
            <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              محفوظة على الجهاز
            </span>
          )}
        </div>

        {/* Notice alert */}
        {pdfUploadNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-[var(--primary-soft)] border border-[var(--primary)]/20 text-xs text-[var(--primary)] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0" />
            <span>{pdfUploadNotice}</span>
          </div>
        )}
      </div>

      {/* Active Unit Meta Ribbon */}
      {currentUnit && (
        <div className="bg-gradient-to-r from-[var(--text-primary)] to-[var(--primary-hover)] text-white rounded-xl p-5 shadow-sm mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap text-xs text-amber-300 font-bold">
                <span className="px-2 py-0.5 rounded-md bg-white/10 border border-white/20">
                  {currentUnit.sectionName}
                </span>
                <span>•</span>
                <span className="px-2 py-0.5 rounded-md bg-white/10 border border-white/20">
                  {currentUnit.domain}
                </span>
              </div>
              <h1 className="text-lg font-bold font-serif">
                الوحدة {currentUnit.unitNumber}: {currentUnit.title}
              </h1>
            </div>

            {/* Time & Hours Volume Badge */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/10 backdrop-blur-xs border border-white/20 px-4 py-2 rounded-xl text-center">
                <div className="text-[11px] text-amber-200 flex items-center justify-center gap-1 font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  <span>الزمن والحجم الساعي</span>
                </div>
                <div className="text-lg font-bold text-white">
                  {currentUnit.hourlyVolume} سا
                </div>
                <div className="text-[10px] text-slate-300">
                  {currentUnit.level === '1AS_SCIENCE' ? '1 سا / أسبوع' : '2 سا / أسبوع'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 1: OFFICIAL PEDAGOGICAL CARD (البطاقة) */}
      {/* ============================================================== */}
      {activeTab === 'card' && currentUnit && (
        <div className="space-y-6">
          {/* Section 1: الهدف التعلمي (Learning Objective) */}
          <div className="bg-white rounded-xl border-2 border-[var(--primary)]/30 p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-3">
              <span className="p-1.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
                <Compass className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-bold text-slate-900">
                1. الهدف التعلمي
              </h3>
            </div>
            <div className="p-4 rounded-xl bg-[var(--primary-soft)]/70 border border-[var(--primary)]/20 text-emerald-950 font-serif text-sm leading-relaxed font-bold">
              {currentUnit.learningObjective ||
                currentUnit.targetedCompetence ||
                'يتعرف المتعلم على المفاهيم المركزية للوحدة، ويستخلص الأحكام والفوائد الشرعية، ويتمثل قيم الدرس في سلوكه اليومي.'}
            </div>
          </div>

          {/* Section 2: الموارد المستهدفة (Targeted Resources / المفاهيم والعناصر) */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-3">
              <span className="p-1.5 rounded-lg bg-blue-100 text-navy">
                <Layers className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-bold text-slate-900">
                2. الموارد المستهدفة (العناصر المفاهيمية وبناء التعلمات)
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(currentUnit.targetedResources || currentUnit.learningObjectives || []).map((resource, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 hover:bg-slate-100/80 transition-colors" >
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--text-primary)] text-white text-xs font-bold shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="text-sm leading-7 font-medium text-slate-800 font-serif">
                    {resource}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: آلية تنفيذ التعلمات (Learning Implementation Mechanisms) */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-3">
              <span className="p-1.5 rounded-lg bg-amber-100 text-amber-800">
                <Compass className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-bold text-slate-900">
                3. آلية تنفيذ التعلمات (خطوات الإنجاز والأنشطة البيداغوجية)
              </h3>
            </div>

            <div className="space-y-3">
              {(currentUnit.implementationMechanisms || []).map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50/40 border border-amber-200/70" >
                  <div className="p-1 rounded-md bg-amber-200 text-amber-900 shrink-0 mt-0.5">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div className="text-sm leading-7 text-slate-800">
                    <span className="font-bold text-amber-950">المرحلة {idx + 1}: </span>
                    <span className="font-serif">{step}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: توجيهات خاصة بالأستاذ (Teacher Directives & Guidance) */}
          <div className="bg-white rounded-xl border-2 border-gold/60 p-5 shadow-xs">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-amber-100 text-amber-900">
                  <AlertCircle className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-amber-950">
                  4. توجيهات خاصة بالأستاذ (ليست عناصر مفاهيمية)
                </h3>
              </div>
              <span className="text-[11px] font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded-md border border-amber-200">
                تنبيهات المنهاج
              </span>
            </div>

            {currentUnit.teacherDirectives && currentUnit.teacherDirectives.length > 0 ? (
              <div className="space-y-2.5">
                {currentUnit.teacherDirectives.map((dir, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-amber-50/60 border border-amber-200 text-sm text-amber-950 leading-7 font-serif flex items-start gap-2" >
                    <span className="text-gold font-bold shrink-0">•</span>
                    <span>{dir}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic p-3 bg-slate-50 rounded-xl">
                لا توجد توجيهات استثنائية ملحقة؛ يلتزم الأستاذ بالحدود المسطرة في المنهاج والتدرجات السنوية.
              </p>
            )}
          </div>

          {/* Section 5: مؤشرات الأداء والتقويم (Performance Indicators) */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-3">
              <span className="p-1.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
                <CheckCircle2 className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-bold text-slate-900">
                5. مؤشرات الأداء والتقويم
              </h3>
            </div>

            <div className="space-y-2">
              {(currentUnit.indicators || []).map((indicator, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-800 leading-7" >
                  <span className="font-bold text-[var(--primary)] shrink-0">✓</span>
                  <span className="font-serif">{indicator}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 6: السندات والنصوص الشرعية المؤطرة (Scriptural References) */}
          {currentUnit.referenceTexts && currentUnit.referenceTexts.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
              <div className="flex items-center gap-2 mb-3">
                <span className="p-1.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
                  <BookOpen className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-slate-900">
                  6. السندات والنصوص الشرعية المؤطرة للوحدة
                </h3>
              </div>

              <div className="space-y-2.5">
                {currentUnit.referenceTexts.map((text, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-stone-50 border border-stone-200 text-sm sm:text-base leading-7 text-stone-900 font-serif" >
                    « {text} »
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Direct CTA to Embedded PDF Tab */}
          <div className="bg-gradient-to-br from-slate-900 to-[var(--text-primary)] text-white rounded-xl p-6 shadow-md flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="space-y-1 text-center sm:text-right">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/20 text-[var(--primary-soft)] border border-[var(--primary)]/30 text-[10px] font-bold">
                  PDF مدمج
                </span>
                <span className="text-xs text-slate-300">مذكرة الوحدة بصيغة PDF</span>
              </div>
              <h4 className="text-base font-bold flex items-center justify-center sm:justify-start gap-2 pt-1">
                <FileUp className="w-5 h-5 text-[var(--primary)]" />
                <span>مذكرة الوحدة مدمجة وجاهزة للمعاينة والطباعة</span>
              </h4>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setActiveTab('pdf')}
                className="px-5 py-2.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary)] text-white text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-2" >
                <Eye className="w-4 h-4" />
                <span>معاينة مذكرة الوحدة المدمجة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: EMBEDDED PDF VIEWER & MANAGER (مستعرض ملفات PDF المدمجة) */}
      {/* ============================================================== */}
      {activeTab === 'pdf' && currentUnit && (
        <div className="space-y-4">
          {/* Top PDF Controls Header */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <span className="p-2.5 rounded-xl bg-[var(--primary-soft)] text-[var(--primary)] border border-[var(--primary)]/20 shrink-0">
                <FileText className="w-5 h-5" />
              </span>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 font-serif">
                    الوحدة {currentUnit.unitNumber}: «{currentUnit.title}»
                  </h3>
                  {(attachedPdf?.fileStorageKey || attachedPdf?.fileDataUrl) && (
                    <span className="px-2 py-0.5 rounded-full bg-purple-50 text-navy border border-purple-200 text-[10px] font-bold">
                      نسخة مخصصة مرفوعة
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {attachedPdf?.fileName
                    ? `تم رفع مذكرة مخصصة محلياً`
                    : currentUnit.pdfFileName
                    ? `مذكرة الوحدة المدمجة`
                    : 'مذكرة بصيغة PDF'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap self-end lg:self-auto">
              {/* Open bundled or teacher-provided PDF */}
              {directViewUrl && (
                <a
                  href={directViewUrl}
                  target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--text-primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold transition-all shadow-xs cursor-pointer" title="فتح الملف" >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>فتح الملف</span>
                </a>
              )}

              {/* Direct Download PDF Button */}
              {directDownloadUrl && (
                <a
                  href={directDownloadUrl}
                  download={currentUnit.pdfFileName || `مذكرة_${currentUnit.title}.pdf`}
                  target={localPdfUrl ? undefined : "_blank"} rel={localPdfUrl ? undefined : "noreferrer"} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary)] text-white text-xs font-bold transition-colors cursor-pointer shadow-xs" title="تحميل نسخة PDF مباشرة على جهازك" >
                  <Download className="w-3.5 h-3.5" />
                  <span>تحميل PDF</span>
                </a>
              )}


              {/* Hidden file input for custom teacher override */}
              <input
                ref={fileInputRef}
                type="file" accept="application/pdf" className="hidden" onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />

              {/* Upload custom override button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer" title="رفع نسختك الخاصة من جهازك" >
                <Upload className="w-3.5 h-3.5" />
                <span>رفع نسخة خاصة</span>
              </button>

              {/* Remove the teacher's local override */}
              {attachedPdf && (
                <button
                  onClick={() => setDeleteConfirmId(currentUnit?.id || null)}
                  className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" title="حذف النسخة المرفوعة واستعادة المذكرة" >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* PDF Viewer */}
          {activePdfUrl ? (
            <div className="bg-white rounded-xl border border-slate-300 p-2 shadow-sm relative">
              <div className="bg-slate-100 rounded-xl overflow-hidden border border-slate-200 relative hidden md:block">
                <object
                  data={`${activePdfUrl}#toolbar=1&navpanes=0&view=FitH`}
                  type="application/pdf"
                  className="h-[70vh] min-h-[32rem] w-full rounded-xl border-0 bg-white md:h-[840px]"
                  aria-label={`معاينة مذكرة ${currentUnit.title}`}
                >
                  <iframe
                    src={`${activePdfUrl}#toolbar=1&navpanes=0&view=FitH`}
                    className="h-[70vh] min-h-[32rem] w-full rounded-xl border-0 bg-white md:h-[840px]"
                    title={`مذكرة ${currentUnit.title}`}
                    allow="autoplay"
                  />
                </object>
              </div>
              
              <div className="md:hidden flex flex-col items-center justify-center py-16 px-4 bg-slate-50 border border-slate-200 rounded-xl text-center space-y-5">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
                  <FileText className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-slate-800 text-base">عارض الهواتف المحمولة</h3>
                  <p className="text-xs text-slate-500">تم إيقاف العارض المدمج لتوفير الذاكرة وتجنب التشنجات.</p>
                </div>
                <a 
                  href={activePdfUrl} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="flex items-center gap-2 px-6 py-3.5 bg-gradient-to-l from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-full font-bold shadow-lg shadow-blue-500/30 transition-all active:scale-95"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>فتح المذكرة (عارض النظام)</span>
                </a>
              </div>

              {/* Viewer Footer Toolbar */}
              <div className="p-3 bg-slate-50 border-t border-slate-200 rounded-b-xl flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-[var(--text-primary)]">الوحدة: {currentUnit.title}</span>
                  <span>•</span>
                  <span>الميدان: {currentUnit.domain}</span>
                  <span>•</span>
                  <span>الحجم: {currentUnit.hourlyVolume} سا</span>
                </div>
                <div className="flex items-center gap-3">
                  {directViewUrl && (
                    <a
                      href={directViewUrl}
                      target="_blank" rel="noreferrer" className="text-slate-700 hover:text-slate-900 font-bold flex items-center gap-1" >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>فتح ملء الشاشة</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border-2 border-dashed border-slate-300 p-12 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-xl bg-[var(--primary-soft)] text-[var(--primary)] flex items-center justify-center border border-[var(--primary)]/20">
                <FileUp className="w-8 h-8" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h4 className="text-base font-bold text-slate-800">
                  إرفاق ملف مذكرة بصيغة PDF لهذه الوحدة
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  اسحب وأفلت ملف الـ PDF هنا أو انقر للاختيار من جهازك.
                </p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary)] text-white text-xs font-bold cursor-pointer" >
                <Upload className="w-4 h-4" />
                <span>اختر ملف PDF من جهازك</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: REFERENCE BANK & CURRICULUM INDEX (الفهرس) */}
      {/* ============================================================== */}
      {activeTab === 'bank' && (
        <div className="space-y-4">
          {/* Local memorandum library summary */}
          <div className="bg-[var(--accent-navy)] rounded-xl p-5 text-white shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="p-3 rounded-xl bg-white/10 text-[var(--primary-soft)] border border-white/10">
                  <FileText className="w-6 h-6" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/30 text-white/70 text-[10px] font-bold border border-[var(--primary)]/30">
                      مذكرات مدمجة
                    </span>
                    <span className="text-xs text-slate-300 font-mono">
                      {unitsForLevel.filter(unit => unit.pdfUrl).length} ملفات مذكرة مدمجة
                    </span>
                  </div>
                  <h4 className="text-base font-bold font-serif mt-0.5">
                    مكتبة المذكرات المحلية للمستوى
                  </h4>
                </div>
              </div>

            </div>
          

          {/* Search bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text" value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ابحث في وحدات المستوى، الأهداف التعلمية، أو السندات الشرعية..." className="w-full text-xs bg-transparent border-0 focus:outline-none text-slate-900" />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs text-slate-400 hover:text-slate-600 px-2 cursor-pointer" >
                مسح
              </button>
            )}
          </div>

          {/* Unit Cards List */}
          <div className="space-y-3">
            {filteredBankUnits.map(unit => {
              const isSelected = unit.id === selectedUnitId;
              const hasPdf = Boolean(state.unitPdfFiles?.[unit.id] || unit.pdfUrl);

              return (
                <div
                  key={unit.id}
                  role="button" tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedUnitId(unit.id);
                      setActiveTab('card');
                    }
                  }}
                  onClick={() => {
                    setSelectedUnitId(unit.id);
                    setActiveTab('card');
                  }}
                  className={`bg-white rounded-xl border p-4 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[var(--primary)] ring-2 ring-emerald-primary/20 shadow-xs' : 'border-slate-200 hover:border-slate-300 hover:shadow-xs' }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-bold flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          الوحدة {unit.unitNumber}
                        </span>
                        <span>•</span>
                        <span>{unit.domain}</span>
                        <span>•</span>
                        <span className="text-[var(--primary)] font-bold">{unit.hourlyVolume} سا</span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 font-serif">
                        {unit.title}
                      </h4>
                      {unit.learningObjective && (
                        <p className="text-xs text-slate-600 font-serif line-clamp-2">
                          <span className="font-bold text-slate-800">الهدف: </span>
                          {unit.learningObjective}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setSelectedUnitId(unit.id);
                          setActiveTab('card');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 text-xs font-bold transition-colors cursor-pointer" >
                        البطاقة البيداغوجية
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setSelectedUnitId(unit.id);
                          setActiveTab('pdf');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary)] text-xs font-bold transition-colors cursor-pointer shadow-xs flex items-center gap-1" >
                        <FileText className="w-3.5 h-3.5" />
                        <span>المذكرة</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
          <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="إزالة المرفق" message={`هل أنت متأكد من إزالة ملف الـ PDF المرفق لدرس «${currentUnit?.title || ''}»؟`}
        onConfirm={() => { if (deleteConfirmId) handleDeletePdf(); }}
        onCancel={() => setDeleteConfirmId(null)}
      />
</div>
  );
};
