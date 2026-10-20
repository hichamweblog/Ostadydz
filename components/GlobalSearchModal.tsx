'use client';

import React, { useState, useEffect } from 'react';
import { useAppState } from '@/hooks/app-state-context';
import { AppState } from '@/lib/storage';
import { getMergedCurriculumUnits } from "@/lib/curriculum-data";
import { SanadTab } from './SidebarSanad';
import { Search, X, BookOpen, Users, ArrowLeft, GraduationCap, Building2 } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { AccessibleDialog } from './AccessibleDialog';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: SanadTab) => void;
  onPrepareUnit?: (unit: ReturnType<typeof getMergedCurriculumUnits>[number]) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onPrepareUnit
}) => {
  const { state, updateState: onUpdateState } = useAppState();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  // Keyboard shortcut for the global search remains available while the dialog is open.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!isOpen) return null;

  const q = debouncedQuery.trim().toLowerCase();

  // Search lessons
  const matchedUnits = !q
    ? []
    : getMergedCurriculumUnits(state.customUnits).filter(
        u =>
          u.title.toLowerCase().includes(q) ||
          u.domain.toLowerCase().includes(q) ||
          (u.referenceTexts && u.referenceTexts.some(t => t.toLowerCase().includes(q)))
      ).slice(0, 6);

  // Search students
  const matchedStudents = !q
    ? []
    : state.students
        .filter(s => s.fullName.toLowerCase().includes(q) || (s.regNumber && s.regNumber.includes(q)))
        .slice(0, 6);

  const matchedClasses = !q
    ? []
    : state.classes
        .filter(c => c.name.toLowerCase().includes(q) || c.stream.toLowerCase().includes(q))
        .slice(0, 6);

  return (
    <AccessibleDialog open={isOpen} titleId="global-search-title" onClose={onClose} className="bg-[var(--bg-surface)] max-w-xl w-full p-5 shadow-2xl border border-[var(--bg-surface-subtle)] text-[var(--text-primary)] space-y-4 rounded-t-3xl sm:rounded-xl rounded-b-none sm:rounded-b-3xl mb-0 sm:mb-auto pb-8 sm:pb-6 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95">
        {/* Search Header Input */}
        <div className="flex items-center gap-3 pb-3 border-b border-[var(--bg-surface-subtle)]">
          <div id="global-search-title" className="sr-only">البحث العام</div>
          <Search className="w-5 h-5 text-[var(--primary)] shrink-0" />
          <input
            type="text" value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث عن وحدة، تلميذ، سند شرعي، مصطلح فقهي..." className="w-full bg-transparent focus:outline-hidden text-sm font-semibold placeholder:text-[var(--text-muted)]" autoFocus
          />
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-[var(--bg-page)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Results Area */}
        <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1 scrollbar-thin">
          {!q && (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              اكتب كلمة للبحث الفوري في المنهاج الرسمي (1AS/2AS/3AS) أو أسماء التلاميذ.
            </div>
          )}

          {matchedClasses.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[var(--primary)]" />
                <span>الأقسام ({matchedClasses.length})</span>
              </div>
              <div className="space-y-1">
                {matchedClasses.map(cls => {
                  const studentCount = state.students.filter(student => student.classId === cls.id).length;
                  return (
                    <div
                      key={cls.id}
                      className="w-full p-3 rounded-xl border border-[var(--bg-surface-subtle)] bg-[var(--bg-page)] transition-all group text-right"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                          onClose();
                          onNavigate('classes');
                        }}
                        className="w-full flex items-center justify-between cursor-pointer text-right"
                      >
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
                          {cls.name}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                          {cls.stream} • {studentCount} تلميذ
                        </div>
                      </div>
                      <ArrowLeft className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--primary)] group-hover:-translate-x-1 transition-all" aria-hidden="true" />
                      </button>
                      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[var(--bg-surface-subtle)]">
                        {([
                          ['attendance', 'الحضور'],
                          ['grades', 'النقاط'],
                          ['sessions', 'دفتر النصوص'],
                        ] as const).map(([tab, label]) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => {
                              onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                              onClose();
                              onNavigate(tab);
                            }}
                            className="min-h-9 px-2 rounded-lg text-[10px] font-bold text-[var(--primary)] bg-white border border-[var(--bg-surface-subtle)] hover:border-[var(--primary)] cursor-pointer"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lessons Section */}
          {matchedUnits.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-[var(--primary)]" />
                <span>الوحدات والدروس في المنهاج ({matchedUnits.length})</span>
              </div>
              <div className="space-y-1">
                {matchedUnits.map(unit => (
                  <button
                    key={unit.id}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClose();
                        if (onPrepareUnit) {
                          onPrepareUnit(unit);
                        } else {
                          onNavigate('curriculum');
                        }
                      }
                    }}
                    onClick={() => {
                      onClose();
                      if (onPrepareUnit) {
                        onPrepareUnit(unit);
                      } else {
                        onNavigate('curriculum');
                      }
                    }}
                    className="p-3 rounded-xl border border-[var(--bg-surface-subtle)] hover:border-[var(--primary)] bg-[var(--bg-page)] hover:bg-[var(--bg-surface)] flex items-center justify-between cursor-pointer transition-all group" >
                    <div>
                      <div className="font-bold text-xs text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
                        {unit.title}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] flex items-center gap-2 mt-0.5">
                        <span className="font-semibold text-[var(--primary)]">{unit.level}</span>
                        <span>•</span>
                        <span>{unit.domain}</span>
                      </div>
                    </div>
                    <ArrowLeft className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--primary)] group-hover:-translate-x-1 transition-all" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Students Section */}
          {matchedStudents.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                <span>قائمة التلاميذ ({matchedStudents.length})</span>
              </div>
              <div className="space-y-1">
                {matchedStudents.map(st => {
                  const cls = state.classes.find(c => c.id === st.classId);
                  return (
                    <button
                      key={st.id}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (cls) {
                            onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                          }
                          onClose();
                          onNavigate('classes');
                        }
                      }}
                      onClick={() => {
                        if (cls) {
                          onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                        }
                        onClose();
                        onNavigate('classes');
                      }}
                      className="p-3 rounded-xl border border-[var(--bg-surface-subtle)] hover:border-[var(--primary)] bg-[var(--bg-page)] hover:bg-[var(--bg-surface)] flex items-center justify-between cursor-pointer transition-all group" >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center">
                          {st.fullName.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-xs text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
                            {st.fullName}
                          </div>
                          <div className="text-[11px] text-[var(--text-secondary)] flex items-center gap-2">
                            <span>{cls?.name || 'قسم غير محدد'}</span>
                            {st.regNumber && <span>رقم: {st.regNumber}</span>}
                          </div>
                        </div>
                      </div>
                      <ArrowLeft className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--primary)] group-hover:-translate-x-1 transition-all" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {q && matchedUnits.length === 0 && matchedStudents.length === 0 && matchedClasses.length === 0 && (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              لم يتم العثور على نتائج مطابقة لـ &quot;{query}&quot;
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-2 border-t border-[var(--border-default)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>اضغط ESC للإغلاق</span>
          <span className="text-[var(--primary)] font-semibold">معين - التعليم الثانوي</span>
        </div>
    </AccessibleDialog>
  );
};
