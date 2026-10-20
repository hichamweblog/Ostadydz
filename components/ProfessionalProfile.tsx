"use client";

import { AppState } from "@/lib/storage";
import { useAppState } from '@/hooks/app-state-context';
import { getSubjectDisplayName, PROFESSIONAL_RANKS, TeacherProfile } from "@/lib/types";

/** Fallback rank shown when the profile has none (or an obsolete one) stored. */
const DEFAULT_RANK_TITLE: string = PROFESSIONAL_RANKS[0];
import { exportToDocx } from "@/lib/utils";
import {
  Award,
  BadgeCheck,
  Briefcase,
  CheckCircle2,
  Contact,
  Mail,
  MapPin,
  Printer,
  Save,
  School,
  Trash2,
  Upload,
  User,
} from "lucide-react";
import { showToast } from '@/components/Toast';
import React, { useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { enqueueAvatarDelete, enqueueAvatarUpload } from '@/lib/supabase/avatar-outbox';
import { getWeeklyHours } from '@/lib/curriculum-data';

interface ProfessionalProfileProps {
}

export const ProfessionalProfile: React.FC<ProfessionalProfileProps> = ({
}) => {
  const { state, updateStateAndWait } = useAppState();
  const [profile, setProfile] = useState<TeacherProfile>({
    ...state.profile,
    title: PROFESSIONAL_RANKS.some(rank => rank === state.profile.title) ? state.profile.title : DEFAULT_RANK_TITLE,
  });
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showRemovePhotoConfirm, setShowRemovePhotoConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const totalStudents = state.students.length;
  const totalClasses = state.classes.length;
  const teacherSubjectIds =
    state.profile.taughtSubjectIds ??
    state.profile.subjectIds ??
    (state.profile.primarySubjectId ? [state.profile.primarySubjectId] : []);
  const teacherSubjectsLabel =
    teacherSubjectIds.length > 0
      ? teacherSubjectIds
          .map((subjId) =>
            getSubjectDisplayName(
              subjId,
              state.profile.subjectVariantsById?.[subjId] ?? state.profile.variantId,
            ),
          )
          .join(" · ")
      : state.profile.subjectName || "التعليم الثانوي العام والتكنولوجي";
  const totalWeeklyHours = state.classes.reduce((sum, c) => {
    const classSubjects =
      c.assignedSubjectIds && c.assignedSubjectIds.length > 0
        ? c.assignedSubjectIds
        : c.subjectIds && c.subjectIds.length > 0
        ? c.subjectIds
        : teacherSubjectIds;
    if (classSubjects.length === 0) {
      return sum + getWeeklyHours(c);
    }
    return (
      sum +
      classSubjects.reduce(
        (subSum, subjId) => subSum + getWeeklyHours(c, subjId),
        0
      )
    );
  }, 0);

  // Calculate experience years from first appointment date
  const calculateExperience = (appointmentDateStr?: string): number => {
    if (!appointmentDateStr) return profile.experienceYears || 0;
    const appDate = new Date(appointmentDateStr);
    if (isNaN(appDate.getTime())) return profile.experienceYears || 0;
    const today = new Date();
    let years = today.getFullYear() - appDate.getFullYear();
    const m = today.getMonth() - appDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < appDate.getDate())) {
      years--;
    }
    return Math.max(0, years);
  };

  const handleAppointmentDateChange = (val: string) => {
    const calcYears = calculateExperience(val);
    setProfile((prev) => ({
      ...prev,
      firstAppointmentDate: val,
      experienceYears: calcYears,
    }));
  };

  // Image Upload Handler
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      showToast("حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 2 ميغابايت.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      void enqueueAvatarUpload(file);
      setProfile((prev) => ({
        ...prev,
        avatarUrl: dataUrl,
        avatarStorageKey: 'profile',
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    void enqueueAvatarDelete();
    setProfile((prev) => ({
      ...prev,
      avatarUrl: undefined,
      avatarStorageKey: undefined,
    }));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateStateAndWait((prev) => ({
        ...prev,
        profile: { ...profile },
      }));
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (error) {
      console.error('Profile save failed:', error);
      showToast('تعذر حفظ الملف الشخصي في السحابة.', 'error');
    }
  };

  const handleExportCard = () => {
    const photoBlock = profile.avatarUrl
      ? `<img src="${profile.avatarUrl}" alt="${profile.name || "صورة الأستاذ"}" width="100" height="130" style="width: 100px; height: 130px; max-width: 100px; max-height: 130px; object-fit: cover; border: 2px solid #2E7D9B; border-radius: 4px; display: block; margin: 0 auto;" />`
      : `<div style="width: 100px; height: 130px; border: 2px dashed #2E7D9B; border-radius: 4px; background-color: #f8fafc; font-size: 26pt; color: #2E7D9B; font-weight: bold; text-align: center; line-height: 130px; margin: 0 auto;">${teacherInitial}</div>`;

    const html = `
      <div dir="rtl" style="font-family: 'Amiri', 'Traditional Arabic', serif; color: #000000; padding: 10px;">
        <div style="text-align: center; border-bottom: 2px solid #2E7D9B; padding-bottom: 12px; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 9pt;">${profile.schoolName || "ثانوية التعليم الثانوي"}</p>
          <div style="margin: 10px 0 4px; font-size: 16pt; font-weight: bold; color: #2E7D9B; text-decoration: underline;">
            البطاقة المهنية الرسمية للأستاذ
          </div>
          <p style="margin: 0; font-size: 10pt; color: #5C6370;">الموسم الدراسي: ${profile.academicYear || "2026/2027 م"}</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <tr>
            <!-- Identity Information (Right Side in RTL) -->
            <td style="width: 68%; vertical-align: top; border: 1px solid #cbd5e1; padding: 12px; background-color: #ffffff;">
              <table style="width: 100%; border-collapse: collapse; font-size: 10.5pt;">
                <tr>
                  <td style="width: 32%; padding: 6px; font-weight: bold; color: #2E7D9B; border-bottom: 1px dashed #e2e8f0; text-align: right;">الاسم واللقب:</td>
                  <td style="padding: 6px; font-weight: bold; font-size: 12pt; border-bottom: 1px dashed #e2e8f0; text-align: right;">${profile.name || `${profile.firstNameAr || ""} ${profile.lastNameAr || ""}`}</td>
                </tr>
                ${
                  profile.firstNameEn || profile.lastNameEn
                    ? `
                <tr>
                  <td style="padding: 6px; font-weight: bold; color: #64748b; border-bottom: 1px dashed #e2e8f0; text-align: right;">Nom et Prénom:</td>
                  <td style="padding: 6px; font-family: Arial; border-bottom: 1px dashed #e2e8f0; text-align: left;" dir="ltr">${profile.lastNameEn || ""} ${profile.firstNameEn || ""}</td>
                </tr>`
                    : "" }
                <tr>
                  <td style="padding: 6px; font-weight: bold; color: #2E7D9B; border-bottom: 1px dashed #e2e8f0; text-align: right;">المادة / المواد المسندة:</td>
                  <td style="padding: 6px; font-weight: bold; border-bottom: 1px dashed #e2e8f0; text-align: right;">${teacherSubjectsLabel} (التعليم الثانوي)</td>
                </tr>
                <tr>
                  <td style="padding: 6px; font-weight: bold; color: #2E7D9B; border-bottom: 1px dashed #e2e8f0; text-align: right;">الرتبة المهنية الحالية:</td>
                  <td style="padding: 6px; font-weight: bold; color: #b45309; border-bottom: 1px dashed #e2e8f0; text-align: right;">${profile.title || DEFAULT_RANK_TITLE}</td>
                </tr>
                <tr>
                  <td style="padding: 6px; font-weight: bold; color: #2E7D9B; border-bottom: 1px dashed #e2e8f0; text-align: right;">تاريخ أول تعيين بالقطاع:</td>
                  <td style="padding: 6px; border-bottom: 1px dashed #e2e8f0; text-align: right;">${profile.firstAppointmentDate || "غير محدد"}</td>
                </tr>
                <tr>
                  <td style="padding: 6px; font-weight: bold; color: #2E7D9B; border-bottom: 1px dashed #e2e8f0; text-align: right;">سنوات الأقدمية العامة:</td>
                  <td style="padding: 6px; font-weight: bold; border-bottom: 1px dashed #e2e8f0; text-align: right;">${profile.experienceYears || 0} سنوات</td>
                </tr>
                <tr>
                  <td style="padding: 6px; font-weight: bold; color: #2E7D9B; border-bottom: 1px dashed #e2e8f0; text-align: right;">المؤسسة الحالية:</td>
                  <td style="padding: 6px; border-bottom: 1px dashed #e2e8f0; text-align: right;">${profile.schoolName || "المؤسسة التعليمية"}</td>
                </tr>
                <tr>
                  <td style="padding: 6px; font-weight: bold; color: #2E7D9B; border-bottom: 1px dashed #e2e8f0; text-align: right;">البريد الإلكتروني:</td>
                  <td style="padding: 6px; font-family: monospace; border-bottom: 1px dashed #e2e8f0; text-align: left;" dir="ltr">${profile.email || "-"}</td>
                </tr>
                <tr>
                  <td style="padding: 6px; font-weight: bold; color: #2E7D9B; text-align: right;">رقم الهاتف:</td>
                  <td style="padding: 6px; font-family: monospace; text-align: left;" dir="ltr">${profile.phoneNumber || "-"}</td>
                </tr>
              </table>
            </td>

            <!-- Photo & Stats Summary (Left Side in RTL) -->
            <td style="width: 32%; vertical-align: top; border: 1px solid #cbd5e1; padding: 12px; text-align: center; background-color: #f8fafc;">
              <div style="margin-bottom: 10px;">
                ${photoBlock}
                <p style="margin: 4px 0 0; font-size: 8.5pt; color: #64748b;">صورة الأستاذ(ة)</p>
              </div>

              <table style="width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 10px; background-color: #ffffff; border: 1px solid #cbd5e1;">
                <tr style="background-color: #e2e8f0;">
                  <th colspan="2" style="padding: 5px; font-size: 9pt; border-bottom: 1px solid #cbd5e1; color: #2E7D9B; text-align: center;">ملخص الإسناد التربوي</th>
                </tr>
                <tr>
                  <td style="padding: 5px; border-bottom: 1px solid #e2e8f0; text-align: right; width: 60%;">الأفواج المسندة:</td>
                  <td style="padding: 5px; border-bottom: 1px solid #e2e8f0; font-weight: bold; text-align: center;">${totalClasses} أقسام</td>
                </tr>
                <tr>
                  <td style="padding: 5px; border-bottom: 1px solid #e2e8f0; text-align: right;">مجموع التلاميذ:</td>
                  <td style="padding: 5px; border-bottom: 1px solid #e2e8f0; font-weight: bold; text-align: center;">${totalStudents} تلميذاً</td>
                </tr>
                <tr>
                  <td style="padding: 5px; text-align: right;">الحجم الساعي الأسبوعي:</td>
                  <td style="padding: 5px; font-weight: bold; text-align: center;">${totalWeeklyHours} سا/أسبوع</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Official Validation & Stamps -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 24px;">
          <tr>
            <td style="width: 50%; text-align: center; border: 1px dashed #94a3b8; padding: 20px; vertical-align: top; background-color: #ffffff;">
              <p style="margin: 0 0 45px; font-weight: bold; font-size: 11pt; color: #1A1C1E;">توقيع الأستاذ(ة):</p>
              <p style="margin: 0; font-size: 9pt; color: #64748b;">حرر بـ: ${profile.stateName || "................"} في: .... / .... / 2026 م</p>
            </td>
            <td style="width: 50%; text-align: center; border: 1px dashed #94a3b8; padding: 20px; vertical-align: top; background-color: #ffffff;">
              <p style="margin: 0 0 45px; font-weight: bold; font-size: 11pt; color: #1A1C1E;">تأشيرة وختم السيد مدير المؤسسة:</p>
              <p style="margin: 0; font-size: 9pt; color: #64748b;">(خاتم المؤسسة وتوقيع المدير)</p>
            </td>
          </tr>
        </table>
      </div>
    `;

    exportToDocx(
      html,
      `البطاقة_المهنية_${(profile.name || "الأستاذ").replace(/\s+/g, "_")}`,
    );
  };

  const teacherInitial = profile.name ? profile.name.trim().charAt(0) : "هـ";

  return (
    <div className="space-y-6" id="sanad-professional-profile">
      {/* Minimal toolbar — export button only */}
      <div className="flex justify-start">
        <button
          onClick={handleExportCard}
          className="flex items-center gap-1.5 px-4 py-2 bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 text-xs font-bold transition-colors shadow-xs cursor-pointer">
          <Printer className="w-4 h-4 text-slate-500" />
          <span>تصدير البطاقة (.docx)</span>
        </button>
      </div>


      {/* Official Teacher Card Preview */}
      <div
        id="teacher-official-card" className="bg-linear-to-br from-[var(--primary)] via-[var(--accent-navy-card)] to-[var(--accent-navy)] text-white rounded-xl p-6 sm:p-8 shadow-md border border-slate-400/30 relative overflow-hidden print:m-0 print:border-none">
        {/* Background Islamic Watermark */}
        <div className="absolute top-0 left-0 -translate-x-12 -translate-y-12 w-64 h-64 rounded-full border-8 border-[var(--primary)]/10 pointer-events-none" />
        <div className="absolute bottom-0 right-0 translate-x-16 translate-y-16 w-80 h-80 rounded-full border-8 border-[var(--primary)]/10 pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start justify-between gap-6">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-5 text-center md:text-right">
            {/* Avatar Photo / Initial Circle with upload trigger */}
            <div className="relative group shrink-0">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt={profile.name || "صورة الأستاذ"}
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl object-cover border-3 border-[var(--primary)]/60 shadow-lg" />
              ) : (
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-white/10 backdrop-blur-md border-2 border-[var(--primary)]/40 text-slate-100 flex items-center justify-center font-bold text-4xl shadow-inner">
                  {teacherInitial}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/60 border border-[var(--primary)]/30 text-[11px] font-bold text-slate-200">
                <BadgeCheck className="w-3.5 h-3.5 text-slate-300" />
                <span>
                  الجمهورية الجزائرية الديمقراطية الشعبية - وزارة التربية
                  الوطنية
                </span>
              </div>
              <h3 className="text-lg font-bold tracking-tight text-white">
                {profile.name || "أستاذ المادة"}
              </h3>
              <div className="pt-0.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/15 backdrop-blur-xs border border-white/20 text-white font-bold text-xs shadow-xs">
                  <Award className="w-3.5 h-3.5 text-amber-300" />
                  <span>
                    {profile.title || DEFAULT_RANK_TITLE}
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-center md:justify-start gap-4 text-xs text-slate-200/90 pt-1 flex-wrap">
                <span className="flex items-center gap-1">
                  <School className="w-3.5 h-3.5" />
                  {profile.schoolName || "المؤسسة التعليمية"}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {profile.stateName || "مديرية التربية"}
                </span>
                <span className="flex items-center gap-1 font-mono">
                  {profile.academicYear || "2026/2027"}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Stats Badges */}
          <div className="grid grid-cols-3 gap-3 shrink-0 text-center w-full md:w-auto">
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
              <div className="text-lg font-bold text-white">
                {totalClasses}
              </div>
              <div className="text-[10px] text-slate-200">أفواج تربوية</div>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
              <div className="text-lg font-bold text-white">
                {totalStudents}
              </div>
              <div className="text-[10px] text-slate-200">
                تلميذاً متمدرساً
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
              <div className="text-lg font-bold text-white">
                {profile.experienceYears ?? 0}
              </div>
              <div className="text-[10px] text-slate-200">سنوات خبرة</div>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <form
        onSubmit={handleSave}
        className="bg-white  border border-slate-200/90  rounded-xl p-6 shadow-xs space-y-6">
        {/* Photo Upload Section */}
        <div className="p-4 bg-slate-50  rounded-xl border border-slate-200/80  flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-200  flex items-center justify-center border border-slate-300  shrink-0">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt="معاينة" className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-slate-400" />
              )}
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 ">
                الصورة الشخصية للأستاذ
              </div>
              <div className="text-[11px] text-slate-500  mt-0.5">
                تظهر في البطاقة المهنية والمطبوعات الرسمية (PNG أو JPG، الحد
                الأقصى 2MB)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="file" ref={fileInputRef}
              accept="image/*" onChange={handleImageUpload}
              className="hidden" />
            <button
              type="button" onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 bg-white  hover:bg-slate-100 text-slate-800  border border-slate-200  rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-xs">
              <Upload className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>{profile.avatarUrl ? "تغيير الصورة" : "رفع صورة"}</span>
            </button>
            {profile.avatarUrl && (
              <button
                type="button" onClick={() => setShowRemovePhotoConfirm(true)}
                className="p-2 text-rose-600 hover:bg-rose-50 :bg-rose-900/30 rounded-xl transition-colors cursor-pointer border border-rose-200 " title="حذف الصورة">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Section: الحالة الإدارية وتاريخ أول تعيين */}
        <div className="space-y-4">
          <h3 className="text-base font-bold text-slate-900  flex items-center gap-2 border-b border-slate-100  pb-3">
            <Briefcase className="w-4 h-4 text-[var(--primary)] " />
            <span>الحالة المهنية والإدارية</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* First Appointment Date */}
            <div>
              <label htmlFor="prof-firstAppointmentDate" className="block font-bold text-slate-700 mb-1">
                تاريخ أول تعيين بقطاع التربية الوطنية:
              </label>
              <input
                id="prof-firstAppointmentDate"
                type="date" value={profile.firstAppointmentDate || ""}
                onChange={(e) => handleAppointmentDateChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-mono" />
              <span className="text-[10px] text-slate-500 mt-1 block">
                تُحسب الأقدمية تلقائياً بناءً على هذا التاريخ
              </span>
            </div>

            {/* Professional Rank */}
            <div>
              <label htmlFor="prof-title" className="block font-bold text-slate-700 mb-1">
                الرتبة المهنية الحالية:
              </label>
              <select
                id="prof-title"
                value={PROFESSIONAL_RANKS.includes(profile.title as (typeof PROFESSIONAL_RANKS)[number]) ? profile.title : PROFESSIONAL_RANKS[0]}
                onChange={(e) =>
                  setProfile({ ...profile, title: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-bold">
                {PROFESSIONAL_RANKS.map((rank) => (
                  <option key={rank} value={rank}>
                    {rank}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-slate-500 mt-1 block">
                تنعكس الرتبة فورياً في البطاقة المهنية
              </span>
            </div>
          </div>
        </div>

        {/* Section: الحالة المدنية والعائلية */}
        <div className="space-y-4 pt-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
            <User className="w-4 h-4 text-[var(--primary)]" />
            <span>الحالة المدنية والعائلية</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* First Name AR */}
            <div>
              <label htmlFor="prof-firstNameAr" className="block font-bold text-slate-700 mb-1">
                الاسم بالعربية
              </label>
              <input
                id="prof-firstNameAr"
                type="text" value={profile.firstNameAr || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setProfile(prev => ({ 
                    ...prev, 
                    firstNameAr: val,
                    name: `${val} ${prev.lastNameAr || ''}`.trim()
                  }));
                }}
                placeholder="الاسم بالعربية" className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900" />
            </div>

            {/* Last Name AR */}
            <div>
              <label htmlFor="prof-lastNameAr" className="block font-bold text-slate-700 mb-1">
                اللقب بالعربية
              </label>
              <input
                id="prof-lastNameAr"
                type="text" value={profile.lastNameAr || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setProfile(prev => ({ 
                    ...prev, 
                    lastNameAr: val,
                    name: `${prev.firstNameAr || ''} ${val}`.trim()
                  }));
                }}
                placeholder="اللقب بالعربية" className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900" />
            </div>

            {/* First Name EN */}
            <div>
              <label htmlFor="prof-firstNameEn" className="block font-bold text-slate-700 mb-1">
                الاسم باللاتينية
              </label>
              <input
                id="prof-firstNameEn"
                type="text" dir="ltr" value={profile.firstNameEn || ""}
                onChange={(e) =>
                  setProfile({ ...profile, firstNameEn: e.target.value })
                }
                placeholder="First Name" className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-left text-slate-900" />
            </div>

            {/* Last Name EN */}
            <div>
              <label htmlFor="prof-lastNameEn" className="block font-bold text-slate-700 mb-1">
                اللقب باللاتينية
              </label>
              <input
                id="prof-lastNameEn"
                type="text" dir="ltr" value={profile.lastNameEn || ""}
                onChange={(e) =>
                  setProfile({ ...profile, lastNameEn: e.target.value })
                }
                placeholder="Last Name" className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-left text-slate-900" />
            </div>

            {/* Birth Date */}
            <div>
              <label htmlFor="prof-birthDate" className="block font-bold text-slate-700 mb-1">
                تاريخ الميلاد
              </label>
              <input
                id="prof-birthDate"
                type="date" value={profile.birthDate || ""}
                onChange={(e) =>
                  setProfile({ ...profile, birthDate: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-mono" />
            </div>

            {/* Birth Place */}
            <div>
              <label htmlFor="prof-birthPlace" className="block font-bold text-slate-700 mb-1">
                مكان الميلاد
              </label>
              <input
                id="prof-birthPlace"
                type="text" value={profile.birthPlace || ""}
                onChange={(e) =>
                  setProfile({ ...profile, birthPlace: e.target.value })
                }
                placeholder="مكان الميلاد" className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900" />
            </div>

            {/* Gender */}
            <div>
              <label htmlFor="prof-gender" className="block font-bold text-slate-700 mb-1">
                الجنس
              </label>
              <select
                id="prof-gender"
                value={profile.gender || "M"}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    gender: e.target.value as "M" | "F",
                  })
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900">
                <option value="M">ذكر</option>
                <option value="F">أنثى</option>
              </select>
            </div>

            {/* Family Status */}
            <div>
              <label htmlFor="prof-familyStatus" className="block font-bold text-slate-700 mb-1">
                الحالة العائلية
              </label>
              <select
                id="prof-familyStatus"
                value={profile.familyStatus || ""}
                onChange={(e) =>
                  setProfile({ ...profile, familyStatus: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900">
                <option value="">اختر الحالة العائلية</option>
                <option value="أعزب">أعزب / عزباء</option>
                <option value="متزوج">متزوج (ة)</option>
                <option value="مطلق">مطلق (ة)</option>
                <option value="أرمل">أرمل (ة)</option>
              </select>
            </div>

            {/* School Name */}
            <div>
              <label htmlFor="prof-schoolName" className="block font-bold text-slate-700 mb-1">
                المؤسسة التعليمية (الثانوية)
              </label>
              <input
                id="prof-schoolName"
                type="text" value={profile.schoolName || ""}
                onChange={(e) =>
                  setProfile({ ...profile, schoolName: e.target.value })
                }
                placeholder="اسم الثانوية أو المؤسسة التعليمية" className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900" />
            </div>

            {/* State / Wilaya */}
            <div>
              <label htmlFor="prof-stateName" className="block font-bold text-slate-700 mb-1">
                الولاية (مديرية التربية)
              </label>
              <input
                id="prof-stateName"
                type="text" value={profile.stateName || ""}
                onChange={(e) =>
                  setProfile({ ...profile, stateName: e.target.value })
                }
                placeholder="الولاية (مثال: الجزائر، وهران، سطيف...)" className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900" />
            </div>

            {/* Academic Year */}
            <div>
              <label htmlFor="prof-academicYear" className="block font-bold text-slate-700 mb-1">
                السنة الدراسية
              </label>
              <input
                id="prof-academicYear"
                type="text" value={profile.academicYear || ""}
                onChange={(e) =>
                  setProfile({ ...profile, academicYear: e.target.value })
                }
                placeholder="2026/2027" className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900" />
            </div>
          </div>
        </div>

        {/* Section: بريد الدخول والإشعارات */}
        <div className="pt-4 border-t border-slate-100">
          <label htmlFor="prof-email" className="block font-bold text-slate-700 mb-1 text-xs">
            بريد الدخول والإشعارات
          </label>
          <div className="flex items-center gap-2 max-w-md">
            <div className="relative flex-1">
              <Mail className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                id="prof-email"
                type="email" dir="ltr" value={profile.email || ""}
                onChange={(e) =>
                  setProfile({ ...profile, email: e.target.value })
                }
                placeholder="name@example.com" className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-left text-xs text-slate-900" />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100 ">
          {savedSuccess ? (
            <span className="flex items-center gap-1.5 text-xs text-[var(--primary)] font-bold bg-[var(--primary-soft)] px-3 py-1.5 rounded-lg border border-[var(--primary)]/20">
              <CheckCircle2 className="w-4 h-4 text-[var(--primary)]" />
              تم حفظ البيانات بنجاح!
            </span>
          ) : (
            <span />
          )}

          <button
            type="submit" className="flex items-center gap-2 px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer text-xs">
            <Save className="w-4 h-4" />
            <span>حفظ التعديلات</span>
          </button>
        </div>
      </form>
      <ConfirmDialog
        isOpen={showRemovePhotoConfirm}
        title="تأكيد حذف الصورة"
        message="هل أنت متأكد من حذف الصورة الشخصية؟"
        onCancel={() => setShowRemovePhotoConfirm(false)}
        onConfirm={() => {
          handleRemoveImage();
          setShowRemovePhotoConfirm(false);
        }}
      />
    </div>
  );
};
