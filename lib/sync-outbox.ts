import { del, get, keys, set } from 'idb-keyval';
import type { AppState } from './storage';

export type SyncEntity =
  | 'class' | 'student' | 'grade' | 'session' | 'timetable'
  | 'lessonProgress' | 'customUnit' | 'lessonPlan' | 'attendance'
  | 'behavior' | 'dashboardTask' | 'profile' | 'settings';

export interface SyncOperation {
  id: string;
  entity: SyncEntity;
  action: 'upsert' | 'delete';
  recordId: string;
  payload?: unknown;
}

export interface SyncOutboxEntry {
  id: string;
  ownerId: string;
  revision: number;
  updatedAt: string;
  operations: SyncOperation[];
  createdAt: string;
  attempts?: number;
  nextAttemptAt?: string;
  lastError?: string;
  /**
   * Set only when the user explicitly chose "keep my local version" for a record whose
   * deletion was recorded on another device. Without it a tombstone always wins.
   */
  allowTombstoneOverride?: boolean;
}

export interface SyncConflictDescriptor {
  entity: SyncEntity;
  recordId: string;
  outboxId: string;
  operationId: string;
  localRevision: number;
  remoteRevision: number;
  localPayload?: unknown;
  remotePayload?: unknown;
}

const OUTBOX_PREFIX = 'sanad:sync-outbox:';
const DEVICE_ID_KEY = 'sanad:sync-device-id';
/**
 * Every entry id is prefixed with its owner (`<ownerId>:<deviceId>:<revision>:<updatedAt>`),
 * so a listing for one teacher only has to *read* that teacher's keys. The previous version
 * deserialized every entry on the device — including other accounts' blobs and old entries
 * that still embedded a whole `AppState` — and filtered by owner afterwards in memory.
 */
const outboxKey = (id: string) => `${OUTBOX_PREFIX}${id}`;
/**
 * Entries created by much older builds used a bare uuid as the id. They are rare, are only
 * read when present, and are identified by the absence of the `owner:device:revision:date`
 * structure.
 */
const isUuidStyleOutboxKey = (key: string): boolean => {
  if (!key.startsWith(OUTBOX_PREFIX)) return false;
  return !key.slice(OUTBOX_PREFIX.length).includes(':');
};

export function getSyncDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

/**
 * Relational rows must be written after their parents and removed before them.
 * Keeping this ordering at the operation boundary makes legacy and manually
 * constructed outbox entries safe as well as state-derived deltas.
 */
export function orderSyncOperations(operations: SyncOperation[]): SyncOperation[] {
  const upsertOrder: Record<SyncEntity, number> = {
    class: 10,
    student: 20,
    timetable: 30,
    session: 40,
    grade: 50,
    lessonProgress: 60,
    customUnit: 60,
    lessonPlan: 60,
    dashboardTask: 60,
    profile: 70,
    settings: 70,
    attendance: 80,
    behavior: 90,
  };
  const deleteOrder: Record<SyncEntity, number> = {
    attendance: 10,
    behavior: 20,
    grade: 30,
    timetable: 40,
    lessonProgress: 50,
    customUnit: 50,
    lessonPlan: 50,
    dashboardTask: 50,
    session: 60,
    student: 70,
    class: 80,
    profile: 90,
    settings: 90,
  };

  return operations
    .map((operation, index) => ({
      operation,
      index,
      rank: operation.action === 'delete'
        ? 100 + deleteOrder[operation.entity]
        : upsertOrder[operation.entity],
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ operation }) => operation);
}

export function getSyncOperationsForState(state: AppState): SyncOperation[] {
  const collections: Array<[SyncEntity, Array<{ id: string }>, boolean]> = [
    ['class', state.classes, true], ['student', state.students, true], ['grade', state.grades, true],
    ['session', state.sessions, true], ['timetable', state.timetable, true],
    ['lessonProgress', state.lessonProgress, true], ['customUnit', state.customUnits, true],
    ['lessonPlan', state.lessonPlans, true],
  ];
  const operations: SyncOperation[] = collections.flatMap(([entity, records]) =>
    records.map(record => ({ id: `${entity}:${record.id}`, entity, action: 'upsert' as const, recordId: record.id, payload: record })),
  );
  for (const task of state.dashboardTasks || []) {
    operations.push({
      id: `dashboardTask:${task.id}`,
      entity: 'dashboardTask',
      action: 'upsert',
      recordId: task.id,
      payload: task,
    });
  }
  for (const session of state.sessions) {
    for (const [studentId, status] of Object.entries(session.attendance || {})) {
      const recordId = `${session.id}:${studentId}`;
      operations.push({
        id: `attendance:${recordId}`,
        entity: 'attendance',
        action: 'upsert',
        recordId,
        payload: { id: recordId, sessionId: session.id, studentId, status },
      });
    }
    for (const [behavior, studentIds] of [
      ['disruptions', session.disruptions || []],
      ['unwrittenLessons', session.unwrittenLessons || []],
      ['poorParticipation', session.poorParticipation || []],
      ['goodParticipation', session.goodParticipation || []],
    ] as const) {
      for (const studentId of studentIds) {
        const recordId = `${session.id}:${studentId}:${behavior}`;
        operations.push({
          id: `behavior:${recordId}`,
          entity: 'behavior',
          action: 'upsert',
          recordId,
          payload: { id: recordId, sessionId: session.id, studentId, behavior },
        });
      }
    }
  }
  operations.push({ id: 'profile:profile', entity: 'profile', action: 'upsert', recordId: 'profile', payload: state.profile });
  operations.push({
    id: 'settings:settings', entity: 'settings', action: 'upsert', recordId: 'settings',
    payload: {
      calendarSettings: state.calendarSettings, theme: state.theme, dashboardStyle: state.dashboardStyle,
      sidebarCollapsed: state.sidebarCollapsed, onboardingDismissed: state.onboardingDismissed,
      activeClassId: state.activeClassId, activeTrimester: state.activeTrimester,
      activeSubjectId: state.activeSubjectId, educationOverrides: state.educationOverrides,
      profileSubjectMeta: {
        primarySubjectId: state.profile.primarySubjectId,
        taughtSubjectIds: state.profile.taughtSubjectIds,
        subjectVariantsById: state.profile.subjectVariantsById,
      },
      lastWorkspace: state.lastWorkspace,
    },
  });
  for (const tombstone of state.deletedRecordIds || []) {
    const separator = tombstone.indexOf(':');
    if (separator <= 0) continue;
    const entity = tombstone.slice(0, separator) as SyncEntity;
    const recordId = tombstone.slice(separator + 1);
    const relationalEntity = entity === 'attendance' || entity === 'behavior' || entity === 'dashboardTask';
    if ((!collections.some(([kind]) => kind === entity) && !relationalEntity) || !recordId) continue;
    operations.push({ id: `delete:${entity}:${recordId}`, entity, action: 'delete', recordId });
  }
  return orderSyncOperations(operations);
}

function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function recordsShallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    const valA = objA[k];
    const valB = objB[k];
    if (valA === valB) continue;
    if (valA !== null && typeof valA === 'object' && valB !== null && typeof valB === 'object') {
      if (stableStringify(valA) !== stableStringify(valB)) return false;
    } else {
      return false;
    }
  }
  return true;
}

export function getSyncOperationsDelta(
  previousState: AppState | null | undefined,
  nextState: AppState,
): SyncOperation[] {
  if (!previousState) {
    return getSyncOperationsForState(nextState);
  }

  const operations: SyncOperation[] = [];

  const prevClasses = new Map(previousState.classes.map((c) => [c.id, c]));
  for (const c of nextState.classes) {
    const prev = prevClasses.get(c.id);
    if (!prev || !recordsShallowEqual(prev, c)) {
      operations.push({ id: `class:${c.id}`, entity: 'class', action: 'upsert', recordId: c.id, payload: c });
    }
  }

  const prevStudents = new Map(previousState.students.map((s) => [s.id, s]));
  for (const s of nextState.students) {
    const prev = prevStudents.get(s.id);
    if (!prev || !recordsShallowEqual(prev, s)) {
      operations.push({ id: `student:${s.id}`, entity: 'student', action: 'upsert', recordId: s.id, payload: s });
    }
  }

  const prevGrades = new Map(previousState.grades.map((g) => [g.id, g]));
  for (const g of nextState.grades) {
    const prev = prevGrades.get(g.id);
    if (!prev || !recordsShallowEqual(prev, g)) {
      operations.push({ id: `grade:${g.id}`, entity: 'grade', action: 'upsert', recordId: g.id, payload: g });
    }
  }

  const prevTimetable = new Map(previousState.timetable.map((t) => [t.id, t]));
  for (const t of nextState.timetable) {
    const prev = prevTimetable.get(t.id);
    if (!prev || !recordsShallowEqual(prev, t)) {
      operations.push({ id: `timetable:${t.id}`, entity: 'timetable', action: 'upsert', recordId: t.id, payload: t });
    }
  }

  const prevProgress = new Map(previousState.lessonProgress.map((p) => [p.id, p]));
  for (const p of nextState.lessonProgress) {
    const prev = prevProgress.get(p.id);
    if (!prev || !recordsShallowEqual(prev, p)) {
      operations.push({ id: `lessonProgress:${p.id}`, entity: 'lessonProgress', action: 'upsert', recordId: p.id, payload: p });
    }
  }

  const prevCustomUnits = new Map(previousState.customUnits.map((u) => [u.id, u]));
  for (const u of nextState.customUnits) {
    const prev = prevCustomUnits.get(u.id);
    if (!prev || !recordsShallowEqual(prev, u)) {
      operations.push({ id: `customUnit:${u.id}`, entity: 'customUnit', action: 'upsert', recordId: u.id, payload: u });
    }
  }

  const prevPlans = new Map(previousState.lessonPlans.map((p) => [p.id, p]));
  for (const p of nextState.lessonPlans) {
    const prev = prevPlans.get(p.id);
    if (!prev || !recordsShallowEqual(prev, p)) {
      operations.push({ id: `lessonPlan:${p.id}`, entity: 'lessonPlan', action: 'upsert', recordId: p.id, payload: p });
    }
  }

  const prevTasks = new Map((previousState.dashboardTasks || []).map((t) => [t.id, t]));
  for (const t of nextState.dashboardTasks || []) {
    const prev = prevTasks.get(t.id);
    if (!prev || !recordsShallowEqual(prev, t)) {
      operations.push({ id: `dashboardTask:${t.id}`, entity: 'dashboardTask', action: 'upsert', recordId: t.id, payload: t });
    }
  }

  const prevSessions = new Map(previousState.sessions.map((s) => [s.id, s]));
  for (const s of nextState.sessions) {
    const prev = prevSessions.get(s.id);
    if (!prev || !recordsShallowEqual(prev, s)) {
      operations.push({ id: `session:${s.id}`, entity: 'session', action: 'upsert', recordId: s.id, payload: s });
    }

    for (const [studentId, status] of Object.entries(s.attendance || {})) {
      if (!prev || prev.attendance?.[studentId] !== status) {
        const recordId = `${s.id}:${studentId}`;
        operations.push({
          id: `attendance:${recordId}`,
          entity: 'attendance',
          action: 'upsert',
          recordId,
          payload: { id: recordId, sessionId: s.id, studentId, status },
        });
      }
    }

    for (const [behavior, studentIds] of [
      ['disruptions', s.disruptions || []],
      ['unwrittenLessons', s.unwrittenLessons || []],
      ['poorParticipation', s.poorParticipation || []],
      ['goodParticipation', s.goodParticipation || []],
    ] as const) {
      const prevStudentIds = new Set(prev?.[behavior] || []);
      for (const studentId of studentIds) {
        if (!prev || !prevStudentIds.has(studentId)) {
          const recordId = `${s.id}:${studentId}:${behavior}`;
          operations.push({
            id: `behavior:${recordId}`,
            entity: 'behavior',
            action: 'upsert',
            recordId,
            payload: { id: recordId, sessionId: s.id, studentId, behavior },
          });
        }
      }
    }
  }

  if (!recordsShallowEqual(previousState.profile, nextState.profile)) {
    operations.push({ id: 'profile:profile', entity: 'profile', action: 'upsert', recordId: 'profile', payload: nextState.profile });
  }

  const prevSettings = {
    calendarSettings: previousState.calendarSettings,
    theme: previousState.theme,
    dashboardStyle: previousState.dashboardStyle,
    sidebarCollapsed: previousState.sidebarCollapsed,
    onboardingDismissed: previousState.onboardingDismissed,
    activeClassId: previousState.activeClassId,
    activeTrimester: previousState.activeTrimester,
    activeSubjectId: previousState.activeSubjectId,
    educationOverrides: previousState.educationOverrides,
    profileSubjectMeta: {
      primarySubjectId: previousState.profile.primarySubjectId,
      taughtSubjectIds: previousState.profile.taughtSubjectIds,
      subjectVariantsById: previousState.profile.subjectVariantsById,
    },
    lastWorkspace: previousState.lastWorkspace,
  };
  const nextSettings = {
    calendarSettings: nextState.calendarSettings,
    theme: nextState.theme,
    dashboardStyle: nextState.dashboardStyle,
    sidebarCollapsed: nextState.sidebarCollapsed,
    onboardingDismissed: nextState.onboardingDismissed,
    activeClassId: nextState.activeClassId,
    activeTrimester: nextState.activeTrimester,
    activeSubjectId: nextState.activeSubjectId,
    educationOverrides: nextState.educationOverrides,
    profileSubjectMeta: {
      primarySubjectId: nextState.profile.primarySubjectId,
      taughtSubjectIds: nextState.profile.taughtSubjectIds,
      subjectVariantsById: nextState.profile.subjectVariantsById,
    },
    lastWorkspace: nextState.lastWorkspace,
  };
  if (!recordsShallowEqual(prevSettings, nextSettings)) {
    operations.push({ id: 'settings:settings', entity: 'settings', action: 'upsert', recordId: 'settings', payload: nextSettings });
  }

  const deletedClassIds = new Set(
    previousState.classes
      .filter((c) => !nextState.classes.some((nc) => nc.id === c.id))
      .map((c) => c.id),
  );

  const collectionsToCheck: [SyncEntity, { id: string }[], { id: string }[]][] = [
    ['class', previousState.classes, nextState.classes],
    ['student', previousState.students, nextState.students],
    ['grade', previousState.grades, nextState.grades],
    ['session', previousState.sessions, nextState.sessions],
    ['timetable', previousState.timetable, nextState.timetable],
    ['lessonProgress', previousState.lessonProgress, nextState.lessonProgress],
    ['customUnit', previousState.customUnits, nextState.customUnits],
    ['lessonPlan', previousState.lessonPlans, nextState.lessonPlans],
    ['dashboardTask', previousState.dashboardTasks || [], nextState.dashboardTasks || []],
  ];

  const addedDeleteIds = new Set<string>();

  for (const [entity, prevItems, nextItems] of collectionsToCheck) {
    const nextIds = new Set(nextItems.map((item) => item.id));
    for (const item of prevItems) {
      if (!nextIds.has(item.id)) {
        if (deletedClassIds.size > 0 && typeof item === 'object' && item !== null && 'classId' in item && typeof item.classId === 'string') {
          if (deletedClassIds.has(item.classId as string)) {
            continue;
          }
        }
        const id = `delete:${entity}:${item.id}`;
        addedDeleteIds.add(id);
        operations.push({ id, entity, action: 'delete', recordId: item.id });
      }
    }
  }

  const nextSessionsMap = new Map(nextState.sessions.map((s) => [s.id, s]));
  for (const prevSession of previousState.sessions) {
    if (deletedClassIds.has(prevSession.classId)) continue;
    const nextSession = nextSessionsMap.get(prevSession.id);
    if (!nextSession) continue;

    for (const studentId of Object.keys(prevSession.attendance || {})) {
      if (!(studentId in (nextSession.attendance || {}))) {
        const recordId = `${prevSession.id}:${studentId}`;
        const id = `delete:attendance:${recordId}`;
        if (!addedDeleteIds.has(id)) {
          addedDeleteIds.add(id);
          operations.push({ id, entity: 'attendance', action: 'delete', recordId });
        }
      }
    }

    for (const behavior of [
      'disruptions',
      'unwrittenLessons',
      'poorParticipation',
      'goodParticipation',
    ] as const) {
      const nextStudentIds = new Set(nextSession[behavior] || []);
      for (const studentId of prevSession[behavior] || []) {
        if (!nextStudentIds.has(studentId)) {
          const recordId = `${prevSession.id}:${studentId}:${behavior}`;
          const id = `delete:behavior:${recordId}`;
          if (!addedDeleteIds.has(id)) {
            addedDeleteIds.add(id);
            operations.push({ id, entity: 'behavior', action: 'delete', recordId });
          }
        }
      }
    }
  }

  const collections: SyncEntity[] = [
    'class', 'student', 'grade', 'session', 'timetable',
    'lessonProgress', 'customUnit', 'lessonPlan', 'attendance',
    'behavior', 'dashboardTask',
  ];
  for (const tombstone of nextState.deletedRecordIds || []) {
    const separator = tombstone.indexOf(':');
    if (separator <= 0) continue;
    const entity = tombstone.slice(0, separator) as SyncEntity;
    const recordId = tombstone.slice(separator + 1);
    if (!collections.includes(entity) || !recordId) continue;
    const id = `delete:${entity}:${recordId}`;
    if (!addedDeleteIds.has(id)) {
      addedDeleteIds.add(id);
      operations.push({ id, entity, action: 'delete', recordId });
    }
  }

  return orderSyncOperations(operations);
}

/** Compatibility wrapper: it now stores row operations, never a whole snapshot. */
export async function enqueueSyncState(ownerId: string, state: AppState, revision: number, updatedAt: string): Promise<string> {
  return enqueueSyncOperations(ownerId, getSyncOperationsForState(state), revision, updatedAt);
}

export async function enqueueSyncDelta(
  ownerId: string,
  previousState: AppState | null | undefined,
  nextState: AppState,
  revision: number,
  updatedAt: string,
): Promise<string | null> {
  const operations = getSyncOperationsDelta(previousState, nextState);
  if (operations.length === 0) {
    return null;
  }
  return enqueueSyncOperations(ownerId, operations, revision, updatedAt);
}

// Serialize writes per teacher so two quick edits cannot prune each other's newest work.
const enqueueTails = new Map<string, Promise<unknown>>();

export function enqueueSyncOperations(
  ownerId: string,
  operations: SyncOperation[],
  revision: number,
  updatedAt: string,
  options: { allowTombstoneOverride?: boolean } = {},
): Promise<string> {
  const previous = enqueueTails.get(ownerId) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    const existingEntries = await listSyncOutbox(ownerId);
    const id = `${ownerId}:${getSyncDeviceId()}:${revision}:${updatedAt}:${globalThis.crypto.randomUUID()}`;
    // Persist first. If storage is full or fails, the earlier durable copy is untouched.
    await set(outboxKey(id), {
      id, ownerId, revision, updatedAt, operations, createdAt: new Date().toISOString(),
      attempts: 0, nextAttemptAt: new Date().toISOString(),
      allowTombstoneOverride: options.allowTombstoneOverride ?? false,
    } satisfies SyncOutboxEntry);
    const supersededRecordKeys = new Set(operations.map(op => `${op.entity}:${op.recordId}`));
    // Pruning is an optimisation only. Its failure must never turn a successful write into
    // a failed enqueue; both copies are safe and the next boot compacts the queue again.
    try {
      for (const existing of existingEntries) {
        const remaining = existing.operations.filter(op => !supersededRecordKeys.has(`${op.entity}:${op.recordId}`));
        if (!remaining.length) await del(outboxKey(existing.id));
        else if (remaining.length !== existing.operations.length) {
          await set(outboxKey(existing.id), { ...existing, operations: remaining });
        }
      }
    } catch (error) {
      console.warn('Outbox compaction deferred; newest operation is durable:', error);
    }
    return id;
  });
  enqueueTails.set(ownerId, write);
  void write.finally(() => {
    if (enqueueTails.get(ownerId) === write) enqueueTails.delete(ownerId);
  }).catch(() => undefined);
  return write;
}

/**
 * Compacts all pending outbox entries for `ownerId` so that superseded operations
 * for the same `(entity, recordId)` in older entries are pruned, preventing
 * cumulative queue growth when working offline.
 */
export async function compactSyncOutbox(ownerId: string): Promise<SyncOutboxEntry[]> {
  const entries = await listSyncOutbox(ownerId);
  if (entries.length === 0) return [];

  const seenRecordKeys = new Set<string>();
  const keptDesc: SyncOutboxEntry[] = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.operations.length === 0) {
      // An entry with nothing left to send is pure overhead: drop it.
      await del(outboxKey(entry.id));
      continue;
    }
    const dedupedDesc: SyncOperation[] = [];
    for (let j = entry.operations.length - 1; j >= 0; j--) {
      const op = entry.operations[j];
      const key = `${op.entity}:${op.recordId}`;
      if (seenRecordKeys.has(key)) continue;
      seenRecordKeys.add(key);
      dedupedDesc.push(op);
    }
    const remaining = dedupedDesc.reverse();
    if (remaining.length === 0) {
      await del(outboxKey(entry.id));
    } else {
      const updated = remaining.length !== entry.operations.length
        ? { ...entry, operations: remaining }
        : entry;
      if (remaining.length !== entry.operations.length) {
        await set(outboxKey(entry.id), updated);
      }
      keptDesc.push(updated);
    }
  }

  return keptDesc.reverse();
}

/**
 * Replays pending outbox operations onto `baseState` so that any unacknowledged local
 * work in IndexedDB (`sanad:sync-outbox:*`) is guaranteed to be reflected in memory
 * and in the local state cache, even if an earlier reload overwrote the state cache.
 */
export function replayOutboxEntriesOnState(
  baseState: AppState,
  entries: readonly SyncOutboxEntry[],
  tombstonedKeys?: ReadonlySet<string>,
): AppState {
  if (!entries.length) return baseState;

  let classes = [...baseState.classes];
  let students = [...baseState.students];
  let grades = [...baseState.grades];
  let sessions = baseState.sessions.map((s) => ({
    ...s,
    attendance: { ...(s.attendance || {}) },
    disruptions: [...(s.disruptions || [])],
    unwrittenLessons: [...(s.unwrittenLessons || [])],
    poorParticipation: [...(s.poorParticipation || [])],
    goodParticipation: [...(s.goodParticipation || [])],
  }));
  let timetable = [...baseState.timetable];
  let lessonProgress = [...baseState.lessonProgress];
  let customUnits = [...baseState.customUnits];
  let lessonPlans = [...baseState.lessonPlans];
  let dashboardTasks = [...(baseState.dashboardTasks || [])];
  let profile = { ...baseState.profile };
  let settingsFields: Partial<AppState> = {};

  const upsertInList = <T extends { id: string }>(
    list: T[],
    item: T,
    matchNatural?: (existing: T, candidate: T) => boolean,
  ): T[] => {
    const idx = list.findIndex(
      (existing) => existing.id === item.id || (matchNatural ? matchNatural(existing, item) : false),
    );
    if (idx >= 0) {
      const next = [...list];
      next[idx] = { ...next[idx], ...item, id: next[idx].id };
      return next;
    }
    return [...list, item];
  };

  for (const entry of entries) {
    for (const op of entry.operations) {
      if (!entry.allowTombstoneOverride && tombstonedKeys?.has(`${op.entity}:${op.recordId}`)) {
        continue;
      }

      if (op.action === 'delete') {
        switch (op.entity) {
          case 'class':
            classes = classes.filter((item) => item.id !== op.recordId);
            break;
          case 'student':
            students = students.filter((item) => item.id !== op.recordId);
            break;
          case 'grade':
            grades = grades.filter((item) => item.id !== op.recordId);
            break;
          case 'session':
            sessions = sessions.filter((item) => item.id !== op.recordId);
            break;
          case 'timetable':
            timetable = timetable.filter((item) => item.id !== op.recordId);
            break;
          case 'lessonProgress':
            lessonProgress = lessonProgress.filter((item) => item.id !== op.recordId);
            break;
          case 'customUnit':
            customUnits = customUnits.filter((item) => item.id !== op.recordId);
            break;
          case 'lessonPlan':
            lessonPlans = lessonPlans.filter((item) => item.id !== op.recordId);
            break;
          case 'dashboardTask':
            dashboardTasks = dashboardTasks.filter((item) => item.id !== op.recordId);
            break;
          case 'attendance': {
            const sep = op.recordId.indexOf(':');
            if (sep > 0) {
              const sessionId = op.recordId.slice(0, sep);
              const studentId = op.recordId.slice(sep + 1);
              const target = sessions.find((s) => s.id === sessionId);
              if (target?.attendance) {
                delete target.attendance[studentId];
              }
            }
            break;
          }
          case 'behavior': {
            const parts = op.recordId.split(':');
            if (parts.length >= 3) {
              const [sessionId, studentId, behavior] = parts;
              const target = sessions.find((s) => s.id === sessionId);
              if (
                target &&
                (behavior === 'disruptions' ||
                  behavior === 'unwrittenLessons' ||
                  behavior === 'poorParticipation' ||
                  behavior === 'goodParticipation')
              ) {
                target[behavior] = (target[behavior] || []).filter((id) => id !== studentId);
              }
            }
            break;
          }
          default:
            break;
        }
        continue;
      }

      if (!op.payload || typeof op.payload !== 'object') continue;
      const payload = op.payload as Record<string, any>;

      switch (op.entity) {
        case 'class':
          classes = upsertInList(classes, payload as any);
          break;
        case 'student':
          students = upsertInList(students, payload as any);
          break;
        case 'grade':
          grades = upsertInList(
            grades,
            payload as any,
            (a, b) =>
              a.studentId === b.studentId &&
              a.trimester === b.trimester &&
              (a.subjectId || undefined) === (b.subjectId || undefined),
          );
          break;
        case 'session': {
          const idx = sessions.findIndex(
            (s) =>
              s.id === payload.id ||
              (s.classId === payload.classId &&
                s.date === payload.date &&
                (s.startTime || '') === (payload.startTime || '')),
          );
          if (idx >= 0) {
            const existing = sessions[idx];
            sessions[idx] = {
              ...existing,
              ...(payload as any),
              id: existing.id,
              attendance: {
                ...(existing.attendance || {}),
                ...(payload.attendance || {}),
              },
              disruptions: payload.disruptions?.length ? [...payload.disruptions] : existing.disruptions,
              unwrittenLessons: payload.unwrittenLessons?.length ? [...payload.unwrittenLessons] : existing.unwrittenLessons,
              poorParticipation: payload.poorParticipation?.length ? [...payload.poorParticipation] : existing.poorParticipation,
              goodParticipation: payload.goodParticipation?.length ? [...payload.goodParticipation] : existing.goodParticipation,
            };
          } else {
            sessions.push({
              ...(payload as any),
              attendance: { ...(payload.attendance || {}) },
              disruptions: [...(payload.disruptions || [])],
              unwrittenLessons: [...(payload.unwrittenLessons || [])],
              poorParticipation: [...(payload.poorParticipation || [])],
              goodParticipation: [...(payload.goodParticipation || [])],
            });
          }
          break;
        }
        case 'attendance': {
          const target = sessions.find((s) => s.id === payload.sessionId);
          if (target && payload.studentId && payload.status) {
            target.attendance = { ...(target.attendance || {}), [payload.studentId]: payload.status };
          }
          break;
        }
        case 'behavior': {
          const target = sessions.find((s) => s.id === payload.sessionId);
          const behavior = payload.behavior as
            | 'disruptions'
            | 'unwrittenLessons'
            | 'poorParticipation'
            | 'goodParticipation';
          if (
            target &&
            payload.studentId &&
            (behavior === 'disruptions' ||
              behavior === 'unwrittenLessons' ||
              behavior === 'poorParticipation' ||
              behavior === 'goodParticipation')
          ) {
            const list = target[behavior] || [];
            if (!list.includes(payload.studentId)) {
              target[behavior] = [...list, payload.studentId];
            }
          }
          break;
        }
        case 'timetable':
          timetable = upsertInList(timetable, payload as any);
          break;
        case 'lessonProgress':
          lessonProgress = upsertInList(
            lessonProgress,
            payload as any,
            (a, b) => a.classId === b.classId && Boolean(a.unitId) && a.unitId === b.unitId,
          );
          break;
        case 'customUnit':
          customUnits = upsertInList(customUnits, payload as any);
          break;
        case 'lessonPlan':
          lessonPlans = upsertInList(lessonPlans, payload as any);
          break;
        case 'dashboardTask':
          dashboardTasks = upsertInList(dashboardTasks, payload as any);
          break;
        case 'profile':
          profile = { ...profile, ...(payload as any) };
          break;
        case 'settings':
          settingsFields = { ...settingsFields, ...(payload as any) };
          break;
        default:
          break;
      }
    }
  }

  return {
    ...baseState,
    ...settingsFields,
    profile,
    classes,
    students,
    grades,
    sessions,
    timetable,
    lessonProgress,
    customUnits,
    lessonPlans,
    dashboardTasks,
  };
}

/**
 * Identifiers of records that still have unacknowledged work in the outbox, in the
 * `entity:recordId` form. Used to decide which local records may survive a cloud load.
 */
export async function listPendingRecordIds(ownerId: string): Promise<Set<string>> {
  const entries = await listSyncOutbox(ownerId);
  const pending = new Set<string>();
  for (const entry of entries) {
    for (const operation of entry.operations) {
      pending.add(`${operation.entity}:${operation.recordId}`);
    }
  }
  return pending;
}

export async function listSyncOutbox(ownerId: string): Promise<SyncOutboxEntry[]> {
  const allKeys = (await keys())
    .filter((key): key is string => typeof key === 'string' && key.startsWith(OUTBOX_PREFIX));

  // Fast path: entry ids start with the owner id, so only this teacher's blobs are read.
  const ownerPrefix = `${OUTBOX_PREFIX}${ownerId}:`;
  const keysToRead = allKeys.filter((key) => key.startsWith(ownerPrefix));

  // Rare fallback: uuid-id entries written by very old builds, which are only adopted when
  // the body confirms the owner (so another account's queue is still never read into ours).
  for (const key of allKeys) {
    if (!isUuidStyleOutboxKey(key)) continue;
    const legacyEntry = await get<SyncOutboxEntry>(key);
    if (!legacyEntry || legacyEntry.ownerId !== ownerId) continue;
    const targetKey = outboxKey(legacyEntry.id);
    if (targetKey === key) {
      // A uuid id maps to the very key it was read from: no re-key, just read it.
      keysToRead.push(key);
      continue;
    }
    // Genuine re-key (id does not match its own key): move the blob, then read the new key.
    await set(targetKey, legacyEntry);
    await del(key);
    keysToRead.push(targetKey);
  }

  const entries = await Promise.all(keysToRead.map((key) => get<SyncOutboxEntry>(key)));
  return entries
    .filter((entry): entry is SyncOutboxEntry => {
      if (!entry || entry.ownerId !== ownerId) return false;
      // Read old entries once and convert them in memory; new entries never contain snapshots.
      const legacy = entry as SyncOutboxEntry & { state?: AppState };
      if (!entry.operations && legacy.state) entry.operations = getSyncOperationsForState(legacy.state);
      if (!Array.isArray(entry.operations)) return false;
      entry.attempts ??= 0;
      entry.nextAttemptAt ??= entry.createdAt;
      return true;
    })
    .sort((a, b) => a.revision - b.revision);
}

export function syncRetryDelay(attempts: number): number {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempts, 8));
}

export async function markSyncOutboxFailure(id: string, error: unknown): Promise<void> {
  const entry = (await get<SyncOutboxEntry>(outboxKey(id)));
  if (!entry) return;
  const attempts = (entry.attempts ?? 0) + 1;
  entry.attempts = attempts;
  entry.nextAttemptAt = new Date(Date.now() + syncRetryDelay(attempts)).toISOString();
  entry.lastError = error instanceof Error ? error.message : String(error);
  await set(outboxKey(id), entry);
}

export async function removeSyncOutboxEntry(id: string): Promise<void> { await del(outboxKey(id)); }

export async function clearSyncOutbox(ownerId: string): Promise<void> {
  await Promise.all((await listSyncOutbox(ownerId)).map(entry => removeSyncOutboxEntry(entry.id)));
}
