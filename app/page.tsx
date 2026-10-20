"use client";

import React, { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { useCloudAppState } from "@/hooks/useCloudAppState";
import { AppStateProvider } from "@/hooks/app-state-context";
import { SidebarSanad, SanadTab } from "@/components/SidebarSanad";
import { TopHeaderSanad } from "@/components/TopHeaderSanad";
import { MobileNavigation } from "@/components/MobileNavigation";
import { SyncConflictDialog } from "@/components/SyncConflictDialog";
import { SignOutDialog } from "@/components/SignOutDialog";
import { exportBackupJSON } from "@/lib/storage";
import { purgeLocalUserData } from "@/lib/local-user-data";
import { AuthGate } from "@/components/AuthGate";
import { CurriculumUnit } from "@/lib/types";
import { Onboarding } from "@/components/Onboarding";
import { Dashboard } from "@/components/Dashboard";
import { ClassesManager } from "@/components/ClassesManager";
import { AttendanceSanad } from "@/components/AttendanceSanad";
import { GradesAndEvaluation } from "@/components/GradesAndEvaluation";
import { CouncilAnalysis } from "@/components/CouncilAnalysis";
import { SessionCahier } from "@/components/SessionCahier";
import { AnnualDistribution } from "@/components/AnnualDistribution";
import { CurriculumView } from "@/components/CurriculumView";
import { TimetableSanad } from "@/components/TimetableSanad";
import { SettingsSanad } from "@/components/SettingsSanad";
import { LessonPreparation } from "@/components/LessonPreparation";
import { DocumentsExport } from "@/components/DocumentsExport";
import { GlobalSearchModal } from "@/components/GlobalSearchModal";

const TAB_ROUTES: Record<SanadTab, string> = {
  dashboard: "/dashboard",
  classes: "/classes",
  students: "/students",
  attendance: "/attendance",
  grades: "/grades",
  council: "/council",
  sessions: "/sessions",
  annual_dist: "/annual-distribution",
  curriculum: "/curriculum",
  timetable: "/timetable",
  settings: "/settings",
  prep: "/lesson-preparation",
  documents: "/documents",
};

const ROUTE_TABS = Object.entries(TAB_ROUTES).reduce<Record<string, SanadTab>>(
  (result, [tab, route]) => {
    result[route] = tab as SanadTab;
    return result;
  },
  {},
);

function AppContent({
  user,
  onSignOut,
}: {
  user: User | null;
  onSignOut: () => void;
}) {
  const {
    state,
    handleUpdateState,
    updateStateAndWait,
    replaceStateFromBackup,
    commitRosterImport,
    clearRosterData,
    resetWorkspace,
    isMounted,
    cloudReady,
    cloudStatus,
    syncError,
    retrySync,
    syncNow,
    countPendingOperations,
    flushOutboxNow,
    conflicts,
    resolveConflictKeepRemote,
    resolveConflictKeepLocal,
    resyncFromCloud,
    pendingCount,
    lastSyncedAt,
    refreshSyncStatus,
    syncDeviceId,
  } = useCloudAppState(user);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [isConflictOpen, setIsConflictOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const currentTab = ROUTE_TABS[pathname] ?? "dashboard";
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [prepUnit, setPrepUnit] = useState<CurriculumUnit | null>(null);
  const [prepTab, setPrepTab] = useState<"card" | "pdf" | "bank">("card");
  const [selectedSessionForCahier, setSelectedSessionForCahier] = useState<string | null>(null);
  const [signOutRequest, setSignOutRequest] = useState<{ pending: number } | null>(null);

  // Derive onboarding state from app state (no need for separate state + effect)
  const showOnboarding =
    isMounted &&
    cloudReady &&
    !state.onboardingDismissed &&
    state.classes.length === 0 &&
    state.students.length === 0;

  /**
   * Sign-out is only "clean" when everything is acknowledged: otherwise we show the
   * pending-work dialog instead of silently dropping local changes.
   */
  const handleSignOutRequest = async () => {
    if (!user) {
      onSignOut();
      return;
    }
    const pending = await countPendingOperations();
    if (pending === 0 && cloudStatus === "ready") {
      await performSignOut();
      return;
    }
    setSignOutRequest({ pending });
  };

  const performSignOut = async () => {
    setSignOutRequest(null);
    try {
      await flushOutboxNow();
    } catch (error) {
      console.warn("Sign-out flush warning:", error);
    }
    try {
      await purgeLocalUserData(user?.id);
    } catch (error) {
      console.warn("Sign-out purge warning:", error);
    }
    onSignOut();
  };

  const handleExportBackup = () => {
    try {
      const blob = new Blob([exportBackupJSON(state)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `moeen-al-oustadh-backup-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Backup export failed:", error);
    }
  };

  const setCurrentTab = (tab: SanadTab) => {
    router.push(TAB_ROUTES[tab]);
  };

  // Remember only meaningful workspaces. This is synchronized with app settings,
  // so reopening the PWA can resume work without storing user data in localStorage.
  useEffect(() => {
    if (currentTab !== "attendance" && currentTab !== "sessions" && currentTab !== "grades") return;
    const sessionId =
      currentTab === "sessions"
        ? selectedSessionForCahier || undefined
        : currentTab === "attendance"
          ? state.sessions.find((session) => session.classId === state.activeClassId)?.id
          : undefined;
    const previous = state.lastWorkspace;
    if (
      previous?.route === currentTab &&
      previous.classId === state.activeClassId &&
      previous.sessionId === sessionId
    )
      return;
    handleUpdateState((current) => ({
      ...current,
      lastWorkspace: {
        route: currentTab,
        classId: current.activeClassId,
        sessionId,
        gradeColumn: currentTab === "grades" ? current.lastWorkspace?.gradeColumn : undefined,
        updatedAt: new Date().toISOString(),
      },
    }));
  }, [
    currentTab,
    selectedSessionForCahier,
    state.activeClassId,
    state.sessions,
    state.lastWorkspace,
    handleUpdateState,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Unregister any stale Service Workers that could cache old build chunks in preview
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) {
          void registration.unregister();
        }
      })
      .catch(() => {});
  }, []);

  // Navigate to prep with unit preselected
  const handlePrepareUnit = (
    unit: CurriculumUnit,
    tab: "card" | "pdf" | "bank" = "card",
  ) => {
    setPrepUnit(unit);
    setPrepTab(tab);
    setCurrentTab("prep");
  };

  const isCollapsed = state.sidebarCollapsed || false;

  return (
    <AppStateProvider
      value={{
        state,
        ownerId: user?.id ?? null,
        updateState: handleUpdateState,
        updateStateAndWait,
        replaceStateFromBackup,
        commitRosterImport,
        clearRosterData,
        resetWorkspace,
        resyncFromCloud,
        pendingCount,
        lastSyncedAt,
        refreshSyncStatus,
        syncDeviceId,
        retrySync,
        syncNow,
        cloudStatus,
        conflicts,
        resolveConflictKeepRemote,
        resolveConflictKeepLocal,
      }}>
      <div
        className="min-h-screen flex flex-row bg-[var(--bg-page)] text-[var(--text-primary)]"
        dir="rtl">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[var(--primary)] focus:text-white focus:text-xs focus:font-bold">
          الانتقال إلى المحتوى الرئيسي
        </a>
        {/* 1. Official Sanad Al-Oustadh Right Sidebar (Desktop & Mobile Drawer) */}
        <SidebarSanad
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          isOpenMobile={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
          onSignOut={() => void handleSignOutRequest()}
          isCollapsed={isCollapsed}
          onToggleCollapse={() =>
            handleUpdateState((prev) => ({
              ...prev,
              sidebarCollapsed: !prev.sidebarCollapsed,
            }))
          }
        />

        {/* 2. Main Content Wrapper (offset by sidebar width on desktop) */}
        <div
          className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
            isCollapsed ? "lg:mr-20" : "lg:mr-64"
          }`}>
          {/* Top Header Bar */}
          <TopHeaderSanad
            currentTab={currentTab}
            onOpenSearch={() => setIsSearchOpen(true)}
            onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
            cloudStatus={cloudStatus}
            syncError={syncError}
            onRetrySync={retrySync}
            onOpenConflict={() => setIsConflictOpen(true)}
          />

          {/* View Content Area (with bottom padding for Mobile Navigation bar) */}
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-12">
            {currentTab === "dashboard" && <Dashboard onNavigate={setCurrentTab} />}

            {currentTab === "classes" && (
              <ClassesManager onNavigate={setCurrentTab} initialSubTab="classes" />
            )}

            {currentTab === "students" && (
              <ClassesManager onNavigate={setCurrentTab} initialSubTab="students" />
            )}

            {currentTab === "attendance" && (
              <AttendanceSanad
                onNavigateToTimetable={() => setCurrentTab("timetable")}
                onNavigateToSessions={(sessionId) => {
                  setSelectedSessionForCahier(sessionId || null);
                  setCurrentTab("sessions");
                }}
              />
            )}

            {currentTab === "grades" && <GradesAndEvaluation />}

            {currentTab === "council" && <CouncilAnalysis />}

            {currentTab === "sessions" && (
              <SessionCahier
                initialSessionId={
                  selectedSessionForCahier ||
                  (state.lastWorkspace?.route === "sessions"
                    ? state.lastWorkspace.sessionId
                    : undefined)
                }
                onClearInitialSession={() => setSelectedSessionForCahier(null)}
                onNavigate={(target) => setCurrentTab(target)}
              />
            )}

            {currentTab === "annual_dist" && <AnnualDistribution />}

            {currentTab === "curriculum" && (
              <CurriculumView onPrepareUnit={handlePrepareUnit} />
            )}

            {currentTab === "timetable" && <TimetableSanad />}

            {currentTab === "settings" && <SettingsSanad />}

            {currentTab === "prep" && (
              <LessonPreparation initialUnit={prepUnit} initialTab={prepTab} />
            )}

            {currentTab === "documents" && <DocumentsExport />}
          </main>

          {/* Footer */}
          <footer className="border-[var(--border-default)] bg-white px-4 py-6 pb-24 text-center text-xs lg:pb-6 print:hidden">
            <div className="max-w-7xl mx-auto flex flex-col items-center justify-center gap-1">
              <div className="mb-1 text-sm font-bold text-[var(--text-primary)]">
                معين
              </div>
              <div className="text-slate-500 font-medium">
                تطبيق مساعد لأستاذ التعليم الثانوي العام والتكنولوجي (القرار 186/2006)
              </div>
              {state.profile.schoolName ? (
                <div className="text-slate-600 font-bold mt-1">
                  {state.profile.schoolName}
                  {state.profile.stateName ? ` - ${state.profile.stateName}` : ""}
                </div>
              ) : (
                <div className="text-slate-600 font-medium text-xs mt-1">
                  الطور الثانوي • وزارة التربية الوطنية
                </div>
              )}
              <div className="text-xs text-slate-600 font-mono mt-0.5">
                2026 - 2027
              </div>
            </div>
          </footer>
        </div>

        {/* 3. Mobile/Tablet Navigation Bottom Bar (hidden when desktop sidebar is visible) */}
        <MobileNavigation
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          onOpenMobileMenu={() => setIsMobileSidebarOpen(true)}
        />

        {/* 4. Global Search Modal (Ctrl+K) */}
        <GlobalSearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          onNavigate={setCurrentTab}
          onPrepareUnit={handlePrepareUnit}
        />
        <SyncConflictDialog
          conflict={isConflictOpen ? conflicts[0] || null : null}
          busy={conflictBusy}
          onKeepRemote={async () => {
            setConflictBusy(true);
            setConflictError(null);
            try {
              if (conflicts[0]) await resolveConflictKeepRemote(conflicts[0]);
              setIsConflictOpen(false);
            } catch (error) {
              setConflictError(
                error instanceof Error ? error.message : "تعذر حل التعارض.",
              );
            } finally {
              setConflictBusy(false);
            }
          }}
          onKeepLocal={async () => {
            setConflictBusy(true);
            setConflictError(null);
            try {
              if (conflicts[0]) await resolveConflictKeepLocal(conflicts[0]);
              setIsConflictOpen(false);
            } catch (error) {
              setConflictError(
                error instanceof Error ? error.message : "تعذر حل التعارض.",
              );
            } finally {
              setConflictBusy(false);
            }
          }}
        />
        <SignOutDialog
          isOpen={Boolean(signOutRequest)}
          pendingOperations={signOutRequest?.pending ?? 0}
          cloudStatus={cloudStatus}
          syncError={syncError}
          onSyncThenSignOut={async () => {
            const flushed = await flushOutboxNow();
            if (!flushed) return false;
            await performSignOut();
            return true;
          }}
          onExportBackup={handleExportBackup}
          onSignOutAnyway={() => void performSignOut()}
          onCancel={() => setSignOutRequest(null)}
        />
        {conflictError && (
          <div
            role="alert"
            className="fixed bottom-4 left-4 z-[10001] rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white">
            {conflictError}
          </div>
        )}

        {/* 6. Onboarding for new users */}
        {showOnboarding && (
          <Onboarding onOpenSetup={() => setCurrentTab("classes")} />
        )}
      </div>
    </AppStateProvider>
  );
}

export default function Page() {
  return (
    <AuthGate>
      {(user, onSignOut) => (
        <AppContent key={user?.id || "anon"} user={user} onSignOut={onSignOut} />
      )}
    </AuthGate>
  );
}
