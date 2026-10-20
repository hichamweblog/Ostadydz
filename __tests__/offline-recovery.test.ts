import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression suite for the reported incident:
 *
 *   "I worked on the phone and documented many sessions. The app showed ~225 operations waiting
 *    to be uploaded. When I opened the app again the documentation was gone."
 *
 * Root causes, and the guarantee each test locks in:
 *
 *  1. A cloud row that is *stale* (its update is still queued) used to win over the local row
 *     because both share the same id — the documentation was replaced by the empty session that
 *     was still on the server.            → §1, §2
 *  2. The state cache was then overwritten with that stale cloud copy, so the only remaining
 *     copy of the work lived in the outbox and was invisible on screen.
 *                                      → §3 (`replayOutboxEntriesOnState`)
 *  3. One rejected entry froze the whole queue (head-of-line blocking), so nothing behind it was
 *     ever acknowledged.               → covered by the flush contract in §5
 *  4. The queue grew one entry per edit instead of one per record, which made every step slower.
 *                                      → §4 (`compactSyncOutbox` / supersede on enqueue)
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

import { getEmptyState } from '@/lib/storage';
import type { SessionRecord } from '@/lib/types';
import {
  reconcileEntityList,
  reconcileSessionMarks,
  type ReconciliationContext,
} from '@/lib/sync-reconcile';
import {
  compactSyncOutbox,
  enqueueSyncDelta,
  enqueueSyncOperations,
  listPendingRecordIds,
  listSyncOutbox,
  replayOutboxEntriesOnState,
  type SyncOutboxEntry,
} from '@/lib/sync-outbox';
import { applySyncOutboxEntry, loadCoreState, SyncConflictError } from '@/lib/supabase/core-sync';
import {
  CANCELLATION_REASON_PRESETS,
  SESSION_PART_NUMBERS,
  buildCancellationNote,
  buildSessionTitle,
  isSessionDocumented,
  normalizeSessionPart,
  readSessionPart,
} from '@/lib/session-flow';

const ownerId = 'owner-1';
const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const studentId = 'ssssssss-ssss-4sss-8sss-ssssssssssss';
const sessionId = '55555555-5555-4555-8555-555555555555';

const context = (overrides: Partial<ReconciliationContext> = {}): ReconciliationContext => ({
  cloudIdFor: (_entity, localId) => localId,
  pendingRecordIds: new Set<string>(),
  deletedRecordIds: [],
  tombstonedKeys: new Set<string>(),
  ...overrides,
});

function makeSession(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: sessionId,
    classId,
    date: '2026-10-12',
    startTime: '08:00',
    endTime: '09:00',
    sessionGoals: '',
    accomplishments: '',
    nextSteps: '',
    teacherNotes: '',
    attendance: {},
    ...partial,
  };
}

function makeClient(rows: Record<string, unknown[]> = {}, tombstone: unknown = null) {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: ownerId } } }) },
    rpc: async () => ({ data: classId, error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/f' }, error: null }) }) },
    from() {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        like: () => chain,
        limit: () => chain,
        in: () => chain,
        order: () => chain,
        then: (resolve: any) => Promise.resolve({ data: rows[chain.__table] ?? [], error: null }).then(resolve),
        maybeSingle: async () => ({ data: tombstone, error: null }),
        insert: async () => ({ data: null, error: null }),
        upsert: async () => ({ data: null, error: null }),
        delete: () => chain,
      };
      return chain;
    },
  };
  return new Proxy(client, {
    get(target, prop) {
      if (prop !== 'from') return target[prop as keyof typeof target];
      return (table: string) => {
        const chain = target.from();
        chain.__table = table;
        return chain;
      };
    },
  }) as any;
}

beforeEach(() => {
  idb.values.clear();
  vi.clearAllMocks();
});

describe('§1 a queued local edit beats a stale cloud row with the same id', () => {
  it('keeps the documented session instead of the empty cloud copy', () => {
    const staleCloud = makeSession({ accomplishments: '', notes: '' });
    const documented = makeSession({
      accomplishments: 'تم إنجاز عناصر الدرس المبرمجة',
      notes: 'تم إنجاز عناصر الدرس المبرمجة',
      customTopic: 'خصائص الشريعة (2)',
      partNumber: 2,
    });

    const merged = reconcileEntityList(
      'session',
      [staleCloud],
      [documented],
      context({ pendingRecordIds: new Set([`session:${sessionId}`]) }),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].accomplishments).toBe('تم إنجاز عناصر الدرس المبرمجة');
    expect(merged[0].customTopic).toBe('خصائص الشريعة (2)');
    expect(merged[0].partNumber).toBe(2);
  });

  it('keeps the cloud copy when nothing is queued for that record', () => {
    const cloud = makeSession({ accomplishments: 'النسخة السحابية' });
    const local = makeSession({ accomplishments: 'النسخة المحلية' });

    const merged = reconcileEntityList('session', [cloud], [local], context());

    expect(merged).toHaveLength(1);
    expect(merged[0].accomplishments).toBe('النسخة السحابية');
  });

  it('keeps the cloud copy when the server recorded the deletion', () => {
    const cloud = makeSession();
    const local = makeSession({ accomplishments: 'موثقة' });

    const merged = reconcileEntityList(
      'session',
      [cloud],
      [local],
      context({
        pendingRecordIds: new Set([`session:${sessionId}`]),
        tombstonedKeys: new Set([`session:${sessionId}`]),
      }),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].accomplishments).toBe('');
  });

  it('hides a cloud row the teacher deleted locally but the delete is still queued', () => {
    const cloud = makeSession();

    const merged = reconcileEntityList(
      'session',
      [cloud],
      [],
      context({ deletedRecordIds: [`session:${sessionId}`] }),
    );

    expect(merged).toEqual([]);
  });

  it('never lets a pending local row re-add a record the server says is deleted', () => {
    const merged = reconcileEntityList(
      'session',
      [],
      [makeSession()],
      context({
        pendingRecordIds: new Set([`session:${sessionId}`]),
        tombstonedKeys: new Set([`session:${sessionId}`]),
      }),
    );

    expect(merged).toEqual([]);
  });
});

describe('§2 a queued local row is recognised under its cloud id (natural keys)', () => {
  it('matches a session by class + date + start time', () => {
    const cloudId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const cloud = makeSession({ id: cloudId, accomplishments: '' });
    const local = makeSession({ id: 'local-session', accomplishments: 'موثقة دون اتصال' });

    const merged = reconcileEntityList(
      'session',
      [cloud],
      [local],
      context({ pendingRecordIds: new Set(['session:local-session']) }),
    );

    expect(merged).toHaveLength(1);
    // The cloud id is kept so the queued upsert reconciles onto the same row.
    expect(merged[0].id).toBe(cloudId);
    expect(merged[0].accomplishments).toBe('موثقة دون اتصال');
  });

  it('matches a grade by student + trimester', () => {
    const cloud = { id: 'cloud-grade', studentId, trimester: 1 as const, exam: null };
    const local = { id: 'local-grade', studentId, trimester: 1 as const, exam: 17 };

    const merged = reconcileEntityList(
      'grade',
      [cloud],
      [local],
      context({ pendingRecordIds: new Set(['grade:local-grade']) }),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].exam).toBe(17);
  });

  it('matches lesson progress by class + unit', () => {
    const cloud = { id: 'cloud-progress', classId, unitId: 'u1', status: 'NOT_STARTED' as const };
    const local = { id: 'local-progress', classId, unitId: 'u1', status: 'COMPLETED' as const };

    const merged = reconcileEntityList(
      'lessonProgress',
      [cloud],
      [local],
      context({ pendingRecordIds: new Set(['lessonProgress:local-progress']) }),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('COMPLETED');
  });

  it('keeps cloud relational marks while overriding only the queued ones', () => {
    const remoteSession = makeSession();
    const localSession = makeSession({ attendance: { [studentId]: 'ABSENT' } });

    reconcileSessionMarks(
      [remoteSession],
      new Map([[remoteSession.id, localSession]]),
      [{ session_id: sessionId, student_id: 'other-student', status: 'present' }],
      [],
      context({ pendingRecordIds: new Set([`attendance:${sessionId}:${studentId}`]) }),
    );

    expect(remoteSession.attendance).toEqual({
      [studentId]: 'ABSENT',
      'other-student': 'PRESENT',
    });
  });

  it('drops a cloud attendance row whose deletion is still queued', () => {
    const remoteSession = makeSession();

    reconcileSessionMarks(
      [remoteSession],
      new Map(),
      [{ session_id: sessionId, student_id: studentId, status: 'absent' }],
      [],
      context({ deletedRecordIds: [`attendance:${sessionId}:${studentId}`] }),
    );

    expect(remoteSession.attendance).toEqual({});
  });
});

describe('§3 the outbox can rebuild the workspace on its own', () => {
  const entry = (revision: number, operations: SyncOutboxEntry['operations']): SyncOutboxEntry => ({
    id: `${ownerId}:device:${revision}:2026-10-12T08:00:0${revision}.000Z`,
    ownerId,
    revision,
    updatedAt: `2026-10-12T08:00:0${revision}.000Z`,
    createdAt: `2026-10-12T08:00:0${revision}.000Z`,
    operations,
  });

  it('restores documented sessions into an empty state', () => {
    const replayed = replayOutboxEntriesOnState(getEmptyState(), [
      entry(3, [
        {
          id: `session:${sessionId}`,
          entity: 'session',
          action: 'upsert',
          recordId: sessionId,
          payload: makeSession({ accomplishments: 'تم إنجاز الدرس', customTopic: 'الوحدة (1)' }),
        },
        {
          id: `attendance:${sessionId}:${studentId}`,
          entity: 'attendance',
          action: 'upsert',
          recordId: `${sessionId}:${studentId}`,
          payload: { id: `${sessionId}:${studentId}`, sessionId, studentId, status: 'ABSENT' },
        },
      ]),
    ]);

    expect(replayed.sessions).toHaveLength(1);
    expect(replayed.sessions[0].accomplishments).toBe('تم إنجاز الدرس');
    expect(replayed.sessions[0].attendance).toEqual({ [studentId]: 'ABSENT' });
  });

  it('applies the newest payload when the same record is queued twice', () => {
    const replayed = replayOutboxEntriesOnState(getEmptyState(), [
      entry(1, [{ id: `session:${sessionId}`, entity: 'session', action: 'upsert', recordId: sessionId, payload: makeSession({ accomplishments: 'الأولى' }) }]),
      entry(2, [{ id: `session:${sessionId}`, entity: 'session', action: 'upsert', recordId: sessionId, payload: makeSession({ accomplishments: 'الثانية' }) }]),
    ]);

    expect(replayed.sessions).toHaveLength(1);
    expect(replayed.sessions[0].accomplishments).toBe('الثانية');
  });

  it('applies queued deletions, including relational marks', () => {
    const base = {
      ...getEmptyState(),
      classes: [{ id: classId, name: 'قسم', level: '3AS' as const, stream: '' }],
      students: [{ id: studentId, classId, fullName: 'تلميذ', numberInList: 1 }],
      sessions: [makeSession({ attendance: { [studentId]: 'ABSENT' as const }, disruptions: [studentId] })],
    };

    const replayed = replayOutboxEntriesOnState(base, [
      entry(4, [
        { id: `attendance:${sessionId}:${studentId}`, entity: 'attendance', action: 'delete', recordId: `${sessionId}:${studentId}` },
        { id: `behavior:${sessionId}:${studentId}:disruptions`, entity: 'behavior', action: 'delete', recordId: `${sessionId}:${studentId}:disruptions` },
        { id: `delete:student:${studentId}`, entity: 'student', action: 'delete', recordId: studentId },
      ]),
    ]);

    expect(replayed.students).toHaveLength(0);
    expect(replayed.sessions[0].attendance).toEqual({});
    expect(replayed.sessions[0].disruptions).toEqual([]);
  });

  it('does not resurrect a record the server tombstoned', () => {
    const replayed = replayOutboxEntriesOnState(
      getEmptyState(),
      [entry(5, [{ id: `session:${sessionId}`, entity: 'session', action: 'upsert', recordId: sessionId, payload: makeSession() }])],
      new Set([`session:${sessionId}`]),
    );

    expect(replayed.sessions).toHaveLength(0);
  });

  it('restores profile and settings operations', () => {
    const replayed = replayOutboxEntriesOnState(getEmptyState(), [
      entry(6, [
        { id: 'profile:profile', entity: 'profile', action: 'upsert', recordId: 'profile', payload: { name: 'أحمد', schoolName: 'ثانوية' } },
        { id: 'settings:settings', entity: 'settings', action: 'upsert', recordId: 'settings', payload: { activeTrimester: 3 } },
      ]),
    ]);

    expect(replayed.profile.name).toBe('أحمد');
    expect(replayed.profile.schoolName).toBe('ثانوية');
    expect(replayed.activeTrimester).toBe(3);
  });

  it('loadCoreState replays the queue over the cloud snapshot', async () => {
    const documented = makeSession({ accomplishments: 'موثقة على الهاتف' });
    await enqueueSyncDelta(
      ownerId,
      { ...getEmptyState(), classes: [{ id: classId, name: 'قسم', level: '3AS' as const, stream: '' }], sessions: [makeSession()] },
      { ...getEmptyState(), classes: [{ id: classId, name: 'قسم', level: '3AS' as const, stream: '' }], sessions: [documented] },
      8,
      '2026-10-12T09:00:00.000Z',
    );
    const entries = await listSyncOutbox(ownerId);
    const pending = await listPendingRecordIds(ownerId);

    const loaded = await loadCoreState(
      makeClient({
        classes: [{ id: classId, name: 'قسم', level: '3AS', section: '', sync_revision: 2 }],
        // The server still holds the *undocumented* session: its update never arrived.
        sessions: [{
          id: sessionId,
          class_id: classId,
          session_date: '2026-10-12',
          start_time: '08:00:00',
          end_time: '09:00:00',
          teacher_notes: JSON.stringify(makeSession()),
          sync_revision: 2,
        }],
      }),
      getEmptyState(),
      { pendingRecordIds: pending, outboxEntries: entries },
    );

    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].accomplishments).toBe('موثقة على الهاتف');
  });

  it('never replays a child record whose class is gone from the workspace', async () => {
    await enqueueSyncOperations(ownerId, [
      {
        id: `session:${sessionId}`,
        entity: 'session',
        action: 'upsert',
        recordId: sessionId,
        payload: makeSession({ classId: 'deleted-class', accomplishments: 'يتيمة' }),
      },
    ], 4, '2026-10-12T09:30:00.000Z');

    const loaded = await loadCoreState(makeClient({}), getEmptyState(), {
      pendingRecordIds: await listPendingRecordIds(ownerId),
      outboxEntries: await listSyncOutbox(ownerId),
    });

    expect(loaded.classes).toHaveLength(0);
    expect(loaded.sessions).toHaveLength(0);
  });
});

describe('§4 the queue stays one entry per record, not one per edit', () => {
  it('supersedes an older queued operation for the same record', async () => {
    await enqueueSyncOperations(ownerId, [
      { id: `session:${sessionId}`, entity: 'session', action: 'upsert', recordId: sessionId, payload: makeSession({ accomplishments: 'الأولى' }) },
    ], 1, '2026-10-12T08:00:00.000Z');
    await enqueueSyncOperations(ownerId, [
      { id: `session:${sessionId}`, entity: 'session', action: 'upsert', recordId: sessionId, payload: makeSession({ accomplishments: 'الثانية' }) },
    ], 2, '2026-10-12T08:05:00.000Z');

    const entries = await listSyncOutbox(ownerId);
    expect(entries).toHaveLength(1);
    expect(entries[0].revision).toBe(2);
    expect((entries[0].operations[0].payload as SessionRecord).accomplishments).toBe('الثانية');
  });

  it('keeps operations for different records in their own entries', async () => {
    await enqueueSyncOperations(ownerId, [
      { id: `session:${sessionId}`, entity: 'session', action: 'upsert', recordId: sessionId, payload: makeSession() },
    ], 1, '2026-10-12T08:00:00.000Z');
    await enqueueSyncOperations(ownerId, [
      { id: `grade:g1`, entity: 'grade', action: 'upsert', recordId: 'g1', payload: { id: 'g1', studentId, classId, trimester: 1 } },
    ], 2, '2026-10-12T08:05:00.000Z');

    expect(await listSyncOutbox(ownerId)).toHaveLength(2);
  });

  it('compacts a long queue down to the newest operation per record', async () => {
    for (let revision = 1; revision <= 20; revision++) {
      await enqueueSyncOperations(
        ownerId,
        [
          { id: `session:${sessionId}`, entity: 'session', action: 'upsert', recordId: sessionId, payload: makeSession({ accomplishments: `مراجعة ${revision}` }) },
          { id: `grade:g${revision % 3}`, entity: 'grade', action: 'upsert', recordId: `g${revision % 3}`, payload: { id: `g${revision % 3}`, studentId, classId, trimester: 1 } },
        ],
        revision * 100,
        `2026-10-12T08:00:${String(revision).padStart(2, '0')}.000Z`,
      );
    }

    // Enqueue-time superseding already keeps this small; compaction makes it exact.
    const compacted = await compactSyncOutbox(ownerId);
    const recordKeys = compacted.flatMap((entry) => entry.operations.map((op) => `${op.entity}:${op.recordId}`));

    expect(new Set(recordKeys).size).toBe(recordKeys.length);
    expect(recordKeys).toContain(`session:${sessionId}`);
    const sessionOp = compacted.flatMap((e) => e.operations).find((op) => op.entity === 'session');
    expect((sessionOp?.payload as SessionRecord).accomplishments).toBe('مراجعة 20');
  });

  it('drops entries left empty by compaction', async () => {
    idb.values.set(`sanad:sync-outbox:${ownerId}:device:1:2026-10-12T08:00:00.000Z`, {
      id: `${ownerId}:device:1:2026-10-12T08:00:00.000Z`,
      ownerId,
      revision: 1,
      updatedAt: '2026-10-12T08:00:00.000Z',
      createdAt: '2026-10-12T08:00:00.000Z',
      operations: [],
    } satisfies SyncOutboxEntry);

    expect(await compactSyncOutbox(ownerId)).toEqual([]);
    expect(await listSyncOutbox(ownerId)).toEqual([]);
  });
});

describe('§5 a blocked entry never freezes the rest of the queue', () => {
  it('reports every distinct failure while still draining the entries that can be applied', async () => {
    // The flush itself lives in the hook (browser-only), so the contract is asserted on the
    // queue primitives it relies on: entries are independent, each carries its own attempt
    // counter, and a failure only marks *that* entry.
    const { markSyncOutboxFailure } = await import('@/lib/sync-outbox');

    await enqueueSyncOperations(ownerId, [
      { id: `session:${sessionId}`, entity: 'session', action: 'upsert', recordId: sessionId, payload: makeSession() },
    ], 5, '2026-10-12T08:00:00.000Z');
    await enqueueSyncOperations(ownerId, [
      { id: 'grade:g1', entity: 'grade', action: 'upsert', recordId: 'g1', payload: { id: 'g1', studentId, classId, trimester: 1 } },
    ], 6, '2026-10-12T08:05:00.000Z');

    const entries = await listSyncOutbox(ownerId);
    await markSyncOutboxFailure(entries[0].id, new Error('conflict'));

    const after = await listSyncOutbox(ownerId);
    expect(after).toHaveLength(2);
    expect(after[0].attempts).toBe(1);
    expect(after[0].lastError).toBe('conflict');
    // The healthy entry is untouched and still eligible for the next flush pass.
    expect(after[1].attempts).toBe(0);
  });
});

describe('§6 دفتر النصوص: five parts per unit and cancelled sessions', () => {
  it('offers up to five parts of a unit', () => {
    expect([...SESSION_PART_NUMBERS]).toEqual([1, 2, 3, 4, 5]);
  });

  it('offers the usual cancellation reasons', () => {
    expect(CANCELLATION_REASON_PRESETS).toContain('الغياب');
    expect(CANCELLATION_REASON_PRESETS.some((reason) => reason.includes('اجتماع'))).toBe(true);
    expect(CANCELLATION_REASON_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it('clamps a part number into the supported range', () => {
    expect(normalizeSessionPart(0)).toBe(1);
    expect(normalizeSessionPart(5)).toBe(5);
    expect(normalizeSessionPart(9)).toBe(5);
    expect(normalizeSessionPart(undefined)).toBe(1);
    expect(normalizeSessionPart(Number.NaN)).toBe(1);
  });

  it('reads the part number back from the explicit field, then from the title suffix', () => {
    expect(readSessionPart(makeSession({ partNumber: 4 }))).toBe(4);
    expect(readSessionPart(makeSession({ customTopic: 'خصائص الشريعة (3)' }))).toBe(3);
    expect(readSessionPart(makeSession({ customTopic: 'خصائص الشريعة (9)' }))).toBe(5);
    expect(readSessionPart(makeSession())).toBe(1);
  });

  it('titles a normal and a cancelled session differently', () => {
    expect(buildSessionTitle('خصائص الشريعة', 2, { cancelled: false })).toBe('خصائص الشريعة (2)');
    expect(buildSessionTitle(undefined, 1, { cancelled: false })).toBe('حصة تعليمية (1)');
    expect(buildSessionTitle('خصائص الشريعة', 2, { cancelled: true, reason: 'اجتماع' }))
      .toBe('حصة ملغاة (اجتماع) — خصائص الشريعة');
    expect(buildSessionTitle(undefined, 2, { cancelled: true })).toContain('حصة ملغاة');
  });

  it('records the cancellation reason in the documentation field', () => {
    expect(buildCancellationNote('الغياب')).toBe('حصة ملغاة بسبب: الغياب');
    expect(buildCancellationNote('', 'ملاحظة إضافية')).toContain('حصة ملغاة بسبب');
    expect(buildCancellationNote('الغياب', 'ملاحظة إضافية')).toContain('ملاحظة إضافية');
  });

  it('counts a cancelled session as documented so it is never reported as pending', () => {
    expect(isSessionDocumented(makeSession({ sessionStatus: 'CANCELLED', cancellationReason: 'اجتماع' }))).toBe(true);
    expect(isSessionDocumented(makeSession({ accomplishments: 'تم الإنجاز' }))).toBe(true);
    expect(isSessionDocumented(makeSession())).toBe(false);
  });

  it('carries the cancellation and the part number through the sync payload', () => {
    const cancelled = makeSession({
      sessionStatus: 'CANCELLED',
      cancellationReason: 'اجتماع بيداغوجي',
      customTopic: 'حصة ملغاة (اجتماع بيداغوجي)',
      accomplishments: 'حصة ملغاة بسبب: اجتماع بيداغوجي',
    });

    const merged = reconcileEntityList(
      'session',
      [makeSession()],
      [cancelled],
      context({ pendingRecordIds: new Set([`session:${sessionId}`]) }),
    );

    expect(merged[0].sessionStatus).toBe('CANCELLED');
    expect(merged[0].cancellationReason).toBe('اجتماع بيداغوجي');
  });

  it('round-trips the new fields through the session row encoding', async () => {
    const documented = makeSession({
      partNumber: 5,
      sessionStatus: 'CANCELLED',
      cancellationReason: 'ندوة تربوية',
    });
    await enqueueSyncDelta(
      ownerId,
      { ...getEmptyState(), sessions: [] },
      { ...getEmptyState(), classes: [{ id: classId, name: 'قسم', level: '3AS' as const, stream: '' }], sessions: [documented] },
      9,
      '2026-10-12T10:00:00.000Z',
    );

    const entries = await listSyncOutbox(ownerId);
    const loaded = await loadCoreState(
      makeClient({ classes: [{ id: classId, name: 'قسم', level: '3AS', section: '', sync_revision: 1 }] }),
      getEmptyState(),
      { pendingRecordIds: await listPendingRecordIds(ownerId), outboxEntries: entries },
    );

    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].partNumber).toBe(5);
    expect(loaded.sessions[0].sessionStatus).toBe('CANCELLED');
    expect(loaded.sessions[0].cancellationReason).toBe('ندوة تربوية');
  });
});

describe('§7 a preference or a missing column cannot freeze the queue', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';

  function writeClient(options: {
    existing?: Record<string, unknown> | null;
    failTimes?: number;
    failure?: { code: string; message: string };
  } = {}) {
    const calls: Array<{ table: string; method: string; value?: unknown }> = [];
    let failuresLeft = options.failTimes ?? 0;
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
            return { data: null, error: null };
          },
          upsert: async (value: unknown) => {
            calls.push({ table, method: 'upsert', value });
            if (failuresLeft > 0) {
              failuresLeft -= 1;
              return { data: null, error: options.failure ?? null };
            }
            return { data: null, error: null };
          },
          delete: () => {
            calls.push({ table, method: 'delete' });
            return chain;
          },
        };
        return chain;
      },
    };
    return { client: client as any, calls };
  }

  const settingsEntry: SyncOutboxEntry = {
    id: 'entry-settings',
    ownerId,
    revision: 5,
    updatedAt: '2026-10-12T10:00:00.000Z',
    createdAt: '2026-10-12T10:00:00.000Z',
    operations: [{
      id: 'settings:settings',
      entity: 'settings',
      action: 'upsert',
      recordId: 'settings',
      payload: { activeClassId: classId, activeTrimester: 2, lastWorkspace: { route: 'sessions' } },
    }],
  };

  it('merges a UI preference instead of raising a conflict that blocks the queue', async () => {
    const { client, calls } = writeClient({
      existing: {
        sync_revision: 99,
        sync_device_id: 'device-laptop',
        settings: { activeTrimester: 1, dashboardStyle: 'executive' },
      },
    });

    await expect(applySyncOutboxEntry(client, ownerId, settingsEntry, 'device-phone')).resolves.toBeUndefined();

    const written = calls.find((call) => call.table === 'app_settings' && call.method === 'upsert');
    expect(written).toBeDefined();
    expect(calls.some((call) => call.table === 'sync_conflicts')).toBe(false);
    const value = written?.value as { settings: Record<string, unknown>; sync_revision: number };
    // The stored preference the phone never touched survives; the queued ones win.
    expect(value.settings).toMatchObject({
      activeClassId: classId,
      activeTrimester: 2,
      dashboardStyle: 'executive',
      lastWorkspace: { route: 'sessions' },
    });
    // The clock moves forward instead of being rejected as stale.
    expect(value.sync_revision).toBe(99);
  });

  it('still refuses a stale write on a pedagogical record', async () => {
    const { client, calls } = writeClient({
      existing: { sync_revision: 99, sync_device_id: 'device-laptop', updated_by: 'device-laptop' },
    });
    const sessionEntry: SyncOutboxEntry = {
      ...settingsEntry,
      id: 'entry-session',
      operations: [{
        id: `session:${sessionId}`,
        entity: 'session',
        action: 'upsert',
        recordId: sessionId,
        payload: makeSession({ accomplishments: 'موثقة' }),
      }],
    };

    await expect(applySyncOutboxEntry(client, ownerId, sessionEntry, 'device-phone'))
      .rejects.toBeInstanceOf(SyncConflictError);
    expect(calls.some((call) => call.table === 'sessions' && call.method === 'upsert')).toBe(false);
  });

  it('retries a write without a column the deployed schema does not have yet', async () => {
    const { client, calls } = writeClient({
      failTimes: 1,
      failure: {
        code: 'PGRST204',
        message: "could not find the 'summary' column of 'sessions' in the schema cache",
      },
    });
    const sessionEntry: SyncOutboxEntry = {
      ...settingsEntry,
      id: 'entry-session-column',
      operations: [{
        id: `session:${sessionId}`,
        entity: 'session',
        action: 'upsert',
        recordId: sessionId,
        payload: makeSession({ accomplishments: 'موثقة', summary: 'ملخص' }),
      }],
    };

    await expect(applySyncOutboxEntry(client, ownerId, sessionEntry, 'device-phone')).resolves.toBeUndefined();

    const upserts = calls.filter((call) => call.table === 'sessions' && call.method === 'upsert');
    expect(upserts).toHaveLength(2);
    expect((upserts[0].value as Record<string, unknown>).summary).toBe('ملخص');
    expect((upserts[1].value as Record<string, unknown>)).not.toHaveProperty('summary');
    // The record itself is still written, so the queue keeps moving.
    expect((upserts[1].value as Record<string, unknown>).teacher_notes).toContain('موثقة');
  });
});
