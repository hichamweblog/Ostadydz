"use client";
import Image from "next/image";
import { useAppState } from '@/hooks/app-state-context';
import { getSubjectDisplayName, normalizeSubjectList } from "@/lib/education";
import { AppState, exportBackupJSON } from "@/lib/storage";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CalendarRange,
  Download,
  Edit3,
  FileText,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Star,
  UserCheck,
  Users,
  X,
  LogIn,
  LogOut,
} from "lucide-react";
import React from "react";

export type SanadTab =
  | "dashboard"
  | "classes"
  | "students"
  | "attendance"
  | "grades"
  | "council"
  | "sessions"
  | "annual_dist"
  | "curriculum"
  | "timetable"
  | "settings"
  | "prep"
  | "documents";

interface SidebarSanadProps {
  currentTab: SanadTab;
  onSelectTab: (tab: SanadTab) => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onSignOut?: () => void;
}

export const SidebarSanad: React.FC<SidebarSanadProps> = ({
  currentTab,
  onSelectTab,
  isOpenMobile = false,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapse,
  onSignOut,
}) => {
  const { state, ownerId } = useAppState();
  const navGroups: {
    groupName: string;
    items: {
      id: SanadTab;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      isAi?: boolean;
      badge?: string;
    }[];
  }[] = [
    {
      groupName: "الرئيسية",
      items: [{ id: "dashboard", label: "لوحة التحكم", icon: LayoutDashboard }],
    },
    {
      groupName: "المنهاج والتخطيط",
      items: [
        { id: "timetable", label: "جدول التوقيت", icon: CalendarDays },
        { id: "annual_dist", label: "التوزيع السنوي", icon: CalendarRange },
        { id: "curriculum", label: "المنهاج", icon: BookOpen },
        { id: "prep", label: "المذكرات", icon: FileText },
        { id: "sessions", label: "دفتر النصوص", icon: Edit3 },
      ],
    },
    {
      groupName: "التقويم",
      items: [
        { id: "classes", label: "الأقسام المسندة", icon: Users },
        { id: "students", label: "قوائم التلاميذ", icon: Users },
        { id: "attendance", label: "الحضور", icon: UserCheck },
        { id: "grades", label: "النقاط", icon: Star },
        { id: "council", label: "المجالس", icon: BarChart3 },
        { id: "documents", label: "الوثائق", icon: FileText },
      ],
    },
    {
      groupName: "النظام",
      items: [{ id: "settings", label: "الإعدادات", icon: Settings }],
    },
  ];

  const handleBackup = () => {
    const jsonStr = exportBackupJSON(state);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `معين_نسخة_احتياطية_${state.profile.name || "أستاذ"}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const teacherName = state.profile.name || "أستاذ المادة";
  const schoolName = state.profile.schoolName || "المؤسسة التعليمية";
  const teacherInitial = teacherName.trim().charAt(0) || "أ";
  const taughtSubjects = normalizeSubjectList(
    state.profile.taughtSubjectIds ?? state.profile.subjectIds,
    state.profile.primarySubjectId,
  );
  const activeSubId = state.activeSubjectId ?? taughtSubjects[0];
  const sidebarSubjectLabel = activeSubId
    ? getSubjectDisplayName(activeSubId, state.profile.variantId, true)
    : "التعليم الثانوي";

  return (
    <>
      {/* Mobile Overlay */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      {/* Signature Deep Navy Sidebar (as seen in Screenshot 2) */}
      <aside
        id="sanad-sidebar"
        className={`fixed top-0 bottom-0 right-0 z-50 flex flex-col transition-all duration-300 ease-in-out border-l border-[var(--accent-navy-card)] bg-[var(--accent-navy)] text-white ${
          isCollapsed ? "w-20" : "w-64"
        } ${
          isOpenMobile
            ? "translate-x-0 shadow-2xl w-72"
            : "translate-x-full lg:translate-x-0"
        }`}>
        {/* Top Branding */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-[var(--accent-navy-card)] shrink-0">
          {isCollapsed ? (
            <div className="mx-auto">
              <Image
                src="/pwa-192x192.png"
                alt="شعار معين"
                width={40}
                height={40}
                className="rounded-xl shadow-sm object-cover"
                priority
              />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Image
                src="/pwa-192x192.png"
                alt="شعار معين"
                width={40}
                height={40}
                className="rounded-xl shadow-sm object-cover shrink-0"
                priority
              />
              <div className="text-right">
                <div className="font-black text-sm text-white tracking-tight leading-tight">
                  معين
                </div>
                <div className="text-[10px] text-amber-400 font-bold flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="truncate max-w-[130px]">{sidebarSubjectLabel}</span>
                </div>
              </div>
            </div>
          )}

          {/* Desktop Collapse Toggle */}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
              title={isCollapsed ? "توسيع القائمة" : "تصغير القائمة"}>
              {isCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Mobile Close Button */}
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg lg:hidden cursor-pointer"
              aria-label="إغلاق القائمة">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5 scrollbar-thin">
          {navGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 text-[10px] font-black uppercase tracking-wider text-slate-400 text-right">
                  {group.groupName}
                </div>
              )}

              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectTab(item.id);
                      if (onCloseMobile) onCloseMobile();
                    }}
                    title={isCollapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-right cursor-pointer group relative ${
                      isActive
                        ? "bg-[var(--primary)] text-white shadow-sm border border-[var(--primary)]/30"
                        : "text-slate-300 hover:text-white hover:bg-[var(--accent-navy-card)]"
                    } ${isCollapsed ? "justify-center px-0" : ""}`}
                    id={`sidebar-link-${item.id}`}>
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                        isActive
                          ? "text-white"
                          : item.isAi
                            ? "text-amber-400"
                            : "text-slate-400 group-hover:text-slate-200"
                      }`}
                    />
                    {!isCollapsed && (
                      <span className="flex-1 truncate">{item.label}</span>
                    )}
                    {!isCollapsed && item.isAi && !isActive && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-300 border border-amber-400/30 font-bold">
                        AI
                      </span>
                    )}

                    {/* Active Pip Indicator for Collapsed Mode */}
                    {isCollapsed && isActive && (
                      <span className="absolute left-1.5 w-1.5 h-1.5 rounded-full bg-emerald-300" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Bottom Section: teacher profile and local backup */}
        <div className="p-3 border-t border-[var(--accent-navy-card)] shrink-0 bg-[var(--accent-navy)] space-y-2">
          {!isCollapsed ? (
            <div
              onClick={() => {
                onSelectTab("settings");
                if (onCloseMobile) onCloseMobile();
              }}
              className="flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--accent-navy-card)] transition-colors cursor-pointer">
              {state.profile.avatarUrl ? (
                <Image
                  src={state.profile.avatarUrl}
                  alt={teacherName}
                  width={36}
                  height={36}
                  unoptimized
                  className="w-9 h-9 rounded-xl object-cover shadow-xs shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-slate-950 font-black text-sm flex items-center justify-center shadow-xs shrink-0">
                  {teacherInitial}
                </div>
              )}
              <div className="text-right overflow-hidden flex-1">
                <div className="font-bold text-xs text-white truncate">
                  {teacherName}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {schoolName}
                </div>
              </div>
            </div>
          ) : (
            <div
              onClick={() => {
                onSelectTab("settings");
                if (onCloseMobile) onCloseMobile();
              }}
              className="w-10 h-10 mx-auto rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-slate-950 font-black text-sm flex items-center justify-center cursor-pointer overflow-hidden"
              title={teacherName}>
              {state.profile.avatarUrl ? (
                <Image
                  src={state.profile.avatarUrl}
                  alt={teacherName}
                  width={40}
                  height={40}
                  unoptimized
                  className="w-full h-full object-cover"
                />
              ) : (
                teacherInitial
              )}
            </div>
          )}

          <div className={`pt-1 flex items-center gap-1 text-[11px] text-slate-400 ${isCollapsed ? "justify-center" : "justify-between"}`}>
            <button
              onClick={handleBackup}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-[var(--accent-navy-card)] hover:text-white ${isCollapsed ? "justify-center" : ""}`}
              title="تصدير نسخة احتياطية"
              aria-label="تصدير نسخة احتياطية"
            >
              <Download className="h-3.5 w-3.5 text-[var(--primary)]" />
              {!isCollapsed && <span>تصدير نسخة احتياطية</span>}
            </button>
            {onSignOut && (
              <button
                onClick={onSignOut}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-slate-400 transition-colors hover:bg-[var(--accent-navy-card)] hover:text-white cursor-pointer ${isCollapsed ? "justify-center" : ""}`}
                title={ownerId ? "تسجيل الخروج" : "تسجيل الدخول السحابي"}
                aria-label={ownerId ? "تسجيل الخروج" : "تسجيل الدخول السحابي"}
              >
                {ownerId ? (
                  <>
                    <LogOut className="h-3.5 w-3.5" />
                    {!isCollapsed && <span>تسجيل الخروج</span>}
                  </>
                ) : (
                  <>
                    <LogIn className="h-3.5 w-3.5 text-amber-400" />
                    {!isCollapsed && <span className="text-amber-300 font-bold">دخول سحابي</span>}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
