'use client';

import React, { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/app-state-context';
import { exportToDocx } from '@/lib/utils';
import { showToast } from '@/components/Toast';
import {
  getSubjectDisplayName,
  SessionRecord,
} from '@/lib/types';
import { getMergedCurriculumUnits } from '@/lib/curriculum-data';
import {
  selectEffectiveSubjectId,
  selectGradesByClassAndTrimester,
} from '@/lib/state-selectors';
import { SubjectSwitcherBar } from './SubjectSwitcherBar';
import { calculateCouncilStatistics, calculateStudentAverage } from '@/lib/grade-calculator';
import { getDefaultEstimation } from '@/lib/pedagogical-evaluations';
import { isSessionDocumented } from '@/lib/session-flow';
import Link from 'next/link';
import {
  FileText,
  CheckCircle2,
  Layers,
  FileSpreadsheet,
  FileCheck2,
  Calendar,
  Sparkles,
  Download,
  Share2,
  AlertCircle
} from 'lucide-react';

interface DocumentsExportProps {
}

type DocCategory =
  | 'JOURNAL' | 'CURRICULUM_DISTRIBUTION' | 'GRADES_ROSTER' | 'COUNCIL_FORM' | 'STUDENTS_LIST';

export const DocumentsExport: React.FC<DocumentsExportProps> = () => {
  const { state, updateState: onUpdateState } = useAppState();
  const [docType, setDocType] = useState<DocCategory>('JOURNAL');
  const [selectedClassId, setSelectedClassId] = useState<string>(
    state.activeClassId || (state.classes[0]?.id || '')
  );
  const [selectedTrimester, setSelectedTrimester] = useState<1 | 2 | 3>(
    state.activeTrimester || 1
  );
  const ecoPaperMode = true;

  const activeClass = state.classes.find(c => c.id === selectedClassId);
  const activeSubjectId = selectEffectiveSubjectId(state, activeClass);
  const activeSubjectTitle = getSubjectDisplayName(activeSubjectId);

  const classStudents = state.students
    .filter(s => s.classId === selectedClassId)
    .sort((a, b) => a.numberInList - b.numberInList);

  const isSessionCancelled = (session: SessionRecord): boolean =>
    session.sessionStatus === 'CANCELLED';

  /** A cancelled session keeps its scheduled topic but is labelled as cancelled in the export. */
  const sessionTitleForDoc = (session: SessionRecord, unitTitle?: string): string => {
    if (!isSessionCancelled(session)) return unitTitle || session.customTopic || 'حصة عادية';
    const reason = session.cancellationReason?.trim();
    if (unitTitle) return `حصة ملغاة${reason ? ` (${reason})` : ''} — ${unitTitle}`;
    return session.customTopic?.trim() || `حصة ملغاة${reason ? ` (${reason})` : ''}`;
  };

  const classPastSessions = useMemo(() => {
    return state.sessions
      .filter(
        s =>
          s.classId === selectedClassId &&
          isSessionDocumented(s) &&
          (!activeSubjectId || !s.subjectId || s.subjectId === activeSubjectId)
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
  }, [state.sessions, selectedClassId, activeSubjectId]);

  const getSessionNotes = (session: SessionRecord): string => {
    if (session.notes) return session.notes;
    if (session.teacherNotes) return session.teacherNotes;

    return [
      session.memoryWhatWorked && `ما نجح: ${session.memoryWhatWorked}`,
      session.memoryDifficulty && `الصعوبات: ${session.memoryDifficulty}`,
      session.memoryWhatFailed && `ما يحتاج تحسيناً: ${session.memoryWhatFailed}`,
      session.memoryNextTimeChange &&
        `التعديل المقترح للحصة القادمة: ${session.memoryNextTimeChange}`,
    ]
      .filter(Boolean)
      .join('\n');
  };

  const classUnits = getMergedCurriculumUnits(state.customUnits, activeSubjectId).filter(
    u => u.level === activeClass?.level
  );

  const scopedGradesForClass = selectGradesByClassAndTrimester(
    state,
    selectedClassId,
    selectedTrimester,
    activeSubjectId
  );

  const stats = calculateCouncilStatistics(
    selectedClassId,
    selectedTrimester,
    state.students,
    scopedGradesForClass
  );

  const getDocTitle = (): string => {
    switch (docType) {
      case 'JOURNAL':
        return 'الدفتر اليومي للحصص';
      case 'CURRICULUM_DISTRIBUTION':
        return 'التوزيع السنوي والتدرج البيداغوجي';
      case 'GRADES_ROSTER':
        return `كشف التقويم والعلامات - الفصل ${selectedTrimester}`;
      case 'COUNCIL_FORM':
        return `تقرير مجلس القسم - الفصل ${selectedTrimester}`;
      case 'STUDENTS_LIST':
        return 'القائمة الرسمية للتلاميذ';
      default:
        return 'وثيقة بيداغوجية';
    }
  };

  const handleShare = async () => {
    const title = getDocTitle();
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({
        title,
        text: `${title} — ${activeClass?.name || 'القسم'}`,
      });
      return;
    }
    showToast('المشاركة غير متاحة على هذا الجهاز. استخدم تصدير الوثيقة إلى doc.', 'warning');
  };

  // Export to Microsoft Word document (.docx)
  // OOXML uses bidiVisual for tables: the first logical column is rendered on the right.
  const handleExportDoc = () => {
    const docTitle = getDocTitle();
    const className = activeClass?.name || 'فوج';
    const establishment = state.profile.schoolName || 'الثانوية';
    const academicYear = state.profile.academicYear || '2026/2027';

    let tableHtml = '';

    if (docType === 'JOURNAL') {
      tableHtml = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 10pt;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold;">
              <th style="border: 1px solid #000; padding: 6px; width: 14%; text-align: center;">التاريخ والتوقيت</th>
              <th style="border: 1px solid #000; padding: 6px; width: 26%; text-align: right;">موضوع الدرس / الوحدة</th>
              <th style="border: 1px solid #000; padding: 6px; width: 32%; text-align: right;">ما تم إنجازه في الحصة</th>
              <th style="border: 1px solid #000; padding: 6px; width: 14%; text-align: right;">التوجيهات والواجبات</th>
              <th style="border: 1px solid #000; padding: 6px; width: 14%; text-align: right;">دفتر الملاحظات</th>
            </tr>
          </thead>
          <tbody>
            ${
              classPastSessions.length === 0
                ? '<tr><td colspan="5" style="border: 1px solid #000; padding: 12px; text-align: center; color: #64748b;">لا توجد حصص موثقة مسجلة بعد لهذا القسم.</td></tr>' : classPastSessions
                    .map(ses => {
                      const allUnits = getMergedCurriculumUnits(state.customUnits);
                      const unit = allUnits.find(u => u.id === ses.unitId);
                      return `
                        <tr>
                          <td style="border: 1px solid #000; padding: 5px; text-align: center;">
                            <b>${ses.date}</b><br/>
                            <small>${ses.startTime} - ${ses.endTime}</small>
                          </td>
                          <td style="border: 1px solid #000; padding: 5px; text-align: right;"><b>${sessionTitleForDoc(ses, unit?.title)}</b></td>
                          <td style="border: 1px solid #000; padding: 5px; text-align: right;">${ses.accomplishments || '-'}</td>
                          <td style="border: 1px solid #000; padding: 5px; text-align: right;">${ses.nextSteps || '-'}</td>
                          <td style="border: 1px solid #000; padding: 5px; text-align: right; white-space: pre-wrap;">${getSessionNotes(ses) || '-'}</td>
                        </tr>
                      `;
                    })
                    .join('')
            }
          </tbody>
        </table>
      `;
    } else if (docType === 'CURRICULUM_DISTRIBUTION') {
      tableHtml = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 10pt;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold;">
              <th style="border: 1px solid #000; padding: 6px; width: 6%; text-align: center;">الرقم</th>
              <th style="border: 1px solid #000; padding: 6px; width: 19%; text-align: right;">الميدان</th>
              <th style="border: 1px solid #000; padding: 6px; width: 30%; text-align: right;">الوحدة التعليمية</th>
              <th style="border: 1px solid #000; padding: 6px; width: 35%; text-align: right;">الكفاءة المستهدفة</th>
              <th style="border: 1px solid #000; padding: 6px; width: 10%; text-align: center;">الحجم</th>
            </tr>
          </thead>
          <tbody>
            ${classUnits
              .map(
                (u, i) => `
                <tr>
                  <td style="border: 1px solid #000; padding: 5px; text-align: center;">${String(u.unitNumber || i + 1).padStart(2, '0')}</td>
                  <td style="border: 1px solid #000; padding: 5px; text-align: right;">${u.domain}</td>
                  <td style="border: 1px solid #000; padding: 5px; text-align: right;"><b>${u.title}</b></td>
                  <td style="border: 1px solid #000; padding: 5px; text-align: right;">${u.targetedCompetence || '-'}</td>
                  <td style="border: 1px solid #000; padding: 5px; text-align: center;">${u.hourlyVolume || 2} سا</td>
                </tr>
              `
              )
              .join('')}
          </tbody>
        </table>
      `;
    } else if (docType === 'GRADES_ROSTER') {
      tableHtml = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 9.5pt;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold;">
              <th style="border: 1px solid #000; padding: 5px; width: 6%; text-align: center;">الرقم</th>
              <th style="border: 1px solid #000; padding: 5px; width: 28%; text-align: right;">اسم ولقب التلميذ</th>
              <th style="border: 1px solid #000; padding: 5px; width: 10%; text-align: center;">التقويم (20)</th>
              <th style="border: 1px solid #000; padding: 5px; width: 10%; text-align: center;">الفرض (20)</th>
              <th style="border: 1px solid #000; padding: 5px; width: 11%; text-align: center;">الاختبار (×2)</th>
              <th style="border: 1px solid #000; padding: 5px; width: 11%; text-align: center;">المعدل الفصلي</th>
              <th style="border: 1px solid #000; padding: 5px; width: 12%; text-align: center;">التقديرات</th>
              <th style="border: 1px solid #000; padding: 5px; width: 12%; text-align: right;">الإرشادات</th>
            </tr>
          </thead>
          <tbody>
            ${classStudents
              .map(st => {
                const g = scopedGradesForClass.find(x => x.studentId === st.id);
                const avg =
                  g?.calculatedAverage ??
                  calculateStudentAverage(
                    g?.continuousEval ?? null,
                    g?.quiz ?? null,
                    g?.exam ?? null
                  );
                const defaultEst = getDefaultEstimation(avg);
                const rawEst = g?.estimation || defaultEst;
                const cleanEst = (rawEst === 'غير مقوم' || rawEst === 'غير مقوّم' || rawEst === '-') ? '' : rawEst;
                return `
                  <tr>
                    <td style="border: 1px solid #000; padding: 4px; text-align: center;">${st.numberInList}</td>
                    <td style="border: 1px solid #000; padding: 4px; text-align: right;"><b>${st.fullName}</b></td>
                    <td style="border: 1px solid #000; padding: 4px; text-align: center;">${g?.continuousEval ?? '-'}</td>
                    <td style="border: 1px solid #000; padding: 4px; text-align: center;">${g?.quiz ?? '-'}</td>
                    <td style="border: 1px solid #000; padding: 4px; text-align: center;">${g?.exam ?? '-'}</td>
                    <td style="border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold;">${avg !== null ? avg.toFixed(2) : '-'}</td>
                    <td style="border: 1px solid #000; padding: 4px; text-align: center;">${cleanEst}</td>
                    <td style="border: 1px solid #000; padding: 4px; text-align: right;">${g?.guidance || g?.remarks || '-'}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      `;
    } else if (docType === 'COUNCIL_FORM') {
      tableHtml = `
        <div style="margin-top: 10px; margin-bottom: 10px; padding: 8px; border: 1px solid #000;">
          <table style="width: 100%; border: none;">
            <tr>
              <td style="border: none; text-align: right;"><b>تعداد التلاميذ:</b> ${stats.totalStudents}</td>
              <td style="border: none; text-align: center;"><b>الحاضرون في التقييم:</b> ${stats.evaluatedCount}</td>
              <td style="border: none; text-align: left;"><b>الحاصلون على المعدل (≥10):</b> ${stats.passCount}</td>
            </tr>
            <tr>
              <td style="border: none; text-align: right;"><b>نسبة النجاح:</b> ${stats.passRate.toFixed(1)}%</td>
              <td style="border: none; text-align: center;"><b>معدل المادة العام:</b> ${stats.averageScore.toFixed(2)} / 20</td>
              <td style="border: none; text-align: left;"><b>أعلى معدل:</b> ${stats.highestScore.toFixed(2)} (${stats.topStudentName})</td>
            </tr>
          </table>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10pt;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold;">
              <th style="border: 1px solid #000; padding: 6px; width: 44%; text-align: right;">الفئة الوزارية</th>
              <th style="border: 1px solid #000; padding: 6px; width: 28%; text-align: center;">العدد</th>
              <th style="border: 1px solid #000; padding: 6px; width: 28%; text-align: center;">النسبة %</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right;">أقل من 08 (ضعيف جداً)</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.lessThan8}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.evaluatedCount > 0 ? ((stats.lessThan8 / stats.evaluatedCount) * 100).toFixed(1) : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right;">ما بين 08 و 09.99 (دون المتوسط)</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.between8and10}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.evaluatedCount > 0 ? ((stats.between8and10 / stats.evaluatedCount) * 100).toFixed(1) : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right;">ما بين 10 و 11.99 (مقبول)</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.between10and12}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.evaluatedCount > 0 ? ((stats.between10and12 / stats.evaluatedCount) * 100).toFixed(1) : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right;">ما بين 12 و 13.99 (جيد)</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.between12and14}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.evaluatedCount > 0 ? ((stats.between12and14 / stats.evaluatedCount) * 100).toFixed(1) : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right;">ما بين 14 و 15.99 (جيد جداً)</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.between14and16}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center;">${stats.evaluatedCount > 0 ? ((stats.between14and16 / stats.evaluatedCount) * 100).toFixed(1) : 0}%</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px; text-align: right; font-weight: bold;">أكبر من 16 (ممتاز)</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.greaterThan16}</td>
              <td style="border: 1px solid #000; padding: 5px; text-align: center; font-weight: bold;">${stats.evaluatedCount > 0 ? ((stats.greaterThan16 / stats.evaluatedCount) * 100).toFixed(1) : 0}%</td>
            </tr>
          </tbody>
        </table>
      `;
    } else {
      tableHtml = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 10pt;" dir="rtl">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold;">
              <th style="border: 1px solid #000; padding: 6px; width: 8%; text-align: center;">الرقم</th>
              <th style="border: 1px solid #000; padding: 6px; width: 57%; text-align: right;">اسم ولقب التلميذ</th>
              <th style="border: 1px solid #000; padding: 6px; width: 35%; text-align: right;">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            ${classStudents
              .map(
                st => `
                <tr>
                  <td style="border: 1px solid #000; padding: 6px; text-align: center; font-weight: bold;">${st.numberInList}</td>
                  <td style="border: 1px solid #000; padding: 6px; text-align: right;"><b>${st.fullName}</b></td>
                  <td style="border: 1px solid #000; padding: 6px;"></td>
                </tr>
              `
              )
              .join('')}
          </tbody>
        </table>
      `;
    }

    const wordHtml = `
      <!DOCTYPE html>
      <${'html'} lang="ar" dir="rtl" xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <meta name="ProgId" content="Word.Document">
        <meta name="Generator" content="Microsoft Word 15">
        <title>${docTitle}</title>
        <!--[if gte mso 9]>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
          </w:WordDocument>
        </xml>
        <![endif]-->
        <style>
          @page WordSection1 {
            size: 595.3pt 841.9pt; /* A4 Portrait */
            margin: 10pt 14pt 14pt 14pt;
            mso-header-margin: 1pt;
            mso-footer-margin: 1pt;
          }
          div.WordSection1 {
            page: WordSection1;
            direction: rtl;
          }
          body {
            font-family: 'Amiri', 'Traditional Arabic', 'Arial', sans-serif;
            color: #000000;
            background: #ffffff;
            font-size: 10pt;
            line-height: 1.15;
            margin: 0;
            padding: 0;
            direction: rtl;
            unicode-bidi: embed;
            mso-bidi-font-family: 'Amiri';
            overflow-wrap: anywhere;
          }
          .compact-header {
            border-bottom: 1.5px solid #000;
            padding-bottom: 2px;
            margin-bottom: 3px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            direction: rtl !important;
            unicode-bidi: embed;
            mso-table-dir: rtl;
            table-layout: fixed;
          }
          tr { direction: rtl !important; }
          td, th {
            direction: rtl !important;
            unicode-bidi: embed;
            overflow-wrap: anywhere;
            word-break: normal;
          }
        </style>
      </head>
      <body dir="rtl">
        <div class="WordSection1" dir="rtl">
          <div class="compact-header">
            <table style="width: 100%; font-size: 10pt; border: none;">
              <tr>
                <td style="border: none; text-align: right; width: 33%;">المؤسسة: <b>${establishment}</b></td>
                <td style="border: none; text-align: center; width: 34%;">الموسم الدراسي: <b>${academicYear}</b></td>
                <td style="border: none; text-align: left; width: 33%;">المادة: <b>${activeSubjectTitle}</b> (الفوج: <b>${className}</b>)</td>
              </tr>
            </table>
          </div>

          <p align="center" style="text-align: center; font-size: 12pt; font-weight: bold; text-decoration: underline; margin: 4px 0 6px 0;">
            ${docTitle}
          </p>

          ${tableHtml}
        </div>
      </body>
      ${'</html>'}
    `;

    exportToDocx(
      wordHtml,
      `الوثائق_البيداغوجية_${activeSubjectTitle.replace(/\s+/g, '_')}_${docTitle.replace(/\s+/g, '_')}_${className}`,
    );
  };

  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="documents-pedagogical-view">
      {/* Multi-Subject Switcher */}
      <SubjectSwitcherBar classRoom={activeClass} />

      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200/90 shadow-2xs">
        {/* Mobile-friendly derived document actions */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => void handleShare()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border-default)] text-[var(--text-primary)] text-xs font-bold hover:bg-[var(--bg-surface-subtle)] transition-colors cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>مشاركة</span>
          </button>
          <button
            type="button" onClick={handleExportDoc}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold shadow-xs hover:shadow-md transition-all cursor-pointer" title="تصدير الوثيقة" id="btn-export-doc-word" >
            <Download className="w-4 h-4" />
            <span>تصدير إلى doc</span>
          </button>
        </div>
      </div>

      {/* 2. Document Selection Ribbons & Class/Trimester Selectors */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/90">
        {/* Document Tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button" onClick={() => setDocType('JOURNAL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              docType === 'JOURNAL' ? 'bg-[var(--primary)] text-white shadow-2xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100' }`}
          >
            الدفتر اليومي للحصص
          </button>

          <button
            type="button" onClick={() => setDocType('CURRICULUM_DISTRIBUTION')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              docType === 'CURRICULUM_DISTRIBUTION' ? 'bg-[var(--primary)] text-white shadow-2xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100' }`}
          >
            التوزيع السنوي والتدرجات
          </button>

          <button
            type="button" onClick={() => setDocType('GRADES_ROSTER')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              docType === 'GRADES_ROSTER' ? 'bg-[var(--primary)] text-white shadow-2xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100' }`}
          >
            كشف النقاط والتقويم الفصلي
          </button>

          <button
            type="button" onClick={() => setDocType('COUNCIL_FORM')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              docType === 'COUNCIL_FORM' ? 'bg-[var(--primary)] text-white shadow-2xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100' }`}
          >
            تقرير مجلس القسم
          </button>

          <button
            type="button" onClick={() => setDocType('STUDENTS_LIST')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              docType === 'STUDENTS_LIST' ? 'bg-[var(--primary)] text-white shadow-2xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100' }`}
          >
            قائمة تلاميذ القسم
          </button>
        </div>

        {/* Filter Controls: Class & Trimester */}
        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
          <div className="flex items-center gap-1 text-xs text-slate-600 font-bold">
            <span>القسم:</span>
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className="bg-white px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 outline-none cursor-pointer shadow-2xs" >
              {state.classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.stream})
                </option>
              ))}
            </select>
          </div>

          {(docType === 'GRADES_ROSTER' || docType === 'COUNCIL_FORM') && (
            <div className="flex items-center gap-1 text-xs text-slate-600 font-bold">
              <span>الفصل:</span>
              <select
                value={selectedTrimester}
                onChange={e => setSelectedTrimester(Number(e.target.value) as 1 | 2 | 3)}
                className="bg-white px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 outline-none cursor-pointer shadow-2xs" >
                <option value={1}>الفصل الأول</option>
                <option value={2}>الفصل الثاني</option>
                <option value={3}>الفصل الثالث</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Institutional Profile Incomplete Warning Banner */}
      {!state.profile.schoolName && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>تنبيه:</strong> لم يتم تحديد اسم المؤسسة التعليمية في إعدادات ملفك الشخصي. أكمل بيانات المؤسسة لتظهر تلقائياً في ترويسة الوثائق المطبوعة.
            </span>
          </div>
          <Link
            href="/settings"
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold shrink-0 text-xs transition-colors"
          >
            الانتقال للإعدادات
          </Link>
        </div>
      )}

      {/* Mobile Quick Actions (No A4 preview) */}
      <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 p-4 rounded-2xl shadow-sm text-center">
          <FileText className="w-8 h-8 text-blue-600 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-blue-900 mb-1">{getDocTitle()}</h3>
          <p className="text-[10px] text-blue-700 mb-3">حمل الوثيقة جاهزة للطباعة والتعديل بصيغة Word</p>
          <button
            type="button" onClick={handleExportDoc}
            className="w-full flex justify-center items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-md active:scale-95 transition-all"
          >
            <Download className="w-4 h-4" />
            <span>تحميل مباشر (.docx)</span>
          </button>
        </div>
      </div>
      
      {/* 3. Document Sheet Container (Hidden on Mobile) */}
      <div
        dir="rtl" style={{ direction: 'rtl', textAlign: 'right' }}
        className="hidden md:block bg-white rounded-xl border border-slate-300 shadow-sm max-w-[860px] mx-auto text-slate-900 text-xs transition-all p-5 [direction:rtl] text-right" >
        {/* Space-Saving Compact Institutional Header */}
        <div className="pb-2 border-b-2 border-slate-900">
          <div className="flex justify-between items-center text-xs font-bold text-slate-800 px-1">
            <div>المؤسسة: {state.profile.schoolName || 'الثانوية'}</div>
            <div>الموسم الدراسي: {state.profile.academicYear || '2026/2027'}</div>
            <div>القسم: {activeClass?.name} ({activeClass?.stream}) — مادة: {activeSubjectTitle}</div>
          </div>
        </div>

        {/* Document Title Banner */}
        <div className="text-center pt-3 pb-2">
          <h3 className="font-bold text-sm sm:text-base text-slate-900 underline underline-offset-4">
            {getDocTitle()}
          </h3>
        </div>

        {/* --------------------------------------------- */}
        {/* DOC 1: CAHIER JOURNAL (الدفتر اليومي) */}
        {/* --------------------------------------------- */}
        {docType === 'JOURNAL' && (
          <div className="space-y-3">
            <div className="space-y-2 sm:hidden">
              {classPastSessions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border-default)] p-5 text-center text-xs text-[var(--text-tertiary)]">
                  لا توجد حصص موثقة مسجلة بعد لهذا القسم.
                </div>
              ) : classPastSessions.map((session) => {
                const unit = getMergedCurriculumUnits(state.customUnits).find((item) => item.id === session.unitId);
                return (
                  <article key={session.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-black text-[var(--text-primary)]">{sessionTitleForDoc(session, unit?.title)}</div>
                        <div className="mt-1 text-[11px] font-semibold text-[var(--text-tertiary)]">{session.date} • {session.startTime} - {session.endTime}</div>
                      </div>
                      {isSessionCancelled(session) && (
                        <span className="shrink-0 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          ملغاة
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1 text-xs leading-6 text-[var(--text-secondary)]">
                      <p><strong>المنجز:</strong> {session.accomplishments || '—'}</p>
                      <p><strong>الواجبات:</strong> {session.nextSteps || '—'}</p>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto scrollbar-thin w-full print:overflow-visible sm:block">
              <table className="w-full min-w-[640px] sm:min-w-0 text-right border-collapse border border-slate-900 text-xs">
                <thead className="bg-slate-100 border-b border-slate-900 font-bold">
                  <tr>
                    <th className="border border-slate-900 p-1.5 text-center w-24">التاريخ والتوقيت</th>
                    <th className="border border-slate-900 p-1.5 w-48">موضوع الدرس / الوحدة</th>
                    <th className="border border-slate-900 p-1.5">ما تم إنجازه في الحصة</th>
                    <th className="border border-slate-900 p-1.5 w-36">التوجيهات والواجبات</th>
                    <th className="border border-slate-900 p-1.5 w-44">دفتر الملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {classPastSessions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border border-slate-900 p-6 text-center text-slate-400">
                        لا توجد حصص موثقة مسجلة بعد لهذا القسم في الدفتر اليومي.
                      </td>
                    </tr>
                  ) : (
                    classPastSessions.map(ses => {
                      const allCurriculumUnits = getMergedCurriculumUnits(state.customUnits);
                      const unit = allCurriculumUnits.find(u => u.id === ses.unitId);

                      return (
                        <tr key={ses.id} className="break-inside-avoid">
                          <td className={`border border-slate-900 text-center font-mono ${ecoPaperMode ? 'p-1 text-[10px]' : 'p-1.5 text-[11px]'}`}>
                            <div className="font-bold">{ses.date}</div>
                            <div className="text-[9px] text-slate-600">{ses.startTime} – {ses.endTime}</div>
                          </td>
                          <td className={`border border-slate-900 font-bold ${ecoPaperMode ? 'p-1 text-[10px]' : 'p-1.5 text-xs'}`}>
                            {sessionTitleForDoc(ses, unit?.title)}
                          </td>
                          <td className={`border border-slate-900 ${ecoPaperMode ? 'p-1 text-[10px] leading-tight' : 'p-1.5 text-xs'}`}>
                            {ses.accomplishments || '-'}
                          </td>
                          <td className={`border border-slate-900 ${ecoPaperMode ? 'p-1 text-[10px] leading-tight' : 'p-1.5 text-xs'}`}>
                            {ses.nextSteps || '-'}
                          </td>
                          <td className={`border border-slate-900 whitespace-pre-line ${ecoPaperMode ? 'p-1 text-[10px] leading-tight' : 'p-1.5 text-xs'}`}>
                            {getSessionNotes(ses) || '-'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --------------------------------------------- */}
        {/* DOC 2: CURRICULUM DISTRIBUTION (التوزيع السنوي) */}
        {/* --------------------------------------------- */}
        {docType === 'CURRICULUM_DISTRIBUTION' && (
          <div className="space-y-3">
            <div className="overflow-x-auto scrollbar-thin w-full print:overflow-visible">
              <table className="w-full min-w-[620px] sm:min-w-0 text-right border-collapse border border-slate-900 text-xs">
                <thead className="bg-slate-100 border-b border-slate-900 font-bold">
                  <tr>
                    <th className="border border-slate-900 p-1.5 text-center w-10">الرقم</th>
                    <th className="border border-slate-900 p-1.5 w-28">الميدان</th>
                    <th className="border border-slate-900 p-1.5 w-44">الوحدة التعليمية / العنوان</th>
                    <th className="border border-slate-900 p-1.5">الكفاءة المستهدفة</th>
                    <th className="border border-slate-900 p-1.5 text-center w-14">الحجم</th>
                    <th className="border border-slate-900 p-1.5 text-center w-20">الإنجاز</th>
                  </tr>
                </thead>
                <tbody>
                  {classUnits.map((unit, idx) => {
                    const prog = state.lessonProgress.find(
                      p => p.classId === selectedClassId && p.unitId === unit.id
                    );
                    const isDone = prog?.status === 'COMPLETED';

                    return (
                      <tr key={unit.id} className="break-inside-avoid">
                        <td className={`border border-slate-900 text-center font-mono font-bold ${ecoPaperMode ? 'p-1 text-[10px]' : 'p-1.5'}`}>
                          {String(unit.unitNumber || idx + 1).padStart(2, '0')}
                        </td>
                        <td className={`border border-slate-900 font-medium text-emerald-950 ${ecoPaperMode ? 'p-1 text-[10px]' : 'p-1.5 text-[11px]'}`}>
                          {unit.domain}
                        </td>
                        <td className={`border border-slate-900 font-bold ${ecoPaperMode ? 'p-1 text-[10px]' : 'p-1.5 text-xs'}`}>
                          {unit.title}
                        </td>
                        <td className={`border border-slate-900 ${ecoPaperMode ? 'p-1 text-[10px] leading-tight' : 'p-1.5 text-xs'}`}>
                          {unit.targetedCompetence || '-'}
                        </td>
                        <td className={`border border-slate-900 text-center font-mono ${ecoPaperMode ? 'p-1 text-[10px]' : 'p-1.5'}`}>
                          {unit.hourlyVolume || 2} سا
                        </td>
                        <td className={`border border-slate-900 text-center font-bold ${ecoPaperMode ? 'p-1 text-[10px]' : 'p-1.5 text-[11px]'}`}>
                          {isDone ? 'أُنجز' : 'مخطط'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --------------------------------------------- */}
        {/* DOC 3: GRADES ROSTER (كشف التقويم الفصلي) */}
        {/* --------------------------------------------- */}
        {docType === 'GRADES_ROSTER' && (
          <div className="space-y-3">
            <div className="overflow-x-auto scrollbar-thin w-full print:overflow-visible">
              <table className="w-full min-w-[680px] sm:min-w-0 text-right border-collapse border border-slate-900 text-xs">
                <thead className="bg-slate-100 border-b border-slate-900 font-bold">
                  <tr>
                    <th className="border border-slate-900 p-1 text-center w-8">#</th>
                    <th className="border border-slate-900 p-1 min-w-[140px]">اسم ولقب التلميذ</th>
                    <th className="border border-slate-900 p-1 text-center w-16">التقويم (20)</th>
                    <th className="border border-slate-900 p-1 text-center w-16">الفرض (20)</th>
                    <th className="border border-slate-900 p-1 text-center w-16">الاختبار (×2)</th>
                    <th className="border border-slate-900 p-1 text-center w-16">المعدل</th>
                    <th className="border border-slate-900 p-1 text-center w-20">التقديرات</th>
                    <th className="border border-slate-900 p-1 min-w-[110px]">الإرشادات</th>
                  </tr>
                </thead>
                <tbody>
                  {classStudents.map(student => {
                    const g = state.grades.find(
                      x => x.studentId === student.id && x.trimester === selectedTrimester
                    );
                    const avg =
                      g?.calculatedAverage ??
                      calculateStudentAverage(
                        g?.continuousEval ?? null,
                        g?.quiz ?? null,
                        g?.exam ?? null
                      );

                    const defaultEstimation = getDefaultEstimation(avg);

                    return (
                      <tr key={student.id} className="break-inside-avoid">
                        <td className={`border border-slate-900 text-center font-mono font-bold ${ecoPaperMode ? 'py-0.5 px-1 text-[10px]' : 'p-1'}`}>
                          {student.numberInList}
                        </td>
                        <td className={`border border-slate-900 font-bold ${ecoPaperMode ? 'py-0.5 px-1 text-[10px]' : 'p-1'}`}>
                          {student.fullName}
                        </td>
                        <td className={`border border-slate-900 text-center font-mono ${ecoPaperMode ? 'py-0.5 px-1 text-[10px]' : 'p-1'}`}>
                          {g?.continuousEval ?? '-'}
                        </td>
                        <td className={`border border-slate-900 text-center font-mono ${ecoPaperMode ? 'py-0.5 px-1 text-[10px]' : 'p-1'}`}>
                          {g?.quiz ?? '-'}
                        </td>
                        <td className={`border border-slate-900 text-center font-mono ${ecoPaperMode ? 'py-0.5 px-1 text-[10px]' : 'p-1'}`}>
                          {g?.exam ?? '-'}
                        </td>
                        <td className={`border border-slate-900 text-center font-mono font-bold ${ecoPaperMode ? 'py-0.5 px-1 text-[10px]' : 'p-1'}`}>
                          {avg !== null ? avg.toFixed(2) : '-'}
                        </td>
                        <td className={`border border-slate-900 text-center font-semibold ${ecoPaperMode ? 'py-0.5 px-1 text-[9px]' : 'p-1 text-[10px]'}`}>
                          {(() => {
                            const est = g?.estimation || defaultEstimation;
                            return (est === 'غير مقوم' || est === 'غير مقوّم' || est === '-') ? '' : est;
                          })()}
                        </td>
                        <td className={`border border-slate-900 ${ecoPaperMode ? 'py-0.5 px-1 text-[9px]' : 'p-1 text-[10px]'}`}>
                          {g?.remarks || g?.guidance || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --------------------------------------------- */}
        {/* DOC 4: COUNCIL REPORT (تقرير مجلس القسم) */}
        {/* --------------------------------------------- */}
        {docType === 'COUNCIL_FORM' && (
          <div className="space-y-3">
            {/* Stats Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border border-slate-900 p-2 text-xs font-bold bg-slate-50">
              <div>تعداد القسم الكلي: <span className="font-mono">{stats.totalStudents}</span></div>
              <div>المقوّمون فعلياً: <span className="font-mono">{stats.evaluatedCount}</span></div>
              <div>الحاصلون على المعدل: <span className="font-mono text-[var(--primary)]">{stats.passCount}</span></div>
              <div>نسبة النجاح الفصلي: <span className="font-mono text-[var(--primary)]">{stats.passRate.toFixed(1)}%</span></div>
              <div>معدل المادة العام: <span className="font-mono">{stats.averageScore.toFixed(2)} / 20</span></div>
              <div>أعلى معدل: <span className="font-mono">{stats.highestScore.toFixed(2)}</span> ({stats.topStudentName})</div>
            </div>

            {/* Official Ministerial Categories Breakdown */}
            <div className="overflow-x-auto scrollbar-thin w-full print:overflow-visible">
              <table className="w-full min-w-[380px] sm:min-w-0 text-right border-collapse border border-slate-900 text-xs">
                <thead className="bg-slate-100 border-b border-slate-900 font-bold">
                  <tr>
                    <th className="border border-slate-900 p-1.5">الفئة الوزارية</th>
                    <th className="border border-slate-900 p-1.5 text-center w-24">العدد</th>
                    <th className="border border-slate-900 p-1.5 text-center w-24">النسبة %</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-900 p-1">أقل من 08 (ضعيف جداً)</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">{stats.lessThan8}</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">
                      {stats.evaluatedCount > 0 ? ((stats.lessThan8 / stats.evaluatedCount) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-900 p-1">ما بين 08 و 09.99 (دون المتوسط)</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">{stats.between8and10}</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">
                      {stats.evaluatedCount > 0 ? ((stats.between8and10 / stats.evaluatedCount) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-900 p-1">ما بين 10 و 11.99 (مقبول / متوسط)</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">{stats.between10and12}</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">
                      {stats.evaluatedCount > 0 ? ((stats.between10and12 / stats.evaluatedCount) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-900 p-1">ما بين 12 و 13.99 (جيد)</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">{stats.between12and14}</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">
                      {stats.evaluatedCount > 0 ? ((stats.between12and14 / stats.evaluatedCount) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-900 p-1">ما بين 14 و 15.99 (جيد جداً)</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">{stats.between14and16}</td>
                    <td className="border border-slate-900 p-1 text-center font-mono">
                      {stats.evaluatedCount > 0 ? ((stats.between14and16 / stats.evaluatedCount) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-900 p-1 font-bold">أكبر من 16 (ممتاز)</td>
                    <td className="border border-slate-900 p-1 text-center font-mono font-bold">{stats.greaterThan16}</td>
                    <td className="border border-slate-900 p-1 text-center font-mono font-bold">
                      {stats.evaluatedCount > 0 ? ((stats.greaterThan16 / stats.evaluatedCount) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --------------------------------------------- */}
        {/* DOC 5: STUDENTS LIST (قائمة التلاميذ الرسمية) */}
        {/* --------------------------------------------- */}
        {docType === 'STUDENTS_LIST' && (
          <div className="space-y-3">
            <div className="overflow-x-auto scrollbar-thin w-full print:overflow-visible">
              <table className="w-full min-w-[380px] sm:min-w-0 text-right border-collapse border border-slate-900 text-xs">
                <thead className="bg-slate-100 border-b border-slate-900 font-bold">
                  <tr>
                    <th className="border border-slate-900 p-2 text-center w-12">الرقم</th>
                    <th className="border border-slate-900 p-2">اسم ولقب التلميذ</th>
                    <th className="border border-slate-900 p-2 min-w-[180px]">ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {classStudents.map(student => (
                    <tr key={student.id} className="break-inside-avoid">
                      <td className={`border border-slate-900 text-center font-mono font-bold ${ecoPaperMode ? 'py-1 px-1.5 text-[10px]' : 'p-2'}`}>
                        {student.numberInList}
                      </td>
                      <td className={`border border-slate-900 font-bold ${ecoPaperMode ? 'py-1 px-1.5 text-[10px]' : 'p-2'}`}>
                        {student.fullName}
                      </td>
                      <td className={`border border-slate-900 ${ecoPaperMode ? 'py-1 px-1.5' : 'p-2'}`}></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
