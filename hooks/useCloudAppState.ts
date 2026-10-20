'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { getEmptyState, isDemoState } from '@/lib/storage';
import { loadAppStateCache, saveAppStateCache } from '@/lib/state-cache';
import { clearTeacherBinaryFiles } from '@/lib/binary-storage';
import { clearDashboardTasks } from '@/lib/dashboard-tasks';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { applySyncOutboxEntry, clearCloudRosterData, loadCoreState, resetCloudWorkspace, SyncConflictError } from '@/lib/supabase/core-sync';
import { commitRosterImportBatch, type RosterImportClass, type RosterImportStudent } from '@/lib/supabase/roster-import';
import { flushMemorandaOutbox } from '@/lib/supabase/memoranda-storage';

/** Quiet period before a burst of realtime events triggers one workspace load. */
const REALTIME_REFRESH_COALESCE_MS = 250;
import { createCoalescer } from '@/lib/coalescer';
import {
  SYNCHRONIZED_TABLES,
  isSelfAuthoredChange,
  nextRevisionFloor,
  shouldApplyRemoteRefresh,
  shouldFlushOnBackground,
} from '@/lib/realtime-guard';
import {
  enqueueSyncDelta,
  getSyncDeviceId,
  listSyncOutbox,
  removeSyncOutboxEntry,
  clearSyncOutbox,
  markSyncOutboxFailure,
  enqueueSyncOperations,
  listPendingRecordIds,
  compactSyncOutbox,
  replayOutboxEntriesOnState,
  type SyncConflictDescriptor,
} from '@/lib/sync-outbox';
import { clearMemorandaOutbox } from '@/lib/supabase/memoranda-outbox';
import { flushAvatarOutbox } from '@/lib/supabase/avatar-storage';
import { clearAvatarOutbox } from '@/lib/supabase/avatar-outbox';
import type { AppState } from '@/lib/storage';

export type CloudSyncStatus =
  | 'loading'
  | 'ready'
  | 'sync-pending'
  | 'sync-failed'
  | 'conflict'
  | 'local-only';

function describeCloudError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object') {
    const candidate = error as { message?: string; details?: string; hint?: string; code?: string; status?: number };
    const parts = [candidate.message, candidate.details, candidate.hint, candidate.code && `code=${candidate.code}`, candidate.status && `status=${candidate.status}`]
      .filter(Boolean)
      .join(' | ');
    if (parts) return new Error(parts);
  }

  return new Error('تعذر الوصول إلى البيانات السحابية. يرجى التحقق من توفر الخدمة والاتصال.');
}

function getStateRecord(state: AppState, entity: SyncConflictDescriptor['entity'], recordId: string): unknown {
  const collections: Record<string, unknown[] | undefined> = {
    class: state.classes, student: state.students, grade: state.grades, session: state.sessions,
    timetable: state.timetable, lessonProgress: state.lessonProgress, customUnit: state.customUnits,
    lessonPlan: state.lessonPlans, dashboardTask: state.dashboardTasks,
  };
  return collections[entity]?.find((record) => (record as { id?: string }).id === recordId);
}

function isLocalOnlyCloudError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [candidate.message, candidate.details, candidate.hint]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase();

  if (candidate.code === 'PGRST204' || candidate.code === '42703' || /could not find the '[^']+' column|column "[^"]+" .* does not exist/i.test(text)) {
    return false;
  }

  return candidate.code === 'LOCAL_ONLY_CLOUD' || /schema is unavailable|remaining in local-only mode|could not find the table|schema cache/i.test(text);
}

export function getDeletedRecordIds(previous: AppState, next: AppState): string[] {
  const deletedClassIds = new Set(
    previous.classes
      .filter((c) => !next.classes.some((nc) => nc.id === c.id))
      .map((c) => c.id),
  );

  const collections = [
    ['class', previous.classes, next.classes],
    ['student', previous.students, next.students],
    ['grade', previous.grades, next.grades],
    ['session', previous.sessions, next.sessions],
    ['timetable', previous.timetable, next.timetable],
    ['lessonProgress', previous.lessonProgress, next.lessonProgress],
    ['customUnit', previous.customUnits, next.customUnits],
    ['lessonPlan', previous.lessonPlans, next.lessonPlans],
  ] as const;
  const deleted = collections.flatMap(([entity, previousRecords, nextRecords]) => {
    const nextIds = new Set(nextRecords.map((record) => record.id));
    return previousRecords
      .filter((record) => {
        if (nextIds.has(record.id)) return false;
        if (deletedClassIds.size > 0 && 'classId' in record && typeof (record as any).classId === 'string') {
          if (deletedClassIds.has((record as any).classId)) return false;
        }
        return true;
      })
      .map((record) => `${entity}:${record.id}`);
  });
  for (const session of previous.sessions) {
    if (deletedClassIds.has(session.classId)) continue;
    if (!next.sessions.some((item) => item.id === session.id)) continue;
    const nextSession = next.sessions.find((item) => item.id === session.id);
    if (!nextSession) continue;
    for (const studentId of Object.keys(session.attendance || {})) {
      if (!(studentId in (nextSession.attendance || {}))) deleted.push(`attendance:${session.id}:${studentId}`);
    }
    const behaviorLists = [
      ['disruptions', session.disruptions || [], nextSession.disruptions || []],
      ['unwrittenLessons', session.unwrittenLessons || [], nextSession.unwrittenLessons || []],
      ['poorParticipation', session.poorParticipation || [], nextSession.poorParticipation || []],
      ['goodParticipation', session.goodParticipation || [], nextSession.goodParticipation || []],
    ] as const;
    for (const [behavior, previousStudents, nextStudents] of behaviorLists) {
      const nextStudentIds = new Set(nextStudents);
      for (const studentId of previousStudents) {
        if (!nextStudentIds.has(studentId)) deleted.push(`behavior:${session.id}:${studentId}:${behavior}`);
      }
    }
  }
  const nextTaskIds = new Set((next.dashboardTasks || []).map((task) => task.id));
  for (const task of previous.dashboardTasks || []) {
    if (!nextTaskIds.has(task.id)) deleted.push(`dashboardTask:${task.id}`);
  }
  return Array.from(new Set(deleted));
}

export function isAuthenticatedOwner(authenticatedUserId: string | undefined, ownerId: string): boolean {
  return authenticatedUserId === ownerId;
}

/**
 * `auth.getUser()` round-trips to Supabase. It used to run on every flush, every realtime
 * refresh and every retry, which dominated the request budget on a busy device for a value
 * that changes only on sign-in/sign-out. Cached briefly; `forgetAuthCheck()` clears it on
 * auth events.
 */
const AUTH_CHECK_TTL_MS = 30_000;
let authCheckCache: { ownerId: string; at: number; ok: boolean } | null = null;

export function forgetAuthCheck(): void {
  authCheckCache = null;
}

async function hasAuthenticatedOwner(
  client: ReturnType<typeof createSupabaseBrowserClient>,
  ownerId: string,
  force = false,
): Promise<boolean> {
  if (!client) return false;
  const now = Date.now();
  if (!force && authCheckCache && authCheckCache.ownerId === ownerId && now - authCheckCache.at < AUTH_CHECK_TTL_MS) {
    return authCheckCache.ok;
  }
  const { data, error } = await client.auth.getUser();
  const ok = !error && isAuthenticatedOwner(data.user?.id, ownerId);
  authCheckCache = { ownerId, at: now, ok };
  return ok;
}

/**
 * Drains the durable outbox.
 *
 * Head-of-line blocking was the single worst failure mode of the previous version: the loop
 * always took `entries[0]`, and a single rejected entry (a revision conflict, a tombstone from
 * another device, a column the deployed schema does not have yet) threw out of the loop and
 * froze *every* queued operation behind it. A teacher who documented 200 sessions offline would
 * then see the queue stuck at "N عمليات بانتظار الرفع" forever while the screen showed the stale
 * cloud copy.
 *
 * Now an entry that cannot be applied is parked for this pass and the flush continues with the
 * next one, so acknowledged work always reaches the server. Every parked error is still reported
 * (so conflicts surface in the dialog and the status pill is honest), and the retry timer uses
 * the earliest `nextAttemptAt` still in the queue.
 *
 * @returns true only when the queue is completely empty afterwards.
 */
const activeFlushes = new Map<string, Promise<boolean>>();
const retryTimers = new Map<string, number>();

/** A manual flush waits for an in-flight flush, then retries any entries still pending. */
export async function flushSyncOutbox(
  client: ReturnType<typeof createSupabaseBrowserClient>,
  ownerId: string,
  syncingRef: { current: boolean },
  onError: (error: unknown) => void,
  force = false,
  signal?: AbortSignal,
): Promise<boolean> {
  const active = activeFlushes.get(ownerId);
  if (active) {
    const result = await active;
    if (!force || signal?.aborted) return result;
    return flushSyncOutbox(client, ownerId, syncingRef, onError, true, signal);
  }
  const retryTimer = retryTimers.get(ownerId);
  if (retryTimer !== undefined) { window.clearTimeout(retryTimer); retryTimers.delete(ownerId); }
  const task = flushSyncOutboxOnce(client, ownerId, syncingRef, onError, force, signal);
  activeFlushes.set(ownerId, task);
  try { return await task; }
  finally { if (activeFlushes.get(ownerId) === task) activeFlushes.delete(ownerId); }
}

async function flushSyncOutboxOnce(
  client: ReturnType<typeof createSupabaseBrowserClient>,
  ownerId: string,
  syncingRef: { current: boolean },
  onError: (error: unknown) => void,
  force = false,
  signal?: AbortSignal
): Promise<boolean> {
  if (!client || syncingRef.current) return false;
  if (!(await hasAuthenticatedOwner(client, ownerId, force))) return false;

  syncingRef.current = true;
  const parkedIds = new Set<string>();
  const reported = new Set<string>();
  let drained = false;

  const report = (error: unknown) => {
    const key = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    if (reported.has(key)) return;
    reported.add(key);
    onError(error);
  };

  try {
    let filesFlushed = true;
    try { await flushAvatarOutbox(ownerId); } catch (error) { filesFlushed = false; report(error); }
    try { await flushMemorandaOutbox(ownerId); } catch (error) { filesFlushed = false; report(error); }

    while (!signal?.aborted) {
      const entries = await listSyncOutbox(ownerId);
      const entry = entries.find((item) => !parkedIds.has(item.id));
      if (!entry) {
        drained = entries.length === 0 && filesFlushed;
        break;
      }

      const waitUntil = Date.parse(entry.nextAttemptAt || '');
      if (!force && Number.isFinite(waitUntil) && waitUntil > Date.now()) {
        // Still inside its exponential backoff window: park it and try the next entry
        // instead of stalling the whole queue until the timer fires.
        parkedIds.add(entry.id);
        continue;
      }

      try {
        await applySyncOutboxEntry(client, ownerId, entry, getSyncDeviceId());
        await removeSyncOutboxEntry(entry.id);
      } catch (error) {
        await markSyncOutboxFailure(entry.id, error);
        parkedIds.add(entry.id);
        report(error);
      }
    }
  } catch (error) {
    report(error);
  } finally {
    syncingRef.current = false;
  }

  if (!drained) {
    // Something is still queued: schedule exactly one retry for the earliest attempt time so
    // the queue keeps moving on its own without the user having to press "retry".
    try {
      const remaining = await listSyncOutbox(ownerId);
      const nextAttempt = remaining.reduce<number | null>((earliest, entry) => {
        const at = Date.parse(entry.nextAttemptAt || '');
        if (!Number.isFinite(at)) return earliest;
        return earliest === null ? at : Math.min(earliest, at);
      }, null);
      if (!signal?.aborted && (nextAttempt !== null || remaining.length === 0)) {
        const timer = window.setTimeout(() => {
          if (retryTimers.get(ownerId) === timer) retryTimers.delete(ownerId);
          if (!syncingRef.current && !signal?.aborted) {
            void flushSyncOutbox(client, ownerId, syncingRef, onError, false, signal);
          }
        }, nextAttempt === null ? 30_000 : Math.max(1_000, nextAttempt - Date.now()));
        retryTimers.set(ownerId, timer);
        if (signal) {
          signal.addEventListener('abort', () => {
            window.clearTimeout(timer);
            if (retryTimers.get(ownerId) === timer) retryTimers.delete(ownerId);
          }, { once: true });
        }
      }
    } catch (error) {
      report(error);
    }
  }

  return drained;
}

export function useCloudAppState(user: User | null) {
  const [state, setState] = useState<AppState>(getEmptyState);
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>(() =>
    user ? 'loading' : 'ready'
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflictDescriptor[]>([]);
  const cloudStatusRef = useRef<CloudSyncStatus>(cloudStatus);
  const [localStorageError, setLocalStorageError] = useState<string | null>(null);
  // Sync panel data. `pendingCount` mirrors the durable outbox (not a render-time guess), and
  // `lastSyncedAt` records the last moment the queue was observed empty.
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const cloudReady = !user || cloudStatus !== 'loading';
  const syncingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    abortControllerRef.current = new AbortController();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [user?.id]);
  const pendingSaveTimerRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  const latestStateRef = useRef(state);
  const lastSyncedStateRef = useRef<AppState | null>(null);
  const lastEnqueuedStateRef = useRef<AppState | null>(null);
  const enqueueTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const revisionRef = useRef(0);
  const updatedAtRef = useRef(new Date(0).toISOString());
  // Incremented synchronously on every user edit. A Realtime refresh captures it before its
  // fetch and refuses to apply a response if it moved meanwhile (the clobber race).
  const localEditSeqRef = useRef(0);

  /** Re-reads the durable queue and records the last time it was empty. */
  const refreshSyncStatus = async (): Promise<number> => {
    if (!user) {
      setPendingCount(0);
      return 0;
    }
    try {
      const count = (await listSyncOutbox(user.id)).length;
      setPendingCount(count);
      // Counting an empty queue is not itself a server acknowledgement. Only successful
      // flush/load paths update lastSyncedAt.
      return count;
    } catch {
      return pendingCount;
    }
  };

  const registerConflict = async (error: unknown): Promise<void> => {
    if (!(error instanceof SyncConflictError) || !user) return;
    const entry = (await listSyncOutbox(user.id)).find((item) =>
      item.operations.some((operation) =>
        operation.entity === error.entity && operation.recordId === error.recordId,
      ),
    );
    const operation = entry?.operations.find((item) =>
      item.entity === error.entity && item.recordId === error.recordId,
    );
    if (!entry || !operation) return;
    const client = createSupabaseBrowserClient();
    if (!client) return;
    let remoteState: AppState;
    try {
      remoteState = await loadCoreState(client, latestStateRef.current);
    } catch (remoteError) {
      setSyncError(describeCloudError(remoteError).message);
      return;
    }
    setConflicts((current) => [{
      entity: error.entity,
      recordId: error.recordId,
      outboxId: entry.id,
      operationId: operation.id,
      localRevision: error.localRevision,
      remoteRevision: error.remoteRevision,
      localPayload: operation.payload,
      remotePayload: getStateRecord(remoteState, error.entity, error.recordId),
    }, ...current.filter((item) => item.outboxId !== entry.id)]);
  };

  useEffect(() => {
    cloudStatusRef.current = cloudStatus;
  }, [cloudStatus]);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  // Unified initial state initialization: loads user-scoped IndexedDB cache first, then syncs with Supabase
  useEffect(() => {
    let active = true;

    const initializeState = async () => {
      // 1. Load user-scoped local cache and compact/replay any pending outbox entries first
      let currentLocal: AppState | null = null;
      let outboxEntries: Awaited<ReturnType<typeof compactSyncOutbox>> = [];
      try {
        if (user?.id) outboxEntries = await compactSyncOutbox(user.id);
      } catch (compactErr) {
        console.warn('Outbox compaction skipped:', compactErr);
      }
      try {
        const cachedState = await loadAppStateCache(user?.id);
        const hasValidCache = Boolean(cachedState && !isDemoState(cachedState));
        if (hasValidCache || outboxEntries.length > 0) {
          const baseLocal = hasValidCache && cachedState ? cachedState : getEmptyState();
          const localWithOutbox = replayOutboxEntriesOnState(baseLocal, outboxEntries);
          currentLocal = localWithOutbox;
          // Start the revision clock where the last successful sync or queued entry left it.
          revisionRef.current = nextRevisionFloor(
            revisionRef.current,
            localWithOutbox.cloudRevision,
            ...outboxEntries.map((entry) => entry.revision),
          );
          lastSyncedStateRef.current = baseLocal;
          lastEnqueuedStateRef.current = localWithOutbox;
          if (active) {
            latestStateRef.current = localWithOutbox;
            setState(localWithOutbox);
          }
          if (user?.id && outboxEntries.length > 0) {
            void saveAppStateCache(localWithOutbox, user.id);
          }
        }
      } catch (cacheErr) {
        console.error('Local workspace load failed:', cacheErr);
        if (active) setLocalStorageError(cacheErr instanceof Error ? cacheErr.message : 'تعذر تحميل النسخة المحلية.');
      }

      // 2. If not authenticated, local workspace is ready
      if (!user) {
        if (active) setCloudStatus('ready');
        return;
      }

      // 3. Authenticated: load authoritative state from Supabase
      const client = createSupabaseBrowserClient();
      if (!client) {
        if (active) setCloudStatus('local-only');
        return;
      }

      if (active && (!currentLocal || currentLocal.classes.length === 0)) {
        setCloudStatus('loading');
      }

      try {
        // Read the outbox *before* loading so genuinely unsynced local work survives
        // the authoritative merge, while stale cache entries are dropped.
        let pendingRecordIds = await listPendingRecordIds(user.id);
        outboxEntries = await listSyncOutbox(user.id);

        let remoteState = await loadCoreState(client, currentLocal || latestStateRef.current, {
          pendingRecordIds,
          outboxEntries,
        });
        if (!active) return;

        // Flush any pending outbox entries for this user
        if (pendingRecordIds.size > 0) {
          await flushSyncOutbox(client, user.id, syncingRef, (err) => {
            console.warn('Initial pending outbox flush warning:', err);
          }, true, abortControllerRef.current?.signal);
          if (!active) return;
          // Recompute instead of assuming the flush drained everything: a partially
          // failed flush must keep its local records, or the refresh would hide them.
          pendingRecordIds = await listPendingRecordIds(user.id);
          outboxEntries = await listSyncOutbox(user.id);
          if (pendingRecordIds.size === 0) {
            // Everything acknowledged: the cloud is now the only truth for this load.
            const refreshed = await loadCoreState(client, remoteState, { pendingRecordIds });
            remoteState = refreshed;
          } else {
            remoteState = replayOutboxEntriesOnState(remoteState, outboxEntries);
          }
        }

        latestStateRef.current = remoteState;
        lastEnqueuedStateRef.current = remoteState;
        if (outboxEntries.length === 0) {
          lastSyncedStateRef.current = remoteState;
        }

        if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
          revisionRef.current = remoteState.cloudRevision;
        }

        setState(remoteState);
        void saveAppStateCache(remoteState, user.id);
        setCloudStatus(outboxEntries.length > 0 ? 'sync-pending' : 'ready');
        if (!outboxEntries.length) setLastSyncedAt(new Date().toISOString());
        void refreshSyncStatus();
      } catch (error) {
        if (!active) return;
        if (isLocalOnlyCloudError(error)) {
          console.warn('Supabase cloud sync is unavailable. Remaining in local-only mode.');
          setCloudStatus('local-only');
          return;
        }
        console.error('Cloud state load failed:', describeCloudError(error).message);
        setCloudStatus('local-only');
      }
    };

    void initializeState();

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Cache save effect (user-scoped)
  useEffect(() => {
    if (!isMounted) return;
    if (isDemoState(state)) return;
    const timer = window.setTimeout(() => {
      void saveAppStateCache(state, user?.id)
        .then(() => {
          setLocalStorageError(null);
        })
        .catch((error) => {
          setLocalStorageError(error instanceof Error ? error.message : 'تعذر حفظ النسخة المحلية.');
          console.error('Local state save failed:', error);
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [isMounted, state, user]);

  // Supabase Auth listener & Realtime change subscriptions
  useEffect(() => {
    if (!user) {
      return;
    }

    const client = createSupabaseBrowserClient();
    if (!client) {
      return;
    }

    let active = true;
    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      forgetAuthCheck();
      active = false;
      saveGenerationRef.current += 1;
      if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
      revisionRef.current = 0;
      lastSyncedStateRef.current = null;
      lastEnqueuedStateRef.current = null;
      setCloudStatus('ready');
      setSyncError(null);
      setConflicts([]);
    });

    /** Collapses a burst of row-level events into one workspace load. */
    const refreshCoalescer = createCoalescer(REALTIME_REFRESH_COALESCE_MS, () => {
      void refreshRemoteState().catch((error) => {
        if (isLocalOnlyCloudError(error)) {
          setCloudStatus('local-only');
          return;
        }
        console.error('Realtime sync failed:', describeCloudError(error).message);
      });
    });

    /** Whether the fetched state may still replace the local one (see realtime-guard). */
    const refreshAllowed = async (expectedGeneration: number, expectedEditSeq: number) => shouldApplyRemoteRefresh({
      active,
      authenticated: true,
      syncing: syncingRef.current,
      pendingSaveScheduled: pendingSaveTimerRef.current !== null,
      pendingOutboxCount: (await listSyncOutbox(user.id)).length,
      generationChanged: saveGenerationRef.current !== expectedGeneration,
      localEditsDuringFetch: localEditSeqRef.current - expectedEditSeq,
    });
    const refreshRemoteState = async () => {
      const expectedGeneration = saveGenerationRef.current;
      const expectedEditSeq = localEditSeqRef.current;
      if (!active || !(await hasAuthenticatedOwner(client, user.id))) return;
      if (!(await refreshAllowed(expectedGeneration, expectedEditSeq))) return;

      const remoteState = await loadCoreState(client, latestStateRef.current);

      // Re-check after the round trip: the fetch result is stale if the user edited while
      // it was in flight, and applying it would silently roll that edit back on screen.
      if (!(await refreshAllowed(expectedGeneration, expectedEditSeq))) return;

      latestStateRef.current = remoteState;
      lastSyncedStateRef.current = remoteState;
      lastEnqueuedStateRef.current = remoteState;
      revisionRef.current = nextRevisionFloor(revisionRef.current, remoteState.cloudRevision);
      setState(remoteState);
      void saveAppStateCache(remoteState, user.id);
    };

    let channel = client.channel(`core-state:${user.id}`);
    for (const table of SYNCHRONIZED_TABLES) {
      channel = channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table,
        ...(table === 'profiles'
          ? { filter: `id=eq.${user.id}` }
          : { filter: `owner_id=eq.${user.id}` }),
      }, (payload) => {
        // Our own writes echo back on this channel. Refreshing for them is wasted work, and
        // the fetch would race the in-memory state the user has already moved past.
        if (isSelfAuthoredChange(payload, getSyncDeviceId())) return;
        refreshCoalescer.schedule();
      });
    }
    channel = channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.error('Realtime subscription failed');
    });

    return () => {
      active = false;
      refreshCoalescer.cancel();
      authListener.subscription.unsubscribe();
      void client.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /** Serialized durable state enqueue; a failed IndexedDB write never advances the baseline. */
  const enqueueSnapshot = (snapshot: AppState): Promise<string | null> => {
    if (!user) return Promise.resolve(null);
    const signal = abortControllerRef.current?.signal;
    const result = enqueueTailRef.current.catch(() => undefined).then(async () => {
      if (signal?.aborted) throw new Error("انتهت جلسة الحساب قبل الحفظ.");
      const baseline = lastEnqueuedStateRef.current ?? lastSyncedStateRef.current;
      revisionRef.current += 1;
      const updatedAt = new Date().toISOString();
      const id = await enqueueSyncDelta(user.id, baseline, snapshot, revisionRef.current, updatedAt);
      if (!signal?.aborted) lastEnqueuedStateRef.current = snapshot;
      updatedAtRef.current = updatedAt;
      return id;
    });
    enqueueTailRef.current = result;
    return result;
  };

  /**
   * Enqueues the delta of `nextState` and flushes the durable outbox in one go.
   * Shared by the debounced background save and the manual "مزامنة الآن" action so both
   * paths behave identically and neither can drop unacknowledged work.
   */
  const runSavePipeline = (
    nextState: AppState,
    force = false,
    alreadyEnqueued = false,
  ): Promise<void> => {
    if (!user) return Promise.resolve();
    const saveGeneration = saveGenerationRef.current;
    const client = createSupabaseBrowserClient();
    const syncedDeletedIds = new Set(nextState.deletedRecordIds || []);
    return (alreadyEnqueued ? Promise.resolve(null) : enqueueSnapshot(nextState))
      .then(async (enqueued) => {
        if (saveGeneration !== saveGenerationRef.current) return false;
        const pending = await listSyncOutbox(user.id);
        if (!enqueued && pending.length === 0) return true;
        return flushSyncOutbox(client, user.id, syncingRef, (error) => {
          if (isLocalOnlyCloudError(error)) {
            setCloudStatus('local-only');
            return;
          }
          const message = describeCloudError(error).message;
          setSyncError(message);
          setCloudStatus(error instanceof Error && error.name === 'SyncConflictError' ? 'conflict' : 'sync-failed');
          void registerConflict(error);
          console.error('Cloud state save failed:', message);
        }, force, abortControllerRef.current?.signal);
      })
      .then(async (flushed) => {
        if (!flushed || (await listSyncOutbox(user.id)).length > 0) return;
        if (latestStateRef.current !== nextState) return;
        lastSyncedStateRef.current = nextState;
        lastEnqueuedStateRef.current = nextState;
        setSyncError(null);
        setCloudStatus('ready');
        setState((previous) => (
          previous.deletedRecordIds?.length
            ? {
                ...previous,
                deletedRecordIds: previous.deletedRecordIds.filter(
                  (id) => !syncedDeletedIds.has(id),
                ),
              }
            : previous
        ));
      })
      .catch(error => {
        setSyncError(describeCloudError(error).message);
        setCloudStatus('sync-failed');
        throw error;
      })
      .finally(() => {
        void refreshSyncStatus();
      });
  };

  // Debounced background save effect for standard changes
  useEffect(() => {
    if (!isMounted || !cloudReady) return;
    if (!user) return;
    // Local durability is mandatory even while offline or another record is conflicted.
    // Guard: do NOT trigger save if state is already enqueued or synced
    if (state === lastEnqueuedStateRef.current || state === lastSyncedStateRef.current) return;

    const saveGeneration = saveGenerationRef.current;
    const timer = window.setTimeout(() => {
      pendingSaveTimerRef.current = -1;
      if (saveGeneration !== saveGenerationRef.current) {
        pendingSaveTimerRef.current = null;
        return;
      }
      void runSavePipeline(state).catch(error => {
        console.error('Durable background save failed:', error);
      }).finally(() => {
        if (pendingSaveTimerRef.current === -1) pendingSaveTimerRef.current = null;
      });
    }, 300);
    pendingSaveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (pendingSaveTimerRef.current === timer) pendingSaveTimerRef.current = null;
    };
  // user is read by the scheduled callback; changing its id also resets cloudReady.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudReady, cloudStatus, isMounted, state, user?.id]);

  /**
   * Manual "مزامنة الآن": enqueues anything still sitting in the debounce window and
   * flushes the durable outbox immediately, so a press always produces a real sync attempt.
   */
  const syncNow = async (): Promise<'synced' | 'pending' | 'offline' | 'conflict'> => {
    if (!user) return 'offline';
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
    const nextState = latestStateRef.current;
    await enqueueSnapshot(nextState);
    const client = createSupabaseBrowserClient();
    if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      setCloudStatus('local-only');
      await refreshSyncStatus();
      return 'offline';
    }
    setCloudStatus('sync-pending');
    setSyncError(null);
    let conflicted = false;
    const flushed = await flushSyncOutbox(client, user.id, syncingRef, (error) => {
      conflicted ||= error instanceof SyncConflictError;
      const message = describeCloudError(error).message;
      setSyncError(message);
      setCloudStatus(conflicted ? 'conflict' : 'sync-failed');
      void registerConflict(error);
    }, true, abortControllerRef.current?.signal);
    const remaining = await listSyncOutbox(user.id);
    await refreshSyncStatus();
    if (!flushed || remaining.length || latestStateRef.current !== nextState) {
      return conflicted ? 'conflict' : 'pending';
    }
    // Download changes from other devices too, but never overwrite a newer edit made while
    // this request was in flight. The same guarded merge seam handles all pending records.
    const editSeq = localEditSeqRef.current;
    const remoteState = await loadCoreState(client, nextState);
    if (editSeq !== localEditSeqRef.current || latestStateRef.current !== nextState ||
        (await listSyncOutbox(user.id)).length || abortControllerRef.current?.signal.aborted) {
      return 'pending';
    }
    latestStateRef.current = remoteState;
    lastSyncedStateRef.current = remoteState;
    lastEnqueuedStateRef.current = remoteState;
    revisionRef.current = nextRevisionFloor(revisionRef.current, remoteState.cloudRevision);
    setState(remoteState);
    void saveAppStateCache(remoteState, user.id);
    setSyncError(null);
    setCloudStatus('ready');
    setLastSyncedAt(new Date().toISOString());
    return 'synced';
  };

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const retryWhenOnline = async () => {
      try { await syncNow(); }
      catch (error) {
        setCloudStatus('sync-failed');
        setSyncError(describeCloudError(error).message);
      }
    };
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  // The retry listener is intentionally scoped to the authenticated user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Keep retrying pending local work while the app remains open. The online event is
  // immediate, while this interval also covers transient failures that do not emit it.
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const retryPendingWork = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if ((await listSyncOutbox(user.id)).length === 0) return;
      void runSavePipeline(latestStateRef.current, false, true).catch((error) => {
        console.warn('Automatic background sync retry failed:', describeCloudError(error).message);
      });
    };
    const timer = window.setInterval(() => {
      void retryPendingWork();
    }, 30_000);
    return () => window.clearInterval(timer);
  // The callback intentionally reads live refs so it never retries a stale snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const retrySync = async (): Promise<void> => {
    await syncNow();
  };


  /** Number of outbox entries still waiting for acknowledgment (0 = nothing pending). */
  const countPendingOperations = async (): Promise<number> => {
    if (!user) return 0;
    try {
      return (await listSyncOutbox(user.id)).length;
    } catch {
      return 0;
    }
  };

  /**
   * Force-flush the outbox once (used before signing out). Returns whether the queue is
   * empty afterwards; never throws, because the caller must still be able to sign out.
   */
  const flushOutboxNow = async (): Promise<boolean> => {
    if (!user) return true;
    const client = createSupabaseBrowserClient();
    if (!client) return false;
    try {
      await enqueueSnapshot(latestStateRef.current);
      const flushed = await flushSyncOutbox(client, user.id, syncingRef, (error) => {
        console.warn('Sign-out flush warning:', describeCloudError(error).message);
      }, true);
      const remaining = (await listSyncOutbox(user.id)).length;
      setPendingCount(remaining);
      return flushed && remaining === 0 && latestStateRef.current === lastEnqueuedStateRef.current;
    } catch (error) {
      console.warn('Sign-out flush failed:', describeCloudError(error).message);
      return false;
    }
  };

  // Durability when the tab is closed or backgrounded. The debounced save holds up to 300ms
  // of edits in memory only, so a tab that dies inside that window used to lose them. Here the
  // delta is written to the outbox first (IndexedDB, survives the unload) and only then is one
  // best-effort flush attempted — the browser may still kill the page mid-request, but the
  // work is already queued and will be retried on the next start.
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;

    const persistPendingWork = () => {
      const scheduled = pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1;
      void (async () => {
        try {
          if (scheduled) {
            window.clearTimeout(pendingSaveTimerRef.current as number);
            pendingSaveTimerRef.current = null;
            const baseline = lastEnqueuedStateRef.current ?? lastSyncedStateRef.current;
            // Always persist pending work to the local IndexedDB outbox even when offline.
            if (baseline && latestStateRef.current !== baseline) {
              saveGenerationRef.current += 1;
              await enqueueSnapshot(latestStateRef.current);
            }
          }
          const pendingOutboxCount = (await listSyncOutbox(user.id)).length;
          if (!shouldFlushOnBackground({
            pendingSaveScheduled: false,
            pendingOutboxCount,
            status: cloudStatusRef.current,
          })) return;
          await flushOutboxNow();
        } catch (error) {
          console.warn('Background persistence warning:', describeCloudError(error).message);
        }
      })();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistPendingWork();
    };
    window.addEventListener('pagehide', persistPendingWork);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', persistPendingWork);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  // Scoped to the authenticated user; the handler reads the live refs, not render values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /**
   * Settings escape hatch: drop unacknowledged local operations and reload the workspace
   * from the cloud. The user confirms this explicitly because queued edits are discarded.
   */
  const resyncFromCloud = async (): Promise<void> => {
    if (!user) throw new Error('لا يمكن إعادة المزامنة دون تسجيل الدخول.');
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error('لا يمكن إعادة المزامنة دون اتصال بالخادم السحابي.');

    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
    setCloudStatus('loading');
    setSyncError(null);
    try {
      await clearSyncOutbox(user.id);
      const remoteState = await loadCoreState(client, getEmptyState(), { pendingRecordIds: new Set() });
      latestStateRef.current = remoteState;
      lastSyncedStateRef.current = remoteState;
      lastEnqueuedStateRef.current = remoteState;

      if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
        revisionRef.current = remoteState.cloudRevision;
      }
      setState(remoteState);
      await saveAppStateCache(remoteState, user.id);
      setLocalStorageError(null);
      setConflicts([]);
      setCloudStatus('ready');
    } catch (error) {
      const message = describeCloudError(error).message;
      setSyncError(message);
      setCloudStatus('sync-failed');
      throw error;
    }
  };

  const resolveConflictKeepRemote = async (conflict: SyncConflictDescriptor): Promise<void> => {
    if (!user) throw new Error('لا يمكن حل التعارض دون تسجيل الدخول.');
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error('لا يمكن حل التعارض دون اتصال بالخادم السحابي.');
    await removeSyncOutboxEntry(conflict.outboxId);
    const remoteState = await loadCoreState(client, latestStateRef.current);
    latestStateRef.current = remoteState;
    lastSyncedStateRef.current = remoteState;
    if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
      revisionRef.current = remoteState.cloudRevision;
    }
    setState(remoteState);
    setConflicts((current) => current.filter((item) => item.outboxId !== conflict.outboxId));
    setSyncError(null);
    setCloudStatus('ready');
  };

  const resolveConflictKeepLocal = async (conflict: SyncConflictDescriptor): Promise<void> => {
    if (!user) throw new Error('لا يمكن حل التعارض دون تسجيل الدخول.');
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error('لا يمكن حل التعارض دون اتصال بالخادم السحابي.');
    const entries = await listSyncOutbox(user.id);
    const entry = entries.find((item) => item.id === conflict.outboxId);
    if (!entry) throw new Error('لم تعد عملية التعارض موجودة في طابور المزامنة.');
    const operations = entry.operations.map((operation) => ({
      ...operation,
      id: `${operation.id}:${globalThis.crypto.randomUUID()}`,
    }));
    await removeSyncOutboxEntry(entry.id);
    const remoteRevision = Math.max(conflict.remoteRevision, revisionRef.current);
    revisionRef.current = remoteRevision + 1;
    // The user explicitly chose their local version: this is the only path allowed to
    // override a deletion recorded by another device.
    await enqueueSyncOperations(user.id, operations, revisionRef.current, new Date().toISOString(), {
      allowTombstoneOverride: true,
    });
    setConflicts((current) => current.filter((item) => item.outboxId !== conflict.outboxId));
    setCloudStatus('sync-pending');
    setSyncError(null);
    const flushed = await flushSyncOutbox(client, user.id, syncingRef, (error) => {
      setSyncError(describeCloudError(error).message);
      setCloudStatus(error instanceof SyncConflictError ? 'conflict' : 'sync-failed');
    }, true);
    if (!flushed || (await listSyncOutbox(user.id)).length > 0) {
      throw new Error('تعذر تأكيد النسخة المحلية بعد حل التعارض.');
    }
    const remoteState = await loadCoreState(client, latestStateRef.current);
    latestStateRef.current = remoteState;
    lastSyncedStateRef.current = remoteState;
    if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
      revisionRef.current = remoteState.cloudRevision;
    }
    setState(remoteState);
    setCloudStatus('ready');
  };

  const handleUpdateState = (updater: (previous: AppState) => AppState) => {
    localEditSeqRef.current += 1;
    if (user && (cloudStatus === 'ready' || cloudStatus === 'sync-failed')) {
      setCloudStatus('sync-pending');
      setSyncError(null);
    }
    const previous = latestStateRef.current;
    const next = updater(previous);
    const deletedRecordIds = getDeletedRecordIds(previous, next);
    const committedState = {
      ...next,
      deletedRecordIds: Array.from(new Set([
        ...(previous.deletedRecordIds || []),
        ...deletedRecordIds,
      ])),
    };
    latestStateRef.current = committedState;
    setState(committedState);
  };

  const updateStateAndWait = async (updater: (previous: AppState) => AppState): Promise<void> => {
    localEditSeqRef.current += 1;
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }

    const previous = latestStateRef.current;
    const computed = updater(previous);
    const deletedRecordIds = getDeletedRecordIds(previous, computed);
    const nextState: AppState = {
      ...computed,
      deletedRecordIds: Array.from(new Set([
        ...(previous.deletedRecordIds || []),
        ...deletedRecordIds,
      ])),
    };
    latestStateRef.current = nextState;
    setState(nextState);
    void saveAppStateCache(nextState, user?.id);

    if (!user) return;

    setCloudStatus('sync-pending');
    setSyncError(null);

    try {
      await enqueueSnapshot(nextState);
      // Local durability is the save contract for the editor. Upload in the background
      // so a slow or unavailable server never keeps the modal in a saving state.
      void runSavePipeline(nextState, false, true).catch((error) => {
        console.error('Background cloud sync failed:', describeCloudError(error).message);
      });
      void refreshSyncStatus();
    } catch (error) {
      const message = describeCloudError(error).message;
      setSyncError(message);
      setCloudStatus('sync-failed');
      throw error;
    }
  };

  const replaceStateFromBackup = async (nextState: AppState): Promise<void> => {
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
    if (user) await clearSyncOutbox(user.id);
    const normalizedState = {
      ...nextState,
      deletedRecordIds: Array.from(new Set([
        ...(nextState.deletedRecordIds || []),
        ...getDeletedRecordIds(latestStateRef.current, nextState),
      ])),
      activeClassId: nextState.classes.some((item) => item.id === nextState.activeClassId)
        ? nextState.activeClassId
        : nextState.classes[0]?.id || null,
    };
    setState(normalizedState);
    latestStateRef.current = normalizedState;
    lastSyncedStateRef.current = null;
    lastEnqueuedStateRef.current = null;
    await saveAppStateCache(normalizedState, user?.id);
    setLocalStorageError(null);
    if (user) await updateStateAndWait(() => normalizedState);
  };

  const clearRosterData = async (): Promise<void> => {
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }

    if (user) {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error('لا يمكن مزامنة إعادة التعيين دون اتصال بالخادم السحابي.');

      // Purge outbox so any old pending or failed operations are cleared
      await clearSyncOutbox(user.id);
      setCloudStatus('sync-pending');
      setSyncError(null);

      try {
        await clearCloudRosterData(client, user.id);
        // Purge outbox again to ensure clean slate
        await clearSyncOutbox(user.id);
      } catch (error) {
        setCloudStatus('sync-failed');
        const message = describeCloudError(error).message;
        setSyncError(message);
        throw error;
      }
    }

    const previousState = latestStateRef.current;
    const nextState: AppState = {
      ...previousState,
      classes: [],
      students: [],
      sessions: [],
      grades: [],
      timetable: [],
      lessonProgress: [],
      activeClassId: null,
      deletedRecordIds: [],
    };

    latestStateRef.current = nextState;
    lastSyncedStateRef.current = nextState;
    lastEnqueuedStateRef.current = nextState;
    setState(nextState);
    await saveAppStateCache(nextState, user?.id, { allowEmptyRoster: true });

    setSyncError(null);
    setCloudStatus(user ? 'ready' : 'local-only');
    setConflicts([]);
  };

  const resetWorkspace = async (): Promise<void> => {
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
    if (user) {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error('لا يمكن تنظيف مساحة الحساب دون اتصال بالخادم السحابي.');
      await resetCloudWorkspace(client, user.id);
      await clearSyncOutbox(user.id);
    }
    if (user) await clearMemorandaOutbox(user.id);
    await clearAvatarOutbox();
    await clearTeacherBinaryFiles(user?.id);
    await clearDashboardTasks();
    const emptyState = getEmptyState();
    await saveAppStateCache(emptyState, user?.id, { allowEmptyRoster: true });
    setLocalStorageError(null);
    setState(emptyState);
    latestStateRef.current = emptyState;
    lastSyncedStateRef.current = emptyState;
    lastEnqueuedStateRef.current = emptyState;
    revisionRef.current = 0;
  };

  const commitRosterImport = async (
    importedClasses: RosterImportClass[],
    importedStudents: RosterImportStudent[],
    nextState: AppState,
  ): Promise<void> => {
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }

    // Immediately update in-memory state and persist to local cache
    latestStateRef.current = nextState;
    setState(nextState);
    await saveAppStateCache(nextState, user?.id);
    setLocalStorageError(null);

    if (!user) {
      return;
    }

    setCloudStatus('sync-pending');
    setSyncError(null);

    try {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error('تعذر الوصول إلى الخادم السحابي لتأكيد الاستيراد.');

      // 1. Direct atomic bulk upsert to Supabase classes and students tables
      const committed = await commitRosterImportBatch(importedClasses, importedStudents);

      // Reconcile local state with any cloud IDs reconciled by the server
      let reconciledState = nextState;
      if (committed.classes.length > 0 || committed.students.length > 0) {
        const classMap = new Map(committed.classes.map(c => [c.name, c]));
        const studentMap = new Map(committed.students.map(s => [`${s.classId}:${s.numberInList}`, s.id]));

        const updatedClasses = nextState.classes.map(c => {
          const cloudClass = classMap.get(c.name);
          if (!cloudClass) return c;
          // Keep the cloud id and the distinct colour acknowledged by the atomic import.
          return {
            ...c,
            id: cloudClass.id !== c.id ? cloudClass.id : c.id,
            color: cloudClass.color || c.color,
          };
        });

        const updatedStudents = nextState.students.map(s => {
          const targetClass = updatedClasses.find(c => c.name === nextState.classes.find(oc => oc.id === s.classId)?.name) || { id: s.classId };
          const cloudId = studentMap.get(`${targetClass.id}:${s.numberInList}`);
          return {
            ...s,
            classId: targetClass.id,
            id: cloudId || s.id,
          };
        });

        reconciledState = {
          ...nextState,
          classes: updatedClasses,
          students: updatedStudents,
        };
        latestStateRef.current = reconciledState;
        setState(reconciledState);
        await saveAppStateCache(reconciledState, user.id);
      }

      // 2. Profile updates if school name, academic year, or state changed
      if (nextState.profile && (nextState.profile.schoolName || nextState.profile.academicYear || nextState.profile.stateName)) {
        await (client as any).from('profiles').update({
          school_name: nextState.profile.schoolName || null,
          academic_year: nextState.profile.academicYear || null,
          state_name: nextState.profile.stateName || null,
          updated_at: new Date().toISOString(),
        }).eq('id', user.id);
      }

      // 3. Clear any pending class/student delta operations from outbox for this user to avoid redundant mutations
      const pendingEntries = await listSyncOutbox(user.id);
      for (const entry of pendingEntries) {
        const hasRosterOp = entry.operations.some((op) => op.entity === 'class' || op.entity === 'student');
        if (hasRosterOp) {
          const nonRosterOps = entry.operations.filter((op) => op.entity !== 'class' && op.entity !== 'student');
          if (nonRosterOps.length === 0) {
            await removeSyncOutboxEntry(entry.id);
          }
        }
      }

      lastSyncedStateRef.current = reconciledState;
      lastEnqueuedStateRef.current = reconciledState;
      setCloudStatus('ready');
      setSyncError(null);
    } catch (error) {
      const message = describeCloudError(error).message;
      console.error('commitRosterImport failed:', message);
      setSyncError(message);
      setCloudStatus('sync-failed');
      throw error;
    }
  };

  return {
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
    localStorageError,
    retrySync,
    syncNow,
    countPendingOperations,
    pendingCount,
    lastSyncedAt,
    refreshSyncStatus,
    syncDeviceId: user ? getSyncDeviceId() : null,
    flushOutboxNow,
    resyncFromCloud,
    conflicts,
    resolveConflictKeepRemote,
    resolveConflictKeepLocal,
  };
}
