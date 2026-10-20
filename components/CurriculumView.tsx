'use client';

import { ConfirmDialog } from './ConfirmDialog';
import { SubjectSwitcherBar } from './SubjectSwitcherBar';
import { showToast } from '@/components/Toast';
import { useAppState } from '@/hooks/app-state-context';
import React, { useEffect, useRef, useState } from 'react';
import {
  OFFICIAL_LEVELS,
  getMergedCurriculumUnits,
  loadAllCurriculum,
} from '@/lib/curriculum-data';
import {
  CurriculumUnit,
  getSubjectDisplayName,
  GradeLevel,
  LessonStatus,
} from '@/lib/types';
import { selectEffectiveSubjectId } from '@/lib/state-selectors';
import { v4 as uuidv4 } from 'uuid';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Edit,
  Plus,
  Trash2,
  Sparkles,
  AlertCircle,
  Filter,
  Search,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  FileText,
  FileDown,
  Upload,
  Download,
} from 'lucide-react';

interface CurriculumViewProps {
  onPrepareUnit: (unit: CurriculumUnit, tab?: 'card' | 'pdf' | 'bank') => void;
}

export const CurriculumView: React.FC<CurriculumViewProps> = ({
  onPrepareUnit
}) => {
  const { state, updateStateAndWait } = useAppState();
  const [, setLoaded] = useState(false);
  useEffect(() => {
    loadAllCurriculum().then(() => setLoaded(true)).catch(console.error);
  }, []);
  const activeClass = state.classes.find(c => c.id === state.activeClassId);
  const activeSubjectId = selectEffectiveSubjectId(state, activeClass);
  const activeSubjectTitle = getSubjectDisplayName(activeSubjectId);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [selectedLevel, setSelectedLevel] = useState<GradeLevel>(
    activeClass?.level || '3AS'
  );

  useEffect(() => {
    if (activeClass?.level) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedLevel(activeClass.level);
    }
  }, [state.activeClassId, activeClass?.level]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);

  // Edit / Add Unit Modal State
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Partial<CurriculumUnit> | null>(null);

  // Combine official curriculum with custom units cleanly deduplicated by ID & scoped by subject
  const allUnits = getMergedCurriculumUnits(state.customUnits, activeSubjectId);

  // Filter by selected level & search query
  const filteredUnits = allUnits.filter(unit => {
    if (unit.level !== selectedLevel) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      unit.title.toLowerCase().includes(q) ||
      unit.domain.toLowerCase().includes(q) ||
      (unit.targetedCompetence && unit.targetedCompetence.toLowerCase().includes(q)) ||
      (unit.learningObjectives && unit.learningObjectives.some(obj => obj.toLowerCase().includes(q)))
    );
  });

  // Helper to extract clean competence number (أرقام الكفاءات من دون عنوان)
  const getCompetenceNumber = (unit: CurriculumUnit, idx: number): string => {
    if (unit.targetedCompetence) {
      const match = unit.targetedCompetence.match(/([0-9]+)/);
      if (match) return `ك ${match[1]}`;
    }
    return `ك ${((idx % 5) + 1)}`;
  };

  // State for inline handwritten note insertion
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [activeNoteText, setActiveNoteText] = useState<string>('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const getUnitNote = (unitId: string): string => {
    const prog = state.lessonProgress.find(
      p => p.classId === state.activeClassId && p.unitId === unitId,
    );
    return prog?.notes || '';
  };

  const handleSaveUnitNote = async (unitId: string) => {
    setEditingNoteId(null);
    try {
      await updateStateAndWait(prev => {
      const existingIdx = prev.lessonProgress.findIndex(
        p => p.classId === prev.activeClassId && p.unitId === unitId,
      );
      let updated = [...prev.lessonProgress];
      if (existingIdx >= 0) {
        updated[existingIdx] = {
          ...updated[existingIdx],
          notes: activeNoteText
        };
      } else {
        updated.push({
          id: uuidv4(),
          classId: prev.activeClassId || (prev.classes[0]?.id || 'default'),
          unitId,
          status: 'IN_PROGRESS',
          notes: activeNoteText
        });
      }
      return { ...prev, lessonProgress: updated };
      });
    } catch (error) {
      console.error('Curriculum note save failed:', error);
      showToast('تعذر حفظ ملاحظة الوحدة في السحابة.', 'error');
    }
  };

  // Group by official sections: المقطع الأول - المقطع الثاني - المقطع الثالث
  const sectionsMap = new Map<string, CurriculumUnit[]>();
  for (const unit of filteredUnits) {
    let key = `المقطع ${unit.sectionNumber || 1}`;
    if (unit.sectionNumber === 1) key = 'المقطع الأول (الفترة الأولى: سبتمبر - ديسمبر)';
    else if (unit.sectionNumber === 2) key = 'المقطع الثاني (الفترة الثانية: جانفي - مارس)';
    else if (unit.sectionNumber === 3) key = 'المقطع الثالث (الفترة الثالثة: أفريل - جوان)';
    else if (unit.sectionName) key = unit.sectionName;

    if (!sectionsMap.has(key)) {
      sectionsMap.set(key, []);
    }
    sectionsMap.get(key)!.push(unit);
  }

  // Get status for unit in active class
  const getUnitStatus = (unitId: string): LessonStatus => {
    if (!state.activeClassId) return 'NOT_STARTED';
    const progress = state.lessonProgress.find(
      p => p.classId === state.activeClassId && p.unitId === unitId
    );
    if (progress?.status) return progress.status;

    // Automatically recognize as completed if documented in the notebook (excluding cancelled sessions)
    const isDocumentedInSessions = state.sessions.some(
      s =>
        s.classId === state.activeClassId &&
        s.unitId === unitId &&
        s.sessionStatus !== 'CANCELLED' &&
        (s.accomplishments || s.notes || s.sessionGoals)
    );
    if (isDocumentedInSessions) return 'COMPLETED';

    return 'NOT_STARTED';
  };

  const setUnitStatus = async (unitId: string, status: LessonStatus) => {
    if (!state.activeClassId) return;
    try {
      await updateStateAndWait(prev => {
      const existingIdx = prev.lessonProgress.findIndex(
        p => p.classId === prev.activeClassId && p.unitId === unitId
      );
      let updatedProgress = [...prev.lessonProgress];
      if (existingIdx >= 0) {
        updatedProgress[existingIdx] = {
          ...updatedProgress[existingIdx],
          status,
          completedAt: status === 'COMPLETED' ? new Date().toISOString().split('T')[0] : undefined
        };
      } else {
        updatedProgress.push({
          id: uuidv4(),
          classId: prev.activeClassId!,
          unitId,
          status,
          completedAt: status === 'COMPLETED' ? new Date().toISOString().split('T')[0] : undefined
        });
      }
      return { ...prev, lessonProgress: updatedProgress };
      });
    } catch (error) {
      console.error('Curriculum status save failed:', error);
      showToast('تعذر حفظ حالة الوحدة في السحابة.', 'error');
    }
  };

  const handleOpenAddUnit = () => {
    setEditingUnit({
      id: `custom-${uuidv4()}`,
      subjectId: activeSubjectId,
      level: selectedLevel,
      sectionNumber: 1,
      sectionName: 'المقطع الأول',
      unitNumber: (filteredUnits.length || 0) + 1,
      title: '',
      domain: activeSubjectTitle,
      hourlyVolume: 2,
      targetedCompetence: '',
      learningObjectives: [],
      indicators: [],
      referenceTexts: []
    });
    setIsEditingModalOpen(true);
  };

  const handleOpenEditUnit = (unit: CurriculumUnit) => {
    setEditingUnit({ ...unit, subjectId: unit.subjectId ?? activeSubjectId });
    setIsEditingModalOpen(true);
  };

  const handleSaveUnit = async () => {
    if (!editingUnit || !editingUnit.title) return;
    const unitToSave: CurriculumUnit = {
      ...(editingUnit as CurriculumUnit),
      subjectId: editingUnit.subjectId ?? activeSubjectId,
    };
    setIsEditingModalOpen(false);
    setEditingUnit(null);

    try {
      await updateStateAndWait(prev => {
        const isCustom = prev.customUnits.some(u => u.id === unitToSave.id);
        let updatedCustom: CurriculumUnit[] = [];

        if (isCustom) {
          updatedCustom = prev.customUnits.map(u =>
            u.id === unitToSave.id ? unitToSave : u
          );
        } else {
          updatedCustom = [
            ...prev.customUnits.filter(u => u.id !== unitToSave.id),
            unitToSave
          ];
        }
        return { ...prev, customUnits: updatedCustom };
      });
      showToast('تم حفظ الوحدة التعليمية بنجاح.', 'success');
    } catch (error) {
      console.error('Custom unit save failed:', error);
      showToast('تعذر حفظ الوحدة المخصصة في السحابة.', 'error');
    }
  };

  const handleDeleteCustomUnit = async (unitId: string) => {
    setDeleteConfirmId(null);
    try {
      await updateStateAndWait(prev => ({
        ...prev,
        customUnits: prev.customUnits.filter(u => u.id !== unitId)
      }));
    } catch (error) {
      console.error('Custom unit delete failed:', error);
      showToast('تعذر حذف الوحدة المخصصة من السحابة.', 'error');
    }
  };

  const handleExportCurriculumExcel = async () => {
    try {
      const { utils, writeFile } = await import('xlsx');
      const rows = filteredUnits.map((u, index) => ({
        'رقم الوحدة': u.unitNumber || index + 1,
        'عنوان الوحدة / الدرس': u.title,
        'الميدان / المحور': u.domain,
        'المقطع': u.sectionName || `المقطع ${u.sectionNumber || 1}`,
        'الحجم الساعي': u.hourlyVolume || 2,
        'الكفاءة المستهدفة': u.targetedCompetence || '',
        'الأهداف التعلمية': (u.learningObjectives || []).join(' | '),
      }));
      const ws = utils.json_to_sheet(rows);
      ws['!dir'] = 'rtl';
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'وحدات_المنهاج');
      writeFile(
        wb,
        `منهاج_${activeSubjectTitle.replace(/\s+/g, '_')}_${selectedLevel}.xlsx`
      );
      showToast('تم تصدير وحدات المنهاج إلى ملف Excel بنجاح.', 'success');
    } catch (error) {
      console.error('Export curriculum failed:', error);
      showToast('تعذر تصدير وحدات المنهاج.', 'error');
    }
  };

  const handleImportCurriculumFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let importedUnits: CurriculumUnit[] = [];
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const rawArr = Array.isArray(parsed) ? parsed : parsed.units || [];
        importedUnits = rawArr.map((item: Record<string, unknown>, idx: number) => ({
          id: `custom-${uuidv4()}`,
          subjectId: activeSubjectId,
          level: selectedLevel,
          sectionNumber: Number(item.sectionNumber || 1),
          sectionName: String(item.sectionName || 'المقطع الأول'),
          unitNumber: Number(item.unitNumber || idx + 1),
          title: String(item.title || item['عنوان الوحدة'] || `وحدة ${idx + 1}`),
          domain: String(item.domain || item['الميدان'] || activeSubjectTitle),
          hourlyVolume: Number(item.hourlyVolume || item['الحجم الساعي'] || 2),
          targetedCompetence: String(item.targetedCompetence || item['الكفاءة المستهدفة'] || ''),
          learningObjectives: Array.isArray(item.learningObjectives)
            ? item.learningObjectives.map(String)
            : [],
          indicators: [],
          referenceTexts: [],
        }));
      } else {
        const { read, utils } = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = read(buf, { type: 'array' });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const rows = utils.sheet_to_json<Record<string, unknown>>(firstSheet);
        importedUnits = rows
          .map((row, idx) => {
            const title = String(
              row['عنوان الوحدة / الدرس'] ||
                row['عنوان الوحدة'] ||
                row['الدرس'] ||
                row['العنوان'] ||
                row.title ||
                ''
            ).trim();
            if (!title) return null;
            const objectivesStr = String(
              row['الأهداف التعلمية'] || row['الأهداف'] || row.learningObjectives || ''
            );
            return {
              id: `custom-${uuidv4()}`,
              subjectId: activeSubjectId,
              level: selectedLevel,
              sectionNumber: Number(row['رقم المقطع'] || row.sectionNumber || 1),
              sectionName: String(row['المقطع'] || row.sectionName || 'المقطع الأول'),
              unitNumber: Number(row['رقم الوحدة'] || row.unitNumber || idx + 1),
              title,
              domain: String(
                row['الميدان / المحور'] || row['الميدان'] || row.domain || activeSubjectTitle
              ),
              hourlyVolume: Number(row['الحجم الساعي'] || row.hourlyVolume || 2),
              targetedCompetence: String(
                row['الكفاءة المستهدفة'] || row.targetedCompetence || ''
              ),
              learningObjectives: objectivesStr
                ? objectivesStr.split(/\||\n/).map(s => s.trim()).filter(Boolean)
                : [],
              indicators: [],
              referenceTexts: [],
            } as CurriculumUnit;
          })
          .filter((u): u is CurriculumUnit => u !== null);
      }

      if (importedUnits.length === 0) {
        showToast('لم يتم العثور على وحدات صالحة في الملف المستورد.', 'error');
        return;
      }

      await updateStateAndWait(prev => ({
        ...prev,
        customUnits: [...prev.customUnits, ...importedUnits],
      }));
      showToast(`تم استيراد ${importedUnits.length} وحدة لمادة ${activeSubjectTitle} بنجاح!`, 'success');
    } catch (error) {
      console.error('Import curriculum failed:', error);
      showToast('تعذر قراءة ملف وحدات المنهاج.', 'error');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const statusLabels: Record<LessonStatus, { label: string; bg: string; text: string }> = {
    NOT_STARTED: { label: 'لم يبدأ', bg: 'bg-slate-100', text: 'text-slate-600' },
    PLANNED: { label: 'مخطط له', bg: 'bg-blue-50', text: 'text-blue-700' },
    IN_PROGRESS: { label: 'قيد الإنجاز', bg: 'bg-amber-50', text: 'text-amber-800' },
    COMPLETED: { label: 'أُنجز بحمد الله', bg: 'bg-[var(--primary-soft)]', text: 'text-[var(--primary)]' },
    NEEDS_REMEDIAL: { label: 'يحتاج معالجة / إعادة', bg: 'bg-rose-50', text: 'text-rose-700' }
  };

  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="curriculum-view">
      {/* Multi-Subject Switcher */}
      <SubjectSwitcherBar classRoom={activeClass} allowAllFallback />

      {/* Curriculum Management Toolbar (Add Unit, Import Excel/JSON, Export Excel) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-bold text-slate-700">
          المنهاج الدراسي والتدرج السنوي لمادة:{' '}
          <span className="text-[var(--primary)]">{activeSubjectTitle}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.json"
            onChange={handleImportCurriculumFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleOpenAddUnit}
            className="min-h-10 px-3.5 py-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة وحدة / درس</span>
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="min-h-10 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[var(--primary)]" />
            <span>استيراد وحدات (Excel/JSON)</span>
          </button>
          {filteredUnits.length > 0 && (
            <button
              type="button"
              onClick={handleExportCurriculumExcel}
              className="min-h-10 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>تصدير Excel</span>
            </button>
          )}
        </div>
      </div>

      {/* Level Selector — شبكة 2×2 في الموبايل دون تمرير أفقي */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {OFFICIAL_LEVELS.map(lvl => {
          const isSelected = selectedLevel === lvl.id;
          return (
            <button
              key={lvl.id}
              onClick={() => setSelectedLevel(lvl.id)}
              className={`flex min-h-11 items-center justify-center rounded-xl border px-3 py-2 text-center text-xs font-bold leading-tight transition-all cursor-pointer ${
                isSelected
                  ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {lvl.name}
            </button>
          );
        })}
      </div>
      
      {/* Search & Class Progress Context Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="text" placeholder="بحث في عناوين الدروس، الأهداف، السندات..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pr-9 pl-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-amber-600" />
        </div>

        {activeClass && (
          <div className="flex items-center gap-3 text-xs font-medium text-slate-700 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span>نسبة الإنجاز:</span>
              <span className="font-bold text-[var(--primary)] bg-[var(--primary-soft)] px-2.5 py-0.5 rounded-full border border-[var(--primary)]/20 font-mono">
                {filteredUnits.filter(u => getUnitStatus(u.id) === 'COMPLETED').length} / {filteredUnits.length} وحدة ({filteredUnits.length > 0 ? Math.round((filteredUnits.filter(u => getUnitStatus(u.id) === 'COMPLETED').length / filteredUnits.length) * 100) : 0}%)
              </span>
            </div>
            <div className="hidden sm:block w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--primary)] transition-all duration-300"
                style={{
                  width: `${filteredUnits.length > 0 ? Math.round((filteredUnits.filter(u => getUnitStatus(u.id) === 'COMPLETED').length / filteredUnits.length) * 100) : 0}%`
                }}
              />
            </div>
            <span className="font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
              {activeClass.name} ({activeClass.stream})
            </span>
          </div>
        )}
      </div>

      {/* Sections and Units List */}
      <div className="space-y-6">
        {Array.from(sectionsMap.entries()).map(([sectionName, units]) => (
          <div key={sectionName} className="space-y-3">
            {/* Section Header */}
            <div className="bg-slate-100/90 px-4 py-2 rounded-lg border border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800">{sectionName}</h3>
              <span className="text-[11px] font-semibold text-slate-500">
                {units.length} وحدات
              </span>
            </div>

            {/* Units in this section */}
            <div className="space-y-3">
              {units.map(unit => {
                const currentStatus = getUnitStatus(unit.id);
                const isExpanded = expandedUnitId === unit.id;
                const statusInfo = statusLabels[currentStatus];
                const isCustom = state.customUnits.some(u => u.id === unit.id);

                return (
                  <div
                    key={unit.id}
                    className="bg-white rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all overflow-hidden" id={`unit-card-${unit.id}`}
                  >
                    {/* Unit Main Header Row */}
                    <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                          {unit.unitNumber}
                        </span>

                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                              {unit.title}
                            </h4>
                            {isCustom && (
                              <span className="px-1.5 py-0.2 rounded bg-purple-50 text-navy border border-purple-200 text-[10px] font-bold">
                                مخصص
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-medium">
                              {unit.domain}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-mono">
                              {unit.hourlyVolume} سا
                            </span>
                          </div>

                          {/* Competence full text & local PDF badge */}
                          <div className="flex flex-col gap-1.5 pt-1">
                            {unit.targetedCompetence && (
                              <div className="px-2 py-1 rounded-md bg-amber-100/80 text-amber-900 border border-amber-200 text-[11px] font-bold truncate" title={unit.targetedCompetence}>
                                الكفاءة: {unit.targetedCompetence}
                              </div>
                            )}
                            {getUnitNote(unit.id) && (
                              <div className="text-[11px] text-[var(--primary)] bg-[var(--primary-soft)] border border-[var(--primary)]/20 px-2 py-1 rounded truncate">
                                📝 {getUnitNote(unit.id)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right side: Status dropdown + Action Buttons */}
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {/* Status selector for active class */}
                        {state.activeClassId && (
                          <select
                            value={currentStatus}
                            onChange={e => setUnitStatus(unit.id, e.target.value as LessonStatus)}
                            className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer outline-none ${statusInfo.bg} ${statusInfo.text} border-slate-200`}
                          >
                            <option value="NOT_STARTED">لم يبدأ</option>
                            <option value="PLANNED">مخطط</option>
                            <option value="IN_PROGRESS">قيد الإنجاز</option>
                            <option value="COMPLETED">أُنجز</option>
                            <option value="NEEDS_REMEDIAL">يحتاج معالجة</option>
                          </select>
                        )}

                        {/* Manual Note Insertion button */}
                        <button
                          onClick={() => {
                            if (editingNoteId === unit.id) {
                              setEditingNoteId(null);
                            } else {
                              setEditingNoteId(unit.id);
                              setActiveNoteText(getUnitNote(unit.id));
                            }
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)] text-[var(--primary)] border border-[var(--primary)]/20 text-xs font-bold transition-colors cursor-pointer" title="أضف ملاحظة للوحدة" >
                          <FileText className="w-3.5 h-3.5" />
                          <span>أضف ملاحظة</span>
                        </button>

                        {/* Pedagogical Lesson Plan & Embedded PDF button */}
                        <button
                          onClick={() => onPrepareUnit(unit, 'pdf')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)] text-[var(--text-primary)] border border-[var(--primary)] text-xs font-bold transition-colors cursor-pointer" title="عرض المذكرة البيداغوجية وملف PDF المدمج" >
                          <FileText className="w-3.5 h-3.5 text-[var(--primary)]" />
                          <span>المذكرة البيداغوجية (PDF)</span>
                        </button>

                        {/* Edit Unit button */}
                        <button
                          onClick={() => handleOpenEditUnit(unit)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
                          title="تعديل الوحدة"
                        >
                          <Edit className="w-4 h-4" />
                        </button>

                        {/* Delete button if custom */}
                        {isCustom && (
                          <button
                            onClick={() => setDeleteConfirmId(unit.id)}
                            className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer" title="حذف الوحدة" >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Toggle details expansion */}
                        <button
                          onClick={() => setExpandedUnitId(isExpanded ? null : unit.id)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer" title="عرض التفاصيل والأهداف" >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Inline Manual Note Editor Drawer */}
                    {editingNoteId === unit.id && (
                      <div className="bg-amber-50/60 border-t border-amber-200/80 p-3 flex flex-col sm:flex-row items-center gap-2">
                        <span className="text-xs font-bold text-[var(--primary)] shrink-0">
                          📝 إضافة ملاحظة للوحدة:
                        </span>
                        <input
                          type="text" value={activeNoteText}
                          onChange={e => setActiveNoteText(e.target.value)}
                          placeholder="اكتب ملاحظتك البيداغوجية، تنبيه، أو توصية للدرس..." className="flex-1 w-full text-xs bg-white border border-amber-300 rounded-lg px-3 py-1.5 focus:outline-[var(--primary)] text-slate-800" />
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            onClick={() => handleSaveUnitNote(unit.id)}
                            className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-bold hover:bg-[var(--primary-hover)] transition-colors cursor-pointer whitespace-nowrap" >
                            حفظ
                          </button>
                          <button
                            onClick={() => setEditingNoteId(null)}
                            className="px-3 py-1.5 rounded-lg bg-stone-200 text-stone-700 text-xs font-bold hover:bg-stone-300 transition-colors cursor-pointer whitespace-nowrap" >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Expandable Details Drawer */}
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 p-4 space-y-4 text-xs">
                        {/* Learning Objective - الهدف التعلمي */}
                        {(unit.learningObjective || unit.targetedCompetence) && (
                          <div className="space-y-1">
                            <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-[var(--primary)]"></span>
                              الهدف التعلمي:
                            </span>
                            <p className="text-[var(--text-primary)] bg-[var(--primary-soft)]/80 p-3 rounded-lg border border-[var(--primary)]/20 font-serif font-bold leading-relaxed">
                              {unit.learningObjective || unit.targetedCompetence}
                            </p>
                          </div>
                        )}

                        {/* Targeted Resources - الموارد المستهدفة */}
                        {((unit.targetedResources && unit.targetedResources.length > 0) || (unit.learningObjectives && unit.learningObjectives.length > 0)) && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                              الموارد المستهدفة (العناصر المفاهيمية وبناء التعلمات):
                            </span>
                            <ul className="list-decimal list-inside space-y-1 text-slate-700 bg-white p-3 rounded-lg border border-slate-200 font-serif leading-relaxed">
                              {(unit.targetedResources || unit.learningObjectives || []).map((obj, i) => (
                                <li key={i}>{obj}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Implementation Mechanisms - آلية تنفيذ التعلمات */}
                        {unit.implementationMechanisms && unit.implementationMechanisms.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-gold"></span>
                              آلية تنفيذ التعلمات (خطوات الإنجاز والأنشطة):
                            </span>
                            <div className="space-y-1.5 bg-amber-50/40 p-3 rounded-lg border border-amber-200/70">
                              {unit.implementationMechanisms.map((mech, i) => (
                                <div key={i} className="text-slate-800 font-serif flex items-start gap-2">
                                  <span className="font-bold text-amber-900 shrink-0">المرحلة {i + 1}:</span>
                                  <span>{mech}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Teacher Directives - توجيهات خاصة بالأستاذ */}
                        {((unit.teacherDirectives && unit.teacherDirectives.length > 0) || (unit.pedagogicalDirectives && unit.pedagogicalDirectives.length > 0)) && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-amber-950 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-700"></span>
                              توجيهات خاصة بالأستاذ (ليست عناصر مفاهيمية):
                            </span>
                            <ul className="list-disc list-inside space-y-1 text-amber-950 bg-amber-50/70 p-3 rounded-lg border border-amber-200/80 font-serif leading-relaxed">
                              {(unit.teacherDirectives || unit.pedagogicalDirectives || []).map((dir, i) => (
                                <li key={i}>{dir}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Indicators & Evaluation */}
                        {unit.indicators && unit.indicators.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-[var(--primary)]"></span>
                              مؤشرات الأداء والتقويم:
                            </span>
                            <ul className="list-disc list-inside space-y-1 text-slate-700 bg-white p-3 rounded-lg border border-slate-200 font-serif leading-relaxed">
                              {unit.indicators.map((ind, i) => (
                                <li key={i}>{ind}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Reference Texts & Directives */}
                        {unit.referenceTexts && unit.referenceTexts.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-[var(--primary)]"></span>
                              السندات والنصوص المؤطرة:
                            </span>
                            <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 text-stone-900 space-y-1">
                              {unit.referenceTexts.map((txt, i) => (
                                <p key={i} className="font-serif text-xs leading-relaxed">
                                  « {txt} »
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Quick CTA to open lesson note and embedded PDF */}
                        <div className="pt-2 flex items-center justify-end gap-2 flex-wrap">
                          <button
                            onClick={() => onPrepareUnit(unit, 'pdf')}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--text-primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold transition-colors cursor-pointer" >
                            <FileText className="w-3.5 h-3.5 text-[var(--primary)]" />
                            <span>فتح بطاقة المذكرة وملف PDF المدمج</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {filteredUnits.length === 0 && (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-3">
            <p className="text-sm font-bold text-slate-800">
              لا توجد وحدات مسجلة حالياً لمادة «{activeSubjectTitle}» في هذا المستوى
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              يمكنك إضافة الوحدات التعليمية يدوياً أو استيرادها دفعة واحدة من ملف Excel أو JSON لتوليد التوزيع السنوي الآلي وربط المذكرات (PDF) بكل وحدة.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleOpenAddUnit}
                className="min-h-11 px-4 py-2 rounded-xl bg-[var(--primary)] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة وحدة تعليمية الآن</span>
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="min-h-11 px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-4 h-4 text-[var(--primary)]" />
                <span>استيراد ملف Excel / JSON</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit / Add Unit Modal */}
      {isEditingModalOpen && editingUnit && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" className="bg-white rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {editingUnit.id?.startsWith('custom') ? `إضافة وحدة (${activeSubjectTitle})` : 'تعديل بيانات الوحدة'}
              </h3>
              <button
                onClick={() => setIsEditingModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer" >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="font-bold text-slate-700">عنوان الوحدة / الدرس:</label>
                  <input
                    type="text" value={editingUnit.title || ''}
                    onChange={e => setEditingUnit({ ...editingUnit, title: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:outline-amber-600" placeholder="أدخل عنوان الوحدة أو الدرس..." />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">الحجم الساعي (ساعات):</label>
                  <input
                    type="number" min="1" max="20" value={editingUnit.hourlyVolume || 2}
                    onChange={e =>
                      setEditingUnit({ ...editingUnit, hourlyVolume: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:outline-amber-600" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">الميدان / المجال المفاهيمي:</label>
                  <input
                    type="text"
                    value={editingUnit.domain || ''}
                    onChange={e => setEditingUnit({ ...editingUnit, domain: e.target.value })}
                    placeholder={`مثال: الميدان الأول في ${activeSubjectTitle}...`}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">المقطع / المحور:</label>
                  <input
                    type="text" value={editingUnit.sectionName || ''}
                    onChange={e => setEditingUnit({ ...editingUnit, sectionName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600" placeholder="المقطع الأول / الفصل الأول..." />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">الكفاءة المستهدفة:</label>
                <textarea
                  rows={2}
                  value={editingUnit.targetedCompetence || ''}
                  onChange={e => setEditingUnit({ ...editingUnit, targetedCompetence: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600" placeholder="الكفاءة التي يسعى الدرس لتحقيقها..." />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">
                  الأهداف التعلمية (افصل بين الأهداف بنزول سطر جديد):
                </label>
                <textarea
                  rows={3}
                  value={(editingUnit.learningObjectives || []).join('\n')}
                  onChange={e =>
                    setEditingUnit({
                      ...editingUnit,
                      learningObjectives: e.target.value.split('\n').filter(Boolean)
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600" placeholder="الهدف الأول&#10;الهدف الثاني&#10;الهدف الثالث" />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">
                  السندات والنصوص المؤطرة (آيات وأحاديث - سطر لكل سند):
                </label>
                <textarea
                  rows={2}
                  value={(editingUnit.referenceTexts || []).join('\n')}
                  onChange={e =>
                    setEditingUnit({
                      ...editingUnit,
                      referenceTexts: e.target.value.split('\n').filter(Boolean)
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600" placeholder="سورة النساء: 105&#10;حديث: «من سلك طريقاً...»" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsEditingModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer" >
                إلغاء
              </button>
              <button
                onClick={handleSaveUnit}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent-gold)] hover:bg-[var(--accent-gold-hover)] text-[var(--accent-navy)] text-xs font-bold shadow-xs cursor-pointer" >
                <Save className="w-4 h-4" />
                <span>حفظ التعديلات</span>
              </button>
            </div>
          </div>
        </div>
      )}
          <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="تأكيد الحذف" message="هل أنت متأكد من حذف هذه الوحدة المخصصة؟" onConfirm={() => { if (deleteConfirmId) handleDeleteCustomUnit(deleteConfirmId); }}
        onCancel={() => setDeleteConfirmId(null)}
      />
</div>
  );
};
