import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Grade-sync safety suite ("إذا حصل خلل فكارثة"):
 *
 * Marks are the most sensitive record in the workspace, so this file locks the whole
 * round-trip: an offline grade edit must survive the cloud merge, ride the durable outbox
 * as a single superseding entry, be replayed on top of a stale snapshot at boot, and be
 * applied to the server with every grade column intact (and the cloud's row id reused).
 */

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

import { getEmptyState, type AppState } from '@/lib/storage';
import type { StudentGrade } from '@/lib/types';
import {
  enqueueSyncDelta,
  listPendingRecordIds,
  listSyncOutbox,
  replayOutboxEntriesOnState,
} from '@/lib/sync-outbox';
import { reconcileEntityList, type ReconciliationContext } from '@/lib/sync-reconcile';
import { flushSyncOutbox } from '@/hooks/useCloudAppState';
import * as avatarStorage from '@/lib/supabase/avatar-storage';
import { applySyncOutboxEntry, loadCoreState } from '@/lib/supabase/core-sync';

const ownerId = 'owner-grades';
const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const gradeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const cloudGradeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeGrade(partial: Partial<StudentGrade> = {}): StudentGrade {
  return {
    id: gradeId,
    studentId,
    classId,
    trimester: 1,
    continuousEval: 15,
    behaviorScore: 5,
    attendanceScore: 4.5,
    notebookScore: 5,
    participationScore: 4,
    quiz: 14,
    exam: 16,
    calculatedAverage: 15,
    estimation: 'جيد جداً',
    ...partial,
  };
}

function gradeRow(grade: StudentGrade, id: string = grade.id) {
  return {
    id,
    owner_id: ownerId,
    workspace_id: 'ws',
    class_id: grade.classId,
    student_id: grade.studentId,
    trimester: grade.trimester,
    continuous_eval: grade.continuousEval,
    behavior_score: grade.behaviorScore ?? null,
    attendance_score: grade.attendanceScore ?? null,
    notebook_score: grade.notebookScore ?? null,
    participation_score: grade.participationScore ?? null,
    quiz: grade.quiz,
    exam: grade.exam,
    calculated_average: grade.calculatedAverage ?? null,
    estimation: grade.estimation ?? null,
    guidance: grade.guidance ?? null,
    remarks: grade.remarks ?? null,
    follow_up_notes: grade.followUpNotes ?? null,
    sync_revision: 1,
  };
}

interface RecordingClient {
  client: any;
  upserts: Array<{ table: string; payload: Record<string, any> }>;
}

function makeRecordingClient(
  rows: Record<string, unknown[]>,
  singles: Record<string, unknown> = {},
  failure?: unknown,
): RecordingClient {
  const upserts: Array<{ table: string; payload: Record<string, any> }> = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: ownerId } } }) },
    rpc: async () => ({ data: classId, error: null }),
    storage: {
      from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/f' }, error: null }) }),
    },
    from(table: string) {
      const chain: any = {
        __table: table,
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        like: () => chain,
        limit: () => chain,
        in: () => chain,
        order: () => chain,
        then: (resolve: any) =>
          Promise.resolve({ data: (rows[table] as unknown[]) ?? [], error: null }).then(resolve),
        maybeSingle: async () => ({ data: singles[table] ?? null, error: null }),
        insert: async () => ({ data: null, error: null }),
        upsert: (payload: Record<string, any>) => {
          upserts.push({ table, payload: { ...payload } });
          return { data: null, error: table === "grades" ? failure ?? null : null };
        },
        delete: () => chain,
      };
      return chain;
    },
  };
  return { client, upserts };
}

function baseState(): AppState {
  const state = getEmptyState();
  return {
    ...state,
    classes: [{ id: classId, name: '1AS1', level: '1AS_SCIENCE', stream: 'جذع مشترك علوم' }],
    students: [{ id: studentId, classId, numberInList: 1, fullName: 'تلميذ تجريبي' }],
    grades: [makeGrade()],
  };
}

const context = (overrides: Partial<ReconciliationContext> = {}): ReconciliationContext => ({
  cloudIdFor: (_entity, localId) => localId,
  pendingRecordIds: new Set<string>(),
  deletedRecordIds: [],
  tombstonedKeys: new Set<string>(),
  ...overrides,
});

beforeEach(() => {
  idb.values.clear();
  vi.clearAllMocks();
});

describe('§1 merge: a queued grade edit always beats the stale cloud row', () => {
  it('keeps the local marks when the same id is pending in the outbox', () => {
    const staleCloud = makeGrade({ continuousEval: 8, quiz: 7, estimation: 'ضعيف' });
    const localEdit = makeGrade({ continuousEval: 17.5, quiz: 18, estimation: 'ممتاز' });

    const merged = reconcileEntityList(
      'grade',
      [staleCloud],
      [localEdit],
      context({ pendingRecordIds: new Set([`grade:${gradeId}`]) }),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].continuousEval).toBe(17.5);
    expect(merged[0].quiz).toBe(18);
    expect(merged[0].estimation).toBe('ممتاز');
  });

  it('folds a pending local grade into the cloud row that shares its natural key', () => {
    // The cloud row was created by another device with a different uuid: the natural key
    // (student + trimester) must match it so no duplicate grade can appear.
    const remote = makeGrade({ id: cloudGradeId, continuousEval: 10 });
    const local = makeGrade({ id: gradeId, continuousEval: 16 });

    const merged = reconcileEntityList(
      'grade',
      [remote],
      [local],
      context({ pendingRecordIds: new Set([`grade:${gradeId}`]) }),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(cloudGradeId);
    expect(merged[0].continuousEval).toBe(16);
  });

  it('lets the cloud win when nothing is queued for that grade', () => {
    const remote = makeGrade({ continuousEval: 12 });
    const local = makeGrade({ continuousEval: 19 });

    const merged = reconcileEntityList('grade', [remote], [local], context());

    expect(merged).toHaveLength(1);
    expect(merged[0].continuousEval).toBe(12);
  });

  it('honours a queued deletion and a server tombstone', () => {
    const remote = makeGrade();
    expect(
      reconcileEntityList('grade', [remote], [], context({ deletedRecordIds: [`grade:${gradeId}`] })),
    ).toEqual([]);

    expect(
      reconcileEntityList(
        'grade',
        [remote],
        [makeGrade({ continuousEval: 18 })],
        context({
          pendingRecordIds: new Set([`grade:${gradeId}`]),
          tombstonedKeys: new Set([`grade:${gradeId}`]),
        }),
      )[0].continuousEval,
    ).toBe(remote.continuousEval);
  });
});

describe('§2 outbox: one superseding entry per grade, replayed at boot', () => {
  it('queues a single entry for many successive edits of the same grade', async () => {
    const baseline = baseState();
    const edited = { ...baseline, grades: [makeGrade({ continuousEval: 18 })] };
    await enqueueSyncDelta(ownerId, baseline, edited, 2, new Date().toISOString());

    const editedAgain = { ...baseline, grades: [makeGrade({ continuousEval: 19, quiz: 20 })] };
    await enqueueSyncDelta(ownerId, edited, editedAgain, 3, new Date().toISOString());

    const entries = await listSyncOutbox(ownerId);
    const gradeEntries = entries.filter((entry) => entry.operations.some(op => op.entity === 'grade'));
    expect(gradeEntries).toHaveLength(1);
    expect((await listPendingRecordIds(ownerId)).has(`grade:${gradeId}`)).toBe(true);
  });

  it('replays the queued marks over a stale snapshot so nothing is lost on reopen', async () => {
    const baseline = baseState();
    const edited = { ...baseline, grades: [makeGrade({ continuousEval: 18.5, exam: 19 })] };
    await enqueueSyncDelta(ownerId, baseline, edited, 2, new Date().toISOString());
    const entries = await listSyncOutbox(ownerId);

    const stale = baseState(); // what a stale cloud/cache snapshot would show
    const replayed = replayOutboxEntriesOnState(stale, entries);
    expect(replayed.grades[0].continuousEval).toBe(18.5);
    expect(replayed.grades[0].exam).toBe(19);
  });

  it('keeps the local marks through a full cloud load with the outbox attached', async () => {
    const baseline = baseState();
    const edited = { ...baseline, grades: [makeGrade({ continuousEval: 17, estimation: 'ممتاز' })] };
    await enqueueSyncDelta(ownerId, baseline, edited, 2, new Date().toISOString());
    const entries = await listSyncOutbox(ownerId);

    const { client } = makeRecordingClient(
      {
        classes: [{ id: classId, owner_id: ownerId, workspace_id: 'ws', name: '1AS1', level: '1AS_SCIENCE', section: 'جذع مشترك علوم', sync_revision: 1 }],
        students: [{ id: studentId, owner_id: ownerId, workspace_id: 'ws', class_id: classId, number_in_list: 1, full_name: 'تلميذ تجريبي', is_repeater: false, sync_revision: 1 }],
        grades: [gradeRow(makeGrade({ continuousEval: 5, estimation: 'ضعيف' }))],
      },
    );

    const loaded = await loadCoreState(client, baseline, {
      outboxEntries: entries,
      pendingRecordIds: await listPendingRecordIds(ownerId),
    });

    expect(loaded.grades).toHaveLength(1);
    expect(loaded.grades[0].continuousEval).toBe(17);
    expect(loaded.grades[0].estimation).toBe('ممتاز');
  });
});

describe('§3 flush: the server receives every grade column, reusing the cloud row id', () => {
  it('upserts the full grade payload', async () => {
    const baseline = baseState();
    const edited = {
      ...baseline,
      grades: [makeGrade({ continuousEval: 16.5, quiz: 15, exam: 17, remarks: 'ملاحظة الأستاذ' })],
    };
    await enqueueSyncDelta(ownerId, baseline, edited, 2, new Date().toISOString());
    const [entry] = (await listSyncOutbox(ownerId)).filter((item) => item.operations.some(op => op.entity === 'grade'));

    const { client, upserts } = makeRecordingClient({});
    await applySyncOutboxEntry(client, ownerId, entry, 'device-phone');

    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe('grades');
    const payload = upserts[0].payload;
    expect(payload.continuous_eval).toBe(16.5);
    expect(payload.quiz).toBe(15);
    expect(payload.exam).toBe(17);
    expect(payload.remarks).toBe('ملاحظة الأستاذ');
    expect(payload.behavior_score).toBe(5);
    expect(payload.attendance_score).toBe(4.5);
    expect(payload.notebook_score).toBe(5);
    expect(payload.participation_score).toBe(4);
    expect(payload.estimation).toBe('جيد جداً');
    expect(payload.student_id).toBe(studentId);
    expect(payload.trimester).toBe(1);
  });

  it('redirects the upsert to the existing cloud row for the same student+trimester', async () => {
    const baseline = baseState();
    const edited = { ...baseline, grades: [makeGrade({ continuousEval: 13 })] };
    await enqueueSyncDelta(ownerId, baseline, edited, 2, new Date().toISOString());
    const [entry] = (await listSyncOutbox(ownerId)).filter((item) => item.operations.some(op => op.entity === 'grade'));

    const { client, upserts } = makeRecordingClient({}, { grades: { id: cloudGradeId } });
    await applySyncOutboxEntry(client, ownerId, entry, 'device-phone');

    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload.id).toBe(cloudGradeId);
  });
});


describe('§4 durability on storage failure and concurrent edits', () => {
  it('keeps the previous durable grade when writing its replacement fails', async () => {
    const initial = baseState();
    const edited = { ...initial, grades: [makeGrade({ exam: 18 })] };
    await enqueueSyncDelta(ownerId, initial, edited, 2, new Date().toISOString());
    const previous = await listSyncOutbox(ownerId);
    idb.set.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await expect(enqueueSyncDelta(ownerId, edited, { ...edited, grades: [makeGrade({ exam: 19 })] }, 3, new Date().toISOString())).rejects.toThrow('QuotaExceededError');
    expect(await listSyncOutbox(ownerId)).toEqual(previous);
    expect(replayOutboxEntriesOnState(initial, previous).grades[0].exam).toBe(18);
  });

  it('serializes two overlapping writes and preserves only the latest grade', async () => {
    const initial = baseState();
    const a = { ...initial, grades: [makeGrade({ quiz: 18 })] };
    const b = { ...initial, grades: [makeGrade({ quiz: 19 })] };
    await Promise.all([
      enqueueSyncDelta(ownerId, initial, a, 2, '2026-10-14T12:00:00Z'),
      enqueueSyncDelta(ownerId, a, b, 3, '2026-10-14T12:00:01Z'),
    ]);
    const entries = await listSyncOutbox(ownerId);
    expect(entries).toHaveLength(1);
    expect(replayOutboxEntriesOnState(initial, entries).grades[0].quiz).toBe(19);
  });

  it('does not strip an unknown marks column to report false success', async () => {
    const initial = baseState();
    await enqueueSyncDelta(ownerId, initial, { ...initial, grades: [makeGrade({ exam: 18 })] }, 2, new Date().toISOString());
    const [entry] = await listSyncOutbox(ownerId);
    const error = { code: 'PGRST204', message: "Could not find the 'exam' column of 'grades' in the schema cache" };
    const { client, upserts } = makeRecordingClient({}, {}, error);
    await expect(applySyncOutboxEntry(client, ownerId, entry, 'phone')).rejects.toEqual(error);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload.exam).toBe(18);
    expect(await listSyncOutbox(ownerId)).toHaveLength(1);
  });

  it('rejects corrupt grade values instead of clamping them and acknowledging changed marks', async () => {
    const initial = baseState();
    for (const value of [21, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await enqueueSyncDelta(ownerId, initial, { ...initial, grades: [makeGrade({ exam: value })] }, 2, new Date().toISOString());
      const [entry] = await listSyncOutbox(ownerId);
      const { client, upserts } = makeRecordingClient({});
      await expect(applySyncOutboxEntry(client, ownerId, entry, 'phone')).rejects.toThrow('قيمة نقطة غير صالحة');
      expect(upserts).toHaveLength(0);
      expect(await listSyncOutbox(ownerId)).toHaveLength(1);
    }
  });

  it('round-trips zero and null as distinct marks', async () => {
    const initial = baseState();
    await enqueueSyncDelta(ownerId, initial, { ...initial, grades: [makeGrade({ quiz: 0, exam: null, continuousEval: 0 })] }, 2, new Date().toISOString());
    const [entry] = await listSyncOutbox(ownerId);
    const { client, upserts } = makeRecordingClient({});
    await applySyncOutboxEntry(client, ownerId, entry, 'phone');
    expect(upserts[0].payload.quiz).toBe(0);
    expect(upserts[0].payload.exam).toBeNull();
    expect(upserts[0].payload.continuous_eval).toBe(0);
  });
});

describe('§5 actual queue flush and immediate retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      localStorage: { getItem: () => 'device-test', setItem: () => undefined },
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('force-flushes despite backoff and deletes an entry only after full acknowledgement', async () => {
    const initial = baseState();
    await enqueueSyncDelta(ownerId, initial, { ...initial, grades: [makeGrade({ exam: 18 })] }, 2, new Date().toISOString());
    const [entry] = await listSyncOutbox(ownerId);
    for (const [key, value] of idb.values) {
      if ((value as { id?: string }).id === entry.id) idb.values.set(key, { ...entry, nextAttemptAt: '2099-01-01T00:00:00Z' });
    }
    const { client, upserts } = makeRecordingClient({});
    const syncing = { current: false };
    const controller = new AbortController();
    expect(await flushSyncOutbox(client, ownerId, syncing, vi.fn(), false, controller.signal)).toBe(false);
    expect(upserts).toHaveLength(0);
    expect(await flushSyncOutbox(client, ownerId, syncing, vi.fn(), true, controller.signal)).toBe(true);
    expect(upserts[0].payload.exam).toBe(18);
    expect(await listSyncOutbox(ownerId)).toHaveLength(0);
    controller.abort();
  });

  it('keeps failed grades visible in the outbox and reports failure', async () => {
    const initial = baseState();
    await enqueueSyncDelta(ownerId, initial, { ...initial, grades: [makeGrade({ exam: 18 })] }, 2, new Date().toISOString());
    const error = new Error('network timeout');
    const { client } = makeRecordingClient({}, {}, error);
    const onError = vi.fn();
    const controller = new AbortController();
    expect(await flushSyncOutbox(client, ownerId, { current: false }, onError, true, controller.signal)).toBe(false);
    expect(onError).toHaveBeenCalledWith(error);
    const entries = await listSyncOutbox(ownerId);
    expect(entries).toHaveLength(1);
    expect(entries[0].attempts).toBe(1);
    expect(replayOutboxEntriesOnState(initial, entries).grades[0].exam).toBe(18);
    controller.abort();
  });
  it('does not let an avatar upload failure block marks', async () => {
    const initial = baseState();
    await enqueueSyncDelta(ownerId, initial, { ...initial, grades: [makeGrade({ exam: 18 })] }, 2, new Date().toISOString());
    const spy = vi.spyOn(avatarStorage, 'flushAvatarOutbox').mockRejectedValueOnce(new Error('avatar upload failed'));
    const { client, upserts } = makeRecordingClient({});
    const controller = new AbortController();
    const result = await flushSyncOutbox(client, ownerId, { current: false }, vi.fn(), true, controller.signal);
    expect(upserts[0].payload.exam).toBe(18);
    expect(await listSyncOutbox(ownerId)).toHaveLength(0);
    expect(result).toBe(false); // all marks confirmed, but the file failure is still reported
    spy.mockRestore();
    controller.abort();
  });

  it('waits for an in-flight flush when the teacher presses sync now', async () => {
    const initial = baseState();
    await enqueueSyncDelta(ownerId, initial, { ...initial, grades: [makeGrade({ exam: 18 })] }, 2, new Date().toISOString());
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(avatarStorage, 'flushAvatarOutbox').mockImplementationOnce(() => gate);
    const { client, upserts } = makeRecordingClient({});
    const syncing = { current: false };
    const first = flushSyncOutbox(client, ownerId, syncing, vi.fn());
    const manual = flushSyncOutbox(client, ownerId, syncing, vi.fn(), true);
    release();
    expect(await first).toBe(true);
    expect(await manual).toBe(true);
    expect(upserts).toHaveLength(1);
    spy.mockRestore();
  });

});
