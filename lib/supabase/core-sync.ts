import type { SupabaseClient } from '@supabase/supabase-js';
import { getEmptyState, isDemoState, DEFAULT_CALENDAR_SETTINGS, type AppState } from '@/lib/storage';
import { normalizeCalendarSettings } from '@/lib/academic-calendar';
import type { ClassLessonProgress, ClassRoom, SessionRecord, Student, StudentGrade, TimetableSlot } from '@/lib/types';
import type { Database } from './database.types';
import { getWeeklyHours } from '@/lib/curriculum-data';
import { enqueueSyncState, orderSyncOperations, replayOutboxEntriesOnState, type SyncEntity, type SyncOperation, type SyncOutboxEntry } from '@/lib/sync-outbox';
import {
  BEHAVIOR_FIELDS,
  reconcileEntityList,
  reconcileSessionMarks,
  type ReconciliationContext,
} from '@/lib/sync-reconcile';
import { stableUuid } from './migrate-local-state';
import { normalizeDateToIso, normalizeTime } from '@/lib/date-utils';

type Client = SupabaseClient<Database>;
type AnyClient = { from(table: string): any; auth: any; rpc: any; storage: any };
export interface SyncMetadata {
  revision: number;
  updatedAt: string;
  deviceId: string;
  /**
   * Only set after an explicit user decision (conflict resolution "keep local").
   * A tombstone written by another device must never be cleared implicitly.
   */
  allowTombstoneOverride?: boolean;
}

/**
 * Identifiers of records that still have pending (unacknowledged) work in the local
 * outbox, in the `entity:recordId` form used by `SyncOperation`.
 *
 * These are the *only* local records `loadCoreState` is allowed to keep when the cloud
 * does not know about them: everything else is treated as a stale cache entry.
 */
export type PendingRecordIds = ReadonlySet<string>;

export interface LoadCoreStateOptions {
  pendingRecordIds?: PendingRecordIds;
  outboxEntries?: readonly SyncOutboxEntry[];
}

export function isPendingRecord(pendingRecordIds: PendingRecordIds | undefined, entity: SyncEntity, recordId: string): boolean {
  return Boolean(pendingRecordIds?.has(`${entity}:${recordId}`));
}

export class SyncConflictError extends Error {
  code = 'SYNC_CONFLICT';
  constructor(public entity: SyncEntity, public recordId: string, public remoteRevision: number, public localRevision: number) {
    super(`Sync conflict for ${entity}/${recordId}: remote revision ${remoteRevision} is newer`);
    this.name = 'SyncConflictError';
  }
}

function extractMissingColumn(error: unknown): string | null {
  const e = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  if (!e) return null;
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ');
  const postgrestMatch = text.match(/could not find the '([^']+)' column/i);
  if (postgrestMatch?.[1]) return postgrestMatch[1];
  const pgMatch = text.match(/column "([^"]+)" .* does not exist/i);
  if (pgMatch?.[1]) return pgMatch[1];
  return null;
}

function isMissingColumnError(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  if (!e) return false;
  if (e.code === 'PGRST204' || e.code === '42703') return true;
  return extractMissingColumn(error) !== null;
}

function schemaError(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  if (!e) return false;
  if (isMissingColumnError(error)) return false;
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ');
  return e.code === 'PGRST205' || e.code === '42P01' || /schema cache|could not find the table|relation .* does not exist/i.test(text);
}

const OPTIONAL_FALLBACK_COLUMNS = [
  'summary',
  'assignments',
  'color',
  'hijri_year',
  'first_name_ar',
  'last_name_ar',
  'first_name_en',
  'last_name_en',
  'avatar_storage_key',
  'first_appointment_date',
  'experience_years',
  'birth_date',
  'birth_place',
  'family_status',
  'gender',
  'room_number',
] as const;

/**
 * Upserts a row, and — only when the *deployed* schema is behind the client bundle — retries
 * without the column Postgres/PostgREST says it does not know.
 *
 * Without this, one unknown column made the whole outbox entry fail forever, which (with the
 * old head-of-line flush) froze every queued operation behind it and pushed the app into
 * `local-only`. Losing one optional column is strictly better than losing the record.
 *
 * Each attempt gets a fresh object so a caller holding a reference to the payload never sees
 * the columns this function decided to drop.
 */
async function upsertWithColumnFallback(
  client: AnyClient,
  table: string,
  row: Record<string, any>,
  onConflict: string,
): Promise<{ data?: any; error?: any }> {
  const dropped = new Set<string>();
  const send = async (candidate: Record<string, any>) => {
    const upsertCall = client.from(table).upsert(candidate, { onConflict });
    return typeof upsertCall?.select === 'function'
      ? await upsertCall.select('id').single()
      : await upsertCall;
  };

  let lastResult = await send({ ...row });
  // Grades must be acknowledged in full. Never silently discard any mark or evaluation
  // field because a deployed schema is behind: keep the operation pending instead.
  if (table === 'grades') return lastResult;
  for (let attempt = 0; attempt < 8 && lastResult?.error && isMissingColumnError(lastResult.error); attempt++) {
    const named = extractMissingColumn(lastResult.error);
    const column = named && OPTIONAL_FALLBACK_COLUMNS.some(col => col === named) && named in row && !dropped.has(named)
      ? named
      : !named ? OPTIONAL_FALLBACK_COLUMNS.find((col) => col in row && !dropped.has(col)) : undefined;
    if (!column) return lastResult;
    dropped.add(column);

    const candidate: Record<string, any> = { ...row };
    for (const col of dropped) delete candidate[col];
    lastResult = await send(candidate);
  }
  return lastResult;
}

function localOnly(): Error { return Object.assign(new Error('Supabase schema is unavailable. Remaining in local-only mode.'), { code: 'LOCAL_ONLY_CLOUD' }); }
const tables: Record<SyncEntity, string> = {
  class: 'classes', student: 'students', grade: 'grades', session: 'sessions',
  timetable: 'timetable_slots', lessonProgress: 'lesson_progress', customUnit: 'custom_units',
  lessonPlan: 'lesson_plans', attendance: 'attendance', behavior: 'session_behaviors',
  dashboardTask: 'dashboard_tasks',
  profile: 'profiles', settings: 'app_settings',
};
const isObject = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function getCloudRecordId(ownerId: string, entity: SyncEntity, localId: string): string {
  return isUuid(localId) ? localId : stableUuid(`${entity}:${ownerId}:${localId}`);
}

const workspaceCache = new Map<string, string>();

async function workspaceId(client: AnyClient, ownerId: string): Promise<string> {
  const cached = workspaceCache.get(ownerId);
  if (cached) return cached;

  const result = await client.rpc('default_workspace_id');
  if (!result.error && typeof result.data === 'string' && isUuid(result.data)) {
    workspaceCache.set(ownerId, result.data);
    return result.data;
  }
  const existing = await client.from('workspaces').select('id').eq('owner_id', ownerId).maybeSingle();
  if (existing.data?.id && isUuid(existing.data.id)) {
    workspaceCache.set(ownerId, existing.data.id);
    return existing.data.id;
  }
  const created = await client.from('workspaces').upsert({ owner_id: ownerId }, { onConflict: 'owner_id' }).select('id').single();
  if (created.data?.id && isUuid(created.data.id)) {
    workspaceCache.set(ownerId, created.data.id);
    return created.data.id;
  }
  throw new Error('Supabase workspace is unavailable for this user');
}

function toRow(entity: SyncEntity, payload: any, ownerId: string, workspace: string, metadata: SyncMetadata): Record<string, any> {
  const id = getCloudRecordId(ownerId, entity, payload.id);
  const classId = (value: string | undefined) => value ? getCloudRecordId(ownerId, 'class', value) : null;
  const studentId = (value: string | undefined) => value ? getCloudRecordId(ownerId, 'student', value) : null;
  const sessionId = (value: string | undefined) => value ? getCloudRecordId(ownerId, 'session', value) : null;
  const base = { id, owner_id: ownerId, workspace_id: workspace, revision: metadata.revision, sync_revision: metadata.revision, updated_by: ownerId, sync_device_id: metadata.deviceId, sync_updated_at: metadata.updatedAt };
  switch (entity) {
    case 'class': {
      const hasClassMeta = Boolean(
        payload.levelCode || payload.streamId || payload.assignedSubjectIds || payload.subjectVariantById
      );
      return {
        ...base,
        name: payload.name.trim(),
        level: payload.level,
        section: payload.stream || null,
        room_number: payload.roomNumber?.trim() || null,
        weekly_hours: payload.weeklyHours ?? getWeeklyHours(payload.level, {
          levelCode: payload.levelCode,
          streamId: payload.streamId,
          subjectId: payload.assignedSubjectIds?.[0],
        }),
        academic_year: payload.academicYear || null,
        notes: hasClassMeta
          ? JSON.stringify({
              levelCode: payload.levelCode,
              streamId: payload.streamId,
              assignedSubjectIds: payload.assignedSubjectIds,
              subjectVariantById: payload.subjectVariantById,
            })
          : null,
        color: payload.color || null,
      };
    }
    case 'student': return { ...base, class_id: classId(payload.classId), full_name: payload.fullName.trim(), number_in_list: payload.numberInList, reg_number: payload.regNumber || null, registration_number: payload.registrationNumber || null, is_repeater: payload.isRepeater ?? false, guardian_phone: payload.guardianPhone || null, gender: payload.gender === 'M' ? 'male' : payload.gender === 'F' ? 'female' : null, birth_date: normalizeDateToIso(payload.birthDate) || null, notes: payload.notes || null };
    case 'grade': {
      const clamp = (val: any, min: number, max: number): number | null => {
        if (val === null || val === undefined || val === '') return null;
        if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) {
          throw new Error('قيمة نقطة غير صالحة؛ أُوقف الرفع حفاظاً على السجل الأصلي.');
        }
        return val;
      };
      const trimester = payload.trimester;
      if (![1, 2, 3].includes(trimester)) throw new Error('الفصل الدراسي للنقطة غير صالح.');
      const mergedExtraMarks = {
        ...(payload.extraMarks || {}),
        ...(payload.devoir2 !== undefined && payload.devoir2 !== null ? { devoir2: payload.devoir2 } : {}),
        ...(payload.practicalWork !== undefined && payload.practicalWork !== null ? { tp: payload.practicalWork, practical: payload.practicalWork } : {}),
        ...(payload.oralExpression !== undefined && payload.oralExpression !== null ? { oral: payload.oralExpression } : {}),
      };
      const hasExtraMarks = Object.keys(mergedExtraMarks).length > 0;
      const hasGradeMeta = Boolean(payload.subjectId || hasExtraMarks);
      const encodedFollowUp = hasGradeMeta
        ? JSON.stringify({
            __sanadGradeMeta: true,
            followUpNotes: payload.followUpNotes || undefined,
            subjectId: payload.subjectId,
            extraMarks: hasExtraMarks ? mergedExtraMarks : undefined,
          })
        : (payload.followUpNotes || null);
      return {
        ...base,
        student_id: studentId(payload.studentId),
        class_id: classId(payload.classId),
        trimester,
        continuous_eval: clamp(payload.continuousEval, 0, 20),
        behavior_score: clamp(payload.behaviorScore, 0, 5),
        attendance_score: clamp(payload.attendanceScore, 0, 5),
        notebook_score: clamp(payload.notebookScore, 0, 5),
        participation_score: clamp(payload.participationScore, 0, 5),
        quiz: clamp(payload.quiz, 0, 20),
        exam: clamp(payload.exam, 0, 20),
        calculated_average: clamp(payload.calculatedAverage, 0, 20),
        estimation: payload.estimation || null,
        guidance: payload.guidance || null,
        remarks: payload.remarks || null,
        follow_up_notes: encodedFollowUp,
      };
    }
    case 'timetable': {
      const startTime = normalizeTime(payload.startTime) || '08:00';
      let endTime = normalizeTime(payload.endTime);
      if (!endTime || endTime <= startTime) {
        const [h, m] = startTime.split(':').map(Number);
        endTime = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
      const weekday = typeof payload.dayOfWeek === 'number' && payload.dayOfWeek >= 0 && payload.dayOfWeek <= 6
        ? payload.dayOfWeek
        : 0;
      return { ...base, class_id: classId(payload.classId), weekday, start_time: startTime, end_time: endTime, room: payload.room || null, notes: payload.type || null };
    }
    case 'lessonProgress': {
      const s = String(payload.status || '').toLowerCase();
      const dbStatus = s === 'completed'
        ? 'completed'
        : (s === 'in_progress' || s === 'planned' || s === 'needs_remedial')
          ? 'in_progress'
          : 'not_started';
      return {
        ...base,
        class_id: classId(payload.classId),
        unit_id: null,
        unit_key: payload.unitId || null,
        status: dbStatus,
        completed_at: payload.completedAt ? (normalizeDateToIso(payload.completedAt) || null) : null,
        notes: JSON.stringify(payload),
      };
    }
    case 'session': {
      const sessionDate = normalizeDateToIso(payload.date) || new Date().toISOString().slice(0, 10);
      const startTime = normalizeTime(payload.startTime) || null;
      const parsedEndTime = normalizeTime(payload.endTime);
      const endTime = (parsedEndTime && (!startTime || parsedEndTime > startTime)) ? parsedEndTime : null;
      return {
        ...base,
        class_id: classId(payload.classId),
        session_date: sessionDate,
        start_time: startTime,
        end_time: endTime,
        topic: payload.customTopic || null,
        summary: payload.summary || payload.accomplishments || null,
        assignments: payload.assignments || payload.nextSteps || null,
        teacher_notes: JSON.stringify(payload),
      };
    }
    case 'customUnit': return {
      ...base,
      title: (payload.title || 'وحدة جديدة').trim() || 'وحدة جديدة',
      level: payload.level || '1AS_SCIENCE',
      position: Math.max(0, Number(payload.unitNumber || payload.position || 0) || 0),
      metadata: payload,
    };
    case 'lessonPlan': return {
      ...base,
      class_id: classId(payload.classId),
      unit_id: null,
      title: (payload.title || 'مذكرة جديدة').trim() || 'مذكرة جديدة',
      content: payload,
    };
    case 'attendance': return {
      ...base,
      session_id: sessionId(payload.sessionId),
      student_id: studentId(payload.studentId),
      status: payload.status === 'ABSENT' ? 'absent' : payload.status === 'LATE' ? 'late' : payload.status === 'EXCUSED' ? 'excused' : 'present',
      note: payload.note || null,
    };
    case 'behavior': return {
      ...base,
      session_id: sessionId(payload.sessionId),
      student_id: studentId(payload.studentId),
      behavior: payload.behavior,
      rating: null,
      note: null,
    };
    case 'dashboardTask': return {
      ...base,
      task_id: payload.id,
      text: (payload.text || '').trim(),
      done: Boolean(payload.done),
    };
    default: return payload;
  }
}

function fromRow(entity: SyncEntity, row: any): any {
  if (entity === 'class') {
    let parsedMeta: Record<string, any> = {};
    if (typeof row.notes === 'string' && row.notes.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(row.notes);
        if (isObject(obj)) parsedMeta = obj;
      } catch { /* ignore */ }
    }
    return {
      id: row.id,
      name: row.name,
      level: row.level || '1AS_SCIENCE',
      stream: row.section || '',
      roomNumber: row.room_number || undefined,
      color: row.color || undefined,
      ...(parsedMeta.levelCode ? { levelCode: parsedMeta.levelCode } : {}),
      ...(parsedMeta.streamId ? { streamId: parsedMeta.streamId } : {}),
      ...(Array.isArray(parsedMeta.assignedSubjectIds) ? { assignedSubjectIds: parsedMeta.assignedSubjectIds } : {}),
      ...(isObject(parsedMeta.subjectVariantById) ? { subjectVariantById: parsedMeta.subjectVariantById } : {}),
    } satisfies ClassRoom;
  }
  if (entity === 'student') return { id: row.id, classId: row.class_id, numberInList: row.number_in_list, fullName: row.full_name, regNumber: row.reg_number || undefined, registrationNumber: row.registration_number || undefined, gender: row.gender === 'male' ? 'M' : row.gender === 'female' ? 'F' : undefined, birthDate: row.birth_date || undefined, notes: row.notes || undefined, isRepeater: row.is_repeater, guardianPhone: row.guardian_phone || undefined } satisfies Student;
  if (entity === 'grade') {
    let followUpNotes: string | undefined = row.follow_up_notes || undefined;
    let subjectId: any;
    let extraMarks: Record<string, number | undefined> | undefined;
    if (typeof row.follow_up_notes === 'string' && row.follow_up_notes.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(row.follow_up_notes);
        if (isObject(parsed) && parsed.__sanadGradeMeta) {
          followUpNotes = typeof parsed.followUpNotes === 'string' ? parsed.followUpNotes : undefined;
          subjectId = parsed.subjectId || undefined;
          extraMarks = isObject(parsed.extraMarks) ? parsed.extraMarks : undefined;
        }
      } catch { /* ignore */ }
    }
    return {
      id: row.id,
      studentId: row.student_id,
      classId: row.class_id,
      trimester: row.trimester,
      continuousEval: row.continuous_eval,
      behaviorScore: row.behavior_score,
      attendanceScore: row.attendance_score,
      notebookScore: row.notebook_score,
      participationScore: row.participation_score,
      quiz: row.quiz,
      exam: row.exam,
      calculatedAverage: row.calculated_average,
      estimation: row.estimation || undefined,
      guidance: row.guidance || undefined,
      remarks: row.remarks || undefined,
      followUpNotes,
      ...(subjectId ? { subjectId } : {}),
      ...(extraMarks
        ? {
            extraMarks,
            ...(typeof extraMarks.devoir2 === 'number' ? { devoir2: extraMarks.devoir2 } : {}),
            ...(typeof (extraMarks.tp ?? extraMarks.practical) === 'number'
              ? { practicalWork: extraMarks.tp ?? extraMarks.practical }
              : {}),
            ...(typeof extraMarks.oral === 'number' ? { oralExpression: extraMarks.oral } : {}),
          }
        : {}),
    } satisfies StudentGrade;
  }
  if (entity === 'session' || entity === 'lessonProgress') {
    const encoded = row.teacher_notes || row.notes;
    if (typeof encoded === 'string') {
      try {
        const parsed = JSON.parse(encoded);
        if (isObject(parsed)) {
          if (entity === 'session') {
            return {
              ...parsed,
              id: row.id,
              classId: row.class_id,
              date: row.session_date,
              startTime: normalizeTime(row.start_time) || (typeof parsed.startTime === 'string' ? normalizeTime(parsed.startTime) || '' : ''),
              endTime: normalizeTime(row.end_time) || (typeof parsed.endTime === 'string' ? normalizeTime(parsed.endTime) || '' : ''),
              summary: row.summary || parsed.summary || parsed.accomplishments || '',
              assignments: row.assignments || parsed.assignments || parsed.nextSteps || '',
              accomplishments: parsed.accomplishments || row.summary || parsed.summary || '',
              nextSteps: parsed.nextSteps || row.assignments || parsed.assignments || '',
            };
          }
          return {
            ...parsed,
            id: row.id,
            classId: row.class_id,
            unitId: parsed.unitId || row.unit_key || '',
            status: parsed.status || (row.status === 'completed' ? 'COMPLETED' : row.status === 'in_progress' ? 'IN_PROGRESS' : 'NOT_STARTED'),
            completedAt: parsed.completedAt || row.completed_at?.slice(0, 10) || undefined,
          };
        }
      } catch { /* retain compatibility with rows written by older clients */ }
    }
    if (entity === 'session') {
      return {
        id: row.id,
        classId: row.class_id,
        date: row.session_date,
        startTime: normalizeTime(row.start_time) || '',
        endTime: normalizeTime(row.end_time) || '',
        customTopic: row.topic || undefined,
        summary: row.summary || '',
        assignments: row.assignments || '',
        accomplishments: row.summary || '',
        nextSteps: row.assignments || '',
        sessionGoals: '',
        teacherNotes: row.teacher_notes || '',
        attendance: {},
      } satisfies SessionRecord;
    }
    if (entity === 'lessonProgress') {
      return {
        id: row.id,
        classId: row.class_id,
        unitId: row.unit_key || '',
        status: row.status === 'completed' ? 'COMPLETED' : row.status === 'in_progress' ? 'IN_PROGRESS' : 'NOT_STARTED',
        completedAt: row.completed_at?.slice(0, 10) || undefined,
      };
    }
  }
  if (['customUnit', 'lessonPlan'].includes(entity) && isObject(row.metadata || row.content)) return row.metadata || row.content;
  if (entity === 'timetable') return { id: row.id, classId: row.class_id, dayOfWeek: row.weekday, startTime: normalizeTime(row.start_time) || '08:00', endTime: normalizeTime(row.end_time) || '09:00', room: row.room || undefined, type: row.notes || undefined } satisfies TimetableSlot;
  return null;
}

export async function loadCoreState(
  client: Client,
  localState: AppState,
  options: LoadCoreStateOptions = {},
): Promise<AppState> {
  try {
    const c = client as AnyClient;
    const userId = (await c.auth.getUser()).data.user?.id;
    if (!userId) return localState;
    const pendingRecordIds = options.pendingRecordIds;
    const results = await Promise.all(Object.entries(tables).map(async ([entity, table]) => {
      const query = c.from(table).select('*');
      const result = entity === 'profile' ? await query.eq('id', userId) : await query.eq('owner_id', userId);
      return [entity, result] as const;
    }));
    const memorandaResult = await c.from('memoranda_files').select('unit_key,file_name,storage_path,created_at,updated_at,is_bundled,deleted_at').eq('owner_id', userId).eq('is_bundled', false).is('deleted_at', null);
    if (memorandaResult.error) throw memorandaResult.error;
    for (const [, result] of results) if (result.error) throw result.error;

    // Server-side deletions. A tombstone is the cloud's answer to "was this record
    // deleted?", so it must be read before any local record is allowed to survive.
    const tombstones = await c.from('sync_tombstones').select('entity_type,entity_id').eq('owner_id', userId);
    if (tombstones.error) throw tombstones.error;
    const tombstonedKeys = new Set<string>(
      ((tombstones.data || []) as Array<{ entity_type?: string; entity_id?: string }>)
        .filter((row) => typeof row.entity_type === 'string' && typeof row.entity_id === 'string')
        .map((row) => `${row.entity_type}:${row.entity_id}`),
    );
    const isTombstoned = (entity: SyncEntity, ...ids: string[]): boolean =>
      ids.some((id) => tombstonedKeys.has(`${entity}:${id}`));

    let maxRevision = 0;
    for (const [, result] of results) {
      for (const row of result.data || []) {
        const rev = Number(row.sync_revision ?? 0);
        if (rev > maxRevision) maxRevision = rev;
      }
    }
    const by = (entity: SyncEntity) => (results.find(([key]) => key === entity)?.[1].data || []);

    /**
     * Every merge decision goes through the shared seam (lib/sync-reconcile.ts) so the
     * initial load, the Realtime refresh, the retry path and a full re-sync cannot drift
     * apart: remote wins, and a local row survives only with proven unsynced work.
     */
    const reconciliation: ReconciliationContext = {
      cloudIdFor: (entity, localId) => getCloudRecordId(userId, entity, localId),
      pendingRecordIds,
      deletedRecordIds: localState.deletedRecordIds,
      tombstonedKeys,
    };
    const retainLocal = <T extends { id: string }>(
      entity: SyncEntity,
      remoteItems: T[],
      localItems: T[] | undefined,
    ): T[] => reconcileEntityList(entity, remoteItems, localItems, reconciliation);

    const remoteClasses = by('class').map((r: any) => fromRow('class', r));
    const classes = retainLocal('class', remoteClasses, localState.classes);

    const remoteStudents = by('student').map((r: any) => fromRow('student', r));
    const students = retainLocal('student', remoteStudents, localState.students);

    const remoteGrades = by('grade').map((r: any) => fromRow('grade', r)).filter(Boolean);
    const grades = retainLocal('grade', remoteGrades, localState.grades);

    if (!classes.length && !students.length && !remoteGrades.length && isDemoState(localState)) return getEmptyState();
    const profile = by('profile')[0];
    let remoteAvatarUrl: string | undefined;
    if (profile?.avatar_storage_key) {
      const avatarStoragePath = profile.avatar_storage_key === 'profile'
        ? `users/${userId}/profile`
        : profile.avatar_storage_key;
      const signedAvatar = await c.storage.from('avatars').createSignedUrl(avatarStoragePath, 604800);
      if (signedAvatar.error) throw signedAvatar.error;
      remoteAvatarUrl = signedAvatar.data?.signedUrl;
    }
    const settings = by('settings')[0]?.settings;
    const supplementary = isObject(settings) ? settings : {};

    const remoteTasks = by('dashboardTask').map((row: any) => ({
      id: row.task_id,
      text: row.text,
      done: Boolean(row.done),
    }));
    const dashboardTasks = retainLocal('dashboardTask', remoteTasks, localState.dashboardTasks);

    // Memoranda: cloud metadata is merged *into* the local entry so the local binary
    // reference (`fileStorageKey`) survives a reload; it is never dropped by the merge.
    const localUnitPdfFiles = localState.unitPdfFiles || {};
    const remoteUnitPdfFiles = Object.fromEntries(
      (memorandaResult.data || [])
        .filter((row: any) => typeof row.unit_key === 'string' && typeof row.storage_path === 'string')
        .map((row: any) => [row.unit_key, {
          ...localUnitPdfFiles[row.unit_key],
          fileName: row.file_name,
          cloudStoragePath: row.storage_path,
          uploadedAt: (row.updated_at || row.created_at || new Date().toISOString()).slice(0, 10),
        }]),
    );

    const remoteSessions: SessionRecord[] = by('session')
      .map((r: any) => fromRow('session', r))
      .filter(Boolean);
    const sessionsById = new Map(remoteSessions.map((session) => [session.id, session]));
    const localSessionsById = new Map((localState.sessions || []).map((s) => [s.id, s]));
    // Pending attendance/behaviour marks must survive the load; everything else comes
    // from the cloud so a deletion made elsewhere cannot reappear here.
    reconcileSessionMarks(
      remoteSessions,
      localSessionsById,
      by('attendance') as Array<{ session_id: string; student_id: string; status?: string | null }>,
      by('behavior') as Array<{ session_id: string; student_id: string; behavior: string }>,
      reconciliation,
    );



    const sessions = retainLocal('session', remoteSessions, localState.sessions);

    const remoteTimetable = by('timetable').map((r: any) => fromRow('timetable', r)).filter(Boolean);
    const timetable = retainLocal('timetable', remoteTimetable, localState.timetable);

    const remoteProgress = by('lessonProgress').map((r: any) => fromRow('lessonProgress', r)).filter(Boolean);
    const lessonProgress = retainLocal('lessonProgress', remoteProgress, localState.lessonProgress);

    const remoteCustomUnits = by('customUnit').map((r: any) => fromRow('customUnit', r)).filter(Boolean);
    const customUnits = retainLocal('customUnit', remoteCustomUnits, localState.customUnits);

    const remotePlans = by('lessonPlan').map((r: any) => fromRow('lessonPlan', r)).filter(Boolean);
    const lessonPlans = retainLocal('lessonPlan', remotePlans, localState.lessonPlans);

    const settingsPending = isPendingRecord(pendingRecordIds, 'settings', 'settings');
    const profilePending = isPendingRecord(pendingRecordIds, 'profile', 'profile');

    const preferredActiveClassId = settingsPending
      ? (localState.activeClassId || (supplementary as any)?.activeClassId)
      : ((supplementary as any)?.activeClassId || localState.activeClassId);
    const activeClassId = classes.some((item: ClassRoom) => item.id === preferredActiveClassId)
      ? preferredActiveClassId
      : (classes[0]?.id || null);

    const classIdSet = new Set<string>();
    for (const c of classes) {
      classIdSet.add(c.id);
      classIdSet.add(getCloudRecordId(userId, 'class', c.id));
    }
    const classMatches = (classId: string | undefined): boolean => {
      if (!classId) return false;
      return classIdSet.has(classId) || classIdSet.has(getCloudRecordId(userId, 'class', classId));
    };
    /** No orphaned children: a record whose class is gone from the workspace is dropped. */
    const filterByClass = <T extends { classId?: string }>(items: T[]): T[] =>
      classes.length > 0 ? items.filter((item) => classMatches(item.classId)) : [];

    const profileMeta = isObject((supplementary as any)?.profileSubjectMeta)
      ? (supplementary as any).profileSubjectMeta
      : {};
    const resolvedProfile = profilePending
      ? localState.profile
      : profile
        ? {
            ...localState.profile,
            ...(settingsPending ? {} : profileMeta),
            name: profile.full_name || localState.profile.name,
            title: profile.title || localState.profile.title,
            schoolName: profile.school_name || localState.profile.schoolName,
            stateName: profile.state_name || localState.profile.stateName,
            academicYear: profile.academic_year || localState.profile.academicYear,
            hijriYear: profile.hijri_year || localState.profile.hijriYear,
            firstNameAr: profile.first_name_ar || undefined,
            lastNameAr: profile.last_name_ar || undefined,
            firstNameEn: profile.first_name_en || undefined,
            lastNameEn: profile.last_name_en || undefined,
            email: profile.email || undefined,
            phoneNumber: profile.phone || undefined,
            avatarUrl: remoteAvatarUrl || profile.avatar_url || undefined,
            avatarStorageKey: profile.avatar_storage_key || undefined,
            firstAppointmentDate: profile.first_appointment_date || undefined,
            experienceYears: profile.experience_years ?? undefined,
            birthDate: profile.birth_date || undefined,
            birthPlace: profile.birth_place || undefined,
            familyStatus: profile.family_status || undefined,
            gender: profile.gender === 'M' || profile.gender === 'F' ? profile.gender : undefined,
          }
        : {
            ...localState.profile,
            ...(settingsPending ? {} : profileMeta),
          };

    const mergedState: AppState = {
      ...localState,
      ...(settingsPending ? {} : supplementary),
      profile: resolvedProfile,
      classes,
      students: filterByClass(students),
      grades: filterByClass(grades),
      sessions: filterByClass(sessions),
      timetable: filterByClass(timetable),
      lessonProgress: filterByClass(lessonProgress),
      customUnits,
      lessonPlans,
      dashboardTasks,
      unitPdfFiles: {
        // Keep a local-only attachment only while its binary is still on this device,
        // so a PDF cannot be shown as attached when its file is gone.
        ...Object.fromEntries(
          Object.entries(localUnitPdfFiles).filter(([, entry]) =>
            Boolean(entry?.fileStorageKey || entry?.fileDataUrl),
          ),
        ),
        ...remoteUnitPdfFiles,
      },
      activeClassId,
      cloudRevision: maxRevision,
    };
    // Phase 6 migration: normalise the calendar settings (official dated holidays and the
    // 0.5 unexcused-absence deduction) on every cloud load, whatever the stored jsonb holds.
    mergedState.calendarSettings = normalizeCalendarSettings(
      mergedState.calendarSettings,
      DEFAULT_CALENDAR_SETTINGS,
    );

    if (!options.outboxEntries?.length) return mergedState;

    /**
     * Replay the durable queue over the merged snapshot: whatever is still unacknowledged is
     * part of the teacher's workspace and must be on screen (and in the cache), not only in
     * IndexedDB. This is what stopped a stale cloud copy from erasing offline work.
     */
    const replayed = replayOutboxEntriesOnState(mergedState, options.outboxEntries, tombstonedKeys);
    const replayedClassIdSet = new Set<string>();
    for (const c of replayed.classes) {
      replayedClassIdSet.add(c.id);
      replayedClassIdSet.add(getCloudRecordId(userId, 'class', c.id));
    }
    const replayedClassMatches = (value: string | undefined): boolean => {
      if (!value) return false;
      return replayedClassIdSet.has(value) || replayedClassIdSet.has(getCloudRecordId(userId, 'class', value));
    };
    const refilter = <T extends { classId?: string }>(items: T[]): T[] =>
      replayed.classes.length > 0
        ? items.filter((item) => replayedClassMatches(item.classId))
        : [];

    return {
      ...replayed,
      calendarSettings: normalizeCalendarSettings(replayed.calendarSettings, DEFAULT_CALENDAR_SETTINGS),
      // Re-apply the relational filter: a replayed child must never outlive its class.
      students: refilter(replayed.students),
      grades: refilter(replayed.grades),
      sessions: refilter(replayed.sessions),
      timetable: refilter(replayed.timetable),
      lessonProgress: refilter(replayed.lessonProgress),
    };
  } catch (error) { if (schemaError(error)) throw localOnly(); throw error; }
}

async function applyOperationOnce(client: AnyClient, ownerId: string, workspace: string, operation: SyncOperation, metadata: SyncMetadata): Promise<void> {
  const table = tables[operation.entity];
  let recordId = getCloudRecordId(ownerId, operation.entity, operation.recordId);
  const conflictIfStale = async (existing: any): Promise<void> => {
    // Only check sync_revision (client-coordinated sync revision), NOT internal bump_revision counter
    const remoteRevision = Number(existing?.sync_revision ?? 0);
    const remoteDevice = existing?.sync_device_id || existing?.updated_by || null;
    if (!existing || remoteRevision <= metadata.revision || remoteDevice === metadata.deviceId) return;
    const conflict = await client.from('sync_conflicts').insert({
      workspace_id: workspace,
      owner_id: ownerId,
      entity_type: operation.entity,
      entity_id: recordId,
      local_revision: metadata.revision,
      remote_revision: remoteRevision,
      local_device_id: metadata.deviceId,
      remote_device_id: remoteDevice,
      resolution: 'pending',
    });
    if (conflict.error) throw conflict.error;
    throw new SyncConflictError(operation.entity, operation.recordId, remoteRevision, metadata.revision);
  };
  if (operation.entity === 'profile') {
    const p = operation.payload as any;
    const existing = await client.from(table).select('sync_revision,sync_device_id').eq('id', ownerId).maybeSingle();
    if (existing.error) throw existing.error;
    await conflictIfStale(existing.data);
    const result = await upsertWithColumnFallback(client, table, {
      id: ownerId,
      sync_revision: metadata.revision,
      sync_updated_at: metadata.updatedAt,
      sync_device_id: metadata.deviceId,
      full_name: p.name || null,
      title: p.title || null,
      school_name: p.schoolName || null,
      state_name: p.stateName || null,
      academic_year: p.academicYear || null,
      hijri_year: p.hijriYear || null,
      first_name_ar: p.firstNameAr || null,
      last_name_ar: p.lastNameAr || null,
      first_name_en: p.firstNameEn || null,
      last_name_en: p.lastNameEn || null,
      email: p.email || null,
      phone: p.phoneNumber || null,
      avatar_url: typeof p.avatarUrl === 'string' && !p.avatarUrl.startsWith('data:') ? p.avatarUrl : null,
      avatar_storage_key: p.avatarStorageKey || null,
      first_appointment_date: normalizeDateToIso(p.firstAppointmentDate) || null,
      experience_years: p.experienceYears ?? null,
      birth_date: normalizeDateToIso(p.birthDate) || null,
      birth_place: p.birthPlace || null,
      family_status: p.familyStatus || null,
      gender: p.gender || null,
    }, 'id');
    if (result.error) throw result.error; return;
  }

  if (operation.entity === 'settings') {
    const existing = await client.from(table).select('sync_revision,sync_device_id,settings').eq('owner_id', ownerId).eq('workspace_id', workspace).maybeSingle();
    if (existing.error) throw existing.error;
    // UI preferences (lastWorkspace, activeClassId, etc.) merge cleanly and must never
    // throw a SyncConflictError that blocks pedagogical records in the outbox.
    const nextRevision = Math.max(Number(existing.data?.sync_revision ?? 0), metadata.revision);
    const mergedSettings = isObject(existing.data?.settings) && isObject(operation.payload)
      ? { ...existing.data.settings, ...operation.payload }
      : operation.payload;
    const result = await upsertWithColumnFallback(client, table, {
      owner_id: ownerId,
      workspace_id: workspace,
      settings: mergedSettings,
      revision: nextRevision,
      sync_revision: nextRevision,
      sync_updated_at: metadata.updatedAt,
      sync_device_id: metadata.deviceId,
      updated_by: ownerId,
    }, 'workspace_id');
    if (result.error) throw result.error; return;
  }
  if (operation.action === 'upsert') {
    const row = toRow(operation.entity, operation.payload, ownerId, workspace, metadata);

    if (operation.entity === 'class' && (operation.payload as any)?.name) {
      const existingByName = await client.from('classes')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('name', String((operation.payload as any).name).trim())
        .maybeSingle();
      if (existingByName.data?.id && existingByName.data.id !== recordId) {
        recordId = existingByName.data.id;
        row.id = existingByName.data.id;
      }
    } else if (operation.entity === 'student' && row.class_id && (operation.payload as any)?.numberInList) {
      const existingByNumber = await client.from('students')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('class_id', row.class_id)
        .eq('number_in_list', Number((operation.payload as any).numberInList))
        .maybeSingle();
      if (existingByNumber.data?.id && existingByNumber.data.id !== recordId) {
        recordId = existingByNumber.data.id;
        row.id = existingByNumber.data.id;
      }
    } else if (operation.entity === 'grade' && row.student_id && row.trimester) {
      const payloadSubjectId = (operation.payload as any)?.subjectId || undefined;
      const existingGradeQuery = client.from('grades')
        .select('id,follow_up_notes')
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('student_id', row.student_id)
        .eq('trimester', row.trimester);
      const existingGrade = typeof existingGradeQuery?.maybeSingle === 'function' && !payloadSubjectId
        ? await existingGradeQuery.maybeSingle()
        : await existingGradeQuery;
      if (existingGrade.error) throw existingGrade.error;
      const candidates: Array<{ id: string; follow_up_notes?: string | null }> = Array.isArray(existingGrade.data)
        ? existingGrade.data
        : existingGrade.data
          ? [existingGrade.data]
          : [];
      const extractSubject = (notes?: string | null): string | undefined => {
        if (typeof notes === 'string' && notes.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(notes);
            if (isObject(parsed) && parsed.__sanadGradeMeta && typeof parsed.subjectId === 'string') {
              return parsed.subjectId;
            }
          } catch { /* ignore */ }
        }
        return undefined;
      };
      const matched = candidates.find((cand) => extractSubject(cand.follow_up_notes) === payloadSubjectId);
      if (matched?.id && matched.id !== recordId) {
        recordId = matched.id;
        row.id = matched.id;
      }
    } else if (operation.entity === 'session' && row.class_id && row.session_date && row.start_time) {
      const existingSession = await client.from('sessions')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('class_id', row.class_id)
        .eq('session_date', row.session_date)
        .eq('start_time', row.start_time)
        .maybeSingle();
      if (existingSession.data?.id && existingSession.data.id !== recordId) {
        recordId = existingSession.data.id;
        row.id = existingSession.data.id;
      }
    } else if (operation.entity === 'attendance' && row.session_id && row.student_id) {
      const existingAttendance = await client.from('attendance')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('session_id', row.session_id)
        .eq('student_id', row.student_id)
        .maybeSingle();
      if (existingAttendance.data?.id && existingAttendance.data.id !== recordId) {
        recordId = existingAttendance.data.id;
        row.id = existingAttendance.data.id;
      }
    } else if (operation.entity === 'timetable' && row.class_id && row.weekday !== undefined && row.start_time) {
      const existingSlot = await client.from('timetable_slots')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('class_id', row.class_id)
        .eq('weekday', row.weekday)
        .eq('start_time', row.start_time)
        .maybeSingle();
      if (existingSlot.data?.id && existingSlot.data.id !== recordId) {
        recordId = existingSlot.data.id;
        row.id = existingSlot.data.id;
      }
    } else if (operation.entity === 'lessonProgress' && row.class_id && row.unit_key) {
      const existingProgress = await client.from('lesson_progress')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('class_id', row.class_id)
        .eq('unit_key', row.unit_key)
        .maybeSingle();
      if (existingProgress.data?.id && existingProgress.data.id !== recordId) {
        recordId = existingProgress.data.id;
        row.id = existingProgress.data.id;
      }
    } else if (operation.entity === 'dashboardTask' && row.task_id) {
      const existingTask = await client.from('dashboard_tasks')
        .select('id')
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('task_id', row.task_id)
        .maybeSingle();
      if (existingTask.data?.id && existingTask.data.id !== recordId) {
        recordId = existingTask.data.id;
        row.id = existingTask.data.id;
      }
    }

    const existing = await client.from(table).select('revision,sync_revision,updated_by,sync_device_id').eq('id', recordId).eq('owner_id', ownerId).eq('workspace_id', workspace).maybeSingle();
    if (existing.error) throw existing.error;
    await conflictIfStale(existing.data);

    const tombstone = await client.from('sync_tombstones')
      .select('revision,device_id')
      .eq('workspace_id', workspace)
      .eq('owner_id', ownerId)
      .eq('entity_type', operation.entity)
      .eq('entity_id', recordId)
      .maybeSingle();
    if (tombstone.error) throw tombstone.error;
    // A deletion is absolute: it can only be undone by this device (undo of its own
    // delete) or by an explicit user decision carried on the entry. A newer local
    // revision never silently resurrects a record another device deleted.
    const tombstoneFromOtherDevice = Boolean(tombstone.data && tombstone.data.device_id !== metadata.deviceId);
    if (tombstoneFromOtherDevice && !metadata.allowTombstoneOverride) {
      throw new SyncConflictError(operation.entity, operation.recordId, Number(tombstone.data!.revision ?? 0), metadata.revision);
    }

    const result = await upsertWithColumnFallback(client, table, row, 'id');
    if (result.error) throw result.error;
    if (tombstone.data) {
      const cleared = await client.from('sync_tombstones').delete()
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('entity_type', operation.entity)
        .eq('entity_id', recordId);
      if (cleared.error) throw cleared.error;
    }
    return;
  }
  const existing = await client.from(table).select('revision,sync_revision,updated_by,sync_device_id').eq('id', recordId).eq('owner_id', ownerId).eq('workspace_id', workspace).maybeSingle();
  if (existing.error) throw existing.error;
  await conflictIfStale(existing.data);
  const existingTombstone = await client.from('sync_tombstones')
    .select('revision,device_id')
    .eq('workspace_id', workspace)
    .eq('owner_id', ownerId)
    .eq('entity_type', operation.entity)
    .eq('entity_id', recordId)
    .maybeSingle();
  if (existingTombstone.error) throw existingTombstone.error;
  const tombstone = await client.from('sync_tombstones').upsert({
    workspace_id: workspace,
    owner_id: ownerId,
    entity_type: operation.entity,
    entity_id: recordId,
    revision: Math.max(Number(existingTombstone.data?.revision ?? 0), metadata.revision),
    // Never claim another device's deletion for this one: the tombstone keeps pointing
    // at whoever deleted the record, so it cannot be undone silently later.
    device_id: existingTombstone.data?.device_id ?? metadata.deviceId,
  }, { onConflict: 'workspace_id,entity_type,entity_id' });
  if (tombstone.error) throw tombstone.error;
  const result = await client.from(table).delete().eq('id', recordId).eq('owner_id', ownerId).eq('workspace_id', workspace);
  if (result.error) throw result.error;
}

async function applyOperation(client: AnyClient, ownerId: string, workspace: string, operation: SyncOperation, metadata: SyncMetadata): Promise<void> {
  const operationId = `${metadata.revision}:${metadata.updatedAt}:${operation.id}`;
  const existing = await client.from('sync_operations')
    .select('operation_id')
    .eq('workspace_id', workspace)
    .eq('operation_id', operationId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  await applyOperationOnce(client, ownerId, workspace, operation, metadata);
  const claim = await client.rpc('claim_sync_operation', {
    p_workspace_id: workspace,
    p_owner_id: ownerId,
    p_operation_id: operationId,
  });
  if (claim.error) throw claim.error;
}

export async function saveCoreState(client: Client, ownerId: string, state: AppState, metadata: SyncMetadata = { revision: 0, updatedAt: new Date().toISOString(), deviceId: 'server' }): Promise<void> {
  try {
    const id = await enqueueSyncState(ownerId, state, metadata.revision, metadata.updatedAt);
    const entry = (await import('@/lib/sync-outbox')).listSyncOutbox;
    const pending = await entry(ownerId);
    const current = pending.find(item => item.id === id);
    if (!current) throw new Error('Unable to create sync operations');
    const workspace = await workspaceId(client as AnyClient, ownerId);
    for (const operation of orderSyncOperations(current.operations)) await applyOperation(client as AnyClient, ownerId, workspace, operation, metadata);
    await (await import('@/lib/sync-outbox')).removeSyncOutboxEntry(id);
  } catch (error) { if (schemaError(error)) throw localOnly(); throw error; }
}

export async function applySyncOutboxEntry(client: Client, ownerId: string, entry: SyncOutboxEntry, deviceId: string): Promise<void> {
  try {
    const workspace = await workspaceId(client as AnyClient, ownerId);
    const metadata: SyncMetadata = {
      revision: entry.revision,
      updatedAt: entry.updatedAt,
      deviceId,
      allowTombstoneOverride: entry.allowTombstoneOverride === true,
    };

    for (const operation of orderSyncOperations(entry.operations)) {
      await applyOperation(client as AnyClient, ownerId, workspace, operation, metadata);
    }
  } catch (error) {
    if (schemaError(error)) throw localOnly();
    throw error;
  }
}

export async function resetCloudWorkspace(client: Client, ownerId: string): Promise<void> {
  const result = await client.rpc('reset_workspace');
  if (result.error) throw result.error;
}

export async function clearCloudRosterData(client: Client, ownerId: string): Promise<void> {
  const c = client as AnyClient;
  const rpcResult = await c.rpc('clear_roster_data');
  if (!rpcResult.error) {
    return;
  }

  try {
    const wid = await workspaceId(c, ownerId);
    const tables = [
      'attendance',
      'session_behaviors',
      'sessions',
      'grades',
      'students',
      'timetable_slots',
      'lesson_progress',
      'classes',
    ] as const;

    for (const table of tables) {
      const { error } = await c.from(table).delete().eq('owner_id', ownerId).eq('workspace_id', wid);
      if (error) {
        console.warn(`Direct delete from ${table} returned:`, error);
      }
    }

    await c.from('sync_tombstones')
      .delete()
      .eq('owner_id', ownerId)
      .eq('workspace_id', wid)
      .in('entity_type', ['class', 'student', 'grade', 'session', 'attendance', 'behavior', 'timetable', 'lessonProgress']);

    await c.from('sync_operations')
      .delete()
      .eq('owner_id', ownerId)
      .eq('workspace_id', wid);
  } catch (error) {
    if (schemaError(error)) throw localOnly();
    throw error;
  }
}
