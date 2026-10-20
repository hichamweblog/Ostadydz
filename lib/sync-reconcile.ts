/**
 * The single place that decides what survives a merge. (See AGENTS.md §4.)
 *
 * Contract, in one sentence: **Postgres is authoritative; a local record survives only when
 * the outbox still holds unacknowledged work for it and no tombstone marks it deleted.**
 *
 * Before this module the rule was re-implemented per entity inside `loadCoreState` — plus a
 * second, slightly different copy for attendance and behaviours — and every refresh path
 * (initial load, Realtime, retry, restore, full re-sync) went through its own variant. Now
 * they all call these two functions, so "same input, same decision" is a property of the code
 * rather than of reviewer diligence.
 */

export type ReconciliationEntity =
  | 'class' | 'student' | 'grade' | 'session' | 'timetable'
  | 'lessonProgress' | 'customUnit' | 'lessonPlan' | 'dashboardTask'
  | 'attendance' | 'behavior' | 'profile' | 'settings';

export interface ReconciliationContext {
  /**
   * Cloud-side id for a local id. Local ids are stable (`local-*`), so the comparison against
   * the remote list has to consider both spellings.
   */
  cloudIdFor: (entity: ReconciliationEntity, localId: string) => string;
  /** `entity:recordId` keys that still have queued (unacknowledged) work. */
  pendingRecordIds?: ReadonlySet<string>;
  /** `entity:recordId` keys deleted in this session but not yet acknowledged. */
  deletedRecordIds?: readonly string[];
  /** `entity:recordId` keys the server reports as deleted. */
  tombstonedKeys?: Set<string>;
}

export function isPending(context: ReconciliationContext, entity: ReconciliationEntity, recordId: string): boolean {
  return Boolean(context.pendingRecordIds?.has(`${entity}:${recordId}`));
}

export function isDeletedLocally(context: ReconciliationContext, entity: ReconciliationEntity, recordId: string): boolean {
  return Boolean(context.deletedRecordIds?.includes(`${entity}:${recordId}`));
}

export function isTombstoned(
  context: ReconciliationContext,
  entity: ReconciliationEntity,
  ...recordIds: string[]
): boolean {
  if (!context.tombstonedKeys?.size) return false;
  return recordIds.some((recordId) => context.tombstonedKeys!.has(`${entity}:${recordId}`));
}

function getNaturalKey(entity: ReconciliationEntity, item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  if (entity === 'grade' && typeof rec.studentId === 'string' && rec.trimester !== undefined) {
    return `${rec.studentId}:${rec.trimester}`;
  }
  if (entity === 'lessonProgress' && typeof rec.classId === 'string' && typeof rec.unitId === 'string' && rec.unitId) {
    return `${rec.classId}:${rec.unitId}`;
  }
  if (entity === 'session' && typeof rec.classId === 'string' && typeof rec.date === 'string' && rec.date) {
    return `${rec.classId}:${rec.date}:${typeof rec.startTime === 'string' ? rec.startTime : ''}`;
  }
  return null;
}

/**
 * Remote rows win by default, EXCEPT when a local row has unacknowledged work in the outbox:
 *   1. If a remote row is marked deleted locally (`deletedRecordIds`), it is filtered out.
 *   2. If a remote row matches a pending local row (by id or natural key) and no server
 *      tombstone marks it deleted, the pending local fields override the stale remote row.
 *   3. A local-only row is appended when it is not already in the remote list (by local id,
 *      cloud id, or natural key), is not deleted locally or tombstoned, and is pending in the outbox.
 */
export function reconcileEntityList<T extends { id: string }>(
  entity: ReconciliationEntity,
  remoteItems: T[],
  localItems: T[] | undefined,
  context: ReconciliationContext,
): T[] {
  const filteredRemote = remoteItems.filter((item) => !isDeletedLocally(context, entity, item.id));
  if (!localItems?.length) return filteredRemote;

  const localByExactId = new Map<string, T>();
  const localByNaturalKey = new Map<string, T>();
  for (const item of localItems) {
    localByExactId.set(item.id, item);
    const natKey = getNaturalKey(entity, item);
    if (natKey) localByNaturalKey.set(natKey, item);
  }

  const matchedLocalIds = new Set<string>();

  const reconciledRemote = filteredRemote
    .filter((remoteItem) => {
      const natKey = getNaturalKey(entity, remoteItem);
      const localMatch = localByExactId.get(remoteItem.id) ?? (natKey ? localByNaturalKey.get(natKey) : undefined);
      if (localMatch && isDeletedLocally(context, entity, localMatch.id)) {
        matchedLocalIds.add(localMatch.id);
        return false;
      }
      return true;
    })
    .map((remoteItem) => {
      const natKey = getNaturalKey(entity, remoteItem);
      const localMatch = localByExactId.get(remoteItem.id) ?? (natKey ? localByNaturalKey.get(natKey) : undefined);
      if (!localMatch) return remoteItem;
      matchedLocalIds.add(localMatch.id);

      const cloudId = context.cloudIdFor(entity, localMatch.id);
      if (isTombstoned(context, entity, remoteItem.id, cloudId, localMatch.id)) {
        return remoteItem;
      }

      if (isPending(context, entity, localMatch.id) || isPending(context, entity, remoteItem.id)) {
        const merged: Record<string, unknown> = {
          ...remoteItem,
          ...localMatch,
          id: remoteItem.id,
        };
        if (entity === 'session') {
          const remoteMarks = remoteItem as unknown as SessionMarksLike;
          if (remoteMarks.attendance !== undefined) {
            merged.attendance = remoteMarks.attendance;
          }
          for (const field of BEHAVIOR_FIELDS) {
            if (remoteMarks[field] !== undefined) {
              merged[field] = remoteMarks[field];
            }
          }
        }
        return merged as T;
      }

      return remoteItem;
    });

  const remoteIds = new Set(reconciledRemote.map((item) => item.id));
  const retained = localItems.filter((item) => {
    if (matchedLocalIds.has(item.id)) return false;
    const cloudId = context.cloudIdFor(entity, item.id);
    if (remoteIds.has(item.id) || remoteIds.has(cloudId)) return false;
    if (isDeletedLocally(context, entity, item.id)) return false;
    if (isTombstoned(context, entity, cloudId, item.id)) return false;
    return isPending(context, entity, item.id) || isPending(context, entity, cloudId);
  });

  return retained.length > 0 ? [...reconciledRemote, ...retained] : reconciledRemote;
}

/** The behaviour columns a session carries, in the shape the sync engine stores. */
export const BEHAVIOR_FIELDS = [
  'disruptions',
  'unwrittenLessons',
  'poorParticipation',
  'goodParticipation',
] as const;

export type BehaviorField = (typeof BEHAVIOR_FIELDS)[number];

export interface SessionMarksLike {
  id: string;
  attendance?: Record<string, string> | null;
  disruptions?: string[] | null;
  unwrittenLessons?: string[] | null;
  poorParticipation?: string[] | null;
  goodParticipation?: string[] | null;
}

export interface AttendanceRow {
  session_id: string;
  student_id: string;
  status?: string | null;
}

export interface BehaviorRow {
  session_id: string;
  student_id: string;
  behavior: string;
}

export interface ReconciledSession {
  /** Marks that override the cloud rows because the outbox still holds them. */
  pendingAttendance: Map<string, Set<string>>;
  pendingBehaviors: Map<string, Set<string>>;
}

const ATTENDANCE_STATUSES: Record<string, string> = {
  absent: 'ABSENT',
  late: 'LATE',
  excused: 'EXCUSED',
  present: 'PRESENT',
};

/**
 * Attendance and behaviours are relational on the server but embedded in the session on the
 * client, so they need their own pass: the cloud rows are applied first and a local mark is
 * kept only when it is still pending. Without this, a mark taken offline was silently dropped
 * by the next cloud load (and a mark deleted offline was silently restored).
 *
 * Mutates `remoteSessions` in place and reports which marks it kept as pending overrides.
 */
export function reconcileSessionMarks(
  remoteSessions: SessionMarksLike[],
  localSessionsById: Map<string, SessionMarksLike>,
  attendanceRows: AttendanceRow[],
  behaviorRows: BehaviorRow[],
  context: ReconciliationContext,
): ReconciledSession {
  const pendingAttendance = new Map<string, Set<string>>();
  const pendingBehaviors = new Map<string, Set<string>>();
  const sessionsById = new Map(remoteSessions.map((session) => [session.id, session]));

  const localByNaturalKey = new Map<string, SessionMarksLike>();
  for (const localSession of localSessionsById.values()) {
    const natKey = getNaturalKey('session', localSession);
    if (natKey) localByNaturalKey.set(natKey, localSession);
  }

  for (const session of remoteSessions) {
    // Start from the cloud's empty baseline, then re-apply only what is still queued.
    session.attendance = {};
    for (const field of BEHAVIOR_FIELDS) session[field] = [];
    const natKey = getNaturalKey('session', session);
    const local = localSessionsById.get(session.id) ?? (natKey ? localByNaturalKey.get(natKey) : undefined);
    const attendanceIds = new Set<string>();
    const behaviorIds = new Set<string>();
    pendingAttendance.set(session.id, attendanceIds);
    pendingBehaviors.set(session.id, behaviorIds);
    if (!local) continue;

    for (const [studentId, status] of Object.entries(local.attendance || {})) {
      if (!status) continue;
      if (
        isDeletedLocally(context, 'attendance', `${session.id}:${studentId}`) ||
        isDeletedLocally(context, 'attendance', `${local.id}:${studentId}`)
      ) {
        attendanceIds.add(studentId);
        continue;
      }
      if (
        isPending(context, 'attendance', `${session.id}:${studentId}`) ||
        isPending(context, 'attendance', `${local.id}:${studentId}`)
      ) {
        session.attendance[studentId] = status;
        attendanceIds.add(studentId);
      }
    }

    for (const field of BEHAVIOR_FIELDS) {
      const target = session[field];
      if (!target) continue;
      for (const studentId of local[field] || []) {
        if (
          isDeletedLocally(context, 'behavior', `${session.id}:${studentId}:${field}`) ||
          isDeletedLocally(context, 'behavior', `${local.id}:${studentId}:${field}`)
        ) {
          behaviorIds.add(`${studentId}:${field}`);
          continue;
        }
        if (
          isPending(context, 'behavior', `${session.id}:${studentId}:${field}`) ||
          isPending(context, 'behavior', `${local.id}:${studentId}:${field}`)
        ) {
          if (!target.includes(studentId)) target.push(studentId);
          behaviorIds.add(`${studentId}:${field}`);
        }
      }
    }
  }

  for (const row of attendanceRows) {
    const session = sessionsById.get(row.session_id);
    if (!session) continue;
    if (
      pendingAttendance.get(session.id)?.has(row.student_id) ||
      isPending(context, 'attendance', `${session.id}:${row.student_id}`) ||
      isDeletedLocally(context, 'attendance', `${session.id}:${row.student_id}`)
    ) {
      pendingAttendance.get(session.id)?.add(row.student_id);
      continue;
    }
    session.attendance ??= {};
    session.attendance[row.student_id] = ATTENDANCE_STATUSES[row.status || 'present'] ?? 'PRESENT';
  }

  for (const row of behaviorRows) {
    const session = sessionsById.get(row.session_id);
    if (!session) continue;
    const key = `${row.student_id}:${row.behavior}`;
    if (
      pendingBehaviors.get(session.id)?.has(key) ||
      isPending(context, 'behavior', `${session.id}:${key}`) ||
      isDeletedLocally(context, 'behavior', `${session.id}:${key}`)
    ) {
      pendingBehaviors.get(session.id)?.add(key);
      continue;
    }
    const field = BEHAVIOR_FIELDS.find((candidate) => candidate === row.behavior);
    if (!field) continue;
    const target = (session[field] ??= []);
    if (!target.includes(row.student_id)) target.push(row.student_id);
  }

  return { pendingAttendance, pendingBehaviors };
}
