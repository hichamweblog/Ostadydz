import { beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    del: vi.fn(async (key: string) => values.delete(key)),
    get: vi.fn(async <T>(key: string) => values.get(key) as T | undefined),
    keys: vi.fn(async () => [...values.keys()]),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  };
});

vi.mock('idb-keyval', () => idb);

import { getEmptyState } from '@/lib/storage';
import {
  selectActiveClass,
  selectActiveClassId,
  selectStudentsByClass,
} from '@/lib/state-selectors';
import {
  getSyncOperationsForState,
  getSyncOperationsDelta,
  enqueueSyncDelta,
  orderSyncOperations,
  recordsShallowEqual,
} from '@/lib/sync-outbox';
import { getDeletedRecordIds, isAuthenticatedOwner } from '@/hooks/useCloudAppState';
import {
  applySyncOutboxEntry,
  clearCloudRosterData,
  getCloudRecordId,
  loadCoreState,
  SyncConflictError,
} from '@/lib/supabase/core-sync';
import { loadAppStateCache, saveAppStateCache } from '@/lib/state-cache';
import { commitRosterImportBatch } from '@/lib/supabase/roster-import';
import {
  enqueueSyncState,
  enqueueSyncOperations,
  listSyncOutbox,
  markSyncOutboxFailure,
  syncRetryDelay,
  type SyncOperation,
  type SyncOutboxEntry,
} from '@/lib/sync-outbox';
import {
  enqueueAvatarDelete,
  enqueueAvatarUpload,
  getAvatarOutboxEntry,
  removeAvatarOutboxEntry,
} from '@/lib/supabase/avatar-outbox';

describe('sync outbox', () => {
  it('rejects a stale owner after logout before starting a cloud write', () => {
    expect(isAuthenticatedOwner('owner-1', 'owner-1')).toBe(true);
    expect(isAuthenticatedOwner(undefined, 'owner-1')).toBe(false);
    expect(isAuthenticatedOwner('owner-2', 'owner-1')).toBe(false);
  });

  it('resolves shared state slices with a safe active class fallback', () => {
    const state = getEmptyState();
    state.classes = [
      { ...state.classes[0], id: 'class-1', name: 'الأولى' },
      { ...state.classes[0], id: 'class-2', name: 'الثانية' },
    ];
    state.students = [
      { ...state.students[0], id: 'student-1', classId: 'class-2' },
    ];
    state.activeClassId = 'missing-class';

    expect(selectActiveClassId(state)).toBe('class-1');
    expect(selectActiveClass(state)?.name).toBe('الأولى');
    expect(selectStudentsByClass(state, 'class-2')).toHaveLength(1);
  });

  beforeEach(() => {
    idb.values.clear();
    vi.clearAllMocks();
  });

  it('stores row operations rather than a whole state snapshot', async () => {
    const state = getEmptyState();
    state.classes = [{ id: 'local-class', name: '1 علوم', level: '1AS_SCIENCE', stream: '' }];
    state.deletedRecordIds = ['student:deleted-row'];

    const id = await enqueueSyncState('owner-1', state, 4, '2026-09-20T20:00:00.000Z');
    const [entry] = await listSyncOutbox('owner-1');

    expect(entry.id).toBe(id);
    expect(entry).not.toHaveProperty('state');
    expect(entry.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'class:local-class',
          entity: 'class',
          action: 'upsert',
          recordId: 'local-class',
          payload: expect.objectContaining({ id: 'local-class' }),
        }),
        expect.objectContaining({
          id: 'delete:student:deleted-row',
          entity: 'student',
          action: 'delete',
          recordId: 'deleted-row',
        }),
      ]),
    );
    expect(entry.operations.every((operation) => !('state' in operation))).toBe(true);
  });

  it('uses capped exponential backoff and preserves failed outbox entries', async () => {
    expect(syncRetryDelay(1)).toBe(2000);
    expect(syncRetryDelay(8)).toBe(256000);
    expect(syncRetryDelay(20)).toBe(256000);

    const id = await enqueueSyncOperations('owner-1', [], 4, '2026-09-20T20:00:00.000Z');
    await markSyncOutboxFailure(id, new Error('temporary failure'));
    const [entry] = await listSyncOutbox('owner-1');
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toBe('temporary failure');
    expect(Date.parse(entry.nextAttemptAt || '')).toBeGreaterThan(Date.now());
  });

  it('keeps avatar uploads and deletes as explicit offline operations', async () => {
    await enqueueAvatarUpload(new File(['avatar'], 'avatar.png', { type: 'image/png' }));
    expect((await getAvatarOutboxEntry())?.action).toBe('upload');
    await enqueueAvatarDelete();
    expect((await getAvatarOutboxEntry())?.action).toBe('delete');
    await removeAvatarOutboxEntry();
    expect(await getAvatarOutboxEntry()).toBeUndefined();
  });

  it('synchronizes dashboard tasks as first-class row operations', async () => {
    const state = getEmptyState();
    state.dashboardTasks = [{ id: 'task-1', text: 'مراجعة دفتر النصوص', done: false }];

    const operations = getSyncOperationsForState(state);

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: 'dashboardTask',
        action: 'upsert',
        recordId: 'task-1',
        payload: { id: 'task-1', text: 'مراجعة دفتر النصوص', done: false },
      }),
    ]));
  });

  it('emits a tombstone when a dashboard task is deleted', async () => {
    const previous = getEmptyState();
    previous.dashboardTasks = [{ id: 'task-1', text: 'مهمة', done: false }];
    const next = { ...previous, dashboardTasks: [], deletedRecordIds: ['dashboardTask:task-1'] };

    const operations = getSyncOperationsForState(next);

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: 'dashboardTask',
        action: 'delete',
        recordId: 'task-1',
      }),
    ]));
  });

  it('keeps backup replacement deletions explicit for cloud synchronization', () => {
    const previous = getEmptyState();
    previous.classes = [{ id: 'class-1', name: 'قسم', level: '1AS_SCIENCE', stream: '' }];
    previous.dashboardTasks = [{ id: 'task-1', text: 'مهمة', done: false }];
    const next = getEmptyState();

    expect(getDeletedRecordIds(previous, next)).toEqual(
      expect.arrayContaining(['class:class-1', 'dashboardTask:task-1']),
    );
  });

  it('does not emit cross-table deletes for an entity-specific tombstone', async () => {
    const state = getEmptyState();
    state.deletedRecordIds = ['student:shared-id'];

    await enqueueSyncState('owner-1', state, 5, '2026-09-20T20:01:00.000Z');
    const [entry] = await listSyncOutbox('owner-1');

    expect(entry.operations.filter((operation) => operation.action === 'delete')).toEqual([
      expect.objectContaining({
        entity: 'student',
        recordId: 'shared-id',
      }),
    ]);
  });

  it('emits relational attendance and behavior operations from session records', async () => {
    const state = getEmptyState();
    state.sessions = [{
      id: 'session-1',
      classId: 'class-1',
      date: '2026-09-20',
      startTime: '08:00',
      endTime: '09:00',
      sessionGoals: '',
      accomplishments: '',
      nextSteps: '',
      teacherNotes: '',
      attendance: { 'student-1': 'ABSENT' },
      disruptions: ['student-2'],
      unwrittenLessons: [],
      poorParticipation: [],
      goodParticipation: ['student-3'],
    }];

    await enqueueSyncState('owner-1', state, 6, '2026-09-20T20:02:00.000Z');
    const [entry] = await listSyncOutbox('owner-1');

    expect(entry.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: 'attendance', recordId: 'session-1:student-1' }),
      expect.objectContaining({ entity: 'behavior', recordId: 'session-1:student-2:disruptions' }),
      expect.objectContaining({ entity: 'behavior', recordId: 'session-1:student-3:goodParticipation' }),
    ]));
  });

  it('orders relational writes after their parent session and deletes before their parent', () => {
    const operations: SyncOperation[] = [
      { id: 'attendance:a', entity: 'attendance', action: 'upsert', recordId: 'a' },
      { id: 'session:s', entity: 'session', action: 'upsert', recordId: 's' },
      { id: 'session:s-delete', entity: 'session', action: 'delete', recordId: 's' },
      { id: 'attendance:a-delete', entity: 'attendance', action: 'delete', recordId: 'a' },
    ];

    expect(orderSyncOperations(operations).map(operation => operation.id)).toEqual([
      'session:s',
      'attendance:a',
      'attendance:a-delete',
      'session:s-delete',
    ]);
  });

  it('preserves relational tombstones when attendance or behavior is removed', () => {
    const state = getEmptyState();
    state.deletedRecordIds = [
      'attendance:session-1:student-1',
      'behavior:session-1:student-2:disruptions',
    ];

    const operations = getSyncOperationsForState(state);

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: 'attendance',
        action: 'delete',
        recordId: 'session-1:student-1',
      }),
      expect.objectContaining({
        entity: 'behavior',
        action: 'delete',
        recordId: 'session-1:student-2:disruptions',
      }),
    ]));
  });

  it('uses stable cloud IDs for relational attendance references', () => {
    expect(getCloudRecordId('owner-1', 'session', 'session-1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(getCloudRecordId('owner-1', 'student', 'student-1')).toBe(
      getCloudRecordId('owner-1', 'student', 'student-1'),
    );
  });

  it('includes the complete professional profile in the sync payload contract', () => {
    const state = getEmptyState();
    state.profile = {
      ...state.profile,
      title: 'أستاذ',
      stateName: 'تلمسان',
      academicYear: '2026/2027',
      firstNameAr: 'محمد',
      lastNameAr: 'بن صالح',
      firstAppointmentDate: '2020-09-01',
      gender: 'M',
    };
    const profileOperation = getSyncOperationsForState(state).find((operation) => operation.entity === 'profile');
    expect(profileOperation?.payload).toMatchObject({
      title: 'أستاذ',
      stateName: 'تلمسان',
      academicYear: '2026/2027',
      firstNameAr: 'محمد',
    });
  });

  it('keeps unit references portable without invalid foreign keys', () => {
    const state = getEmptyState();
    state.lessonProgress = [{
      id: 'progress-1',
      classId: 'class-1',
      unitId: 'official-unit-1',
      status: 'COMPLETED',
      completedAt: '2026-09-20T20:00:00.000Z',
    }];
    const operation = getSyncOperationsForState(state).find((item) => item.entity === 'lessonProgress');
    expect(operation?.payload).toMatchObject({ unitId: 'official-unit-1' });
  });
});

describe('core sync', () => {
  const ownerId = 'owner-1';
  const deviceId = 'device-1';
  const workspaceId = '11111111-1111-4111-8111-111111111111';

  function clientFor(options: {
    existing?: Record<string, unknown> | null;
    operationError?: Error;
  } = {}) {
    const calls: Array<{ table: string; method: string; value?: unknown }> = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: ownerId } } }) },
      rpc: async () => ({ data: workspaceId, error: null }),
      from(table: string) {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
          maybeSingle: async () => ({
            data: table === 'sync_operations' ? null : options.existing ?? null,
            error: null,
          }),
          insert: async (value: unknown) => {
            calls.push({ table, method: 'insert', value });
            return { error: null };
          },
          upsert: async (value: unknown) => {
            calls.push({ table, method: 'upsert', value });
            return { error: options.operationError ?? null };
          },
          delete: async () => {
            calls.push({ table, method: 'delete' });
            return { error: options.operationError ?? null };
          },
        };
        return chain;
      },
    };
    return { client, calls };
  }

  it('maps local IDs deterministically and keeps mappings owner/entity scoped', () => {
    const first = getCloudRecordId(ownerId, 'class', 'local-class');
    expect(first).toBe(getCloudRecordId(ownerId, 'class', 'local-class'));
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(getCloudRecordId('owner-2', 'class', 'local-class'));
    expect(first).not.toBe(getCloudRecordId(ownerId, 'student', 'local-class'));

    const uuid = '22222222-2222-4222-8222-222222222222';
    expect(getCloudRecordId(ownerId, 'class', uuid)).toBe(uuid);
  });

  it('applies a row operation, not a snapshot, with the deterministic cloud ID', async () => {
    const { client, calls } = clientFor();
    const operation: SyncOperation = {
      id: 'class:local-class',
      entity: 'class',
      action: 'upsert',
      recordId: 'local-class',
      payload: {
        id: 'local-class',
        name: '  1 علوم  ',
        level: '1AS_SCIENCE',
        stream: '',
        roomNumber: 'القاعة 12',
      },
    };
    const entry: SyncOutboxEntry = {
      id: 'entry-1',
      ownerId,
      revision: 7,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [operation],
      createdAt: '2026-09-20T20:00:00.000Z',
    };

    await applySyncOutboxEntry(client as never, ownerId, entry, deviceId);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('classes');
    expect(calls[0].method).toBe('upsert');
    expect(calls[0].value).toEqual(expect.objectContaining({
      id: getCloudRecordId(ownerId, 'class', 'local-class'),
      name: '1 علوم',
      room_number: 'القاعة 12',
      revision: 7,
      sync_device_id: deviceId,
    }));
    expect(calls[0].value).not.toHaveProperty('state');
  });

  it.each(['upsert', 'delete'] as const)(
    'rejects a stale %s and leaves the outbox entry available for retry or resolution',
    async (action) => {
      const { client, calls } = clientFor({
        existing: {
          sync_revision: 9,
          updated_by: 'another-device',
          sync_device_id: 'another-device',
        },
      });
      const entry: SyncOutboxEntry = {
        id: `entry-${action}`,
        ownerId,
        revision: 7,
        updatedAt: '2026-09-20T20:00:00.000Z',
        operations: [{
          id: `${action}:local-class`,
          entity: 'class',
          action,
          recordId: 'local-class',
          ...(action === 'upsert'
            ? { payload: { id: 'local-class', name: 'Class', level: '1AS_SCIENCE', stream: '' } }
            : {}),
        }],
        createdAt: '2026-09-20T20:00:00.000Z',
      };
      await enqueueSyncState(ownerId, getEmptyState(), 1, '2026-09-20T19:00:00.000Z');
      await expect(applySyncOutboxEntry(client as never, ownerId, entry, deviceId))
        .rejects.toBeInstanceOf(SyncConflictError);
      expect(calls.some((call) => call.table === 'sync_conflicts')).toBe(true);
      const pending = await listSyncOutbox(ownerId);
      expect(pending.some((item) => item.revision === 1)).toBe(true);
    },
  );

  it('propagates write failures instead of reporting success', async () => {
    const { client } = clientFor({ operationError: new Error('network failure') });
    const entry: SyncOutboxEntry = {
      id: 'entry-failed',
      ownerId,
      revision: 1,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'class:local-class',
        entity: 'class',
        action: 'upsert',
        recordId: 'local-class',
        payload: { id: 'local-class', name: 'Class', level: '1AS_SCIENCE', stream: '' },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };

    await enqueueSyncOperations(ownerId, entry.operations, entry.revision, entry.updatedAt);
    await expect(applySyncOutboxEntry(client as never, ownerId, entry, deviceId))
      .rejects.toThrow('network failure');
    expect((await listSyncOutbox(ownerId)).some((item) => item.revision === entry.revision)).toBe(true);
  });

  it('records conflicts with a cloud UUID even when the local id is not a UUID', async () => {
    const { client, calls } = clientFor({
      existing: {
        sync_revision: 9,
        updated_by: 'another-device',
        sync_device_id: 'another-device',
      },
    });
    const entry: SyncOutboxEntry = {
      id: 'entry-local-conflict',
      ownerId,
      revision: 7,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'class:local-class',
        entity: 'class',
        action: 'upsert',
        recordId: 'local-class',
        payload: { id: 'local-class', name: 'Class', level: '1AS_SCIENCE', stream: '' },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };

    await expect(applySyncOutboxEntry(client as never, ownerId, entry, deviceId))
      .rejects.toBeInstanceOf(SyncConflictError);
    const conflict = calls.find((call) => call.table === 'sync_conflicts');
    expect(conflict?.value).toEqual(expect.objectContaining({
      entity_id: getCloudRecordId(ownerId, 'class', 'local-class'),
    }));
  });

  it('normalizes student birth date to ISO YYYY-MM-DD when applying outbox upsert', async () => {
    const { client, calls } = clientFor();
    const operation: SyncOperation = {
      id: 'student:s-algeria',
      entity: 'student',
      action: 'upsert',
      recordId: 's-algeria',
      payload: {
        id: 's-algeria',
        classId: 'c1',
        fullName: 'أحمد بن علي',
        numberInList: 1,
        birthDate: '15/06/2008', // Algerian school format
        gender: 'M',
      },
    };
    const entry: SyncOutboxEntry = {
      id: 'entry-date-test',
      ownerId,
      revision: 1,
      updatedAt: '2026-09-22T08:00:00.000Z',
      operations: [operation],
      createdAt: '2026-09-22T08:00:00.000Z',
    };

    await applySyncOutboxEntry(client as never, ownerId, entry, deviceId);

    const studentCall = calls.find((c) => c.table === 'students');
    expect(studentCall).toBeDefined();
    expect(studentCall?.method).toBe('upsert');
    expect(studentCall?.value).toEqual(expect.objectContaining({
      birth_date: '2008-06-15',
      gender: 'male',
      full_name: 'أحمد بن علي',
    }));
  });

  it('loadCoreState keeps local-only records only while the outbox still holds work for them', async () => {
    const { client } = clientFor();
    const localState = getEmptyState();
    localState.classes = [
      { id: 'c1', name: '2 لغات 1', level: '2AS_L', stream: 'لغات' },
    ];
    localState.students = [
      { id: 's1', classId: 'c1', fullName: 'تلميذ تجريبي', numberInList: 1 },
    ];

    // No pending operation => the (empty) cloud wins and the stale cache is dropped.
    const withoutPending = await loadCoreState(client as never, localState);
    expect(withoutPending.classes).toHaveLength(0);
    expect(withoutPending.students).toHaveLength(0);

    // A queued operation for those records => genuinely unsynced work is preserved.
    const withPending = await loadCoreState(client as never, localState, {
      pendingRecordIds: new Set(['class:c1', 'student:s1']),
    });
    expect(withPending.classes).toHaveLength(1);
    expect(withPending.classes[0].name).toBe('2 لغات 1');
    expect(withPending.students).toHaveLength(1);
    expect(withPending.students[0].fullName).toBe('تلميذ تجريبي');
  });

  it('loadCoreState respects deletedRecordIds and does not retain deleted classes or students', async () => {
    const { client } = clientFor();
    const localState = getEmptyState();
    localState.classes = [
      { id: 'c1', name: '2 لغات 1', level: '2AS_L', stream: 'لغات' },
    ];
    localState.students = [
      { id: 's1', classId: 'c1', fullName: 'تلميذ تجريبي', numberInList: 1 },
    ];
    localState.deletedRecordIds = ['class:c1', 'student:s1'];

    const loaded = await loadCoreState(client as never, localState);
    expect(loaded.classes).toHaveLength(0);
    expect(loaded.students).toHaveLength(0);
  });

  it('reconciles existing records by business keys to prevent constraint violations', async () => {
    const existingMap: Record<string, any> = {
      grades: { id: 'cloud-grade-uuid', revision: 1, sync_revision: 1 },
      sessions: { id: 'cloud-session-uuid', revision: 1, sync_revision: 1 },
      attendance: { id: 'cloud-attendance-uuid', revision: 1, sync_revision: 1 },
      timetable_slots: { id: 'cloud-timetable-uuid', revision: 1, sync_revision: 1 },
      lesson_progress: { id: 'cloud-progress-uuid', revision: 1, sync_revision: 1 },
      dashboard_tasks: { id: 'cloud-task-uuid', revision: 1, sync_revision: 1 },
    };

    const upsertCalls: Record<string, any> = {};
    const mockClient = {
      auth: { getUser: async () => ({ data: { user: { id: ownerId } } }) },
      rpc: async () => ({ data: workspaceId, error: null }),
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: async () => {
            if (table === 'sync_operations') return { data: null, error: null };
            if (table === 'sync_tombstones') return { data: null, error: null };
            return { data: existingMap[table] ?? null, error: null };
          },
          upsert: async (value: any) => {
            upsertCalls[table] = value;
            return { data: value, error: null };
          },
        };
        return chain;
      },
    };

    // Test grade reconciliation
    const gradeEntry: SyncOutboxEntry = {
      id: 'entry-grade',
      ownerId,
      revision: 2,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'grade:local-grade-id',
        entity: 'grade',
        action: 'upsert',
        recordId: 'local-grade-id',
        payload: {
          id: 'local-grade-id',
          studentId: 'st-1',
          classId: 'c-1',
          trimester: 1,
          exam: 18,
        },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };
    await applySyncOutboxEntry(mockClient as never, ownerId, gradeEntry, deviceId);
    expect(upsertCalls.grades.id).toBe('cloud-grade-uuid');

    // Test session reconciliation
    const sessionEntry: SyncOutboxEntry = {
      id: 'entry-session',
      ownerId,
      revision: 2,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'session:local-session-id',
        entity: 'session',
        action: 'upsert',
        recordId: 'local-session-id',
        payload: {
          id: 'local-session-id',
          classId: 'c-1',
          date: '2026-09-22',
          startTime: '08:00',
          endTime: '09:00',
        },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };
    await applySyncOutboxEntry(mockClient as never, ownerId, sessionEntry, deviceId);
    expect(upsertCalls.sessions.id).toBe('cloud-session-uuid');

    // Test attendance reconciliation
    const attendanceEntry: SyncOutboxEntry = {
      id: 'entry-attendance',
      ownerId,
      revision: 2,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'attendance:local-att-id',
        entity: 'attendance',
        action: 'upsert',
        recordId: 'local-att-id',
        payload: {
          id: 'local-att-id',
          sessionId: 'sess-1',
          studentId: 'st-1',
          status: 'ABSENT',
        },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };
    await applySyncOutboxEntry(mockClient as never, ownerId, attendanceEntry, deviceId);
    expect(upsertCalls.attendance.id).toBe('cloud-attendance-uuid');

    // Test timetable reconciliation
    const timetableEntry: SyncOutboxEntry = {
      id: 'entry-timetable',
      ownerId,
      revision: 2,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'timetable:local-tt-id',
        entity: 'timetable',
        action: 'upsert',
        recordId: 'local-tt-id',
        payload: {
          id: 'local-tt-id',
          classId: 'c-1',
          dayOfWeek: 0,
          startTime: '08:00',
          endTime: '09:00',
        },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };
    await applySyncOutboxEntry(mockClient as never, ownerId, timetableEntry, deviceId);
    expect(upsertCalls.timetable_slots.id).toBe('cloud-timetable-uuid');

    // Test lessonProgress reconciliation
    const progressEntry: SyncOutboxEntry = {
      id: 'entry-progress',
      ownerId,
      revision: 2,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'lessonProgress:local-lp-id',
        entity: 'lessonProgress',
        action: 'upsert',
        recordId: 'local-lp-id',
        payload: {
          id: 'local-lp-id',
          classId: 'c-1',
          unitId: 'unit-1',
          status: 'COMPLETED',
        },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };
    await applySyncOutboxEntry(mockClient as never, ownerId, progressEntry, deviceId);
    expect(upsertCalls.lesson_progress.id).toBe('cloud-progress-uuid');

    // Test dashboardTask reconciliation
    const taskEntry: SyncOutboxEntry = {
      id: 'entry-task',
      ownerId,
      revision: 2,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'dashboardTask:local-task-id',
        entity: 'dashboardTask',
        action: 'upsert',
        recordId: 'local-task-id',
        payload: {
          id: 'local-task-id',
          text: 'تصحيح الفروض',
          done: false,
        },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };
    await applySyncOutboxEntry(mockClient as never, ownerId, taskEntry, deviceId);
    expect(upsertCalls.dashboard_tasks.id).toBe('cloud-task-uuid');
  });
});

describe('delta sync engine', () => {
  const ownerId = 'delta-owner';

  it('correctly compares objects using recordsShallowEqual', () => {
    expect(recordsShallowEqual(null, null)).toBe(true);
    expect(recordsShallowEqual({ a: 1, b: 'two' }, { a: 1, b: 'two' })).toBe(true);
    expect(recordsShallowEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
    expect(recordsShallowEqual({ a: 1, b: 'two' }, { a: 1, b: 'three' })).toBe(false);
    expect(recordsShallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('returns empty array when previousState and nextState are identical', () => {
    const state = getEmptyState();
    state.classes = [{ id: 'c1', name: '1AS', level: '1AS_SCIENCE', stream: '' }];
    state.students = [{ id: 's1', classId: 'c1', firstName: 'أحمد', lastName: 'محمد' }];
    state.grades = [{ id: 'g1', studentId: 's1', classId: 'c1', trimester: 1, continuousAssessment: 15 }];

    const ops = getSyncOperationsDelta(state, state);
    expect(ops).toHaveLength(0);
  });

  it('produces only one operation when a single grade changes', () => {
    const prevState = getEmptyState();
    prevState.classes = [{ id: 'c1', name: '1AS', level: '1AS_SCIENCE', stream: '' }];
    prevState.students = [
      { id: 's1', classId: 'c1', firstName: 'أحمد', lastName: 'محمد' },
      { id: 's2', classId: 'c1', firstName: 'علي', lastName: 'فاطمة' },
    ];
    prevState.grades = [
      { id: 'g1', studentId: 's1', classId: 'c1', trimester: 1, continuousAssessment: 15 },
      { id: 'g2', studentId: 's2', classId: 'c1', trimester: 1, continuousAssessment: 14 },
    ];

    const nextState = {
      ...prevState,
      grades: [
        { ...prevState.grades[0], continuousAssessment: 18 },
        prevState.grades[1],
      ],
    };

    const ops = getSyncOperationsDelta(prevState, nextState);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual(expect.objectContaining({
      id: 'grade:g1',
      entity: 'grade',
      action: 'upsert',
      recordId: 'g1',
      payload: expect.objectContaining({ continuousAssessment: 18 }),
    }));
  });

  it('produces a delete operation when an entity is removed in nextState', () => {
    const prevState = getEmptyState();
    prevState.students = [
      { id: 's1', classId: 'c1', firstName: 'أحمد', lastName: 'محمد' },
      { id: 's2', classId: 'c1', firstName: 'علي', lastName: 'فاطمة' },
    ];

    const nextState = {
      ...prevState,
      students: [prevState.students[0]], // s2 removed
    };

    const ops = getSyncOperationsDelta(prevState, nextState);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      id: 'delete:student:s2',
      entity: 'student',
      action: 'delete',
      recordId: 's2',
    });
  });

  it('produces delete operations for attendance and behaviors when removed from a session', () => {
    const prevState = getEmptyState();
    prevState.sessions = [{
      id: 'sess-1',
      classId: 'c1',
      date: '2026-09-21',
      attendance: { s1: 'absent', s2: 'late' },
      disruptions: ['s1'],
      unwrittenLessons: [],
      poorParticipation: [],
      goodParticipation: [],
    }];

    const nextState = {
      ...prevState,
      sessions: [{
        ...prevState.sessions[0],
        attendance: { s1: 'absent' }, // s2 attendance removed
        disruptions: [], // s1 disruption removed
      }],
    };

    const ops = getSyncOperationsDelta(prevState, nextState);
    const deleteAttendance = ops.find((o) => o.id === 'delete:attendance:sess-1:s2');
    const deleteBehavior = ops.find((o) => o.id === 'delete:behavior:sess-1:s1:disruptions');
    expect(deleteAttendance).toBeDefined();
    expect(deleteBehavior).toBeDefined();
  });

  it('enqueueSyncDelta returns null when no delta exists', async () => {
    const state = getEmptyState();
    const result = await enqueueSyncDelta(ownerId, state, state, 1, new Date().toISOString());
    expect(result).toBeNull();
  });

  it('loadCoreState non-destructively retains unsynced local sessions, grades, timetable, and lesson progress', async () => {
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            is: vi.fn().mockResolvedValue({ data: [], error: null }),
            data: [],
            error: null,
          }),
        }),
      }),
    } as any;

    const localState = {
      ...getEmptyState(),
      isDemo: false,
      classes: [{ id: 'c1', name: '1AS', level: '1AS_SCIENCE' as const, stream: '' }],
      sessions: [{
        id: 's1',
        classId: 'c1',
        date: '2026-09-22',
        startTime: '08:00',
        endTime: '09:00',
        sessionGoals: '',
        accomplishments: '',
        nextSteps: '',
        teacherNotes: '',
        attendance: {},
      }],
      grades: [{
        id: 'g1',
        studentId: 'st1',
        classId: 'c1',
        trimester: 1 as const,
        continuousEval: 15,
        quiz: 14,
        exam: 16,
      }],
      timetable: [{
        id: 'tt1',
        classId: 'c1',
        dayOfWeek: 0,
        startTime: '08:00',
        endTime: '09:00',
      }],
      lessonProgress: [{
        id: 'lp1',
        classId: 'c1',
        unitId: 'u1',
        status: 'COMPLETED' as const,
      }],
    };

    // The whole offline unit (class + its records) is still pending in the outbox.
    const loaded = await loadCoreState(mockClient, localState, {
      pendingRecordIds: new Set([
        'class:c1', 'session:s1', 'grade:g1', 'timetable:tt1', 'lessonProgress:lp1',
      ]),
    });
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].id).toBe('s1');
    expect(loaded.grades).toHaveLength(1);
    expect(loaded.grades[0].id).toBe('g1');
    expect(loaded.timetable).toHaveLength(1);
    expect(loaded.timetable[0].id).toBe('tt1');
    expect(loaded.lessonProgress).toHaveLength(1);
    expect(loaded.lessonProgress[0].id).toBe('lp1');
  });

  it('loadCoreState discards orphaned records when parent class is absent', async () => {
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            is: vi.fn().mockResolvedValue({ data: [], error: null }),
            data: [],
            error: null,
          }),
        }),
      }),
    } as any;

    const localState = {
      ...getEmptyState(),
      isDemo: false,
      classes: [],
      students: [{ id: 'st1', classId: 'deleted-class', fullName: 'تلميذ يتيم', numberInList: 1 }],
      sessions: [{ id: 's1', classId: 'deleted-class', date: '2026-09-22', startTime: '08:00', endTime: '09:00', sessionGoals: '', accomplishments: '', nextSteps: '', teacherNotes: '', attendance: {} }],
      grades: [{ id: 'g1', studentId: 'st1', classId: 'deleted-class', trimester: 1 as const, exam: 15 }],
      timetable: [{ id: 'tt1', classId: 'deleted-class', dayOfWeek: 0, startTime: '08:00', endTime: '09:00' }],
      lessonProgress: [{ id: 'lp1', classId: 'deleted-class', unitId: 'u1', status: 'COMPLETED' as const }],
    };

    const loaded = await loadCoreState(mockClient, localState);
    expect(loaded.classes).toHaveLength(0);
    expect(loaded.students).toHaveLength(0);
    expect(loaded.sessions).toHaveLength(0);
    expect(loaded.grades).toHaveLength(0);
    expect(loaded.timetable).toHaveLength(0);
    expect(loaded.lessonProgress).toHaveLength(0);
  });

  it('clearCloudRosterData invokes clear_roster_data rpc when available', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = {
      rpc: rpcMock,
    } as any;

    await clearCloudRosterData(mockClient, 'owner-1');
    expect(rpcMock).toHaveBeenCalledWith('clear_roster_data');
  });

  it('clearCloudRosterData falls back to table and tombstone deletion when rpc fails', async () => {
    const deletedTables: string[] = [];
    const fromMock = vi.fn((table: string) => ({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockImplementation(() => {
              deletedTables.push(table);
              return Promise.resolve({ data: null, error: null });
            }),
            then: (resolve: any) => {
              deletedTables.push(table);
              return Promise.resolve(resolve({ data: null, error: null }));
            },
          }),
        }),
      }),
    }));

    const mockClient = {
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'clear_roster_data') return Promise.resolve({ data: null, error: new Error('RPC not found') });
        if (fn === 'default_workspace_id') return Promise.resolve({ data: '11111111-1111-4111-8111-111111111111', error: null });
        return Promise.resolve({ data: null, error: null });
      }),
      from: fromMock,
    } as any;

    await clearCloudRosterData(mockClient, 'owner-1');
    expect(deletedTables).toEqual(
      expect.arrayContaining([
        'attendance',
        'session_behaviors',
        'sessions',
        'grades',
        'students',
        'timetable_slots',
        'lesson_progress',
        'classes',
        'sync_tombstones',
        'sync_operations',
      ]),
    );
  });

  it('getDeletedRecordIds prunes cascaded child deletions when parent class is deleted', () => {
    const previous = {
      ...getEmptyState(),
      classes: [{ id: 'c1', name: 'قسم 1', level: '1AS_SCIENCE' as const, stream: '' }],
      students: [{ id: 'st1', classId: 'c1', fullName: 'تلميذ 1', numberInList: 1 }],
      sessions: [{ id: 'sess1', classId: 'c1', date: '2026-09-22', startTime: '08:00', endTime: '09:00', sessionGoals: '', accomplishments: '', nextSteps: '', teacherNotes: '', attendance: { st1: 'ABSENT' as const } }],
      grades: [{ id: 'g1', studentId: 'st1', classId: 'c1', trimester: 1 as const, exam: 15 }],
      timetable: [{ id: 'tt1', classId: 'c1', dayOfWeek: 0, startTime: '08:00', endTime: '09:00' }],
      lessonProgress: [{ id: 'lp1', classId: 'c1', unitId: 'u1', status: 'COMPLETED' as const }],
    };

    const next = {
      ...getEmptyState(),
      classes: [],
      students: [],
      sessions: [],
      grades: [],
      timetable: [],
      lessonProgress: [],
    };

    const deletedIds = getDeletedRecordIds(previous, next);
    expect(deletedIds).toEqual(['class:c1']);
    expect(deletedIds).not.toContain('student:st1');
    expect(deletedIds).not.toContain('session:sess1');
    expect(deletedIds).not.toContain('grade:g1');
  });

  it('getDeletedRecordIds retains student deletion when parent class remains', () => {
    const previous = {
      ...getEmptyState(),
      classes: [{ id: 'c1', name: 'قسم 1', level: '1AS_SCIENCE' as const, stream: '' }],
      students: [{ id: 'st1', classId: 'c1', fullName: 'تلميذ 1', numberInList: 1 }],
    };

    const next = {
      ...getEmptyState(),
      classes: [{ id: 'c1', name: 'قسم 1', level: '1AS_SCIENCE' as const, stream: '' }],
      students: [],
    };

    const deletedIds = getDeletedRecordIds(previous, next);
    expect(deletedIds).toEqual(['student:st1']);
  });

  it('saveAppStateCache allows saving legitimate empty roster and protects against demo state overwrite', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {} as any;

    try {
      const populatedUserState = {
        ...getEmptyState(),
        profile: { ...getEmptyState().profile, name: 'أستاذ أحمد' },
        classes: [{ id: 'c1', name: 'قسم 1', level: '1AS_SCIENCE' as const, stream: '' }],
        students: [{ id: 'st1', classId: 'c1', fullName: 'تلميذ 1', numberInList: 1 }],
      };

      await saveAppStateCache(populatedUserState);
      const cachedAfterPopulated = await loadAppStateCache();
      expect(cachedAfterPopulated?.classes).toHaveLength(1);
      expect(cachedAfterPopulated?.students).toHaveLength(1);

      // Attempt to overwrite real user data with demo state
      const demoState = {
        ...getEmptyState(),
        classes: [{ id: 'cls-demo', name: 'قسم تجريبي', level: '1AS_SCIENCE' as const, stream: '' }],
        students: [{ id: 'std-demo', classId: 'cls-demo', fullName: 'تلميذ تجريبي', numberInList: 1 }],
      };
      await saveAppStateCache(demoState);
      const cachedAfterDemoAttempt = await loadAppStateCache();
      // Cache must NOT be overwritten by demo state
      expect(cachedAfterDemoAttempt?.classes[0]?.id).toBe('c1');

      // User legitimately deletes all classes -> saving empty roster is permitted and updates cache
      const emptyRosterState = {
        ...populatedUserState,
        classes: [],
        students: [],
      };

      await saveAppStateCache(emptyRosterState);
      const cachedAfterDelete = await loadAppStateCache();
      expect(cachedAfterDelete?.classes).toHaveLength(0);
      expect(cachedAfterDelete?.students).toHaveLength(0);
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('regression §3.1: reload after deleting last class retains 0 classes in cache without resurrection', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {} as any;

    try {
      // 1. User has 1 class and 3 students
      const userState = {
        ...getEmptyState(),
        classes: [{ id: 'c1', name: '3 ع ت 1', level: '3AS' as const, stream: 'علوم تجريبية' }],
        students: [
          { id: 's1', classId: 'c1', fullName: 'تلميذ 1', numberInList: 1 },
          { id: 's2', classId: 'c1', fullName: 'تلميذ 2', numberInList: 2 },
          { id: 's3', classId: 'c1', fullName: 'تلميذ 3', numberInList: 3 },
        ],
      };
      await saveAppStateCache(userState);
      const cached = await loadAppStateCache();
      expect(cached?.classes).toHaveLength(1);
      expect(cached?.students).toHaveLength(3);

      // 2. User deletes the class -> state has 0 classes and 0 students
      const deletedState = {
        ...userState,
        classes: [],
        students: [],
      };
      await saveAppStateCache(deletedState);

      // 3. Page reload reads cache -> 0 classes, class does NOT resurrect
      const reloaded = await loadAppStateCache();
      expect(reloaded?.classes).toHaveLength(0);
      expect(reloaded?.students).toHaveLength(0);
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('user-scoped cache isolation prevents cross-session pollution', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {} as any;

    try {
      const userAState = {
        ...getEmptyState(),
        classes: [{ id: 'ca1', name: '2 ع ت 1', level: '2AS' as const, stream: 'علوم' }],
      };
      const userBState = {
        ...getEmptyState(),
        classes: [{ id: 'cb1', name: '3 آداب 1', level: '3AS' as const, stream: 'آداب' }],
      };

      // Save for user A and user B
      await saveAppStateCache(userAState, 'user-a');
      await saveAppStateCache(userBState, 'user-b');

      // Load for user A -> gets user A's class only
      const cachedA = await loadAppStateCache('user-a');
      expect(cachedA?.classes).toHaveLength(1);
      expect(cachedA?.classes[0].name).toBe('2 ع ت 1');

      // Load for user B -> gets user B's class only
      const cachedB = await loadAppStateCache('user-b');
      expect(cachedB?.classes).toHaveLength(1);
      expect(cachedB?.classes[0].name).toBe('3 آداب 1');

      // Clear user A cache on logout
      const { clearAppStateCache } = await import('@/lib/state-cache');
      await clearAppStateCache('user-a');

      expect(await loadAppStateCache('user-a')).toBeNull();
      // User B cache is unaffected
      expect((await loadAppStateCache('user-b'))?.classes[0].name).toBe('3 آداب 1');
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('loadCoreState reconciles activeClassId with app_settings so activeClassId is never null when classes exist', async () => {
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-active-class-test' } }, error: null }) },
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => {
            if (table === 'classes') {
              return {
                data: [{ id: 'class-1', name: '2 لغات', level: '2AS', room_number: 'القاعة 12' }],
                error: null,
              };
            }
            if (table === 'app_settings') {
              return { data: [{ settings: { activeClassId: 'class-1' } }], error: null };
            }
            return {
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
              is: vi.fn().mockResolvedValue({ data: [], error: null }),
              data: [],
              error: null,
            };
          }),
        })),
      })),
      storage: { from: vi.fn() },
    };

    const emptyLocal = getEmptyState();
    emptyLocal.activeClassId = null;

    const loaded = await loadCoreState(mockClient as any, emptyLocal);
    expect(loaded.classes).toHaveLength(1);
    expect(loaded.activeClassId).toBe('class-1');
    expect(loaded.classes[0].roomNumber).toBe('القاعة 12');
  });

  it('loadCoreState retains students and grades matching classes via classMatches', async () => {
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-class-match' } }, error: null }) },
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => {
            if (table === 'classes') {
              return { data: [{ id: 'class-uuid-1', name: '2 ع ت 1', level: '2AS' }], error: null };
            }
            if (table === 'students') {
              return { data: [{ id: 'student-uuid-1', class_id: 'class-uuid-1', full_name: 'محمد علي', number_in_list: 1 }], error: null };
            }
            if (table === 'grades') {
              return { data: [{ id: 'grade-uuid-1', student_id: 'student-uuid-1', class_id: 'class-uuid-1', trimester: 1, continuous_eval: 16 }], error: null };
            }
            return {
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
              is: vi.fn().mockResolvedValue({ data: [], error: null }),
              data: [],
              error: null,
            };
          }),
        })),
      })),
      storage: { from: vi.fn() },
    };

    const localState = getEmptyState();
    const loaded = await loadCoreState(mockClient as any, localState);
    expect(loaded.classes).toHaveLength(1);
    expect(loaded.students).toHaveLength(1);
    expect(loaded.students[0].fullName).toBe('محمد علي');
    expect(loaded.grades).toHaveLength(1);
    expect(loaded.grades[0].continuousEval).toBe(16);
  });

  it('getSyncOperationsDelta produces an upsert operation when profile stateName changes', () => {
    const prev = getEmptyState();
    prev.profile = { ...prev.profile, name: 'أستاذ', stateName: 'الجزائر' };
    const next = { ...prev, profile: { ...prev.profile, stateName: 'وهران' } };

    const ops = getSyncOperationsDelta(prev, next);
    const profileOp = ops.find((o) => o.entity === 'profile');
    expect(profileOp).toBeDefined();
    expect(profileOp?.payload.stateName).toBe('وهران');
  });
});
