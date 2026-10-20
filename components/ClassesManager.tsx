'use client';

import { showToast } from '@/components/Toast';
import { useAppState } from '@/hooks/app-state-context';
import React, { useEffect, useState, useRef } from 'react';
import { CLASS_COLORS, DEFAULT_CLASS_COLOR, pickClassColor } from "@/lib/class-colors";
import { AppState } from '@/lib/storage';
import { SanadTab } from './SidebarSanad';
import {
  ClassRoom,
  getClassCoefficient,
  getSubjectDisplayName,
  getWeeklyHours,
  GradeLevel,
  mapLevelAndStreamToLegacyGradeLevel,
  Student,
  StudentGrade,
  TimetableSlot,
} from '@/lib/types';
import {
  ACTIVE_SUBJECTS,
  getStreamsForLevel,
  getSubjectsForStream,
  resolveLevelAndStream,
  STREAMS_BY_ID,
  SUBJECTS_BY_ID,
  type LevelCode,
  type StreamId,
  type SubjectId,
} from '@/lib/education';
import {
  selectClassAssignedSubjectIds,
  selectEffectiveSubjectId,
  selectTeacherSubjectIds,
} from '@/lib/state-selectors';
import { isSchoolSummaryOrFooterRow } from '@/lib/excel-sync';
import type { ParsedDigitizationResult } from '@/lib/excel-sync';
import type { ParsedMoumtazeResult } from '@/lib/moumtaze-sync';
import { commitRosterImportBatch, type RosterImportClass, type RosterImportStudent } from '@/lib/supabase/roster-import';
import { isSameClass, isSameStudentName, getCanonicalClassName, getStudentNameKey } from '@/lib/name-normalizer';
import { v4 as uuidv4 } from 'uuid';
import {
  Users,
  Plus,
  Edit,
  Trash2,
  Calendar,
  Clock,
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle2,
  X,
  AlertCircle,
  AlertTriangle,
  Sparkles,
  ClipboardPaste,
  UserCheck,
  CheckSquare,
  Square,
  Building2,
  Check,
  RotateCcw
} from 'lucide-react';

interface ClassesManagerProps {
  onNavigate?: (tab: SanadTab) => void;
  initialSubTab?: 'classes' | 'students';
}

interface ImportConflict {
  className: string;
  importedName: string;
  importedRegNumber?: string;
  reason: string;
  candidates: Student[];
}

interface StudentMergePair {
  primary: Student;
  duplicate: Student;
}

export const ClassesManager: React.FC<ClassesManagerProps> = ({
  onNavigate,
  initialSubTab = 'classes',
}) => {
  const { state, updateState: onUpdateState, updateStateAndWait, commitRosterImport } = useAppState();
  const [activeSubTab, setActiveSubTab] = useState<'classes' | 'timetable' | 'students'>(initialSubTab);
  const [classSearch, setClassSearch] = useState('');
  const [classLevelFilter, setClassLevelFilter] = useState<GradeLevel | 'ALL'>('ALL');

  // Modal states for Class
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<Partial<ClassRoom> | null>(null);

  // Modal states for Timetable slot
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<Partial<TimetableSlot> | null>(null);

  // Modal states for Student
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Partial<Student> | null>(null);

  // Quick Paste modal state
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pastedNames, setPastedNames] = useState('');

  // Delete Confirmation Dialog state (Safe in-app modal instead of blocked window.confirm)
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'student' | 'class' | 'slot';
    id: string;
    name: string;
  } | null>(null);

  // Selected class for students sub-tab
  const [selectedClassId, setSelectedClassId] = useState<string>(
    state.activeClassId || (state.classes[0]?.id || '')
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const moumtazeFileInputRef = useRef<HTMLInputElement>(null);
  const [importNotification, setImportNotification] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<ParsedDigitizationResult | null>(null);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);

  useEffect(() => {
    if (!isClassModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsClassModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isClassModalOpen]);
  const [mergePair, setMergePair] = useState<StudentMergePair | null>(null);

  // Moumtaze Import States
  const [isMoumtazeModalOpen, setIsMoumtazeModalOpen] = useState(false);
  const [moumtazeData, setMoumtazeData] = useState<ParsedMoumtazeResult | null>(null);
  const [selectedMoumtazeClassIds, setSelectedMoumtazeClassIds] = useState<string[]>([]);
  const [isParsingMoumtaze, setIsParsingMoumtaze] = useState(false);
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
  const activeClassObj = state.classes.find(c => c.id === selectedClassId);

  useEffect(() => {
    const selectedStillExists = state.classes.some(cls => cls.id === selectedClassId);
    if (selectedStillExists) return;
    const nextClassId = state.classes.some(cls => cls.id === state.activeClassId)
      ? state.activeClassId || ''
      : state.classes[0]?.id || '';
    const timer = window.setTimeout(() => setSelectedClassId(nextClassId), 0);
    return () => window.clearTimeout(timer);
  }, [selectedClassId, state.activeClassId, state.classes]);

  const findImportConflicts = (
    importedClasses: Array<{
      className: string;
      students: Array<{ fullName: string; regNumber?: string; birthDate?: string }>;
    }>
  ): ImportConflict[] => {
    const conflicts: ImportConflict[] = [];
    importedClasses.forEach(importedClass => {
      const importedKeys = new Set<string>();
      const reportedImportedKeys = new Set<string>();
      const importedNameKeys = new Set<string>();
      const importedNameEntries: string[] = [];
      importedClass.students.forEach(importedStudent => {
        const normalizedName = getStudentNameKey(importedStudent.fullName);
        const key = importedStudent.regNumber?.trim()
          ? `reg:${importedStudent.regNumber.trim()}`
          : `name:${normalizedName}`;
        const duplicateName = importedNameKeys.has(normalizedName);
        const similarName = Boolean(normalizedName) &&
          importedNameEntries.some(existingName => isSameStudentName(existingName, importedStudent.fullName));
        if ((importedKeys.has(key) || duplicateName || similarName) && !reportedImportedKeys.has(key)) {
          conflicts.push({
            className: importedClass.className,
            importedName: importedStudent.fullName,
            importedRegNumber: importedStudent.regNumber,
            reason: duplicateName
              ? 'الاسم مكرر داخل ملف الاستيراد نفسه، حتى مع اختلاف رقم التعريف'
              : similarName
                ? 'الاسم مشابه جداً لاسم آخر داخل ملف الاستيراد نفسه'
              : 'السجل مكرر داخل ملف الاستيراد نفسه، ولن يتم إنشاء تلميذين بالاسم ذاته تلقائياً',
            candidates: []
          });
          reportedImportedKeys.add(key);
        }
        importedKeys.add(key);
        importedNameKeys.add(normalizedName);
        importedNameEntries.push(importedStudent.fullName);
      });

      const existingClass = state.classes.find(c => isSameClass(c.name, importedClass.className));
      if (!existingClass) return;

      const existingStudents = state.students.filter(s => s.classId === existingClass.id);
      importedClass.students.forEach(importedStudent => {
        if (importedStudent.regNumber) {
          const sameReg = existingStudents.filter(
            student => student.regNumber?.trim() === importedStudent.regNumber?.trim()
          );
          const sameName = existingStudents.filter(
            student => getStudentNameKey(student.fullName) === getStudentNameKey(importedStudent.fullName)
          );
          if (sameReg.length > 1 || sameName.length > 1 || (sameReg.length === 1 && sameName.length === 0)) {
            conflicts.push({
              className: importedClass.className,
              importedName: importedStudent.fullName,
              importedRegNumber: importedStudent.regNumber,
              reason: sameReg.length > 1
                ? 'رقم التعريف مرتبط بأكثر من تلميذ داخل القسم'
                : sameName.length > 1
                  ? 'الاسم موجود أكثر من مرة داخل القسم، رغم وجود رقم تعريف'
                : 'رقم التعريف مرتبط باسم مختلف عن الاسم المستورد',
              candidates: sameReg.length > 0 ? sameReg : sameName
            });
          }
          return;
        }

        const sameName = existingStudents.filter(
          student => getStudentNameKey(student.fullName) === getStudentNameKey(importedStudent.fullName)
        );
        const fuzzyMatches = existingStudents.filter(
          student => isSameStudentName(student.fullName, importedStudent.fullName)
        );
        const birthDateMismatch = sameName.length === 1 &&
          Boolean(importedStudent.birthDate && sameName[0].birthDate &&
            importedStudent.birthDate !== sameName[0].birthDate);
        if (sameName.length > 1 || (sameName.length === 0 && fuzzyMatches.length > 1) || birthDateMismatch) {
          conflicts.push({
            className: importedClass.className,
            importedName: importedStudent.fullName,
            reason: birthDateMismatch
              ? 'الاسم متطابق لكن تاريخ الميلاد مختلف'
              : 'يوجد أكثر من مرشح محتمل للاسم المستورد',
            candidates: sameName.length > 0 ? sameName : fuzzyMatches
          });
        }
      });
    });
    return conflicts;
  };

  const handleConfirmDigitizationImport = () => {
    if (!pendingImport) return;
    const conflicts = findImportConflicts(pendingImport.classes);
    if (conflicts.length > 0) {
      setImportConflicts(conflicts);
      setImportNotification(
        `توقف الاستيراد للمراجعة: توجد ${conflicts.length} حالات تحتاج قراراً يدوياً. لم يتم تغيير أي بيانات.`
      );
      return;
    }
    applyDigitizationImport(pendingImport);
  };




  const classStudents = state.students
    .filter(s => s.classId === selectedClassId)
    .sort((a, b) => a.numberInList - b.numberInList);

  const duplicateNameGroups = Array.from(
    classStudents.reduce((groups, student) => {
      const key = getStudentNameKey(student.fullName);
      if (!key) return groups;
      const group = groups.get(key) || [];
      group.push(student);
      groups.set(key, group);
      return groups;
    }, new Map<string, Student[]>()).values()
  ).filter(group => group.length > 1);

  const handleMergeStudents = async () => {
    if (!mergePair) return;
    const { primary, duplicate } = mergePair;

    try {
      await updateStateAndWait(prev => {
      const gradeByKey = new Map<string, StudentGrade>();
      prev.grades
        .filter(grade => grade.studentId === primary.id || grade.studentId === duplicate.id)
        .forEach(grade => {
          const key = `${grade.classId}:${grade.trimester}`;
          const existing = gradeByKey.get(key);
          if (!existing || (existing.studentId === duplicate.id && grade.studentId === primary.id)) {
            gradeByKey.set(key, {
              ...(existing || {}),
              ...grade,
              studentId: primary.id,
              continuousEval: grade.continuousEval ?? existing?.continuousEval ?? null,
              behaviorScore: grade.behaviorScore ?? existing?.behaviorScore,
              attendanceScore: grade.attendanceScore ?? existing?.attendanceScore,
              notebookScore: grade.notebookScore ?? existing?.notebookScore,
              participationScore: grade.participationScore ?? existing?.participationScore,
              quiz: grade.quiz ?? existing?.quiz ?? null,
              exam: grade.exam ?? existing?.exam ?? null,
              calculatedAverage: grade.calculatedAverage ?? existing?.calculatedAverage,
              estimation: grade.estimation || existing?.estimation,
              guidance: grade.guidance || existing?.guidance,
              remarks: grade.remarks || existing?.remarks
            });
          } else if (existing.studentId === primary.id) {
            gradeByKey.set(key, {
              ...existing,
              behaviorScore: existing.behaviorScore ?? grade.behaviorScore,
              attendanceScore: existing.attendanceScore ?? grade.attendanceScore,
              notebookScore: existing.notebookScore ?? grade.notebookScore,
              participationScore: existing.participationScore ?? grade.participationScore,
              continuousEval: existing.continuousEval ?? grade.continuousEval ?? null,
              quiz: existing.quiz ?? grade.quiz ?? null,
              exam: existing.exam ?? grade.exam ?? null,
              calculatedAverage: existing.calculatedAverage ?? grade.calculatedAverage,
              estimation: existing.estimation || grade.estimation,
              guidance: existing.guidance || grade.guidance,
              remarks: existing.remarks || grade.remarks
            });
          }
        });

      const updatedGrades = prev.grades
        .filter(grade => grade.studentId !== primary.id && grade.studentId !== duplicate.id)
        .concat(Array.from(gradeByKey.values()));

      const updatedSessions = prev.sessions.map(session => {
        const attendance = { ...session.attendance };
        if (attendance[primary.id] === undefined && attendance[duplicate.id] !== undefined) {
          attendance[primary.id] = attendance[duplicate.id];
        }
        delete attendance[duplicate.id];

        const replaceId = (ids: string[] = []) =>
          Array.from(new Set(ids.map(id => id === duplicate.id ? primary.id : id)));

        return {
          ...session,
          attendance,
          disruptions: replaceId(session.disruptions),
          unwrittenLessons: replaceId(session.unwrittenLessons),
          poorParticipation: replaceId(session.poorParticipation),
          goodParticipation: replaceId(session.goodParticipation)
        };
      });

      const mergedPrimary: Student = {
        ...primary,
        regNumber: primary.regNumber || duplicate.regNumber,
        registrationNumber: primary.registrationNumber || duplicate.registrationNumber,
        gender: primary.gender || duplicate.gender,
        birthDate: primary.birthDate || duplicate.birthDate,
        notes: primary.notes || duplicate.notes,
        isRepeater: primary.isRepeater ?? duplicate.isRepeater
      };

      const updatedStudents = prev.students
        .filter(student => student.id !== duplicate.id)
        .map(student => student.id === primary.id ? mergedPrimary : student);

      const inClass = updatedStudents
        .filter(student => student.classId === primary.classId)
        .sort((a, b) => (a.numberInList || 0) - (b.numberInList || 0));
      const numberById = new Map(inClass.map((student, index) => [student.id, index + 1]));

      return {
        ...prev,
        students: updatedStudents.map(student => numberById.has(student.id)
          ? { ...student, numberInList: numberById.get(student.id)! }
          : student),
        grades: updatedGrades,
        sessions: updatedSessions
      };
      });
      setMergePair(null);
      setImportNotification(`تم دمج سجلي «${duplicate.fullName}» و«${primary.fullName}» مع الحفاظ على الدرجات والحضور.`);
      showToast('تم دمج سجلي التلميذين ومزامنة التغييرات مع السحابة.', 'success');
    } catch (error: unknown) {
      console.error('Student merge sync failed:', error);
      showToast(error instanceof Error ? error.message : 'تعذرت مزامنة دمج سجلي التلميذين.', 'error');
    }
  };

  const visibleClasses = state.classes.filter(cls => {
    const matchesLevel = classLevelFilter === 'ALL' || cls.level === classLevelFilter;
    const query = classSearch.trim().toLowerCase();
    const matchesSearch = !query || `${cls.name} ${cls.stream}`.toLowerCase().includes(query);
    return matchesLevel && matchesSearch;
  });

  // ---------------------------------------------
  // Class Operations
  // ---------------------------------------------
  const handleOpenAddClass = () => {
    setEditingClass({
      id: uuidv4(),
      name: '',
      level: '3AS',
      stream: 'علوم تجريبية',
      roomNumber: 'القاعة 01',
      color: pickClassColor(state.classes.map(c => c.color)) });
    setIsClassModalOpen(true);
  };

  const handleOpenEditClass = (cls: ClassRoom) => {
    setEditingClass({ ...cls });
    setIsClassModalOpen(true);
  };

  const handleSaveClass = async () => {
    if (!editingClass || !editingClass.name) return;
    if (isSaving) return; // Prevent double-submit
    
    // Unify class name on manual save
    const canonicalName = getCanonicalClassName(editingClass.name);
    const classId = editingClass.id || uuidv4();
    const classToSave = { ...editingClass, id: classId, name: canonicalName };

    setIsSaving(true);

    try {
      await updateStateAndWait(prev => {
        const idx = prev.classes.findIndex(c => c.id === classId);
        const updatedClasses = [...prev.classes];
        if (idx >= 0) updatedClasses[idx] = classToSave as ClassRoom;
        else updatedClasses.push(classToSave as ClassRoom);
        return {
          ...prev,
          classes: updatedClasses,
          activeClassId: prev.activeClassId || classToSave.id || null
        };
      });
      showToast('تم حفظ القسم ومزامنته مع السحابة.', 'success');
      // Only close modal after successful save
      setIsClassModalOpen(false);
      setEditingClass(null);
    } catch (error: unknown) {
      console.error('Class sync failed:', error);
      showToast(error instanceof Error ? error.message : 'تعذر مزامنة القسم. يمكنك إعادة المحاولة.', 'error');
      // Keep modal open so user can retry
    } finally {
      setIsSaving(false);
    }
  };

  const promptDeleteClass = (cls: ClassRoom) => {
    setDeleteConfirmDialog({
      isOpen: true,
      type: 'class',
      id: cls.id,
      name: `${cls.name} (${cls.stream})`
    });
  };

  // ---------------------------------------------
  // Timetable Operations
  // ---------------------------------------------
  const handleOpenAddSlot = (dayOfWeek: number) => {
    const validDay = (dayOfWeek >= 0 && dayOfWeek <= 4 ? dayOfWeek : 0) as 0 | 1 | 2 | 3 | 4;
    setEditingSlot({
      id: uuidv4(),
      classId: state.classes[0]?.id || '',
      dayOfWeek: validDay,
      startTime: '08:00',
      endTime: '09:00',
      room: state.classes[0]?.roomNumber?.replace('القاعة ', '') || '01' });
    setIsSlotModalOpen(true);
  };

  const handleSaveSlot = async () => {
    if (!editingSlot || !editingSlot.classId) return;
    const slotToSave = { ...editingSlot };
    setIsSlotModalOpen(false);
    setEditingSlot(null);
    try {
      await updateStateAndWait(prev => {
        const idx = prev.timetable.findIndex(s => s.id === slotToSave.id);
        const updatedSlots = [...prev.timetable];
        if (idx >= 0) updatedSlots[idx] = slotToSave as TimetableSlot;
        else updatedSlots.push(slotToSave as TimetableSlot);
        return { ...prev, timetable: updatedSlots };
      });
      showToast('تم حفظ حصة التوقيت ومزامنتها مع السحابة.', 'success');
    } catch (error: unknown) {
      console.error('Timetable slot sync failed:', error);
      showToast(error instanceof Error ? error.message : 'تعذر مزامنة حصة التوقيت.', 'error');
    }
  };

  const handleDeleteSlot = async (slotId: string) => {
    try {
      await updateStateAndWait(prev => ({
        ...prev,
        timetable: prev.timetable.filter(s => s.id !== slotId)
      }));
      showToast('تم حذف حصة التوقيت ومزامنة الحذف مع السحابة.', 'success');
    } catch (error: unknown) {
      console.error('Timetable slot deletion sync failed:', error);
      showToast(error instanceof Error ? error.message : 'تعذر مزامنة حذف حصة التوقيت.', 'error');
    }
  };

  const promptDeleteSlot = (slot: TimetableSlot) => {
    const cls = state.classes.find(c => c.id === slot.classId);
    setDeleteConfirmDialog({
      isOpen: true,
      type: 'slot',
      id: slot.id,
      name: `حصة ${dayNames[slot.dayOfWeek]} ${slot.startTime} - ${slot.endTime}${cls ? ` (${cls.name})` : ''}`
    });
  };

  // ---------------------------------------------
  // Student Operations & Excel / CSV Platform Import
  // ---------------------------------------------
  const applyDigitizationImport = async (parsedData: ParsedDigitizationResult) => {
    let targetClassIdToSelect: string | null = null;
    let summaryNotificationMsg: string | null = null;
    const importedClasses: RosterImportClass[] = [];
    const importedStudents: RosterImportStudent[] = [];

    const updatedClasses = state.classes.map(classRoom => ({ ...classRoom }));
    let updatedStudents = state.students.map(student => ({ ...student }));
    let totalNewStudentsAdded = 0;
    let totalExistingStudentsRetained = 0;
    const processedClassIds: string[] = [];

    // Loop through all parsed classes from all sheets in the Excel file
    parsedData.classes.forEach((pClass, idx) => {
      // Check if class already exists by exact name or matching normalized name
      let classObj = updatedClasses.find(
        c => !processedClassIds.includes(c.id) && isSameClass(c.name, pClass.className)
      );

      // If not found, check if there's an unused placeholder class (e.g., "قسم جديد" with 0 students)
      if (!classObj) {
        const placeholderIdx = updatedClasses.findIndex(
          c => (c.name.includes('قسم جديد') || c.name.trim() === '') &&
               !updatedStudents.some(s => s.classId === c.id) &&
               !processedClassIds.includes(c.id)
        );
        if (placeholderIdx !== -1) {
          classObj = updatedClasses[placeholderIdx];
          classObj.name = pClass.className;
          classObj.level = pClass.level;
          classObj.stream = pClass.stream;
          classObj.color = classObj.color || pickClassColor(updatedClasses.map(c => c.color));
        }
      }

      // If still not found, create a brand new class
      if (!classObj) {
        const newClassId = uuidv4();
        classObj = {
          id: newClassId,
          name: pClass.className,
          level: pClass.level,
          stream: pClass.stream,
          color: pickClassColor(updatedClasses.map(c => c.color)),
        };
        updatedClasses.push(classObj);
      } else {
        // Update level and stream based on exact parsing
        classObj.level = pClass.level;
        classObj.stream = pClass.stream;
      }

      processedClassIds.push(classObj.id);
      importedClasses.push({
        id: classObj.id,
        name: classObj.name,
        level: classObj.level,
        stream: classObj.stream,
        roomNumber: classObj.roomNumber,
        color: classObj.color,
      });

      // Process students for this specific class
      const existingStudentsInClass = updatedStudents.filter(s => s.classId === classObj!.id);
      const studentLookupByReg = new Map<string, Student>();
      const studentLookupByName = new Map<string, Student>();
      const importedKeys = new Set<string>();

      existingStudentsInClass.forEach(s => {
        if (s.regNumber) studentLookupByReg.set(s.regNumber, s);
        if (s.fullName) studentLookupByName.set(getStudentNameKey(s.fullName), s);
      });

      pClass.students.forEach(importedStudent => {
        const importedKey = getStudentNameKey(importedStudent.fullName);
        const duplicateKey = importedStudent.regNumber
          ? `reg:${importedStudent.regNumber.trim()}`
          : `name:${importedKey}`;
        if (importedKeys.has(duplicateKey)) return;
        importedKeys.add(duplicateKey);

        const matchByReg = importedStudent.regNumber ? studentLookupByReg.get(importedStudent.regNumber) : null;
        const matchByName =
          studentLookupByName.get(importedKey) ||
          existingStudentsInClass.find(s => isSameStudentName(s.fullName, importedStudent.fullName));

        if (matchByReg || matchByName) {
          totalExistingStudentsRetained++;
          const targetExisting = matchByReg || matchByName;
          if (targetExisting && importedStudent.regNumber && !targetExisting.regNumber) {
            targetExisting.regNumber = importedStudent.regNumber;
            targetExisting.registrationNumber = importedStudent.regNumber;
          }
        } else {
          totalNewStudentsAdded++;
          const newStudent: Student = {
            ...importedStudent,
            id: uuidv4(),
            classId: classObj!.id, // STRICTLY ASSIGNED TO THIS CLASS ID!
          };
          updatedStudents.push(newStudent);
          importedStudents.push(newStudent);
        }
        if (matchByReg || matchByName) {
          const retained = matchByReg || matchByName;
          if (retained) {
            importedStudents.push({
              ...retained,
              classId: classObj.id,
            });
          }
        }
      });
    });

    // Set the active class to the first imported class
    const firstClassId = processedClassIds[0] || state.activeClassId || (updatedClasses.length > 0 ? updatedClasses[0].id : null);
    targetClassIdToSelect = firstClassId;

    // Summary notification
    summaryNotificationMsg = `تم تجهيز ${parsedData.classes.length} أفواج تربوية: إضافة ${totalNewStudentsAdded} تلميذاً وتحديث ${totalExistingStudentsRetained} تلميذاً.`;

    // Update profile if schoolName or academicYear were detected
    const updatedProfile = { ...state.profile };
    if (parsedData.schoolName && (!state.profile.schoolName || state.profile.schoolName.includes('ثانوية'))) {
      updatedProfile.schoolName = parsedData.schoolName;
    }
    if (parsedData.academicYear) {
      updatedProfile.academicYear = parsedData.academicYear;
    }
    if (parsedData.stateName) {
      updatedProfile.stateName = parsedData.stateName;
    }

    const nextState: AppState = {
      ...state,
      classes: updatedClasses,
      students: updatedStudents,
      activeClassId: firstClassId,
      profile: updatedProfile,
    };

    if (targetClassIdToSelect) setSelectedClassId(targetClassIdToSelect);
    if (summaryNotificationMsg) setImportNotification(summaryNotificationMsg);
    setPendingImport(null);

    try {
      await commitRosterImport(importedClasses, importedStudents, nextState);
      showToast('تم استيراد القوائم ومزامنتها سحابياً بنجاح.', 'success');
    } catch (error) {
      console.error('Atomic roster import sync failed:', error);
      showToast('تم حفظ الاستيراد محلياً، وتعذرت المصادقة السحابية للدفعة. ستتم إعادة المحاولة عبر المزامنة.', 'warning');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setImportNotification('حجم الملف كبير جداً. الحد الأقصى للاستيراد هو 20 ميغابايت.');
      e.target.value = '';
      return;
    }
    try {
      const { parseDigitizationFile } = await import('@/lib/excel-sync');
      const parsedData = await parseDigitizationFile(file);
      setPendingImport(parsedData);
    } catch (err: any) {
      console.error('File import error:', err);
      showToast(err.message || 'حدث خطأ أثناء قراءة الملف. يرجى التأكد من أنه ملف الرقمنة الأصلي.', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ---------------------------------------------
  // Moumtaze (برنامج الممتاز) Import Handlers
  // ---------------------------------------------
  const handleMoumtazeFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingMoumtaze(true);
    try {
      const { parseMoumtazeFile } = await import('@/lib/moumtaze-sync');
      const result = await parseMoumtazeFile(file);
      if (result.classes.length === 0) {
        showToast('لم يتم العثور على أي قوائم أقسام داخل هذا الملف. يرجى التأكد من اختيار ملف برنامج الممتاز الصحيح.', 'warning');
        return;
      }

      setMoumtazeData(result);
      // Pre-select all detected classes so the teacher can easily keep what they teach
      setSelectedMoumtazeClassIds(result.classes.map(c => c.id));
      setIsMoumtazeModalOpen(true);
    } catch (err: any) {
      console.error('Error parsing Moumtaze file:', err);
      showToast('حدث خطأ أثناء قراءة ملف الممتاز: ' + (err.message || 'تأكد من سلامة ملف Excel'), 'error');
    } finally {
      setIsParsingMoumtaze(false);
      if (moumtazeFileInputRef.current) moumtazeFileInputRef.current.value = '';
    }
  };

  const handleToggleSelectMoumtazeClass = (id: string) => {
    setSelectedMoumtazeClassIds(prev =>
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  const handleSelectAllMoumtazeClasses = () => {
    if (!moumtazeData) return;
    setSelectedMoumtazeClassIds(moumtazeData.classes.map(c => c.id));
  };

  const handleDeselectAllMoumtazeClasses = () => {
    setSelectedMoumtazeClassIds([]);
  };

  const handleConfirmMoumtazeImport = async () => {
    if (!moumtazeData || selectedMoumtazeClassIds.length === 0) {
      showToast('يرجى تحديد قسم واحد على الأقل للاستيراد.', 'warning');
      return;
    }

    const classesToImport = moumtazeData.classes.filter(c => selectedMoumtazeClassIds.includes(c.id));
    const conflicts = findImportConflicts(classesToImport.map(mClass => ({
      className: mClass.className,
      students: mClass.students
    })));
    if (conflicts.length > 0) {
      setImportConflicts(conflicts);
      setImportNotification(
        `توقف الاستيراد للمراجعة: توجد ${conflicts.length} حالات تحتاج قراراً يدوياً. لم يتم تغيير أي بيانات.`
      );
      return;
    }
    let targetClassIdToSelect: string | null = null;
    let totalAdded = 0;
    let totalUpdated = 0;
    const importedClasses: RosterImportClass[] = [];
    const importedStudents: RosterImportStudent[] = [];

    const updatedClasses = state.classes.map(classRoom => ({ ...classRoom }));
    let updatedStudents = state.students.map(student => ({ ...student }));
    const processedClassIds: string[] = [];

    classesToImport.forEach((mClass, idx) => {
      // Check if class already exists by exact name or normalized matching
      let classObj = updatedClasses.find(c => !processedClassIds.includes(c.id) && isSameClass(c.name, mClass.className));

      // Check if placeholder class exists
      if (!classObj) {
        const placeholderIdx = updatedClasses.findIndex(
          c => (c.name.includes('قسم جديد') || c.name.trim() === '') &&
               !updatedStudents.some(s => s.classId === c.id) &&
               !processedClassIds.includes(c.id)
        );
        if (placeholderIdx !== -1) {
          classObj = updatedClasses[placeholderIdx];
          classObj.name = mClass.className;
          classObj.level = mClass.level;
          classObj.stream = mClass.stream;
          if (mClass.roomNumber) classObj.roomNumber = mClass.roomNumber;
          classObj.color = classObj.color || pickClassColor(updatedClasses.map(c => c.color));
        }
      }

      // If not found, create new class
      if (!classObj) {
        const newClassId = uuidv4();
        classObj = {
          id: newClassId,
          name: mClass.className,
          level: mClass.level,
          stream: mClass.stream,
          roomNumber: mClass.roomNumber || 'القاعة 01',
          color: pickClassColor(updatedClasses.map(c => c.color)),
        };
        updatedClasses.push(classObj);
      } else {
        // Update room number if detected from Moumtaze
        if (mClass.roomNumber) {
          classObj.roomNumber = mClass.roomNumber;
        }
        classObj.level = mClass.level;
        classObj.stream = mClass.stream;
      }

      processedClassIds.push(classObj.id);
      importedClasses.push({
        id: classObj.id,
        name: classObj.name,
        level: classObj.level,
        stream: classObj.stream,
        roomNumber: classObj.roomNumber,
        color: classObj.color,
      });

      // Process students for this class
      const existingInClass = updatedStudents.filter(s => s.classId === classObj!.id);
      const importedKeys = new Set<string>();

      mClass.students.forEach(mStudent => {
        // Extra guard: ignore any summary rows like "مجموع الذكور والإناث", "ذكور", "إناث", "المجموع"
        if (isSchoolSummaryOrFooterRow(mStudent.fullName)) {
          return;
        }

        const importedKey = `name:${getStudentNameKey(mStudent.fullName)}`;
        if (importedKeys.has(importedKey)) return;
        importedKeys.add(importedKey);

        const exactExisting = existingInClass.find(
          s => getStudentNameKey(s.fullName) === getStudentNameKey(mStudent.fullName)
        );
        const fuzzyCandidates = existingInClass.filter(
          s => isSameStudentName(s.fullName, mStudent.fullName)
        );
        const existing = exactExisting || (fuzzyCandidates.length === 1 ? fuzzyCandidates[0] : undefined);
        if (existing) {
          totalUpdated++;
          existing.isRepeater = mStudent.isRepeater;
          if (mStudent.birthDate && !existing.birthDate) existing.birthDate = mStudent.birthDate;
          if (mStudent.gender) existing.gender = mStudent.gender;
          if (mStudent.address && !existing.notes) existing.notes = `العنوان: ${mStudent.address}`;
          importedStudents.push({ ...existing, classId: classObj.id });
        } else {
          totalAdded++;
          const newStudent: Student = {
            id: uuidv4(),
            classId: classObj!.id,
            numberInList: mStudent.numberInList,
            fullName: mStudent.fullName,
            gender: mStudent.gender,
            birthDate: mStudent.birthDate,
            isRepeater: mStudent.isRepeater,
            notes: mStudent.address ? `العنوان: ${mStudent.address}` : undefined,
          };
          updatedStudents.push(newStudent);
          importedStudents.push(newStudent);
        }
      });

      // Ensure all students in this class are strictly numbered 1..N starting from 1
      const allInThisClass = updatedStudents
        .filter(s => s.classId === classObj!.id)
        .sort((a, b) => (a.numberInList || 0) - (b.numberInList || 0));

      allInThisClass.forEach((st, sIdx) => {
        st.numberInList = sIdx + 1;
      });
    });

    const firstClassId = processedClassIds[0] || state.activeClassId || (updatedClasses.length > 0 ? updatedClasses[0].id : null);
    targetClassIdToSelect = firstClassId;

    const updatedProfile = { ...state.profile };
    if (moumtazeData.schoolName && (!state.profile.schoolName || state.profile.schoolName.includes('ثانوية'))) {
      updatedProfile.schoolName = moumtazeData.schoolName;
    }
    if (moumtazeData.academicYear) {
      updatedProfile.academicYear = moumtazeData.academicYear;
    }
    if (moumtazeData.stateName) {
      updatedProfile.stateName = moumtazeData.stateName;
    }

    const nextState: AppState = {
      ...state,
      classes: updatedClasses,
      students: updatedStudents,
      activeClassId: firstClassId,
      profile: updatedProfile,
    };

    if (targetClassIdToSelect) {
      setSelectedClassId(targetClassIdToSelect);
    }
    setImportNotification(
      `تم تجهيز ${classesToImport.length} أفواج للمزامنة من برنامج الممتاز (${totalAdded} تلميذاً جديداً، و ${totalUpdated} تلميذ تم تحديث بياناتهم وحفظ القاعات).`
    );
    setIsMoumtazeModalOpen(false);
    setMoumtazeData(null);
    try {
      await commitRosterImport(importedClasses, importedStudents, nextState);
      showToast('تم استيراد قوائم الممتاز ومزامنتها سحابياً بنجاح.', 'success');
    } catch (error) {
      console.error('Atomic Moumtaze roster sync failed:', error);
      showToast('تم حفظ الاستيراد محلياً، وتعذرت المصادقة السحابية للدفعة. ستتم إعادة المحاولة عبر المزامنة.', 'warning');
    }
  };

  // Quick Paste Names Parser
  const handleQuickPasteNames = async () => {
    if (!pastedNames.trim() || !selectedClassId) return;

    const lines = pastedNames
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    const newStudents: Student[] = [];
    let startNum = classStudents.length + 1;

    for (const line of lines) {
      // remove leading numbers if present (e.g., "1. بن ددوش صهيب" -> "بن ددوش صهيب")
      const cleaned = line.replace(/^[\d\s.\-_)\]]+/, '').trim();

      // Skip any statistical/summary lines (e.g. مجموع الذكور والإناث)
      if (isSchoolSummaryOrFooterRow(cleaned)) {
        continue;
      }

      if (cleaned.length > 1) {
        newStudents.push({
          id: uuidv4(),
          classId: selectedClassId,
          numberInList: startNum++,
          fullName: cleaned,
          gender: 'M' });
      }
    }

    setPastedNames('');
    setIsPasteModalOpen(false);

    if (newStudents.length > 0) {
      try {
        await updateStateAndWait(prev => {
        const combined = [...prev.students, ...newStudents];
        // Renumber all students in this class strictly starting from 1 continuously
        const inClass = combined
          .filter(s => s.classId === selectedClassId)
          .sort((a, b) => (a.numberInList || 0) - (b.numberInList || 0));

        const idToNumber = new Map<string, number>();
        inClass.forEach((st, idx) => {
          idToNumber.set(st.id, idx + 1);
        });

        const renumbered = combined.map(st => {
          if (st.classId === selectedClassId && idToNumber.has(st.id)) {
            return { ...st, numberInList: idToNumber.get(st.id)! };
          }
          return st;
        });

        return { ...prev, students: renumbered };
        });
        setImportNotification(`تمت إضافة ${newStudents.length} تلميذاً عبر اللصق السريع مع ضبط الترقيم التسلسلي من 1.`);
      } catch (error: unknown) {
        console.error('Quick paste sync failed:', error);
        showToast(error instanceof Error ? error.message : 'تعذرت مزامنة التلاميذ المضافين.', 'error');
        return;
      }
    }
  };

  // Export Students to Excel
  const handleExportStudentsExcel = () => {
    if (!activeClassObj) return;

    const exportData = classStudents.map((s, idx) => ({
      'الرقم في القائمة': s.numberInList || idx + 1,
      'الاسم واللقب': s.fullName,
      'الجنس': s.gender === 'M' ? 'ذكر' : 'أنثى',
      'رقم التسجيل': s.registrationNumber || '-',
      'القسم': activeClassObj.name,
      'الشعبة': activeClassObj.stream
    }));

    void import('xlsx').then(({ utils, writeFile }) => {
      const ws = utils.json_to_sheet(exportData);
      if (!ws['!dir']) ws['!dir'] = 'rtl';
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'قائمة التلاميذ');
      writeFile(wb, `قائمة_${activeClassObj.name.replace(/\s+/g, '_')}.xlsx`);
    }).catch((error) => {
      console.error('Excel export failed:', error);
      showToast('تعذر تصدير ملف Excel.', 'error');
    });
  };

  const handleSaveStudent = async () => {
    if (!editingStudent || !editingStudent.fullName || !selectedClassId) return;
    if (isSaving) return; // Prevent double-submit
    const studentToSave = {
      ...editingStudent,
      id: editingStudent.id || uuidv4(),
    };
    setIsSaving(true);
    try {
      await updateStateAndWait(prev => {
      const idx = prev.students.findIndex(s => s.id === studentToSave.id);
      let updated = [...prev.students];
      if (idx >= 0) {
        updated[idx] = studentToSave as Student;
      } else {
        updated.push({
          ...(studentToSave as Student),
          classId: selectedClassId,
          numberInList: studentToSave.numberInList || classStudents.length + 1
        });
      }

      // Re-index this class strictly starting from 1
      const inClass = updated
        .filter(s => s.classId === selectedClassId)
        .sort((a, b) => (a.numberInList || 0) - (b.numberInList || 0));

      const idToNumber = new Map<string, number>();
      inClass.forEach((st, sIdx) => {
        idToNumber.set(st.id, sIdx + 1);
      });

      const renumbered = updated.map(st => {
        if (st.classId === selectedClassId && idToNumber.has(st.id)) {
          return { ...st, numberInList: idToNumber.get(st.id)! };
        }
        return st;
      });

      return { ...prev, students: renumbered };
      });
      showToast('تم حفظ التلميذ ومزامنته مع السحابة.', 'success');
      // Only close modal after successful save
      setIsStudentModalOpen(false);
      setEditingStudent(null);
    } catch (error: unknown) {
      console.error('Student sync failed:', error);
      showToast(error instanceof Error ? error.message : 'تعذر مزامنة التلميذ. يمكنك إعادة المحاولة.', 'error');
      // Keep modal open so user can retry
    } finally {
      setIsSaving(false);
    }
  };

  const promptDeleteStudent = (student: Student) => {
    setDeleteConfirmDialog({
      isOpen: true,
      type: 'student',
      id: student.id,
      name: `${student.fullName} (رقم ${student.numberInList})`
    });
  };

  // Re-sequence the active class numbers starting from 1 and clean any summary rows
  const handleResequenceCurrentClass = async () => {
    if (!selectedClassId) return;
    try {
      await updateStateAndWait(prev => {
      // 1. Filter out any accidental summary rows like "ذكور" or "إناث" or "المجموع" 
      const cleaned = prev.students.filter(s => {
        if (s.classId !== selectedClassId) return true;
        return !isSchoolSummaryOrFooterRow(s.fullName);
      });

      // 2. Sort existing students by their current order
      const inClass = cleaned
        .filter(s => s.classId === selectedClassId)
        .sort((a, b) => (a.numberInList || 0) - (b.numberInList || 0));

      // 3. Assign continuous numbers strictly starting from 1: 1, 2, 3...
      const idToNumber = new Map<string, number>();
      inClass.forEach((st, idx) => {
        idToNumber.set(st.id, idx + 1);
      });

      const renumbered = cleaned.map(st => {
        if (st.classId === selectedClassId && idToNumber.has(st.id)) {
          return { ...st, numberInList: idToNumber.get(st.id)! };
        }
        return st;
      });

      return { ...prev, students: renumbered };
      });
      setImportNotification('تم تحديث وإعادة ضبط ترقيم تلاميذ القسم تسلسلياً بدءاً من 1.');
    } catch (error: unknown) {
      console.error('Student resequence sync failed:', error);
      showToast(error instanceof Error ? error.message : 'تعذرت مزامنة إعادة الترقيم.', 'error');
    }
  };

  const handleExecuteDelete = async () => {
    if (!deleteConfirmDialog) return;
    const { type, id } = deleteConfirmDialog;
    setDeleteConfirmDialog(null);

    if (type === 'student') {
      try {
        await updateStateAndWait(prev => {
        const studentToDelete = prev.students.find(s => s.id === id);
        const classId = studentToDelete?.classId || selectedClassId;
        const remainingStudents = prev.students.filter(s => s.id !== id);

        // Resequence remaining students in this class strictly starting from 1 continuously
        const targetClassIds = classId ? [classId] : Array.from(new Set(remainingStudents.map(s => s.classId)));

        const idToNewNumber = new Map<string, number>();
        targetClassIds.forEach(cId => {
          const inClass = remainingStudents
            .filter(s => s.classId === cId && !isSchoolSummaryOrFooterRow(s.fullName))
            .sort((a, b) => (a.numberInList || 0) - (b.numberInList || 0));

          inClass.forEach((st, idx) => {
            idToNewNumber.set(st.id, idx + 1);
          });
        });

        const updatedStudents = remainingStudents
          .filter(s => !isSchoolSummaryOrFooterRow(s.fullName))
          .map(st => {
            if (idToNewNumber.has(st.id)) {
              return { ...st, numberInList: idToNewNumber.get(st.id)! };
            }
            return st;
          });

        return {
          ...prev,
          students: updatedStudents,
          grades: prev.grades.filter(g => g.studentId !== id)
        };
        });
        showToast('تم حذف التلميذ ومزامنة الحذف مع السحابة.', 'success');
      } catch (error: unknown) {
        console.error('Student deletion sync failed:', error);
        showToast(error instanceof Error ? error.message : 'تعذرت مزامنة حذف التلميذ.', 'error');
        return;
      }
    } else if (type === 'class') {
      try {
        await updateStateAndWait(prev => ({
          ...prev,
          classes: prev.classes.filter(c => c.id !== id),
          students: prev.students.filter(s => s.classId !== id),
          timetable: prev.timetable.filter(s => s.classId !== id),
          activeClassId:
            prev.activeClassId === id
              ? prev.classes.find(c => c.id !== id)?.id || null
              : prev.activeClassId
        }));
        showToast('تم حذف القسم ومزامنة الحذف مع السحابة.', 'success');
      } catch (error: unknown) {
        console.error('Class deletion sync failed:', error);
        showToast(error instanceof Error ? error.message : 'تعذرت مزامنة حذف القسم.', 'error');
        return;
      }
    } else if (type === 'slot') {
      await handleDeleteSlot(id);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="classes-manager-view">

      {/* Notification Toast */}
      {importNotification && (
        <div className="p-3 rounded-xl bg-[var(--primary-soft)] border border-[var(--primary)]/20 text-xs text-[var(--text-primary)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0" />
            <span>{importNotification}</span>
          </div>
          <button
            onClick={() => setImportNotification(null)}
            className="text-[var(--primary)] hover:text-[var(--text-primary)] font-bold" >
            إغلاق
          </button>
        </div>
      )}

      {importConflicts.length > 0 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-conflicts-title"
            dir="rtl"
            className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-amber-200 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <h2 id="import-conflicts-title" className="text-base font-black text-amber-950">
                    مراجعة حالات الاستيراد الملتبسة
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-amber-900">
                    لم يتم تغيير أي تلميذ أو درجة. راجع المرشحين ثم صحح الملف أو بيانات التلميذ قبل إعادة المحاولة.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImportConflicts([])}
                className="rounded-lg p-2 text-amber-800 hover:bg-amber-100"
                aria-label="إغلاق مراجعة التعارضات"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
              {importConflicts.map((conflict, index) => (
                <article key={`${conflict.className}-${conflict.importedName}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-black text-slate-900">{conflict.importedName}</div>
                    <span className="rounded-md bg-white px-2 py-1 text-[11px] font-bold text-slate-600">
                      القسم: {conflict.className}
                    </span>
                  </div>
                  {conflict.importedRegNumber && (
                    <div className="mt-2 text-[11px] font-semibold text-slate-600">
                      رقم التعريف: <span className="font-mono">{conflict.importedRegNumber}</span>
                    </div>
                  )}
                  <div className="mt-2 flex items-start gap-2 text-xs font-bold text-amber-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{conflict.reason}</span>
                  </div>
                  {conflict.candidates.length > 0 && (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <div className="mb-2 text-[11px] font-black text-slate-700">السجلات المحتملة:</div>
                      <div className="space-y-1.5">
                        {conflict.candidates.map(candidate => (
                          <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs">
                            <span className="font-bold text-slate-800">{candidate.fullName}</span>
                            <span className="text-slate-500">
                              {candidate.birthDate || 'تاريخ الميلاد غير متوفر'}
                              {candidate.regNumber ? ` • ${candidate.regNumber}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>

            <div className="flex justify-end border-t border-slate-200 p-4">
              <button
                type="button"
                onClick={() => setImportConflicts([])}
                className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
              >
                فهمت، العودة للمعاينة
              </button>
            </div>
          </section>
        </div>
      )}

      {mergePair && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-merge-title"
            dir="rtl"
            className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-amber-200 bg-amber-50 p-5">
              <div>
                <h2 id="student-merge-title" className="text-base font-black text-amber-950">دمج سجلّي التلميذ</h2>
                <p className="mt-1 text-xs leading-5 text-amber-900">
                  اختر السجل الأساسي. ستُنقل إليه مراجع الحضور والسلوك، وستُحفظ الدرجة الموجودة عند تعارض درجتين.
                </p>
              </div>
              <button type="button" onClick={() => setMergePair(null)} className="rounded-lg p-2 text-amber-800 hover:bg-amber-100" aria-label="إلغاء الدمج">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {[mergePair.primary, mergePair.duplicate].map((student, index) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => setMergePair(index === 0
                    ? mergePair
                    : { primary: mergePair.duplicate, duplicate: mergePair.primary })}
                  className={`rounded-xl border p-4 text-right transition-colors ${
                    index === 0
                      ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                      : 'border-slate-200 bg-slate-50 hover:border-amber-300'
                  }`}
                >
                  <div className="text-[11px] font-bold text-slate-500">
                    {index === 0 ? 'السجل الأساسي الحالي' : 'السجل الذي سيُدمج'}
                  </div>
                  <div className="mt-2 text-sm font-black text-slate-900">{student.fullName}</div>
                  <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                    <div>الرقم: {student.numberInList}</div>
                    <div>رقم التعريف: {student.regNumber || student.registrationNumber || 'غير متوفر'}</div>
                    <div>تاريخ الميلاد: {student.birthDate || 'غير متوفر'}</div>
                  </div>
                  {index === 1 && <div className="mt-3 text-[11px] font-bold text-amber-800">انقر لجعله السجل الأساسي</div>}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
              <button type="button" onClick={() => setMergePair(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
                إلغاء
              </button>
              <button type="button" onClick={handleMergeStudents} className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90">
                دمج مع الحفاظ على السجلات
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation">
          <section
            role="dialog" aria-modal="true" aria-labelledby="digitization-import-preview-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div id="digitization-import-preview-title" className="text-lg font-black text-slate-900">معاينة استيراد ملف الرقمنة</div>
                <p className="mt-1 text-sm text-slate-600">لن يتم تعديل البيانات قبل تأكيدك.</p>
              </div>
              <button type="button" onClick={() => setPendingImport(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="إلغاء المعاينة">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-2xl font-black text-slate-900">{pendingImport.classes.length}</div>
                <div className="text-xs font-bold text-slate-600">الأفواج المكتشفة</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-2xl font-black text-slate-900">{pendingImport.totalStudents}</div>
                <div className="text-xs font-bold text-slate-600">التلاميذ المكتشفون</div>
              </div>
            </div>
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
              سيتم الاحتفاظ بالتلاميذ الموجودين وإضافة غير الموجودين، مع تحديث معلومات المؤسسة المكتشفة إن وُجدت.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingImport(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                إلغاء
              </button>
              <button type="button" onClick={handleConfirmDigitizationImport} className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-bold text-white hover:opacity-90">
                تأكيد الاستيراد
              </button>
            </div>
          </section>
        </div>
      )}

      {/* --------------------------------------------- */}
      {/* SUB-TAB 1: CLASSES LIST */}
      {/* --------------------------------------------- */}
      {activeSubTab === 'classes' && (
        <div className="space-y-4">
          <input
            type="file"
            ref={fileInputRef}
            accept=".xlsx, .xls, .csv"
            onChange={handleFileUpload}
            className="hidden"
          />
          <input
            type="file"
            ref={moumtazeFileInputRef}
            accept=".xlsx, .xls"
            onChange={handleMoumtazeFileUpload}
            className="hidden"
          />
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs font-bold text-slate-700">
              {state.profile.schoolName
                ? `قائمة الأقسام في ${state.profile.schoolName.startsWith('ثانوية') ? state.profile.schoolName : 'ثانوية ' + state.profile.schoolName}`
                : 'قائمة الأقسام المسندة'}
            </div>
            <div className="text-[11px] text-slate-500 font-semibold">
              {state.classes.length} أقسام • {state.students.length} تلاميذ • {state.timetable.length} حصص مبرمجة
            </div>
            <button
              onClick={handleOpenAddClass}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-[var(--warning-soft)]0 text-white text-xs font-bold shadow-xs cursor-pointer" id="btn-add-new-class" >
              <Plus className="w-4 h-4" />
              <span>إضافة قسم جديد</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={classSearch}
              onChange={event => setClassSearch(event.target.value)}
              placeholder="ابحث باسم القسم أو الشعبة..."
              aria-label="البحث في الأقسام"
              className="flex-1 min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
            <select
              value={classLevelFilter}
              onChange={event => setClassLevelFilter(event.target.value as GradeLevel | 'ALL')}
              aria-label="تصفية الأقسام حسب المستوى"
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              <option value="ALL">كل المستويات</option>
              <option value="1AS_ARTS">1AS آداب</option>
              <option value="1AS_SCIENCE">1AS علوم</option>
              <option value="2AS">2AS</option>
              <option value="3AS">3AS</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleClasses.map(cls => {
              const studentsCount = state.students.filter(s => s.classId === cls.id).length;
              const slotsCount = state.timetable.filter(s => s.classId === cls.id).length;

              return (
                <div
                  key={cls.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition-all space-y-3 overflow-hidden" id={`class-card-${cls.id}`}
                  style={{ borderTop: `3px solid ${cls.color || DEFAULT_CLASS_COLOR}` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-4 h-4 rounded-full ring-2 ring-white shadow-xs" style={{ backgroundColor: cls.color || DEFAULT_CLASS_COLOR }}
                      />
                      <h3 className="text-base font-black text-slate-900">{cls.name}</h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEditClass(cls)}
                        className="min-h-10 min-w-10 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center justify-center" title="تعديل القسم" aria-label={`تعديل قسم ${cls.name}`} >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => promptDeleteClass(cls)}
                        className="min-h-10 min-w-10 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer flex items-center justify-center" title="حذف القسم" aria-label={`حذف قسم ${cls.name}`} >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-500">الشعبة:</span>
                      <span className="font-bold text-slate-800">{cls.stream}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">المستوى الدراسي:</span>
                      <span className="font-bold text-slate-800">
                        {cls.level === '3AS' ? 'السنة الثالثة ثانوي' : cls.level === '2AS' ? 'السنة الثانية ثانوي' : cls.level === '1AS_ARTS' ? 'السنة الأولى ثانوي (ج.م آداب)' : 'السنة الأولى ثانوي (ج.م علوم)'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">القاعة المخصصة:</span>
                      <span className="font-mono text-slate-800">{cls.roomNumber || 'غير محدد'}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-slate-100">
                      <span className="text-slate-500">عدد التلاميذ:</span>
                      <span className="font-bold text-[var(--primary)]">{studentsCount} تلميذ</span>
                    </div>
                    {(() => {
                      const assignedSubjs = selectClassAssignedSubjectIds(state, cls);
                      const activeSubj = selectEffectiveSubjectId(state, cls);
                      if (assignedSubjs.length > 0) {
                        return (
                          <div className="pt-1.5 border-t border-slate-100 space-y-1.5">
                            <span className="block text-[11px] font-bold text-slate-500">
                              المواد المسندة للفوج (القرار 186/2006):
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {assignedSubjs.map(subjId => {
                                const isSubjActive = cls.id === state.activeClassId && activeSubj === subjId;
                                const coeff = getClassCoefficient(cls, subjId, state.educationOverrides);
                                const hours = getWeeklyHours(cls, subjId, state.educationOverrides);
                                return (
                                  <button
                                    key={subjId}
                                    type="button"
                                    onClick={() => {
                                      onUpdateState(prev => ({
                                        ...prev,
                                        activeClassId: cls.id,
                                        activeSubjectId: subjId,
                                      }));
                                      showToast(
                                        `تم تفعيل ${cls.name} — ${getSubjectDisplayName(subjId, state.profile.variantId)}`,
                                        'success'
                                      );
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                                      isSubjActive
                                        ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                    }`}
                                  >
                                    <span>{getSubjectDisplayName(subjId, state.profile.variantId)}</span>
                                    <span
                                      className={`px-1.5 py-0.2 rounded text-[10px] ${
                                        isSubjActive ? 'bg-white/20 text-white' : 'bg-white text-slate-600'
                                      }`}
                                    >
                                      م:{coeff} · {hours}سا
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div className="flex justify-between">
                          <span className="text-slate-500">الحصص الأسبوعية:</span>
                          <span className="font-bold text-slate-800">
                            {getWeeklyHours(cls, undefined, state.educationOverrides)} سا/أسبوع
                            {slotsCount > 0 ? ` • ${slotsCount} بالتوقيت` : ''}
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    {cls.id === state.activeClassId ? (
                      <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200/80 px-3 py-1.5 rounded-xl text-emerald-800 text-xs font-bold">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          القسم النشط حالياً
                        </span>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                          showToast(`تم تفعيل ${cls.name} كقسم نشط`, 'success');
                        }}
                        className="w-full min-h-10 py-1.5 px-3 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] hover:bg-[var(--primary)] text-[var(--primary)] hover:text-white text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Check className="w-4 h-4" />
                        <span>تفعيل كقسم نشط</span>
                      </button>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 grid grid-cols-3 gap-2">
                    <button
                      onClick={() => {
                        onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                        if (onNavigate) onNavigate('attendance');
                      }}
                      className="min-h-11 py-2 rounded-xl bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary)] text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      الحضور
                    </button>
                    <button
                      onClick={() => {
                        onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                        if (onNavigate) onNavigate('grades');
                      }}
                      className="min-h-11 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      النقاط
                    </button>
                    <button
                      onClick={() => {
                        setSelectedClassId(cls.id);
                        onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                        if (onNavigate) onNavigate('students');
                      }}
                      className="min-h-11 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      التفاصيل
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {visibleClasses.length === 0 && (
            state.classes.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-[var(--primary)]/30 bg-[var(--primary-soft)]/35 p-5 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[var(--primary)] shadow-xs">
                  <Users className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="text-base font-black text-[var(--text-primary)]">ابدأ بإضافة أقسامك</h3>
                <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-[var(--text-secondary)]">
                  الاستيراد من ملف الرقمنة هو أسرع مسار: سيحاول مُعين إنشاء الأقسام وقوائم التلاميذ دفعة واحدة، ويمكنك دائماً الإضافة يدوياً.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-black text-white shadow-xs active:scale-[0.98]"
                  >
                    <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
                    استيراد ملف الرقمنة
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenAddClass}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-[var(--border-default)] bg-white px-4 text-sm font-black text-[var(--text-primary)] hover:bg-[var(--bg-surface-subtle)]"
                  >
                    <Plus className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                    إضافة قسم يدوياً
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => moumtazeFileInputRef.current?.click()}
                  className="mt-3 min-h-11 rounded-xl px-4 text-xs font-bold text-[var(--primary)] hover:bg-white/70"
                >
                  أو استيراد ملف الممتاز
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <p className="text-sm font-bold text-slate-800">لا توجد أقسام مطابقة للبحث</p>
                <p className="text-xs text-slate-500 mt-1">جرّب تغيير عبارة البحث أو المستوى.</p>
              </div>
            )
          )}
        </div>
      )}

      {/* --------------------------------------------- */}
      {/* SUB-TAB 2: WEEKLY TIMETABLE */}
      {/* --------------------------------------------- */}
      {activeSubTab === 'timetable' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-slate-700">
              استعمال الزمن الأسبوعي - جدول التوقيت الدراسي (الأحد إلى الخميس)
            </div>
            <button
              onClick={() => handleOpenAddSlot(0)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs cursor-pointer" >
              <Plus className="w-4 h-4" />
              <span>إضافة حصة جديدة للجدول</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {dayNames.map((dayName, dayIndex) => {
              const daySlots = state.timetable
                .filter(s => s.dayOfWeek === dayIndex)
                .sort((a, b) => a.startTime.localeCompare(b.startTime));

              return (
                <div
                  key={dayIndex}
                  className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs flex flex-col" >
                  <div className="bg-slate-100 px-3 py-2.5 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-black text-slate-900">{dayName}</span>
                    <button
                      onClick={() => handleOpenAddSlot(dayIndex)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-600 cursor-pointer" title={`إضافة حصة ليوم ${dayName}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="p-2 space-y-2 flex-1 min-h-[220px]">
                    {daySlots.length === 0 ? (
                      <div className="text-center py-8 text-[11px] text-slate-400">
                        لا توجد حصص
                      </div>
                    ) : (
                      daySlots.map(slot => {
                        const cls = state.classes.find(c => c.id === slot.classId);
                        return (
                          <div
                            key={slot.id}
                            className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white transition-all space-y-1 relative group" >
                            <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 font-bold">
                              <span>
                                {slot.startTime} – {slot.endTime}
                              </span>
                              <div className="flex flex-col items-center gap-1">
                                <button
                                  onClick={() => {
                                    setEditingSlot(slot);
                                    setIsSlotModalOpen(true);
                                  }}
                                  className="min-w-8 min-h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-[var(--primary)] hover:bg-[var(--primary-soft)] transition-colors cursor-pointer" title="تعديل الحصة" >
                                  <Edit className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => promptDeleteSlot(slot)}
                                  className="min-w-8 min-h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-pointer" title="حذف الحصة" >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <div className="text-xs font-black text-slate-900">
                              {cls?.name || 'قسم غير معروف'}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {cls?.stream} {slot.room && `(ق ${slot.room})`}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --------------------------------------------- */}
      {/* SUB-TAB 3: STUDENTS ROSTER & DIGITAL PLATFORM */}
      {/* --------------------------------------------- */}
      {activeSubTab === 'students' && (
        <div className="space-y-4">
          {/* Class selector & actions bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-700">اختر القسم:</span>
              <select
                value={selectedClassId}
                onChange={e => setSelectedClassId(e.target.value)}
                className="bg-white px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 outline-none cursor-pointer" >
                {state.classes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.stream})
                  </option>
                ))}
              </select>
              {selectedClassId === state.activeClassId ? (
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  القسم النشط
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateState(prev => ({ ...prev, activeClassId: selectedClassId }));
                    showToast('تم تفعيل هذا القسم كقسم نشط', 'success');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-bold hover:bg-[var(--primary-hover)] transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>تفعيل كقسم نشط</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* File Input for Excel/CSV - Digitization */}
              <input
                type="file" ref={fileInputRef}
                accept=".xlsx, .xls, .csv" onChange={handleFileUpload}
                className="hidden" />

              {/* File Input for Excel - Moumtaze */}
              <input
                type="file" ref={moumtazeFileInputRef}
                accept=".xlsx, .xls" onChange={handleMoumtazeFileUpload}
                className="hidden" />

              <button
                type="button"
                onClick={() => setIsImportSheetOpen(true)}
                className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-bold text-white shadow-xs cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>استيراد أو إضافة تلاميذ</span>
              </button>

            </div>
          </div>

          {isImportSheetOpen && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 sm:items-center" role="presentation" onClick={() => setIsImportSheetOpen(false)}>
              <section role="dialog" aria-modal="true" aria-label="إجراءات قوائم التلاميذ" onClick={(event) => event.stopPropagation()} className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] p-4 shadow-2xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-black text-[var(--text-primary)]">إضافة أو استيراد التلاميذ</div>
                  <button type="button" onClick={() => setIsImportSheetOpen(false)} className="rounded-lg p-2 text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-subtle)]" aria-label="إغلاق">×</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => { setIsImportSheetOpen(false); moumtazeFileInputRef.current?.click(); }} className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-default)] p-3 text-right text-xs font-bold hover:bg-[var(--bg-surface-subtle)]"><Sparkles className="h-4 w-4 text-[var(--warning)]" />استيراد الممتاز</button>
                  <button type="button" onClick={() => { setIsImportSheetOpen(false); fileInputRef.current?.click(); }} className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-default)] p-3 text-right text-xs font-bold hover:bg-[var(--bg-surface-subtle)]"><FileSpreadsheet className="h-4 w-4 text-[var(--primary)]" />استيراد الرقمنة</button>
                  <button type="button" onClick={() => { setIsImportSheetOpen(false); setIsPasteModalOpen(true); }} className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-default)] p-3 text-right text-xs font-bold hover:bg-[var(--bg-surface-subtle)]"><ClipboardPaste className="h-4 w-4 text-[var(--primary)]" />لصق قائمة أسماء</button>
                  <button type="button" onClick={() => { setIsImportSheetOpen(false); setEditingStudent({ id: uuidv4(), classId: selectedClassId, numberInList: classStudents.length + 1, fullName: '', gender: 'M' }); setIsStudentModalOpen(true); }} className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-default)] p-3 text-right text-xs font-bold hover:bg-[var(--bg-surface-subtle)]"><Plus className="h-4 w-4 text-[var(--primary)]" />إضافة يدوية</button>
                  <button type="button" onClick={() => { setIsImportSheetOpen(false); handleExportStudentsExcel(); }} className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-default)] p-3 text-right text-xs font-bold hover:bg-[var(--bg-surface-subtle)] sm:col-span-2"><Download className="h-4 w-4 text-[var(--text-secondary)]" />تصدير قائمة Excel</button>
                </div>
              </section>
            </div>
          )}

          {/* Students Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-700">
              <div className="flex items-center gap-2">
                <span>تعداد القسم: {classStudents.length} تلميذ</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-500 font-normal text-[11px]">
                  الترقيم تسلسلي دائماً من 1 إلى {classStudents.length}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {duplicateNameGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMergePair({
                      primary: duplicateNameGroups[0][0],
                      duplicate: duplicateNameGroups[0][1]
                    })}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    <span>مراجعة التكرار ({duplicateNameGroups.length})</span>
                  </button>
                )}
                {classStudents.length > 0 && (
                  <button
                    onClick={handleResequenceCurrentClass}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium cursor-pointer transition-colors shadow-2xs" title="إعادة ضبط أرقام تلاميذ هذا القسم لتبدأ من 1 بالتسلسل دون أي انقطاع وحذف خانات المجموع إن وجدت" >
                    <RotateCcw className="w-3 h-3 text-slate-500" />
                    <span>إعادة ترتيب الأرقام (1 إلى {classStudents.length})</span>
                  </button>
                )}
              </div>
            </div>

            {classStudents.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs space-y-3">
                <Users className="w-8 h-8 text-slate-300 mx-auto" />
                <p>لا يوجد تلاميذ مسجلين في هذا القسم بعد.</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-bold cursor-pointer" >
                    استيراد من ملف الرقمنة (Excel)
                  </button>
                  <button
                    onClick={() => setIsPasteModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold cursor-pointer" >
                    لصق الأسماء نصياً
                  </button>
                </div>
              </div>
            ) : (
              <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold">
                    <tr>
                      <th className="py-2.5 px-4 w-14">#</th>
                      <th className="py-2.5 px-4">اسم ولقب التلميذ</th>
                      <th className="py-2.5 px-4 w-24">الجنس</th>
                      <th className="py-2.5 px-4">رقم التعريف / التسجيل</th>
                      <th className="py-2.5 px-4 w-28 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {classStudents.map(student => (
                      <tr key={student.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-4 font-mono font-bold text-slate-500">
                          {student.numberInList}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-slate-900">
                          {student.fullName}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              student.gender === 'F' ? 'bg-pink-50 text-pink-700' : 'bg-blue-50 text-blue-700' }`}
                          >
                            {student.gender === 'F' ? 'أنثى' : 'ذكر'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-500 text-[11px]">
                          {student.registrationNumber || '-'}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => {
                                setEditingStudent({ ...student });
                                setIsStudentModalOpen(true);
                              }}
                              className="min-h-10 min-w-10 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer inline-flex items-center justify-center" title="تعديل" aria-label={`تعديل بيانات ${student.fullName}`} >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => promptDeleteStudent(student)}
                              className="min-h-10 min-w-10 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer inline-flex items-center justify-center" title="حذف" aria-label={`حذف ${student.fullName}`} >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Mobile Cards */}
              <div className="block md:hidden divide-y divide-slate-100">
                {classStudents.map(student => (
                  <div key={student.id} className="p-4 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 font-mono font-bold flex items-center justify-center text-xs shrink-0">
                        {student.numberInList}
                      </span>
                      <div className="space-y-1">
                        <div className="font-bold text-sm text-slate-900">
                          {student.fullName}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              student.gender === 'F' ? 'bg-pink-50 text-pink-700' : 'bg-blue-50 text-blue-700' }`}
                          >
                            {student.gender === 'F' ? 'أنثى' : 'ذكر'}
                          </span>
                          {student.registrationNumber && (
                            <span className="font-mono text-slate-500 text-[10px]">
                              {student.registrationNumber}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setEditingStudent({ ...student });
                          setIsStudentModalOpen(true);
                        }}
                        className="min-h-10 min-w-10 p-2 text-slate-400 hover:text-slate-700 cursor-pointer bg-slate-50 rounded-lg inline-flex items-center justify-center" title="تعديل" aria-label={`تعديل بيانات ${student.fullName}`} >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => promptDeleteStudent(student)}
                        className="min-h-10 min-w-10 p-2 text-[var(--danger)] hover:opacity-80 cursor-pointer bg-[var(--danger-soft)] rounded-lg inline-flex items-center justify-center" title="حذف" aria-label={`حذف ${student.fullName}`} >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* --------------------------------------------- */}
      {/* MODAL: ADD / EDIT CLASS */}
      {/* --------------------------------------------- */}
      {isClassModalOpen && editingClass && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">
                {editingClass.name ? 'تعديل القسم' : 'إضافة قسم جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setIsClassModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg"
                aria-label="إغلاق النافذة" >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">تسمية القسم (مثال: 3 علوم 1):</label>
                <input
                  type="text" value={editingClass.name || ''}
                  onChange={e => setEditingClass({ ...editingClass, name: e.target.value })}
                  placeholder="3 علوم تجريبية 1" className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold focus:outline-amber-600" />
              </div>

              {(() => {
                const resolved = resolveLevelAndStream(editingClass);
                const availableStreams = getStreamsForLevel(resolved.levelCode);
                const streamOfferings = getSubjectsForStream(resolved.levelCode, resolved.streamId);
                const teacherSubjs = selectTeacherSubjectIds(state);
                const currentAssigned =
                  editingClass.assignedSubjectIds ??
                  editingClass.subjectIds ??
                  teacherSubjs.filter(id => streamOfferings.some(o => o.subjectId === id));

                return (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="font-bold text-slate-700">المستوى الدراسي:</label>
                        <select
                          value={resolved.levelCode}
                          onChange={e => {
                            const nextLevelCode = e.target.value as LevelCode;
                            const nextStreams = getStreamsForLevel(nextLevelCode);
                            const nextStream = nextStreams[0];
                            const legacyLevel = mapLevelAndStreamToLegacyGradeLevel(
                              nextLevelCode,
                              nextStream?.id
                            );
                            setEditingClass({
                              ...editingClass,
                              levelCode: nextLevelCode,
                              streamId: nextStream?.id,
                              level: legacyLevel,
                              stream: nextStream?.labelAr || editingClass.stream || '',
                            });
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold"
                        >
                          <option value="1AS">السنة الأولى ثانوي (1AS)</option>
                          <option value="2AS">السنة الثانية ثانوي (2AS)</option>
                          <option value="3AS">السنة الثالثة ثانوي (3AS)</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-slate-700">الشعبة / الجذع المشترك:</label>
                        <select
                          value={resolved.streamId}
                          onChange={e => {
                            const nextStreamId = e.target.value as StreamId;
                            const streamMeta = STREAMS_BY_ID[nextStreamId];
                            const legacyLevel = mapLevelAndStreamToLegacyGradeLevel(
                              resolved.levelCode,
                              nextStreamId
                            );
                            setEditingClass({
                              ...editingClass,
                              levelCode: resolved.levelCode,
                              streamId: nextStreamId,
                              level: legacyLevel,
                              stream: streamMeta?.labelAr || editingClass.stream || '',
                            });
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold"
                        >
                          {availableStreams.map(st => (
                            <option key={st.id} value={st.id}>
                              {st.labelAr}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Multi-subject assignment for this class */}
                    <div className="space-y-1.5 pt-1">
                      <label className="font-bold text-slate-700 block">
                        المواد التي تدرّسها لهذا الفوج (القرار 186/2006):
                      </label>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 rounded-lg border border-slate-200 bg-slate-50">
                        {(teacherSubjs.length > 0 ? ACTIVE_SUBJECTS.filter(s => teacherSubjs.includes(s.id) || streamOfferings.some(o => o.subjectId === s.id)) : ACTIVE_SUBJECTS).map(subj => {
                          const isChecked = currentAssigned.includes(subj.id);
                          const off = streamOfferings.find(o => o.subjectId === subj.id);
                          return (
                            <button
                              key={subj.id}
                              type="button"
                              onClick={() => {
                                const next = isChecked
                                  ? currentAssigned.filter(id => id !== subj.id)
                                  : [...currentAssigned, subj.id];
                                setEditingClass({
                                  ...editingClass,
                                  assignedSubjectIds: next,
                                  subjectIds: next,
                                });
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                                isChecked
                                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              <span>{subj.labelAr}</span>
                              {off && (
                                <span className="opacity-80 text-[10px]">
                                  (م:{off.coefficient ?? '-'} · {off.hours?.total ?? 2}سا)
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">القاعة:</label>
                  <input
                    type="text" value={editingClass.roomNumber || ''}
                    onChange={e => setEditingClass({ ...editingClass, roomNumber: e.target.value })}
                    placeholder="القاعة 04" className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">لون التمييز:</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {CLASS_COLORS.map(color => {
                      const isSelected = (editingClass.color || DEFAULT_CLASS_COLOR).toLowerCase() === color.toLowerCase();
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setEditingClass({ ...editingClass, color })}
                          aria-label={`اختيار اللون ${color}`}
                          aria-pressed={isSelected}
                          className={`h-8 w-8 rounded-lg border-2 transition-transform hover:scale-105 cursor-pointer ${isSelected ? 'border-slate-900 scale-105' : 'border-slate-200'}`}
                          style={{ backgroundColor: color }} />
                      );
                    })}
                    <input
                      type="color" value={editingClass.color || DEFAULT_CLASS_COLOR}
                      onChange={e => setEditingClass({ ...editingClass, color: e.target.value })}
                      aria-label="لون مخصص"
                      className="h-8 w-10 rounded-lg border border-slate-300 cursor-pointer bg-white p-0.5" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsClassModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700" >
                إلغاء
              </button>
              <button
                onClick={handleSaveClass}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-[var(--warning-soft)]0 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold" >
                {isSaving ? 'جارٍ الحفظ...' : 'حفظ القسم'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------- */}
      {/* MODAL: ADD / EDIT TIMETABLE SLOT */}
      {/* --------------------------------------------- */}
      {isSlotModalOpen && editingSlot && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">إضافة حصة إلى جدول التوقيت</h3>
              <button onClick={() => setIsSlotModalOpen(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">اليوم:</label>
                <select
                  value={editingSlot.dayOfWeek ?? 0}
                  onChange={e => setEditingSlot({ ...editingSlot, dayOfWeek: Number(e.target.value) as 0 | 1 | 2 | 3 | 4 })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold" >
                  {dayNames.map((name, i) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">القسم:</label>
                <select
                  value={editingSlot.classId || ''}
                  onChange={e => setEditingSlot({ ...editingSlot, classId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold" >
                  {state.classes.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.stream})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">من الساعة:</label>
                  <input
                    type="time" value={editingSlot.startTime || '08:00'}
                    onChange={e => setEditingSlot({ ...editingSlot, startTime: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">إلى الساعة:</label>
                  <input
                    type="time" value={editingSlot.endTime || '09:00'}
                    onChange={e => setEditingSlot({ ...editingSlot, endTime: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">القاعة:</label>
                <input
                  type="text" value={editingSlot.room || ''}
                  onChange={e => setEditingSlot({ ...editingSlot, room: e.target.value })}
                  placeholder="04" className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsSlotModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700" >
                إلغاء
              </button>
              <button
                onClick={handleSaveSlot}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold" >
                إضافة الحصة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------- */}
      {/* MODAL: QUICK PASTE NAMES */}
      {/* --------------------------------------------- */}
      {isPasteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">
                لصق قائمة أسماء التلاميذ سريعا
              </h3>
              <button
                type="button"
                onClick={() => setIsPasteModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                aria-label="إغلاق نافذة لصق الأسماء"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-slate-600">
                الصق أسماء التلاميذ هنا (اسم في كل سطر). سيقوم التطبيق بحذف الأرقام السابقة تلقائياً وإضافتها إلى قسم: 
                <span className="font-bold text-slate-900 mr-1">{activeClassObj?.name}</span>
              </p>
              <textarea
                rows={8}
                value={pastedNames}
                onChange={e => setPastedNames(e.target.value)}
                placeholder="1. الاسم واللقب&#10;2. الاسم واللقب&#10;3. الاسم واللقب..." className="w-full p-3 rounded-lg border border-slate-300 font-bold focus:outline-amber-600" />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsPasteModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700" >
                إلغاء
              </button>
              <button
                onClick={handleQuickPasteNames}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold" >
                معالجة وإضافة القائمة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------- */}
      {/* MODAL: ADD / EDIT SINGLE STUDENT */}
      {/* --------------------------------------------- */}
      {isStudentModalOpen && editingStudent && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">
                {editingStudent.fullName ? 'تعديل بيانات التلميذ' : 'إضافة تلميذ جديد'}
              </h3>
              <button onClick={() => setIsStudentModalOpen(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">الاسم واللقب:</label>
                <input
                  type="text" value={editingStudent.fullName || ''}
                  onChange={e => setEditingStudent({ ...editingStudent, fullName: e.target.value })}
                  placeholder="الاسم الكامل للتلميذ" className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">الرقم في القائمة:</label>
                  <input
                    type="number" value={editingStudent.numberInList || 1}
                    onChange={e =>
                      setEditingStudent({ ...editingStudent, numberInList: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">الجنس:</label>
                  <select
                    value={editingStudent.gender || 'M'}
                    onChange={e =>
                      setEditingStudent({ ...editingStudent, gender: e.target.value as 'M' | 'F' })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300" >
                    <option value="M">ذكر</option>
                    <option value="F">أنثى</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">رقم التعريف / التسجيل بالرقمنة:</label>
                <input
                  type="text" value={editingStudent.registrationNumber || ''}
                  onChange={e =>
                    setEditingStudent({ ...editingStudent, registrationNumber: e.target.value })
                  }
                  placeholder="اختياري" className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsStudentModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700" >
                إلغاء
              </button>
              <button
                onClick={handleSaveStudent}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold" >
                {isSaving ? 'جارٍ الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* --------------------------------------------- */}
      {/* MODAL: DELETE CONFIRMATION DIALOG (SAFE IN-APP DIALOG) */}
      {/* --------------------------------------------- */}
      {deleteConfirmDialog && deleteConfirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-slate-200" dir="rtl">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-[var(--danger-soft)] text-[var(--danger)] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">
                  {deleteConfirmDialog.type === 'class'
                    ? 'تأكيد حذف القسم'
                    : deleteConfirmDialog.type === 'student'
                      ? 'تأكيد حذف التلميذ'
                      : 'تأكيد حذف الحصة'}
                </h3>
                <span className="text-[11px] text-slate-500">هذا الإجراء لا يمكن التراجع عنه</span>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
              هل أنت متأكد من رغبتك في حذف{' '}
              <strong className="text-slate-900 font-black">«{deleteConfirmDialog.name}»</strong>؟
              {deleteConfirmDialog.type === 'class' && (
                <span className="block mt-1.5 text-rose-700 font-semibold text-[11px]">
                  ملاحظة: سيتم حذف جميع تلاميذ هذا القسم والعلامات المسجلة والحصص المرتبطة به في الجدول تلقائياً.
                </span>
              )}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button" onClick={() => setDeleteConfirmDialog(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer" >
                إلغاء الأمر
              </button>
              <button
                type="button" onClick={handleExecuteDelete}
                className="px-4 py-2 rounded-xl bg-[var(--danger)] hover:opacity-90 text-[var(--color-primary-fg)] text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1.5" >
                <Trash2 className="w-3.5 h-3.5" />
                <span>نعم، تأكيد الحذف</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------- */}
      {/* MODAL: MOUMTAZE (الممتاز) CLASS SELECTION MODAL */}
      {/* --------------------------------------------- */}
      {isMoumtazeModalOpen && moumtazeData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden" dir="rtl" >
            {/* Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <h3 className="text-base font-black flex items-center gap-2">
                    <span>استيراد الأقسام المسندة من برنامج الممتاز</span>
                    <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-indigo-600/60 text-indigo-100 border border-indigo-400/30">
                      مؤسسة
                    </span>
                  </h3>
                  <div className="text-xs text-slate-300 flex items-center gap-3 mt-0.5 flex-wrap">
                    {moumtazeData.schoolName && (
                      <span className="flex items-center gap-1 font-semibold text-amber-200">
                        <Building2 className="w-3.5 h-3.5" />
                        {moumtazeData.schoolName}
                      </span>
                    )}
                    {moumtazeData.academicYear && (
                      <span className="text-slate-300">الموسم: {moumtazeData.academicYear}</span>
                    )}
                    <span className="text-slate-400 font-mono text-[11px]">({moumtazeData.fileName})</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsMoumtazeModalOpen(false);
                  setMoumtazeData(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer" >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Instruction Bar & Actions */}
            <div className="px-6 py-3.5 bg-indigo-50/70 border-b border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="text-indigo-950 leading-relaxed">
                <span className="font-bold">تنبيه بيداغوجي:</span> تم استخراج{' '}
                <strong className="text-indigo-900 font-black">{moumtazeData.classes.length} أقسام</strong> من ملف المؤسسة.
                حدد <strong className="underline">الأقسام المسندة إليك فقط</strong> لتنزيل قوائمها وقاعاتها تلقائياً.
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button" onClick={handleSelectAllMoumtazeClasses}
                  className="px-3 py-1.5 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-900 font-bold cursor-pointer transition-colors" >
                  تحديد الكل
                </button>
                <button
                  type="button" onClick={handleDeselectAllMoumtazeClasses}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer transition-colors" >
                  إلغاء التحديد
                </button>
              </div>
            </div>

            {/* Classes Grid */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {moumtazeData.classes.map(cls => {
                  const isSelected = selectedMoumtazeClassIds.includes(cls.id);
                  const repeatersCount = cls.students.filter(s => s.isRepeater).length;
                  const malesCount = cls.students.filter(s => s.gender === 'M').length;
                  const femalesCount = cls.students.filter(s => s.gender === 'F').length;

                  return (
                    <div
                      key={cls.id}
                      onClick={() => handleToggleSelectMoumtazeClass(cls.id)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer select-none space-y-2.5 relative ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/40 shadow-xs ring-2 ring-indigo-500/20' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60 opacity-75' }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                              isSelected ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white' }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </span>
                          <h4 className="font-black text-slate-900 text-sm">{cls.className}</h4>
                        </div>
                        {cls.roomNumber && (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[var(--warning-soft)] text-amber-900 border border-amber-200">
                            القاعة {cls.roomNumber}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] space-y-1 text-slate-600">
                        <div className="flex justify-between">
                          <span className="text-slate-500">الشعبة:</span>
                          <span className="font-semibold text-slate-800">{cls.stream}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">المستوى:</span>
                          <span className="font-semibold text-slate-800">
                            {cls.level === '3AS' ? 'السنة 3 ثانوي' : cls.level === '2AS' ? 'السنة 2 ثانوي' : cls.level === '1AS_ARTS' ? 'السنة 1 ثانوي (آداب)' : 'السنة 1 ثانوي (علوم)'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">اسم الورقة الأصلية:</span>
                          <span className="font-mono text-slate-500">{cls.sheetName}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[var(--primary)] bg-[var(--primary-soft)] px-2 py-0.5 rounded-md border border-emerald-100">
                          {cls.students.length} تلميذاً
                        </span>
                        <div className="flex items-center gap-1.5 text-slate-500 text-[10px]">
                          <span>{malesCount} ذ</span>
                          <span>•</span>
                          <span>{femalesCount} إناث</span>
                          {repeatersCount > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-rose-600 font-bold">{repeatersCount} معيد</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-700 font-medium">
                تم تحديد{' '}
                <strong className="text-indigo-900 font-black text-sm">
                  {selectedMoumtazeClassIds.length}
                </strong>{' '}
                من أصل {moumtazeData.classes.length} قسماً
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button" onClick={() => {
                    setIsMoumtazeModalOpen(false);
                    setMoumtazeData(null);
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-white cursor-pointer transition-colors" >
                  إلغاء
                </button>
                <button
                  type="button" onClick={handleConfirmMoumtazeImport}
                  disabled={selectedMoumtazeClassIds.length === 0}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary)] disabled:opacity-50 text-white text-xs font-bold shadow-xs cursor-pointer transition-all" >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تأكيد استيراد الأقسام المحددة ({selectedMoumtazeClassIds.length})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
