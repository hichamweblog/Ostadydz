'use client';

import React, { useState } from'react';
import { useAppState } from '@/hooks/app-state-context';
import { v4 as uuid } from 'uuid';
import { exportToDocx } from '@/lib/utils';
import { showToast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  ClassRoom,
  getSubjectDisplayName,
  SubjectId,
  TimetableSlot,
} from '@/lib/types';
import { getWeeklyHours } from '@/lib/curriculum-data';
import {
  selectActiveClassId,
  selectClassAssignedSubjectIds,
  selectEffectiveSubjectId,
  selectTeacherSubjectIds,
} from '@/lib/state-selectors';
import {
 CalendarDays,
 Plus,
 Printer,
 Trash2,
 Edit2,
 X,
 Clock,
 MapPin,
 Users,
 CheckCircle2,
 SlidersHorizontal
} from'lucide-react';

interface TimetableSanadProps {
}

const MORNING_HOURS = [
 { start:'08:00', end:'09:00', label:'08:00 - 09:00'},
 { start:'09:00', end:'10:00', label:'09:00 - 10:00'},
 { start:'10:00', end:'11:00', label:'10:00 - 11:00'},
 { start:'11:00', end:'12:00', label:'11:00 - 12:00'}
];

const AFTERNOON_HOURS = [
 { start:'13:30', end:'14:30', label:'13:30 - 14:30'},
 { start:'14:30', end:'15:30', label:'14:30 - 15:30'},
 { start:'15:30', end:'16:30', label:'15:30 - 16:30'},
 { start:'16:30', end:'17:30', label:'16:30 - 17:30'}
];

const ALL_HOURS = [...MORNING_HOURS, ...AFTERNOON_HOURS];

const DAYS: { dayOfWeek: 0 | 1 | 2 | 3 | 4; name: string }[] = [
 { dayOfWeek: 0, name:'الأحد'},
 { dayOfWeek: 1, name:'الإثنين'},
 { dayOfWeek: 2, name:'الثلاثاء'},
 { dayOfWeek: 3, name:'الأربعاء'},
 { dayOfWeek: 4, name:'الخميس'}
];

export const TimetableSanad: React.FC<TimetableSanadProps> = () => {
  const { state, updateStateAndWait } = useAppState();
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
 const [deleteConfirmSlotId, setDeleteConfirmSlotId] = useState<string | null>(null);
 const [filterMyHoursOnly, setFilterMyHoursOnly] = useState(false);
 const [mobileActiveDay, setMobileActiveDay] = useState<0 | 1 | 2 | 3 | 4>(0);

 // Form state for slot modal
 const [selectedDay, setSelectedDay] = useState<0 | 1 | 2 | 3 | 4>(0);
 const [selectedStartTime, setSelectedStartTime] = useState('08:00');
 const [selectedEndTime, setSelectedEndTime] = useState('09:00');
 const [selectedClassId, setSelectedClassId] = useState<string>(
 selectActiveClassId(state) ||'' );
 const [selectedRoom, setSelectedRoom] = useState('القاعة 01');

 React.useEffect(() => {
   const activeClassId = selectActiveClassId(state);
   if (activeClassId && !state.classes.some(cls => cls.id === selectedClassId)) {
     const timer = window.setTimeout(() => setSelectedClassId(activeClassId), 0);
     return () => window.clearTimeout(timer);
   }
   return undefined;
 }, [selectedClassId, state]);

 // Total weekly teaching hours
 const totalTeachingHours = state.timetable.length;

 // Filter columns if filterMyHoursOnly is active
 const activeHours = filterMyHoursOnly
 ? ALL_HOURS.filter(hour =>
 state.timetable.some(slot => slot.startTime === hour.start)
 )
 : ALL_HOURS;

  const getWeeklyQuotaForClass = (cls: ClassRoom | undefined): number => {
    if (!cls) return getWeeklyHours(undefined);
    const assignedSubjects = selectClassAssignedSubjectIds(state, cls);
    if (assignedSubjects.length === 0) {
      return getWeeklyHours(cls.level, {
        levelCode: cls.levelCode,
        streamId: cls.streamId,
        overrides: state.educationOverrides,
      });
    }
    return assignedSubjects.reduce(
      (sum, subjId) =>
        sum +
        getWeeklyHours(cls.level, {
          subjectId: subjId,
          levelCode: cls.levelCode,
          streamId: cls.streamId,
          overrides: state.educationOverrides,
        }),
      0
    );
  };

 const handleOpenAddModal = (day?: 0 | 1 | 2 | 3 | 4, startHour?: string) => {
 setEditingSlotId(null);
 if (day !== undefined) setSelectedDay(day);
 if (startHour) {
 setSelectedStartTime(startHour);
 const foundHour = ALL_HOURS.find(h => h.start === startHour);
 setSelectedEndTime(foundHour ? foundHour.end :'09:00');
 }
 const defaultCls = state.classes.find(cls => cls.id === selectActiveClassId(state));
 if (defaultCls) {
 setSelectedClassId(defaultCls.id);
 setSelectedRoom(defaultCls.roomNumber ||'القاعة 01');
 }
 setIsModalOpen(true);
 };

 const handleOpenEditModal = (slot: TimetableSlot) => {
   setEditingSlotId(slot.id);
   setSelectedDay(slot.dayOfWeek);
   setSelectedStartTime(slot.startTime);
   setSelectedEndTime(slot.endTime);
   setSelectedClassId(slot.classId);
   setSelectedRoom(slot.room || 'القاعة 01');
   setIsModalOpen(true);
 };

 const handleSaveSlot = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!selectedClassId) {
   showToast('يرجى اختيار الفوج أولاً قبل الحفظ.', 'error');
   return;
 }

 const selectedClass = state.classes.find(cls => cls.id === selectedClassId);
 if (!selectedClass) {
   showToast('الفوج المحدد غير موجود. أعد اختيار الفوج ثم حاول مجدداً.', 'error');
   return;
 }

 const expectedHourSlot = ALL_HOURS.find(hour => hour.start === selectedStartTime);
 if (!expectedHourSlot) {
   showToast('توقيت البداية غير معتمد في الشبكة الرسمية.', 'error');
   return;
 }

 const expectedEndTime = expectedHourSlot.end;
 const finalRoom = selectedRoom.trim() || selectedClass.roomNumber || 'القاعة 01';
 const timetableWithoutCurrent = state.timetable.filter(slot => slot.id !== editingSlotId);
 const hasTimeOverlap = (slot: TimetableSlot) =>
   slot.dayOfWeek === selectedDay &&
   slot.startTime < expectedEndTime &&
   selectedStartTime < slot.endTime;

 const classTimeConflict = timetableWithoutCurrent.some(
   slot => slot.classId === selectedClassId && hasTimeOverlap(slot)
 );
 if (classTimeConflict) {
   showToast('لا يمكن برمجة نفس القسم في نفس التوقيت حتى لو كانت القاعة مختلفة.', 'error');
   return;
 }

 const roomTimeConflict = timetableWithoutCurrent.some(slot => {
   const slotRoom = (slot.room || '').trim();
   return slotRoom !== '' && finalRoom !== '' && slotRoom === finalRoom && hasTimeOverlap(slot);
 });
 if (roomTimeConflict) {
   showToast('القاعة محجوزة في هذا التوقيت. اختر توقيتاً أو قاعة أخرى.', 'error');
   return;
 }

 const classSlotsCount = timetableWithoutCurrent.filter(slot => slot.classId === selectedClassId).length;
 const weeklyQuota = getWeeklyQuotaForClass(selectedClass);
 if (classSlotsCount >= weeklyQuota) {
   showToast(
     `تم بلوغ الحجم الساعي الأسبوعي لهذا القسم (${weeklyQuota} سا/أسبوع). لا يمكن إضافة حصة إضافية.`,
     'error'
   );
   return;
 }

 const targetSlotId = editingSlotId;
 const slotSubjectId: SubjectId | undefined = selectEffectiveSubjectId(state, selectedClass);
 const newSlot: TimetableSlot = {
 id: targetSlotId || uuid(),
 classId: selectedClassId,
 subjectId: slotSubjectId,
 dayOfWeek: selectedDay,
 startTime: selectedStartTime,
 endTime: expectedEndTime,
 room: finalRoom
 };

 setIsModalOpen(false);
 setEditingSlotId(null);

 try {
   await updateStateAndWait(prev => ({
     ...prev,
     timetable: targetSlotId
       ? prev.timetable.map(slot => (slot.id === targetSlotId ? newSlot : slot))
       : [...prev.timetable, newSlot]
   }));
   showToast('تم حفظ حصة التوقيت ومزامنتها مع السحابة.', 'success');
 } catch (error: unknown) {
   console.error('Timetable slot sync failed:', error);
   showToast(error instanceof Error ? error.message : 'تعذر مزامنة حصة التوقيت.', 'error');
 }
 };

 const handleDeleteSlot = async (slotId: string) => {
 setDeleteConfirmSlotId(null);
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

 const handleExportDoc = () => {
 const teacherSubjectIds = selectTeacherSubjectIds(state);
 const subjectsLabel =
   teacherSubjectIds.length > 0
     ? teacherSubjectIds.map(id => getSubjectDisplayName(id, state.profile.variantId)).join(' + ')
     : getSubjectDisplayName(selectEffectiveSubjectId(state));
 const html =`
 <div style="text-align: center; border-bottom: 2px solid #0d6547; padding-bottom: 12px; margin-bottom: 16px;">
 <p style="margin: 0; font-size: 9pt;">${state.profile.schoolName ||'ثانوية التعليم الثانوي'}</p>
 <div style="margin: 10px 0 4px; font-size: 16pt; font-weight: bold; color: #0d6547; text-decoration: underline;">
 جدول التوقيت الأسبوعي — ${state.profile.name ||'الاسم واللقب'}
 </div>
 <p style="margin: 0; font-size: 10pt; color: #475569;">
 المادة: ${subjectsLabel} | الموسم الدراسي: ${state.profile.academicYear ||'2026/2027'} | الحجم الساعي الأسبوعي: ${totalTeachingHours} سا/أسبوع
 </p>
 </div>

 <table dir="rtl"style="width: 100%; border-collapse: collapse; text-align: center; font-size: 9.5pt; margin-top: 10px;">
 <thead>
 <tr style="background-color: #f8fafc;">
 <th rowspan="2"style="border: 1.5px solid #334155; padding: 6px; width: 10%; background-color: #f1f5f9; font-weight: bold;">اليوم</th>
 <th colspan="4"style="border: 1.5px solid #334155; padding: 6px; background-color: #ecfdf5; color: #065f46; font-weight: bold; font-size: 10pt;">الفترة الصباحية (08:00 - 12:00)</th>
 <th colspan="4"style="border: 1.5px solid #334155; padding: 6px; background-color: #fffbeb; color: #92400e; font-weight: bold; font-size: 10pt;">الفترة المسائية (13:30 - 17:30)</th>
 </tr>
 <tr style="background-color: #f1f5f9;">
 ${MORNING_HOURS.map(h =>`<th style="border: 1.5px solid #334155; padding: 4px; font-weight: bold; font-size: 8.5pt;">${h.label}</th>`).join('')}
 ${AFTERNOON_HOURS.map(h =>`<th style="border: 1.5px solid #334155; padding: 4px; font-weight: bold; font-size: 8.5pt;">${h.label}</th>`).join('')}
 </tr>
 </thead>
 <tbody>
 ${DAYS.map(day =>`
 <tr>
 <td style="border: 1.5px solid #334155; padding: 8px 4px; font-weight: bold; background-color: #f8fafc;">${day.name}</td>
 ${ALL_HOURS.map(hour => {
 const slot = state.timetable.find(s => s.dayOfWeek === day.dayOfWeek && (s.startTime === hour.start || s.startTime.startsWith(hour.start.substring(0, 2))));
 if (!slot) return'<td style="border: 1.5px solid #334155; padding: 6px; background-color: #ffffff;">-</td>';
 const cls = state.classes.find(c => c.id === slot.classId);
 return`
 <td style="border: 1.5px solid #334155; padding: 6px; background-color: #f0fdf4; vertical-align: middle;">
 <div style="font-weight: bold; font-size: 10pt; color: #0d6547;">${cls?.name ||'فوج دراسي'}</div>
 <div style="font-size: 8pt; color: #475569;">${cls?.stream ||''}</div>
 <div style="font-size: 8pt; color: #64748b; margin-top: 2px;">${slot.room || cls?.roomNumber ||'القاعة'}</div>
 </td>
`;
 }).join('')}
 </tr>
`).join('')}
 </tbody>
 </table>

 <!-- Official Validation & Stamps -->
 <table dir="rtl"style="width: 100%; border-collapse: collapse; margin-top: 28px;">
 <tr>
 <td style="width: 33%; text-align: center; border: 1px dashed #94a3b8; padding: 14px; vertical-align: top;">
 <p style="margin: 0 0 40px; font-weight: bold; font-size: 10pt;">توقيع الأستاذ(ة):</p>
 <p style="margin: 0; font-size: 8.5pt; color: #64748b;">حرر في: .... / .... / 2026</p>
 </td>
 <td style="width: 33%; text-align: center; border: 1px dashed #94a3b8; padding: 14px; vertical-align: top;">
 <p style="margin: 0 0 40px; font-weight: bold; font-size: 10pt;">تأشيرة مدير المؤسسة:</p>
 <p style="margin: 0; font-size: 8.5pt; color: #64748b;">(الختم والتوقيع)</p>
 </td>
 <td style="width: 33%; text-align: center; border: 1px dashed #94a3b8; padding: 14px; vertical-align: top;">
 <p style="margin: 0 0 40px; font-weight: bold; font-size: 10pt;">تأشيرة مفتش التربية الوطنية:</p>
 <p style="margin: 0; font-size: 8.5pt; color: #64748b;">(الختم والتوقيع)</p>
 </td>
 </tr>
 </table>
`;

 exportToDocx(html,`جدول_التوقيت_الاسبوعي_${(state.profile.name ||'الأستاذ').replace(/\s+/g,'_')}`, {
 landscape: true,
 title:'جدول التوقيت الأسبوعي' });
 };

 return (
 <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="sanad-timetable-view">
 {/* Action Toolbar */}
 <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
   <span className="text-xs font-bold text-[var(--primary)]">{totalTeachingHours} ساعة أسبوعياً · {state.profile.academicYear || '2026/2027'}</span>
   <div className="flex items-stretch sm:items-center gap-2 flex-wrap">
     <button
       onClick={() => setFilterMyHoursOnly(prev => !prev)}
       className={`flex min-h-11 items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
         filterMyHoursOnly
         ? 'bg-[var(--primary-soft)] text-[var(--primary)] border-[var(--primary)]/40 shadow-xs' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50' }`}
     >
       <SlidersHorizontal className="w-3.5 h-3.5"/>
       <span>ساعاتي فقط</span>
     </button>
     <button
       onClick={handleExportDoc}
       className="flex min-h-11 items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors shadow-xs cursor-pointer" >
       <Printer className="w-3.5 h-3.5 text-slate-500"/>
       <span>تصدير (.docx)</span>
     </button>
     <button
       onClick={() => handleOpenAddModal()}
       className="flex min-h-11 items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition-colors shadow-xs cursor-pointer" id="btn-add-timetable-slot" >
       <Plus className="w-4 h-4"/>
       <span>{editingSlotId ? 'تعديل الحصة' : 'إضافة حصة'}</span>
     </button>
   </div>
 </div>

 {/* 1. Mobile-First Daily Schedule View (Screens < 1024px): ZERO Horizontal Scrolling */}
 <div className="block lg:hidden space-y-4">
 {/* Day Selector Pills */}
 <div className="flex items-center gap-1.5 p-1.5 bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
 {DAYS.map(day => {
 const daySlotCount = state.timetable.filter(s => s.dayOfWeek === day.dayOfWeek).length;
 const isSelected = mobileActiveDay === day.dayOfWeek;

 return (
 <button
 key={day.dayOfWeek}
 onClick={() => setMobileActiveDay(day.dayOfWeek)}
 className={`flex-1 min-w-[62px] py-2 px-2 rounded-xl text-xs font-bold text-center transition-all cursor-pointer flex flex-col items-center gap-0.5 ${
 isSelected
 ?'bg-[var(--primary)] text-white shadow-xs' :'text-slate-600 hover:text-slate-900 hover:bg-slate-50' }`}
 >
 <span>{day.name}</span>
 <span
 className={`text-[10px] font-mono px-1.5 rounded-full ${
 isSelected
 ?'bg-white/20 text-white' :'bg-slate-100 text-slate-500' }`}
 >
 {daySlotCount}
 </span>
 </button>
 );
 })}
 </div>

 {/* Selected Day Slots List */}
 {(() => {
 const daySlots = state.timetable
 .filter(s => s.dayOfWeek === mobileActiveDay)
 .sort((a, b) => a.startTime.localeCompare(b.startTime));

 const selectedDayName = DAYS.find(d => d.dayOfWeek === mobileActiveDay)?.name ||'';

 return (
 <div className="space-y-3">
 <div className="flex items-center justify-between text-xs text-slate-600 px-1">
 <span className="font-bold">
 حصص يوم {selectedDayName}: <strong className="text-slate-900">{daySlots.length} حصة</strong>
 </span>
 <span className="text-[11px] text-slate-400">استعمل زر «إضافة حصة» لإضافة توقيت جديد</span>
 </div>

 {daySlots.length === 0 ? (
 <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-3 shadow-xs">
 <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
 <CalendarDays className="w-5 h-5" aria-hidden="true" />
 </div>
 <div className="text-xs font-bold text-slate-700">لا توجد حصص مسجلة يوم {selectedDayName}</div>
 <p className="text-[11px] text-slate-400">يمكنك إضافة حصص هذا اليوم لتنظيم توقيتك الأسبوعي</p>
 <button
 onClick={() => handleOpenAddModal(mobileActiveDay)}
 className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--primary)] text-white text-xs font-bold shadow-xs cursor-pointer" >
 <Plus className="w-4 h-4"/>
 <span>إضافة حصة ليوم {selectedDayName}</span>
 </button>
 </div>
 ) : (
 daySlots.map(slot => {
 const slotClass = state.classes.find(c => c.id === slot.classId);

 return (
 <div
 key={slot.id}
 className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between gap-3" >
 <div className="flex items-center gap-3 min-w-0">
 {/* Time Pill */}
 <div className="w-16 text-center py-2 px-1 rounded-xl bg-slate-100 font-mono text-[11px] font-black text-slate-800 shrink-0 border border-slate-200/80">
 <div>{slot.startTime}</div>
 <div className="text-[9px] text-slate-500 font-medium">إلى</div>
 <div>{slot.endTime}</div>
 </div>

 {/* Class and Room Info */}
 <div className="min-w-0">
 <div className="flex items-center gap-2">
 <span
 className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: slotClass?.color ||'#0d6547'}}
 />
 <h4 className="font-bold text-sm text-slate-900 truncate">
 {slotClass?.name ||'فوج دراسي'}
 </h4>
 </div>
 <p className="text-xs text-slate-500 truncate mt-0.5">
 {slotClass?.stream ||''}
 </p>
 <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mt-1">
 <MapPin className="w-3 h-3 text-slate-500"/>
 <span>{slot.room || slotClass?.roomNumber ||'القاعة'}</span>
 </div>
 </div>
 </div>

 {/* Action buttons */}
 <div className="grid grid-cols-1 items-center gap-1.5 shrink-0">
 <button
 onClick={() => handleOpenEditModal(slot)}
 className="min-w-11 min-h-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-[var(--primary)] hover:bg-[var(--primary-soft)] transition-colors cursor-pointer" title="تعديل الحصة" >
 <Edit2 className="w-4 h-4"/>
 </button>
 <button
 onClick={() => setDeleteConfirmSlotId(slot.id)}
 className="min-w-11 min-h-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" title="حذف الحصة" >
 <Trash2 className="w-4 h-4"/>
 </button>
 </div>
 </div>
 );
 })
 )}
 </div>
 );
 })()}
 </div>

 {/* 2. Desktop Timetable Matrix (Screens >= 1024px) */}
 <div className="hidden lg:block bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden">
 <div className="overflow-x-auto">
 <table className="w-full text-right border-collapse min-w-[850px]"id="timetable-matrix-table">
 <thead>
 {/* Period Headers Row */}
 <tr className="bg-slate-50/80 border-b border-slate-200 text-xs text-slate-600 font-bold">
 <th className="p-3 w-28 text-center border-l border-slate-200">اليوم</th>
 <th
 colSpan={filterMyHoursOnly ? activeHours.filter(h => MORNING_HOURS.some(m => m.start === h.start)).length : MORNING_HOURS.length}
 className="p-2.5 text-center bg-[var(--primary-soft)]/70 text-[var(--text-primary)] font-bold text-xs border-l border-slate-200" >
 الفترة الصباحية (08:00 - 12:00)
 </th>
 <th
 colSpan={filterMyHoursOnly ? activeHours.filter(h => AFTERNOON_HOURS.some(a => a.start === h.start)).length : AFTERNOON_HOURS.length}
 className="p-2.5 text-center bg-amber-50/60 text-amber-900 font-bold text-xs" >
 الفترة المسائية (13:30 - 17:30)
 </th>
 </tr>
 {/* Hour Columns Row */}
 <tr className="bg-slate-100/70 border-b border-slate-200 text-[11px] font-bold text-slate-700">
 <th className="p-2.5 text-center border-l border-slate-200">التوقيت</th>
 {activeHours.map(hour => (
 <th
 key={hour.start}
 className="p-2 text-center border-l border-slate-200 last:border-l-0 min-w-[95px]" >
 {hour.label}
 </th>
 ))}
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-200 text-xs">
 {DAYS.map(day => (
 <tr key={day.dayOfWeek} className="hover:bg-slate-50/50 transition-colors">
 {/* Day Label */}
 <td className="p-3 font-bold text-slate-800 bg-slate-50/40 text-center border-l border-slate-200">
 {day.name}
 </td>

 {/* Hourly Slots */}
 {activeHours.map(hour => {
 const slot = state.timetable.find(
 s => s.dayOfWeek === day.dayOfWeek && (s.startTime === hour.start || s.startTime.startsWith(hour.start.substring(0, 2)))
 );
 const slotClass = slot
 ? state.classes.find(c => c.id === slot.classId)
 : null;

 return (
 <td
 key={hour.start}
 className="p-1.5 border-l border-slate-200 last:border-l-0 align-top h-24 relative group" >
 {slot && slotClass ? (
 <div
 className="h-full w-full rounded-xl p-2 flex flex-col justify-between transition-all border shadow-2xs relative group/card" style={{
 backgroundColor:`${slotClass.color ||'#0d6547'}12`,
 borderColor:`${slotClass.color ||'#0d6547'}40`
 }}
 >
 <div>
 <div
 className="font-bold text-xs truncate leading-tight" style={{ color: slotClass.color ||'#0d6547'}}
 >
 {slotClass.name}
 </div>
 <div className="text-[10px] text-slate-500 truncate mt-0.5">
 {slotClass.stream}
 </div>
 </div>

 <div className="flex items-center justify-between text-[10px] text-slate-600 pt-1 border-t border-slate-200/40 mt-1">
 <span className="flex items-center gap-0.5">
 <MapPin className="w-2.5 h-2.5 text-slate-500"/>
 {slot.room || slotClass.roomNumber ||'القاعة'}
 </span>
 <span className="font-mono text-[9px] text-slate-600 font-medium">
 {slot.startTime}–{slot.endTime}
 </span>
 </div>

 {/* Edit and delete actions on hover */}
 <div className="absolute top-1 left-1 grid grid-cols-1 gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
 <button
 onClick={() => handleOpenEditModal(slot)}
 className="w-5 h-5 rounded-md bg-white/90 text-[var(--primary)] hover:bg-[var(--primary-soft)] flex items-center justify-center shadow-2xs cursor-pointer" title="تعديل الحصة" >
 <Edit2 className="w-3 h-3"/>
 </button>
 <button
 onClick={() => setDeleteConfirmSlotId(slot.id)}
 className="w-5 h-5 rounded-md bg-white/90 text-rose-500 hover:bg-rose-50 hover:text-rose-700 flex items-center justify-center shadow-2xs cursor-pointer" title="حذف الحصة" >
 <Trash2 className="w-3 h-3"/>
 </button>
 </div>
 </div>
 ) : (
 <button
 onClick={() => handleOpenAddModal(day.dayOfWeek, hour.start)}
 className="w-full h-full rounded-xl border border-dashed border-slate-200 hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]/40 flex flex-col items-center justify-center text-slate-300 hover:text-[var(--primary)] transition-all cursor-pointer opacity-40 hover:opacity-100 group/btn" title={`إضافة حصة يوم ${day.name} في ${hour.label}`}
 >
 <Plus className="w-4 h-4 transition-transform group-hover/btn:scale-110"/>
 </button>
 )}
 </td>
 );
 })}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 {/* Modal: إضافة حصة إلى الجدول (Screenshot 13) */}
 {isModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => { setIsModalOpen(false); setEditingSlotId(null); }}>
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200 text-right space-y-5 animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto w-12 h-1.5 bg-slate-200 rounded-full mb-2 sm:hidden" />
 <div className="flex items-center justify-between pb-3 border-b border-slate-100">
 <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
 <CalendarDays className="w-5 h-5 text-[var(--primary)]"/>
 <span>{editingSlotId ? 'حفظ تعديل الحصة' : 'إضافة الحصة'}</span>
 </div>
 <button
 onClick={() => {
   setIsModalOpen(false);
   setEditingSlotId(null);
 }}
 className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer" >
 <X className="w-4 h-4"/>
 </button>
 </div>

 <form onSubmit={handleSaveSlot} className="space-y-4 text-xs">
 {/* Day Selection */}
 <div>
 <label className="block font-bold text-slate-700 mb-1">اليوم</label>
 <select
 value={selectedDay}
 onChange={e => setSelectedDay(Number(e.target.value) as 0 | 1 | 2 | 3 | 4)}
 className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900" >
 {DAYS.map(d => (
 <option key={d.dayOfWeek} value={d.dayOfWeek}>
 {d.name}
 </option>
 ))}
 </select>
 </div>

 
          {/* Quick Time Slots */}
          <div>
            <label className="block font-bold text-slate-700 mb-2">التوقيت</label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-1 scrollbar-thin">
              {ALL_HOURS.map(h => {
                const isSelected = selectedStartTime === h.start;
                return (
                  <button
                    key={h.start}
                    type="button"
                    onClick={() => {
                      setSelectedStartTime(h.start);
                      setSelectedEndTime(h.end);
                    }}
                    className={`py-2 px-1 rounded-xl text-xs font-bold transition-all border ${
                      isSelected
                        ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-md'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-[var(--primary)] hover:bg-slate-50'
                    }`}
                  >
                    <span dir="ltr">{h.start} - {h.end}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Class Selection */}
 <div>
 <label className="block font-bold text-slate-700 mb-1">الفوج التربوي</label>
 <select
 value={selectedClassId}
 onChange={e => {
 setSelectedClassId(e.target.value);
 const cls = state.classes.find(c => c.id === e.target.value);
 if (cls?.roomNumber) setSelectedRoom(cls.roomNumber);
 }}
 className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900" >
 {state.classes.map(cls => (
 <option key={cls.id} value={cls.id}>
 {cls.name} ({cls.stream})
 </option>
 ))}
 </select>
 </div>

 {/* Room Number */}
 <div>
 <label className="block font-bold text-slate-700 mb-1">القاعة</label>
 <input
 type="text" value={selectedRoom}
 onChange={e => setSelectedRoom(e.target.value)}
 placeholder="القاعة 20" className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900" />
 </div>

 {/* Action Buttons */}
 <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
 <button
 type="button" onClick={() => {
   setIsModalOpen(false);
   setEditingSlotId(null);
 }}
 className="px-4 py-2 rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 font-bold transition-colors cursor-pointer" >
 إلغاء
 </button>
 <button
 type="submit" className="px-5 py-2 rounded-xl text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] font-bold shadow-xs transition-colors cursor-pointer" >
 إضافة الحصة
 </button>
 </div>
 </form>
 </div>
 </div>
 )}
 <ConfirmDialog
 isOpen={Boolean(deleteConfirmSlotId)}
 title="تأكيد حذف الحصة"
 message="هل أنت متأكد من حذف هذه الحصة من جدول التوقيت؟"
 onCancel={() => setDeleteConfirmSlotId(null)}
 onConfirm={() => {
   if (deleteConfirmSlotId) {
     handleDeleteSlot(deleteConfirmSlotId);
   }
 }}
 />
 </div>
 );
};
