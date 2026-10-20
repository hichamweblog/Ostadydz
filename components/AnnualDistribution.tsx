"use client";

import { useAppState } from '@/hooks/app-state-context';
import {
  buildStarterUnitsForTrack,
  getMergedCurriculumUnits,
  getWeeklyHours,
  loadAllCurriculum,
} from "@/lib/curriculum-data";
import { selectEffectiveSubjectId } from "@/lib/state-selectors";
import {
  CurriculumUnit,
  getSubjectDisplayName,
  GradeLevel,
} from "@/lib/types";
import { resolveLevelAndStream } from "@/lib/education";
import { exportToDocx } from "@/lib/utils";
import { Layers, Printer, Sparkles } from "lucide-react";
import React, { useEffect, useState } from "react";
import { SubjectSwitcherBar } from "./SubjectSwitcherBar";
import { showToast } from "./Toast";

interface AnnualDistributionProps {
}

export interface UnitScheduleInfo {
  monthName: string;
  monthId: string;
  weekName: string;
  periodName: string;
}

export const getUnitSchedule = (
  sectionNumber: number,
  uIdx: number,
  totalInSec: number,
): UnitScheduleInfo => {
  if (sectionNumber === 1) {
    if (uIdx === 0)
      return {
        monthName: "سبتمبر",
        monthId: "sep",
        weekName: "الأسبوع 3 - 4",
        periodName: "المقطع 1",
      };
    if (uIdx === 1)
      return {
        monthName: "أكتوبر",
        monthId: "oct",
        weekName: "الأسبوع 1",
        periodName: "المقطع 1",
      };
    if (uIdx === 2)
      return {
        monthName: "أكتوبر",
        monthId: "oct",
        weekName: "الأسبوع 2",
        periodName: "المقطع 1",
      };
    if (uIdx === 3)
      return {
        monthName: "أكتوبر",
        monthId: "oct",
        weekName: "الأسبوع 3 - 4",
        periodName: "المقطع 1",
      };
    if (uIdx === 4)
      return {
        monthName: "نوفمبر",
        monthId: "nov",
        weekName: "الأسبوع 1",
        periodName: "المقطع 1",
      };
    if (uIdx === 5)
      return {
        monthName: "نوفمبر",
        monthId: "nov",
        weekName: "الأسبوع 2",
        periodName: "المقطع 1",
      };
    if (uIdx === 6)
      return {
        monthName: "نوفمبر",
        monthId: "nov",
        weekName: "الأسبوع 3 - 4",
        periodName: "المقطع 1",
      };
    return {
      monthName: "ديسمبر",
      monthId: "dec",
      weekName: `الأسبوع ${Math.min(Math.max(uIdx - 6, 1), 2)}`,
      periodName: "المقطع 1",
    };
  } else if (sectionNumber === 2) {
    if (uIdx === 0)
      return {
        monthName: "جانفي",
        monthId: "jan",
        weekName: "الأسبوع 1",
        periodName: "المقطع 2",
      };
    if (uIdx === 1)
      return {
        monthName: "جانفي",
        monthId: "jan",
        weekName: "الأسبوع 2 - 3",
        periodName: "المقطع 2",
      };
    if (uIdx === 2)
      return {
        monthName: "جانفي",
        monthId: "jan",
        weekName: "الأسبوع 4",
        periodName: "المقطع 2",
      };
    if (uIdx === 3)
      return {
        monthName: "فيفري",
        monthId: "feb",
        weekName: "الأسبوع 1",
        periodName: "المقطع 2",
      };
    if (uIdx === 4)
      return {
        monthName: "فيفري",
        monthId: "feb",
        weekName: "الأسبوع 2 - 3",
        periodName: "المقطع 2",
      };
    if (uIdx === 5)
      return {
        monthName: "فيفري",
        monthId: "feb",
        weekName: "الأسبوع 4",
        periodName: "المقطع 2",
      };
    return {
      monthName: "مارس",
      monthId: "mar",
      weekName: `الأسبوع ${Math.min(Math.max(uIdx - 5, 1), 2)}`,
      periodName: "المقطع 2",
    };
  } else {
    if (uIdx === 0)
      return {
        monthName: "أفريل",
        monthId: "apr",
        weekName: "الأسبوع 1",
        periodName: "المقطع 3",
      };
    if (uIdx === 1)
      return {
        monthName: "أفريل",
        monthId: "apr",
        weekName: "الأسبوع 2 - 3",
        periodName: "المقطع 3",
      };
    if (uIdx === 2)
      return {
        monthName: "أفريل",
        monthId: "apr",
        weekName: "الأسبوع 4",
        periodName: "المقطع 3",
      };
    if (uIdx === 3)
      return {
        monthName: "ماي",
        monthId: "may",
        weekName: "الأسبوع 1",
        periodName: "المقطع 3",
      };
    if (uIdx === 4)
      return {
        monthName: "ماي",
        monthId: "may",
        weekName: "الأسبوع 2 - 3",
        periodName: "المقطع 3",
      };
    return {
      monthName: "جوان",
      monthId: "jun",
      weekName: "الأسبوع 1",
      periodName: "المقطع 3",
    };
  }
};

export const AnnualDistribution: React.FC<AnnualDistributionProps> = ({
}) => {
  const { state, updateStateAndWait } = useAppState();
  const activeClass = state.classes.find(c => c.id === state.activeClassId);
  const activeSubjectId = selectEffectiveSubjectId(state, activeClass);
  const activeSubjectTitle = getSubjectDisplayName(
    activeSubjectId,
    activeSubjectId && activeClass?.subjectVariantById?.[activeSubjectId]
      ? activeClass.subjectVariantById[activeSubjectId]
      : state.profile.variantId,
  );
  const [prevActiveClassId, setPrevActiveClassId] = useState(state.activeClassId);
  const [selectedLevel, setSelectedLevel] = useState<GradeLevel>(activeClass?.level || "3AS");
  const [curriculumLoaded, setCurriculumLoaded] = useState(false);

  if (state.activeClassId !== prevActiveClassId) {
    setPrevActiveClassId(state.activeClassId);
    if (activeClass?.level) {
      setSelectedLevel(activeClass.level);
    }
  }

  useEffect(() => {
    let active = true;
    loadAllCurriculum().then(() => {
      if (active) setCurriculumLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const levelUnits = getMergedCurriculumUnits(state.customUnits, activeSubjectId).filter(
    (u) => u.level === selectedLevel,
  );

  const weeklyHoursForSelection = getWeeklyHours(selectedLevel, {
    subjectId: activeSubjectId,
    levelCode: activeClass?.levelCode,
    streamId: activeClass?.streamId,
    overrides: state.educationOverrides,
  });

  const handleGenerateStarterUnits = async () => {
    if (!activeSubjectId) return;
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
      weeklyHours: weeklyHoursForSelection,
    });
    await updateStateAndWait((prev) => ({
      ...prev,
      customUnits: [
        ...prev.customUnits.filter(
          (u) => !(u.subjectId === activeSubjectId && u.level === selectedLevel),
        ),
        ...starterUnits,
      ],
    }));
    showToast(`تم توليد التوزيع السنوي المقترح لمادة ${activeSubjectTitle} بنجاح!`, "success");
  };

  const levelLabel: Record<GradeLevel, string> = {
    "1AS_ARTS": "السنة الأولى ثانوي - جذع مشترك آداب",
    "1AS_SCIENCE": "السنة الأولى ثانوي - جذع مشترك علوم وتكنولوجيا",
    "2AS": "السنة الثانية ثانوي - جميع الشعب",
    "3AS": "السنة الثالثة ثانوي - بكالوريا (جميع الشعب)",
  };

  // Group units into 3 official ministerial sections (المقطع الأول، الثاني، الثالث)
  const term1Units = levelUnits.filter((u) => (u.sectionNumber || 1) === 1);
  const term2Units = levelUnits.filter((u) => u.sectionNumber === 2);
  const term3Units = levelUnits.filter((u) => u.sectionNumber === 3);

  const buildSectionWithSchedule = (
    secNumber: number,
    title: string,
    shortTitle: string,
    months: string[],
    units: CurriculumUnit[],
    badge: string,
  ) => {
    const scheduledUnits = units.map((unit, uIdx) => {
      const sched = getUnitSchedule(secNumber, uIdx, units.length);
      return {
        unit,
        originalIndex: uIdx,
        sched,
      };
    });

    return {
      number: secNumber,
      title,
      shortTitle,
      months,
      units: scheduledUnits,
      badge,
    };
  };

  const sections = [
    buildSectionWithSchedule(
      1,
      "المقطع الأول — الفترة الأولى (سبتمبر - ديسمبر)",
      "المقطع الأول",
      ["sep", "oct", "nov", "dec"],
      term1Units,
      "الفترة الأولى",
    ),
    buildSectionWithSchedule(
      2,
      "المقطع الثاني — الفترة الثانية (جانفي - مارس)",
      "المقطع الثاني",
      ["jan", "feb", "mar"],
      term2Units,
      "الفترة الثانية",
    ),
    buildSectionWithSchedule(
      3,
      "المقطع الثالث — الفترة الثالثة (أفريل - جوان)",
      "المقطع الثالث",
      ["apr", "may", "jun"],
      term3Units,
      "الفترة الثالثة",
    ),
  ];

  const totalHours = levelUnits.reduce(
    (acc, u) => acc + (u.hourlyVolume || 2),
    0,
  );

  // Helper to extract or construct a clean competence number without title
  const getCompetenceNumber = (unit: CurriculumUnit, index: number): string => {
    if (unit.targetedCompetence) {
      // If text mentions numbers like "ك1" or "1" or "الكفاءة الأولى"
      const match = unit.targetedCompetence.match(/([0-9]+)/);
      if (match) return `ك ${match[1]}`;
    }
    // Standard sequential competence number for unit
    return `ك ${(index % 5) + 1}`;
  };

  const handleExportWord = () => {
    let sectionsHtml = "";

    sections.forEach((sec) => {
      let rowsHtml = "";
      sec.units.forEach(({ unit, originalIndex, sched }) => {
        const compText =
          unit.targetedCompetence ||
          `كفاءة الوحدة ${getCompetenceNumber(unit, originalIndex)}`;
        rowsHtml += `
          <tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="border: 1px solid #94a3b8; padding: 6px 8px; text-align: center; font-weight: bold; width: 40px;">
              ${String(unit.unitNumber).padStart(2, "0")}
            </td>
            <td style="border: 1px solid #94a3b8; padding: 6px 8px; text-align: center; font-weight: bold; width: 110px; background-color: #f8fafc;">
              ${sched.monthName} / ${sched.weekName}
            </td>
            <td style="border: 1px solid #94a3b8; padding: 6px 8px; font-weight: bold; color: #065f46; text-align: right; width: 110px;">
              ${unit.domain}
            </td>
            <td style="border: 1px solid #94a3b8; padding: 6px 8px; font-weight: bold; color: #1A1C1E; text-align: right;">
              ${unit.title}
            </td>
            <td style="border: 1px solid #94a3b8; padding: 6px 8px; text-align: center; font-weight: bold; width: 55px;">
              ${unit.hourlyVolume} سا
            </td>
            <td style="border: 1px solid #94a3b8; padding: 6px 8px; font-size: 9.5pt; color: #334155; line-height: 1.4; text-align: right;">
              ${compText}
            </td>
          </tr>
        `;
      });

      sectionsHtml += `
        <table style="width: 100%; border-collapse: collapse; margin-top: 14px; margin-bottom: 18px; font-family: 'Amiri', 'Traditional Arabic', serif;" dir="rtl">
          <thead>
            <tr style="background-color: #2E7D9B; color: #ffffff;">
              <th colspan="6" style="border: 1px solid #094530; padding: 8px 10px; font-size: 12pt; text-align: right; font-weight: bold;">
                ${sec.title} (${sec.units.length} وحدة تعليمية)
              </th>
            </tr>
            <tr style="background-color: #f1f5f9; color: #1e293b; font-size: 10.5pt; font-weight: bold;">
              <th style="border: 1px solid #94a3b8; padding: 6px; text-align: center; width: 40px;">الرقم</th>
              <th style="border: 1px solid #94a3b8; padding: 6px; text-align: center; width: 110px;">الشهر / الأسبوع</th>
              <th style="border: 1px solid #94a3b8; padding: 6px; text-align: right; width: 110px;">الميدان</th>
              <th style="border: 1px solid #94a3b8; padding: 6px; text-align: right;">الوحدة التعليمية / العنوان</th>
              <th style="border: 1px solid #94a3b8; padding: 6px; text-align: center; width: 55px;">الحجم</th>
              <th style="border: 1px solid #94a3b8; padding: 6px; text-align: right;">الكفاءة المستهدفة</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      `;
    });

    const htmlContent = `
      <div dir="rtl" style="font-family: 'Amiri', 'Traditional Arabic', serif; color: #000000; padding: 10px;">
        <table style="width: 100%; border: none; margin-bottom: 12px;" dir="rtl">
          <tr>
            <td style="width: 35%; text-align: right; font-size: 10pt; line-height: 1.4; vertical-align: top;">
              المؤسسة: <strong>${state.profile.schoolName || "ثانوية التعليم الثانوي"}</strong>
            </td>
            <td style="width: 30%; text-align: center; vertical-align: middle;">
              <div style="margin: 0; color: #2E7D9B; font-size: 15pt; font-weight: bold;">التوزيع السنوي</div>
              <div style="font-size: 11.5pt; font-weight: bold; margin-top: 4px; color: #1A1C1E;">${levelLabel[selectedLevel]}</div>
              <div style="font-size: 10pt; color: #5C6370; margin-top: 2px;">مادة: ${activeSubjectTitle}</div>
            </td>
            <td style="width: 35%; text-align: left; font-size: 10pt; line-height: 1.4; vertical-align: top;">
              السنة الدراسية: <strong>${state.profile.academicYear || "2026/2027"}</strong><br/>
              الأستاذ(ة): <strong>${state.profile.name || "أستاذ المادة"}</strong><br/>
              الحجم الساعي: <strong>${weeklyHoursForSelection} سا/أسبوع</strong> (الإجمالي: <strong>${totalHours} سا</strong>)
            </td>
          </tr>
        </table>

        <div style="height: 2px; background-color: #2E7D9B; margin-bottom: 12px;"></div>

        ${sectionsHtml}

        <table style="width: 100%; border: none; margin-top: 25px; font-size: 10.5pt;" dir="rtl">
          <tr>
            <td style="width: 33%; text-align: center; vertical-align: top;">
              <strong>توقيع الأستاذ(ة):</strong>
            </td>
            <td style="width: 33%; text-align: center; vertical-align: top;">
              <strong>تأشيرة السيد(ة) مدير(ة) المؤسسة:</strong>
            </td>
            <td style="width: 34%; text-align: center; vertical-align: top;">
              <strong>تأشيرة السيد مفتش التربية الوطنية:</strong>
            </td>
          </tr>
        </table>
      </div>
    `;

    exportToDocx(htmlContent, `التوزيع_السنوي_${activeSubjectTitle.replace(/\s+/g, "_")}_${selectedLevel}`, {
      landscape: true,
      title: `التوزيع السنوي - ${activeSubjectTitle} - ${levelLabel[selectedLevel]}`,
    });
  };

  return (
    <div
      className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6"
      id="annual-distribution-view">
      {/* Multi-Subject Switcher */}
      <SubjectSwitcherBar classRoom={activeClass} allowAllFallback />

      {/* Compact toolbar — level selector + export */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between print:hidden">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none snap-x">
          {(["3AS", "2AS", "1AS_ARTS", "1AS_SCIENCE"] as GradeLevel[]).map(
            (lvl) => (
              <button
                key={lvl}
                onClick={() => setSelectedLevel(lvl)}
                className={`flex-none snap-start min-w-[80px] h-[36px] px-4 rounded-full border text-xs font-bold transition-all cursor-pointer ${
                  selectedLevel === lvl
                    ? "bg-[var(--primary)] text-white border-[var(--primary)] shadow-md"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {lvl === "3AS"
                  ? "3 ثانوي"
                  : lvl === "2AS"
                    ? "2 ثانوي"
                    : lvl === "1AS_ARTS"
                      ? "1 آداب"
                      : "1 علوم"}
              </button>
            ),
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {levelUnits.length === 0 && activeSubjectId && activeSubjectId !== "ISLAMIC" && (
            <button
              type="button"
              onClick={() => void handleGenerateStarterUnits()}
              className="min-h-11 flex items-center justify-center gap-1.5 px-4 py-2 bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>توليد توزيع سنوي آلي لمادة {activeSubjectTitle}</span>
            </button>
          )}
          <button
            onClick={handleExportWord}
            className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
            title="تصدير التوزيع السنوي كاملاً إلى ملف وورد منسق وجاهز للطباعة">
            <Printer className="w-4 h-4 text-slate-500" />
            <span>تصدير إلى ملف docx</span>
          </button>
        </div>
      </div>

      {/* Main Distribution Document Container - Integrated Months */}
      <div
        id="annual-dist-doc"
        className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-5">
        {!curriculumLoaded && (
          <div className="rounded-xl border border-[var(--primary-soft)] bg-[var(--primary-soft)]/40 px-4 py-3 text-center text-sm font-bold text-[var(--primary)]">
            جار تحميل محتوى التوزيع السنوي...
          </div>
        )}
        {/* Compact document header */}
        <div className="flex flex-col md:flex-row items-center justify-between text-center md:text-right border-b border-slate-100 pb-4 gap-3 text-xs text-slate-600">
          <div>
            <div className="font-bold text-[var(--primary)] mt-0.5">
              {state.profile.schoolName || "المؤسسة التعليمية"}
            </div>
            <div className="text-slate-500 mt-0.5">
              مادة: <strong className="text-slate-800">{activeSubjectTitle}</strong>
            </div>
          </div>

          <div className="text-center">
            <h3 className="text-lg font-amiri font-bold text-slate-900">
              التوزيع السنوي — {activeSubjectTitle}
            </h3>
            <div className="text-[var(--primary)] font-bold text-sm">
              {levelLabel[selectedLevel]}
            </div>
          </div>

          <div className="text-center md:text-left space-y-0.5">
            <div>
              السنة الدراسية:{" "}
              <span className="font-bold text-slate-900 font-mono">
                {state.profile.academicYear || "2026/2027"}
              </span>
            </div>
            <div>
              الأستاذ (ة):{" "}
              <span className="font-bold text-slate-900">
                {state.profile.name || "أستاذ المادة"}
              </span>
            </div>
            <div className="flex items-center gap-2 justify-center md:justify-end">
              <span>
                الحجم الأسبوعي:{" "}
                <span className="font-bold text-amber-700 font-mono">
                  {weeklyHoursForSelection} سا/أسبوع
                </span>
              </span>
              <span>•</span>
              <span>
                الإجمالي:{" "}
                <span className="font-bold text-[var(--primary)] font-mono">
                  {totalHours} سا
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Sections & Tables with integrated Month and Week Column */}
        <div className="space-y-6 pt-1">
          {sections.map((sec) => (
            <div key={sec.number} className="space-y-2">
              <div className="flex items-center justify-between bg-[var(--primary-soft)]/90 border border-[var(--primary)]/20 px-4 py-2.5 rounded-xl">
                <span className="font-bold text-emerald-950 text-xs flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[var(--primary)]" />
                  <span>{sec.title}</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-[var(--primary)] bg-white/90 px-2 py-0.5 rounded-md border border-[var(--primary)]/20">
                    {sec.units.length}{" "}
                    {[1, 11].includes(sec.units.length)
                      ? "وحدة تعليمية"
                      : "وحدات تعليمية"}
                  </span>
                </div>
              </div>

              {/* Desktop Table */}
              <div className="hidden lg:block border border-slate-200/90 rounded-xl overflow-hidden shadow-2xs bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                        <th className="p-2.5 w-12 text-center">الرقم</th>
                        <th className="p-2.5 w-28 text-center bg-[var(--primary-soft)]/50 text-[var(--primary)]">
                          الشهر / الأسبوع
                        </th>
                        <th className="p-2.5 w-32">الميدان</th>
                        <th className="p-2.5 min-w-[160px]">
                          الوحدة التعليمية / العنوان
                        </th>
                        <th className="p-2.5 w-20 text-center">الحجم</th>
                        <th className="p-2.5 min-w-[220px]">الكفاءة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sec.units.map(({ unit, originalIndex, sched }) => {
                        const compNum = getCompetenceNumber(
                          unit,
                          originalIndex,
                        );
                        const unitProg = state.activeClassId
                          ? state.lessonProgress.find(
                              (p) =>
                                p.classId === state.activeClassId &&
                                p.unitId === unit.id,
                            )
                          : undefined;
                        const isUnitCompleted = Boolean(
                          state.activeClassId && (
                            unitProg
                              ? unitProg.status === "COMPLETED"
                              : state.sessions.some(
                                  (s) =>
                                    s.classId === state.activeClassId &&
                                    s.unitId === unit.id &&
                                    s.sessionStatus !== "CANCELLED" &&
                                    (s.accomplishments || s.notes || s.sessionGoals),
                                )
                          ),
                        );

                        return (
                          <tr
                            key={unit.id}
                            className="hover:bg-slate-50/70 transition-colors">
                            <td className="p-2.5 text-center font-mono font-bold text-slate-500">
                              {String(unit.unitNumber).padStart(2, "0")}
                            </td>
                            {/* Integrated Month & Week Column */}
                            <td className="p-2.5 text-center whitespace-nowrap bg-[var(--primary-soft)]/30 border-x border-emerald-100/50">
                              <div className="inline-flex flex-col items-center">
                                <span className="px-2 py-0.5 rounded bg-white text-[var(--primary)] border border-[var(--primary)]/20 font-bold text-[11px] shadow-2xs">
                                  {sched.monthName}
                                </span>
                                <span className="text-[10px] text-slate-600 font-mono mt-0.5">
                                  {sched.weekName}
                                </span>
                              </div>
                            </td>
                            <td className="p-2.5 font-semibold text-[var(--primary)] text-[11px]">
                              {unit.domain}
                            </td>
                            <td className="p-2.5 font-bold text-slate-900">
                              <div className="flex items-center justify-between gap-2">
                                <span>{unit.title}</span>
                                {isUnitCompleted && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] text-[10px] font-bold border border-[var(--primary)]/20 shrink-0">
                                    أُنجزت ✓
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-700">
                              {unit.hourlyVolume} سا
                            </td>
                            {/* Competence Text (نص الكفاءة المستهدفة) */}
                            <td className="p-2.5 text-slate-800 text-[11px] leading-relaxed">
                              {unit.targetedCompetence ? (
                                <p className="font-medium text-slate-700">
                                  {unit.targetedCompetence}
                                </p>
                              ) : (
                                <span className="text-slate-400 italic">
                                  كفاءة الوحدة {compNum}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Cards */}
              <div className="block lg:hidden space-y-3 mt-3">
                {sec.units.map(({ unit, originalIndex, sched }) => {
                  const unitProg = state.activeClassId
                    ? state.lessonProgress.find(
                        (p) =>
                          p.classId === state.activeClassId &&
                          p.unitId === unit.id,
                      )
                    : undefined;
                  const isUnitCompleted = Boolean(
                    state.activeClassId && (
                      unitProg
                        ? unitProg.status === "COMPLETED"
                        : state.sessions.some(
                            (s) =>
                              s.classId === state.activeClassId &&
                              s.unitId === unit.id &&
                              s.sessionStatus !== "CANCELLED" &&
                              (s.accomplishments || s.notes || s.sessionGoals),
                          )
                    ),
                  );

                  return (
                    <div
                      key={unit.id}
                      className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded bg-[var(--primary-soft)] text-[var(--primary)] border border-[var(--primary)]/20 flex items-center justify-center text-xs font-bold">
                            {String(unit.unitNumber).padStart(2, "0")}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[var(--primary-soft)]/50 text-[var(--primary)] border border-emerald-100 font-bold text-[10px]">
                            {sched.monthName} • {sched.weekName}
                          </span>
                        </div>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono font-bold">
                          {unit.hourlyVolume} سا
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold text-[var(--primary)] bg-[var(--primary-soft)] px-1.5 py-0.5 rounded">
                            {unit.domain}
                          </span>
                          {isUnitCompleted && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] text-[10px] font-bold border border-[var(--primary)]/20">
                              أُنجزت ✓
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-sm text-slate-900 leading-snug">
                          {unit.title}
                        </h4>
                      </div>

                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 mt-1">
                        <p className="text-[11px] text-slate-700 leading-relaxed font-medium">
                          <span className="font-bold text-slate-900 ml-1">
                            الكفاءة:
                          </span>
                          {unit.targetedCompetence ||
                            `كفاءة الوحدة ${getCompetenceNumber(unit, originalIndex)}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
