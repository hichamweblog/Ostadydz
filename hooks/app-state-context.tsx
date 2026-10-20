'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AppState } from '@/lib/storage';
import type { SyncConflictDescriptor } from '@/lib/sync-outbox';
import type { CloudSyncStatusLike } from '@/lib/sync-status';
import type { RosterImportClass, RosterImportStudent } from '@/lib/supabase/roster-import';

export type AppStateUpdater = (updater: (previous: AppState) => AppState) => void;
export type AppStateSyncUpdater = (updater: (previous: AppState) => AppState) => Promise<void>;

export interface AppStateContextValue {
  state: AppState;
  /** Authenticated owner id, used to namespace local (IndexedDB) keys per teacher. */
  ownerId: string | null;
  updateState: AppStateUpdater;
  updateStateAndWait: AppStateSyncUpdater;
  replaceStateFromBackup: (state: AppState) => Promise<void>;
  commitRosterImport: (
    importedClasses: RosterImportClass[],
    importedStudents: RosterImportStudent[],
    nextState: AppState,
  ) => Promise<void>;
  clearRosterData: () => Promise<void>;
  resetWorkspace: () => Promise<void>;
  /** Reloads the whole workspace from the cloud, discarding queued local operations. */
  resyncFromCloud: () => Promise<void>;
  /** Number of queued operations still waiting for the cloud (0 = everything confirmed). */
  pendingCount: number;
  /** Timestamp of the last moment the queue was observed empty. */
  lastSyncedAt: string | null;
  /** Re-reads the durable queue and updates `pendingCount` / `lastSyncedAt`. */
  refreshSyncStatus: () => Promise<number>;
  /** Stable id of this browser profile, shown in the sync panel for troubleshooting. */
  syncDeviceId: string | null;
  /** Retries the queued operations now. */
  retrySync: () => Promise<void>;
  /** Forces an immediate sync: flushes the debounce window and the durable outbox at once. */
  syncNow: () => Promise<'synced' | 'pending' | 'offline' | 'conflict'>;
  /** Current cloud sync status, used by the sync panel. */
  cloudStatus: CloudSyncStatusLike;
  conflicts: SyncConflictDescriptor[];
  resolveConflictKeepRemote: (conflict: SyncConflictDescriptor) => Promise<void>;
  resolveConflictKeepLocal: (conflict: SyncConflictDescriptor) => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({
  value,
  children,
}: {
  value: AppStateContextValue;
  children: ReactNode;
}) {
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
