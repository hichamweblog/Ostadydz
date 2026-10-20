'use client';

import React, { useState } from 'react';
import { useAppState } from '@/hooks/app-state-context';
import { exportToDocx } from '@/lib/utils';
import { calculateCouncilStatistics } from '@/lib/grade-calculator';
import {
  getClassCoefficient,
  getSubjectDisplayName,
} from '@/lib/types';
import { resolveLevelAndStream } from '@/lib/education';
import {
  selectEffectiveSubjectId,
  selectGradesByClassAndTrimester,
} from '@/lib/state-selectors';
import { SubjectSwitcherBar } from './SubjectSwitcherBar';
import {
  Printer,
  TrendingUp,
  AlertCircle,
  Award,
  Percent
} from 'lucide-react';

interface CouncilAnalysisProps {
}

export const CouncilAnalysis: React.FC<CouncilAnalysisProps> = () => {
  const { state } = useAppState();
  const [selectedClassId, setSelectedClassId] = useState<string>(
    state.activeClassId || (state.classes[0]?.id || '')
  );
  const [selectedTrimester, setSelectedTrimester] = useState<1 | 2 | 3>(
    state.activeTrimester || 1
  );

  const activeClass = state.classes.find(c => c.id === selectedClassId);
  const activeSubjectId = selectEffectiveSubjectId(state, activeClass);
  const resolvedLevelStream = resolveLevelAndStream(activeClass);
  const subjectTitle = getSubjectDisplayName(activeSubjectId, state.profile.variantId);
  const subjectCoeff = activeClass
    ? getClassCoefficient(activeClass, activeSubjectId, state.educationOverrides)
    : 2;

  // Compute absence counts map
  const absencesMap: { [studentId: string]: number } = {};
  for (const session of state.sessions) {
    if (session.attendance) {
      for (const [stId, status] of Object.entries(session.attendance)) {
        if (status === 'ABSENT') {
          absencesMap[stId] = (absencesMap[stId] || 0) + 1;
        }
      }
    }
  }

  const subjectGrades = selectGradesByClassAndTrimester(
    state,
    selectedClassId,
    selectedTrimester,
    activeSubjectId
  );

  const stats = calculateCouncilStatistics(
    selectedClassId,
    selectedTrimester,
    state.students,
    subjectGrades,
    absencesMap,
    {
      subjectId: activeSubjectId,
      levelCode: resolvedLevelStream.levelCode,
      streamId: resolvedLevelStream.streamId,
      overrides: state.educationOverrides,
    }
  );

  // Print / Export Form handler with official Algerian Ministry styling and RTL visual layout
  const handlePrint = () => {
    const totalEval = stats.evaluatedCount || 1;
    const pLess8 = ((stats.lessThan8 / totalEval) * 100).toFixed(1);
    const p8to10 = ((stats.between8and10 / totalEval) * 100).toFixed(1);
    const p10to12 = ((stats.between10and12 / totalEval) * 100).toFixed(1);
    const p12to14 = ((stats.between12and14 / totalEval) * 100).toFixed(1);
    const p14to16 = ((stats.between14and16 / totalEval) * 100).toFixed(1);
    const pOver16 = ((stats.greaterThan16 / totalEval) * 100).toFixed(1);

    const html = `
      <div dir="rtl" style="font-family: 'Amiri', 'Traditional Arabic', serif; color: #000000; padding: 5px;">
        <!-- Official Header -->
        <table style="width: 100%; border: none; margin-bottom: 12px; font-size: 9.5pt;">
          <tr>
            <td style="width: 32%; text-align: right; vertical-align: top; line-height: 1.4;">
              المؤسسة: <b>${state.profile.schoolName || 'ثانوية التعليم الثانوي'}</b><br/>
              المادة: <b>${subjectTitle}</b> (المعامل: <b>${subjectCoeff}</b>)
            </td>
            <td style="width: 36%; text-align: center; vertical-align: middle;">
              <div style="margin: 0; font-size: 12pt; color: #0d2c3b; text-decoration: underline;">بطاقة التحليل الإحصائي لنتائج مادة ${subjectTitle} لمجلس القسم</div>
              <div style="font-size: 10.5pt; font-weight: bold; margin-top: 2px;">
                القسم: <b>${activeClass?.name || 'جميع الأقسام'}</b> (${activeClass?.stream || ''})
              </div>
            </td>
            <td style="width: 32%; text-align: left; vertical-align: top; line-height: 1.4;">
              السنة الدراسية: <b>${state.profile.academicYear || '2026/2027'}</b><br/>
              الأستاذ(ة): <b>${state.profile.name || 'أستاذ المادة'}</b><br/>
              الفصل: <b>الثلاثي ${selectedTrimester === 1 ? 'الأول' : selectedTrimester === 2 ? 'الثاني' : 'الثالث'}</b>
            </td>
          </tr>
        </table>

        <div style="height: 1.5px; background-color: #0d2c3b; margin-bottom: 12px;"></div>

        <!-- Section 1: General Indicators Table -->
        <h3 style="margin: 0 0 6px; font-size: 11pt; color: #0d2c3b;">أولاً: المؤشرات الإحصائية العامة للقسم:</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #000; font-size: 9.5pt; margin-bottom: 14px; text-align: center;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold;">
              <th style="border: 1px solid #000; padding: 6px; width: 15%;">تعداد الفوج الإجمالي</th>
              <th style="border: 1px solid #000; padding: 6px; width: 14%;">المقوّمون</th>
              <th style="border: 1px solid #000; padding: 6px; width: 15%;">الحاصلون على المعدل (≥10)</th>
              <th style="border: 1px solid #000; padding: 6px; width: 14%;">نسبة النجاح %</th>
              <th style="border: 1px solid #000; padding: 6px; width: 14%;">معدل القسم العام</th>
              <th style="border: 1px solid #000; padding: 6px; width: 14%;">أعلى معدل</th>
              <th style="border: 1px solid #000; padding: 6px; width: 14%;">أدنى معدل</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border: 1px solid #000; padding: 6px; font-weight: bold;">${stats.totalStudents}</td>
              <td style="border: 1px solid #000; padding: 6px;">${stats.evaluatedCount}</td>
              <td style="border: 1px solid #000; padding: 6px; font-weight: bold;">${stats.passCount}</td>
              <td style="border: 1px solid #000; padding: 6px; font-weight: bold; font-size: 10.5pt; color: #2E7D9B;">${stats.passRate.toFixed(1)}%</td>
              <td style="border: 1px solid #000; padding: 6px; font-weight: bold; font-size: 10.5pt; color: #0d2c3b;">${stats.averageScore.toFixed(2)} / 20</td>
              <td style="border: 1px solid #000; padding: 6px; font-weight: bold; color: #16a34a;">${stats.highestScore > 0 ? stats.highestScore.toFixed(2) : '-'}</td>
              <td style="border: 1px solid #000; padding: 6px; font-weight: bold; color: #dc2626;">${stats.lowestScore > 0 ? stats.lowestScore.toFixed(2) : '-'}</td>
            </tr>
          </tbody>
        </table>

        <!-- Section 2: 6 Bands Table -->
        <h3 style="margin: 0 0 6px; font-size: 11pt; color: #0d2c3b;">ثانياً: التوزيع التكراري والنسبي حسب الفئات الرسمية الست (06) لوزارة التربية الوطنية:</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #000; font-size: 9.5pt; margin-bottom: 14px;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold;">
              <th style="border: 1px solid #000; padding: 6px; width: 24%; text-align: right;">فئة العلامة</th>
              <th style="border: 1px solid #000; padding: 6px; width: 36%; text-align: right;">التقدير والوضعية البيداغوجية</th>
              <th style="border: 1px solid #000; padding: 6px; width: 18%; text-align: center;">التعداد (تلميذ)</th>
              <th style="border: 1px solid #000; padding: 6px; width: 22%; text-align: center;">النسبة المئوية (%)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; font-weight: bold;">أقل من 08 / 20</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; color: #dc2626;">دون المعدل بشكل حرج (معالجة مستعجلة)</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold; color: #dc2626;">${stats.lessThan8}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.evaluatedCount > 0 ? pLess8 : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; font-weight: bold;">من 08 إلى 09.99 / 20</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; color: #d97706;">قريب من المعدل (قابل للاستدراك)</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold; color: #d97706;">${stats.between8and10}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.evaluatedCount > 0 ? p8to10 : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; font-weight: bold;">من 10 إلى 11.99 / 20</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: right;">متوسط ومقبول</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.between10and12}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.evaluatedCount > 0 ? p10to12 : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; font-weight: bold;">من 12 إلى 13.99 / 20</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: right;">قريب من الجيد</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.between12and14}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.evaluatedCount > 0 ? p12to14 : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; font-weight: bold;">من 14 إلى 15.99 / 20</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; color: #16a34a;">جيد ومستحسن</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold; color: #16a34a;">${stats.between14and16}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.evaluatedCount > 0 ? p14to16 : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; font-weight: bold;">16 فما فوق / 20</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; color: #059669;">جيد جداً وممتاز (لوحة شرف)</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold; color: #059669;">${stats.greaterThan16}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.evaluatedCount > 0 ? pOver16 : 0}%</td>
            </tr>
          </tbody>
        </table>

        <!-- Section 3: Pedagogical Observations -->
        <div style="border: 1px solid #000; padding: 10px; margin-bottom: 16px; font-size: 9.5pt;">
          <b>ثالثاً: الملاحظات البيداغوجية وخطة المعالجة والاستدراك لمجلس القسم:</b>
          <div style="margin-top: 8px; line-height: 1.8; color: #334155;">
            • تحليل عام للنتائج: ....................................................................................................................................<br/>
            • صعوبات التعلم المشخصة: .........................................................................................................................<br/>
            • الإجراءات البيداغوجية المقترحة للدعم والمعالجة: ...........................................................................................
          </div>
        </div>

        <!-- Section 4: Official Stamps & Signatures -->
        <table style="width: 100%; border: none; margin-top: 15px; font-size: 10pt;">
          <tr>
            <td style="width: 50%; text-align: center; vertical-align: top; border: 1px dashed #cbd5e1; padding: 14px;">
              <b>حرر بـ:</b> ${state.profile.stateName || '........'} <b>في:</b> .... / .... / 2026 م<br/>
              <b>توقيع أستاذ(ة) المادة:</b>
              <p style="margin: 35px 0 0; font-size: 8.5pt; color: #64748b;">(${state.profile.name || 'الأستاذ(ة)'})</p>
            </td>
            <td style="width: 50%; text-align: center; vertical-align: top; border: 1px dashed #cbd5e1; padding: 14px;">
              <b>تأشيرة وختم السيد مدير المؤسسة:</b>
              <p style="margin: 35px 0 0; font-size: 8.5pt; color: #64748b;">(خاتم المؤسسة وملاحظة السيد المدير)</p>
            </td>
          </tr>
        </table>
      </div>
    `;

    exportToDocx(html, `تحليل_نتائج_مجلس_القسم_${activeClass?.name || 'الفوج'}`);
  };

  // Grade Bands definition
  const bands = [
    { label: 'أقل من 8', count: stats.lessThan8, color: 'bg-rose-500', textCol: 'text-rose-700', desc: 'دون المعدل بشكل حرج (معالجة مستعجلة)' },
    { label: 'مابين 8 و 10', count: stats.between8and10, color: 'bg-gold', textCol: 'text-amber-700', desc: 'قريب من المعدل (قابل للاستدراك)' },
    { label: 'مابين 10 و 12', count: stats.between10and12, color: 'bg-blue-500', textCol: 'text-blue-700', desc: 'متوسط' },
    { label: 'مابين 12 و 14', count: stats.between12and14, color: 'bg-sage', textCol: 'text-sage', desc: 'قريب من الجيد' },
    { label: 'مابين 14 و 16', count: stats.between14and16, color: 'bg-[var(--primary)]', textCol: 'text-[var(--primary)]', desc: 'جيد' },
    { label: 'أكبر من 16', count: stats.greaterThan16, color: 'bg-navy', textCol: 'text-navy', desc: 'جيد جداً وممتاز' }
  ];
  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="council-analysis-view">
      {/* Multi-Subject Switcher */}
      <SubjectSwitcherBar classRoom={activeClass} />

      {/* Action Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs cursor-pointer" id="btn-print-council-report" >
            <Printer className="w-4 h-4" />
            <span>تصدير تحليل النتائج كملف docx</span>
          </button>
        </div>
      </div>


      {/* Filter Ribbon */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 print:hidden">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="space-y-1">
            <span className="text-[11px] font-bold text-slate-500 block">اختر القسم:</span>
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
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-bold text-slate-500 block">الفصل الدراسي:</span>
            <div className="flex items-center bg-white p-0.5 rounded-lg border border-slate-300">
              {([1, 2, 3] as const).map(tri => (
                <button
                  key={tri}
                  onClick={() => setSelectedTrimester(tri)}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    selectedTrimester === tri
                      ? 'bg-[var(--accent-gold)] text-[var(--accent-navy)]' : 'text-slate-600 hover:text-slate-900' }`}
                >
                  الفصل {tri}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-600">
          المادة: <span className="font-bold text-[var(--primary)]">{subjectTitle}</span> (المعامل: <span className="font-bold text-slate-900">{subjectCoeff}</span>) • المؤسسة: <span className="font-bold text-slate-900">{state.profile.schoolName}</span>
        </div>
      </div>

      <div id="council-analysis-doc" className="space-y-6">
        {/* Key Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Success Rate */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
            <span>نسبة النجاح الفصلي</span>
            <Percent className="w-4 h-4 text-[var(--primary)]" />
          </div>
          <div className="text-3xl font-bold text-slate-900">
            {stats.passRate}%
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            ({stats.passCount} من أصل {stats.evaluatedCount} مقوّم)
          </div>
        </div>

        {/* Metric 2: Class Average */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
            <span>معدل القسم في المادة</span>
            <TrendingUp className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-3xl font-bold text-slate-900">
            {stats.averageScore.toFixed(2)} / 20
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            المعامل: {subjectCoeff} • المعدل الحسابي العام
          </div>
        </div>

        {/* Metric 3: Highest Student */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
            <span>أعلى معدل بالقسم</span>
            <Award className="w-4 h-4 text-gold" />
          </div>
          <div className="text-2xl font-bold text-[var(--primary)] font-mono">
            {stats.highestScore > 0 ? stats.highestScore.toFixed(2) : '-'}
          </div>
          <div className="text-xs font-bold text-slate-800 truncate mt-1">
            {stats.topStudentName}
          </div>
        </div>

        {/* Metric 4: Lowest Student */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
            <span>أدنى معدل بالقسم</span>
            <AlertCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-700 font-mono">
            {stats.lowestScore > 0 ? stats.lowestScore.toFixed(2) : '-'}
          </div>
          <div className="text-xs font-bold text-slate-800 truncate mt-1">
            {stats.lowestStudentName}
          </div>
        </div>
      </div>

      {/* Official 6-Bands Table & Visual Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
        <div>
          <h3 className="text-base font-bold text-slate-900 mb-1">
            توزيع الفئات
          </h3>
          <p className="text-xs text-slate-500">
            هذا الجدول يطابق وثيقة مجالس الأقسام التي تقدم للإدارة التربوية في نهاية الفصل
          </p>
        </div>

        {/* 1. Mobile Bands Cards (Screens < 768px): ZERO Horizontal Scrolling */}
        <div className="block md:hidden space-y-2.5">
          {bands.map((band, idx) => {
            const pct =
              stats.evaluatedCount > 0
                ? Math.round((band.count / stats.evaluatedCount) * 10000) / 100
                : 0;

            return (
              <div
                key={idx}
                className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5" >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-slate-900 text-xs">
                    <span className={`w-3 h-3 rounded-full shrink-0 ${band.color}`} />
                    <span>{band.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 text-xs bg-white px-2 py-0.5 rounded-md border border-slate-200">
                      {band.count} تلميذ
                    </span>
                    <span className="font-mono font-bold text-slate-600 text-xs bg-white px-2 py-0.5 rounded-md border border-slate-200">
                      {pct}%
                    </span>
                  </div>
                </div>
                <p className={`text-[11px] font-semibold ${band.textCol} pr-5`}>
                  {band.desc}
                </p>
              </div>
            );
          })}
          <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 flex items-center justify-between">
            <span>المجموع الكلي للمقوّمين:</span>
            <span className="font-mono font-bold text-sm">{stats.evaluatedCount} تلميذ (100%)</span>
          </div>
        </div>

        {/* 2. Desktop Bands Table (Screens >= 768px) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right text-xs border border-slate-200">
            <thead className="bg-slate-100 text-slate-900 border-b border-slate-200 font-bold">
              <tr>
                <th className="py-2.5 px-4 border-l border-slate-200">فئة المعدل</th>
                <th className="py-2.5 px-4 border-l border-slate-200 text-center w-28">العدد</th>
                <th className="py-2.5 px-4 border-l border-slate-200 text-center w-28">النسبة المئوية %</th>
                <th className="py-2.5 px-4">التشخيص والتوصيف البيداغوجي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bands.map((band, idx) => {
                const pct =
                  stats.evaluatedCount > 0
                    ? Math.round((band.count / stats.evaluatedCount) * 10000) / 100
                    : 0;

                return (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-bold text-slate-900 border-l border-slate-200 flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${band.color}`} />
                      <span>{band.label}</span>
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-900 border-l border-slate-200 text-sm">
                      {band.count}
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-700 border-l border-slate-200">
                      {pct}%
                    </td>
                    <td className={`py-2.5 px-4 font-semibold ${band.textCol}`}>
                      {band.desc}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-100 font-bold text-slate-900 border-t border-slate-200">
              <tr>
                <td className="py-2.5 px-4 border-l border-slate-200">المجموع الكلي للمقوّمين</td>
                <td className="py-2.5 px-4 text-center font-mono border-l border-slate-200 text-sm">
                  {stats.evaluatedCount}
                </td>
                <td className="py-2.5 px-4 text-center font-mono border-l border-slate-200">
                  {stats.evaluatedCount > 0 ? '100%' : '0%'}
                </td>
                <td className="py-2.5 px-4 text-xs font-bold text-slate-600">
                  غير المقوّمين: {stats.totalStudents - stats.evaluatedCount} تلميذ
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Visual Distribution Stacked Bar */}
        <div className="space-y-2 pt-2">
          <div className="text-xs font-bold text-slate-700">التمثيل البياني لتوزيع فئات القسم:</div>
          <div className="w-full h-8 rounded-xl bg-slate-100 overflow-hidden flex shadow-inner">
            {bands.map((band, idx) => {
              const widthPct =
                stats.evaluatedCount > 0 ? (band.count / stats.evaluatedCount) * 100 : 0;
              if (widthPct <= 0) return null;
              return (
                <div
                  key={idx}
                  style={{ width: `${widthPct}%` }}
                  className={`${band.color} h-full flex items-center justify-center text-white text-[10px] font-bold font-mono transition-all`}
                  title={`${band.label}: ${band.count} تلميذ (${widthPct.toFixed(1)}%)`}
                >
                  {widthPct >= 6 ? `${Math.round(widthPct)}%` : ''}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/*  */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
        <h3 className="text-base font-bold text-slate-900">
          التقرير
        </h3>
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-3 leading-relaxed">
          <p>
            بناءً على نتائج الفصل <strong>{selectedTrimester}</strong> لقسم{' '}
            <strong>{activeClass?.name} ({activeClass?.stream})</strong> في مادة العلوم الإسلامية،
            بلغت نسبة النجاح <strong>{stats.passRate}%</strong> بمعدل عام للقسم قُدّر بـ{' '}
            <strong>{stats.averageScore.toFixed(2)} / 20</strong>.
          </p>
          <p>
            نلاحظ تفوقاً واستيعاباً جيداً لدى <strong>{stats.between14and16 + stats.greaterThan16}</strong> تلميذاً
            حققوا نتائج تفوق 14/20، مما يعكس قدرتهم على التحليل والاستدلال بالنصوص الشرعية.
          </p>
          {stats.lessThan8 > 0 && (
            <p className="text-rose-900 font-semibold bg-rose-50 p-2.5 rounded-lg border border-rose-200">
              تنبيه بيداغوجي: يوجد <strong>{stats.lessThan8}</strong> تلاميذ تحصلوا على معدلات أقل من 8/20،
              تعود أسباب تعثرهم إلى ضعف التعبير الشرعي وعدم ضبط المصطلحات الفقهية. نقترح إدراجهم ضمن حصص
              المعالجة البيداغوجية والتركيز على منهجية الإجابة في الامتحانات.
            </p>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};
