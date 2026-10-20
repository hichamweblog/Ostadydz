import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase-1 data-safety contract:
 *   Postgres is the source of truth; IndexedDB is a cache plus a queue of *unsynced*
 *   operations; a deletion is absolute unless the user explicitly restores it.
 *
 * These tests exercise the real modules (core-sync, sync-outbox, state-cache, the local
 * purge) against mocked Supabase/IndexedDB boundaries.
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
import {
  applySyncOutboxEntry,
  loadCoreState,
  SyncConflictError,
} from '@/lib/supabase/core-sync';
import {
  enqueueSyncDelta,
  enqueueSyncOperations,
  listPendingRecordIds,
  listSyncOutbox,
  clearSyncOutbox,
  type SyncOutboxEntry,
} from '@/lib/sync-outbox';
import { saveAppStateCache, loadAppStateCache } from '@/lib/state-cache';
import { purgeLocalUserData } from '@/lib/local-user-data';
import {
  enqueueMemorandaDelete,
  enqueueMemorandaUpload,
  listMemorandaOutbox,
} from '@/lib/supabase/memoranda-outbox';
import { binaryKeyForPdf, saveBinaryFile, loadBinaryFile, loadPdfBinary } from '@/lib/binary-storage';

const ownerId = 'owner-1';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const otherClassId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface RecordedCall {
  table: string;
  method: string;
  value?: unknown;
}

function makeClient(options: {
  rows?: Record<string, unknown[]>;
  tombstone?: { revision: number; device_id: string | null } | null;
  existing?: Record<string, unknown> | null;
  calls?: RecordedCall[];
} = {}) {
  const calls = options.calls ?? [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: ownerId } } }) },
    rpc: async () => ({ data: workspaceId, error: null }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/x' }, error: null }),
      }),
    },
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        like: () => chain,
        limit: () => chain,
        in: () => chain,
        order: () => chain,
        then: (resolve: any) => Promise.resolve({ data: options.rows?.[table] ?? [], error: null }).then(resolve),
        maybeSingle: async () => {
          if (table === 'sync_operations') return { data: null, error: null };
          if (table === 'sync_tombstones') return { data: options.tombstone ?? null, error: null };
          if (table === 'sync_conflicts') return { data: null, error: null };
          return { data: options.existing ?? null, error: null };
        },
        insert: async (value: unknown) => {
          calls.push({ table, method: 'insert', value });
          return { data: null, error: null };
        },
        upsert: async (value: unknown) => {
          calls.push({ table, method: 'upsert', value });
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

beforeEach(() => {
  idb.values.clear();
  vi.clearAllMocks();
});

describe('§1 remote empty + stale cache => cache is dropped (delete wins)', () => {
  it('does not resurrect a class the server no longer has', async () => {
    const staleCache = {
      ...getEmptyState(),
      classes: [{ id: 'c1', name: '3 ع ت 1', level: '3AS' as const, stream: 'علوم تجريبية' }],
      students: [{ id: 's1', classId: 'c1', fullName: 'تلميذ 1', numberInList: 1 }],
    };

    const { client } = makeClient({ rows: {} });
    const loaded = await loadCoreState(client, staleCache);

    expect(loaded.classes).toHaveLength(0);
    expect(loaded.students).toHaveLength(0);
  });

  it('keeps them only when the outbox still holds unsynced work', async () => {
    const staleCache = {
      ...getEmptyState(),
      classes: [{ id: 'c1', name: '3 ع ت 1', level: '3AS' as const, stream: 'علوم تجريبية' }],
    };
    const { client } = makeClient({ rows: {} });

    const loaded = await loadCoreState(client, staleCache, { pendingRecordIds: new Set(['class:c1']) });
    expect(loaded.classes).toHaveLength(1);
  });
});

describe('§2 delete on device A never survives on device B', () => {
  it('drops a cached class whose server tombstone exists', async () => {
    const staleCache = {
      ...getEmptyState(),
      classes: [
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'قسم أ', level: '3AS' as const, stream: '' },
        { id: otherClassId, name: 'قسم ب', level: '3AS' as const, stream: '' },
      ],
    };
    const { client } = makeClient({
      rows: {
        classes: [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'قسم أ', level: '3AS', section: '', sync_revision: 10 },
        ],
        sync_tombstones: [{ entity_type: 'class', entity_id: otherClassId }],
      },
      tombstone: { revision: 12, device_id: 'device-A' },
    });

    const loaded = await loadCoreState(client, staleCache);
    expect(loaded.classes.map((c) => c.id)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
  });

  it('rejects an edit of a record deleted on another device and preserves the tombstone', async () => {
    const { client, calls } = makeClient({ tombstone: { revision: 5, device_id: 'device-A' } });
    const entry: SyncOutboxEntry = {
      id: 'entry-1',
      ownerId,
      revision: 9,
      updatedAt: '2026-09-24T10:00:00.000Z',
      createdAt: '2026-09-24T10:00:00.000Z',
      operations: [
        {
          id: `class:${otherClassId}`,
          entity: 'class',
          action: 'upsert',
          recordId: otherClassId,
          payload: { id: otherClassId, name: 'قسم محذوف', level: '3AS', stream: '' },
        },
      ],
    };

    await expect(applySyncOutboxEntry(client, ownerId, entry, 'device-B')).rejects.toBeInstanceOf(SyncConflictError);

    const upserts = calls.filter((call) => call.table === 'classes' && call.method === 'upsert');
    const tombstoneDeletes = calls.filter((call) => call.table === 'sync_tombstones' && call.method === 'delete');
    expect(upserts).toHaveLength(0);
    expect(tombstoneDeletes).toHaveLength(0);
  });

  it('allows a tombstone override only when the user decided to keep the local version', async () => {
    const { client, calls } = makeClient({ tombstone: { revision: 5, device_id: 'device-A' } });
    const entry: SyncOutboxEntry = {
      id: 'entry-2',
      ownerId,
      revision: 9,
      updatedAt: '2026-09-24T10:00:00.000Z',
      createdAt: '2026-09-24T10:00:00.000Z',
      allowTombstoneOverride: true,
      operations: [
        {
          id: `class:${otherClassId}`,
          entity: 'class',
          action: 'upsert',
          recordId: otherClassId,
          payload: { id: otherClassId, name: 'قسم مستعاد', level: '3AS', stream: '' },
        },
      ],
    };

    await applySyncOutboxEntry(client, ownerId, entry, 'device-B');
    expect(calls.some((call) => call.table === 'classes' && call.method === 'upsert')).toBe(true);
  });

  it('never re-labels an existing tombstone as written by this device', async () => {
    const { client, calls } = makeClient({ tombstone: { revision: 4, device_id: 'device-A' } });
    const entry: SyncOutboxEntry = {
      id: 'entry-3',
      ownerId,
      revision: 7,
      updatedAt: '2026-09-24T10:00:00.000Z',
      createdAt: '2026-09-24T10:00:00.000Z',
      operations: [
        { id: `delete:class:${otherClassId}`, entity: 'class', action: 'delete', recordId: otherClassId },
      ],
    };

    await applySyncOutboxEntry(client, ownerId, entry, 'device-B');
    const tombstoneUpsert = calls.find((call) => call.table === 'sync_tombstones' && call.method === 'upsert');
    expect(tombstoneUpsert?.value).toMatchObject({ device_id: 'device-A', revision: 7 });
  });
});

describe('§3 logout keeps unsynced work and purges only this account', () => {
  it('reports the pending operations that a sign-out would drop', async () => {
    const state = {
      ...getEmptyState(),
      classes: [{ id: 'c1', name: 'قسم أ', level: '3AS' as const, stream: '' }],
    };
    // Ids are deterministic: offline work keeps its record ids until it is acknowledged.
    expect(state.classes[0].id).toBe('c1');

    await enqueueSyncOperations(ownerId, [
      { id: 'class:c1', entity: 'class', action: 'upsert', recordId: 'c1', payload: state.classes[0] },
    ], 3, '2026-09-24T10:00:00.000Z');

    const pending = await listPendingRecordIds(ownerId);
    expect(pending.has('class:c1')).toBe(true);
    expect((await listSyncOutbox(ownerId))).toHaveLength(1);
  });

  it('purges the cache, PDF binaries and queues of the signed-out owner only', async () => {
    const originalWindow = globalThis.window;
    const storage = new Map<string, string>();
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    } as any;
    try {
      await saveAppStateCache({ ...getEmptyState(), classes: [{ id: 'c1', name: 'قسم أ', level: '3AS' as const, stream: '' }] }, ownerId);
      await saveBinaryFile(binaryKeyForPdf('1as-arts-u01', ownerId), 'data:application/pdf;base64,AAAA');
      await saveBinaryFile(binaryKeyForPdf('1as-arts-u01', 'owner-2'), 'data:application/pdf;base64,BBBB');
      await enqueueMemorandaUpload(ownerId, '1as-arts-u01', new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' }));
      await enqueueMemorandaDelete('owner-2', 'users/owner-2/x/current.pdf');
      await enqueueSyncDelta(ownerId, getEmptyState(), { ...getEmptyState(), classes: [{ id: 'c1', name: 'قسم أ', level: '3AS' as const, stream: '' }] }, 2, '2026-09-24T10:00:00.000Z');

      await purgeLocalUserData(ownerId);

      expect(await loadAppStateCache(ownerId)).toBeNull();
      expect(await loadBinaryFile(binaryKeyForPdf('1as-arts-u01', ownerId))).toBeUndefined();
      expect(await listSyncOutbox(ownerId)).toHaveLength(0);
      expect(await listMemorandaOutbox(ownerId)).toHaveLength(0);

      // Another account's data on the same device is untouched by this purge.
      expect(await loadBinaryFile(binaryKeyForPdf('1as-arts-u01', 'owner-2'))).toBeDefined();
      expect(await listMemorandaOutbox('owner-2')).toHaveLength(1);
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('never flushes another account queued memoranda upload', async () => {
    await enqueueMemorandaUpload('owner-2', '1as-arts-u01', new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' }));

    expect(await listMemorandaOutbox(ownerId)).toHaveLength(0);
    expect(await listMemorandaOutbox('owner-2')).toHaveLength(1);
  });
});

describe('§4 clear browser data: the cloud restores everything', () => {
  it('rebuilds the workspace from Postgres with an empty local cache', async () => {
    const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const studentId = 'ssssssss-ssss-4sss-8sss-ssssssssssss';
    const { client } = makeClient({
      rows: {
        classes: [{ id: classId, name: 'قسم أ', level: '3AS', section: 'علوم', color: '#123456', sync_revision: 7 }],
        students: [{ id: studentId, class_id: classId, full_name: 'تلميذ 1', number_in_list: 1, gender: 'male', sync_revision: 7 }],
        grades: [{ id: 'g1', student_id: studentId, class_id: classId, trimester: 1, continuous_eval: 15, quiz: 12, exam: 14, sync_revision: 7 }],
        app_settings: [{ settings: { activeClassId: classId, activeTrimester: 2 }, sync_revision: 7 }],
      },
    });

    const loaded = await loadCoreState(client, getEmptyState());

    expect(loaded.classes).toHaveLength(1);
    expect(loaded.students).toHaveLength(1);
    expect(loaded.grades).toHaveLength(1);
    expect(loaded.activeClassId).toBe(classId);
    expect(loaded.activeTrimester).toBe(2);
    expect(loaded.cloudRevision).toBe(7);
  });

  it('keeps the local PDF reference while merging cloud memoranda metadata', async () => {
    const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const localState = {
      ...getEmptyState(),
      unitPdfFiles: { '1as-arts-u01': { fileName: 'محلي.pdf', fileStorageKey: binaryKeyForPdf('1as-arts-u01', ownerId), uploadedAt: '2026-09-01' } },
    };
    const { client } = makeClient({
      rows: {
        classes: [{ id: classId, name: 'قسم أ', level: '3AS', section: '', sync_revision: 1 }],
        memoranda_files: [{ unit_key: '1as-arts-u01', file_name: 'سحابي.pdf', storage_path: 'users/owner-1/u/current.pdf', is_bundled: false, updated_at: '2026-09-10T00:00:00.000Z' }],
      },
    });

    const loaded = await loadCoreState(client, localState);
    expect(loaded.unitPdfFiles?.['1as-arts-u01']).toMatchObject({
      fileName: 'سحابي.pdf',
      cloudStoragePath: 'users/owner-1/u/current.pdf',
      fileStorageKey: binaryKeyForPdf('1as-arts-u01', ownerId),
    });
  });

  it('drops a local attachment whose binary is no longer on the device', async () => {
    const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const localState = {
      ...getEmptyState(),
      unitPdfFiles: { '1as-arts-u01': { fileName: 'يتيم.pdf', uploadedAt: '2026-09-01' } },
    };
    const { client } = makeClient({ rows: { classes: [{ id: classId, name: 'قسم أ', level: '3AS', section: '', sync_revision: 1 }] } });

    const loaded = await loadCoreState(client, localState);
    expect(loaded.unitPdfFiles?.['1as-arts-u01']).toBeUndefined();
  });
});

describe('§5 local PDF binaries are owner-scoped', () => {
  it('migrates a legacy unscoped entry to the owner-scoped key on first read', async () => {
    await saveBinaryFile('sanad:pdf:1as-arts-u01', 'data:application/pdf;base64,LEGACY');

    const value = await loadPdfBinary('1as-arts-u01', ownerId);

    expect(value).toBe('data:application/pdf;base64,LEGACY');
    expect(await loadBinaryFile('sanad:pdf:1as-arts-u01')).toBeUndefined();
    expect(await loadBinaryFile(binaryKeyForPdf('1as-arts-u01', ownerId))).toBe('data:application/pdf;base64,LEGACY');
  });

  it('keeps two teachers PDFs for the same unit separate', async () => {
    await saveBinaryFile(binaryKeyForPdf('1as-arts-u01', 'owner-1'), 'data:application/pdf;base64,AAA');
    await saveBinaryFile(binaryKeyForPdf('1as-arts-u01', 'owner-2'), 'data:application/pdf;base64,BBB');

    expect(await loadPdfBinary('1as-arts-u01', 'owner-1')).toBe('data:application/pdf;base64,AAA');
    expect(await loadPdfBinary('1as-arts-u01', 'owner-2')).toBe('data:application/pdf;base64,BBB');
  });
});

describe('§6 delete storm: relational records follow their class', () => {
  it('clears sessions, attendance and behaviours dropped from the cloud', async () => {
    const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const sessionId = '55555555-5555-4555-8555-555555555555';
    const studentId = 'ssssssss-ssss-4sss-8sss-ssssssssssss';
    const localState = {
      ...getEmptyState(),
      classes: [{ id: classId, name: 'قسم أ', level: '3AS' as const, stream: '' }],
      students: [{ id: studentId, classId, fullName: 'تلميذ 1', numberInList: 1 }],
      sessions: [{
        id: sessionId,
        classId,
        date: '2026-09-23',
        startTime: '08:00',
        endTime: '09:00',
        sessionGoals: '',
        accomplishments: '',
        nextSteps: '',
        teacherNotes: '',
        attendance: { [studentId]: 'ABSENT' as const },
        disruptions: [studentId],
      }],
    };
    const { client } = makeClient({
      rows: {
        classes: [{ id: classId, name: 'قسم أ', level: '3AS', section: '', sync_revision: 4 }],
        students: [{ id: studentId, class_id: classId, full_name: 'تلميذ 1', number_in_list: 1, sync_revision: 4 }],
        sessions: [{ id: sessionId, class_id: classId, session_date: '2026-09-23', start_time: '08:00:00', end_time: '09:00:00', sync_revision: 4 }],
        attendance: [],
        session_behaviors: [],
      },
    });

    const loaded = await loadCoreState(client, localState);

    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].attendance).toEqual({});
    expect(loaded.sessions[0].disruptions).toEqual([]);
  });

  it('keeps a pending attendance mark that the cloud has not received yet', async () => {
    const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const sessionId = '55555555-5555-4555-8555-555555555555';
    const studentId = 'ssssssss-ssss-4sss-8sss-ssssssssssss';
    const localState = {
      ...getEmptyState(),
      classes: [{ id: classId, name: 'قسم أ', level: '3AS' as const, stream: '' }],
      students: [{ id: studentId, classId, fullName: 'تلميذ 1', numberInList: 1 }],
      sessions: [{
        id: sessionId,
        classId,
        date: '2026-09-23',
        startTime: '08:00',
        endTime: '09:00',
        sessionGoals: '',
        accomplishments: '',
        nextSteps: '',
        teacherNotes: '',
        attendance: { [studentId]: 'ABSENT' as const },
      }],
    };
    const { client } = makeClient({
      rows: {
        classes: [{ id: classId, name: 'قسم أ', level: '3AS', section: '', sync_revision: 4 }],
        students: [{ id: studentId, class_id: classId, full_name: 'تلميذ 1', number_in_list: 1, sync_revision: 4 }],
        sessions: [{ id: sessionId, class_id: classId, session_date: '2026-09-23', start_time: '08:00:00', end_time: '09:00:00', sync_revision: 4 }],
        attendance: [],
      },
    });

    const loaded = await loadCoreState(client, localState, {
      pendingRecordIds: new Set([`attendance:${sessionId}:${studentId}`]),
    });

    expect(loaded.sessions[0].attendance).toEqual({ [studentId]: 'ABSENT' });
  });

  it('survives an offline session end to end: outbox ids drive what a load keeps', async () => {
    const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const studentId = 'ssssssss-ssss-4sss-8sss-ssssssssssss';
    const sessionId = '55555555-5555-4555-8555-555555555555';
    const offlineState = {
      ...getEmptyState(),
      classes: [{ id: classId, name: 'قسم أ', level: '3AS' as const, stream: '' }],
      students: [{ id: studentId, classId, fullName: 'تلميذ 1', numberInList: 1 }],
      sessions: [{
        id: sessionId,
        classId,
        date: '2026-09-23',
        startTime: '08:00',
        endTime: '09:00',
        sessionGoals: 'الوحدة 1',
        accomplishments: '',
        nextSteps: '',
        teacherNotes: '',
        attendance: { [studentId]: 'ABSENT' as const },
        disruptions: [studentId],
      }],
    };

    // The teacher worked offline: the engine queues the delta.
    await enqueueSyncDelta(ownerId, getEmptyState(), offlineState, 2, '2026-09-23T18:00:00.000Z');
    const pendingRecordIds = await listPendingRecordIds(ownerId);
    expect(pendingRecordIds.size).toBeGreaterThan(0);

    // Reloading the page before the queue drains must not lose that work, even though
    // the cloud is still empty.
    const { client } = makeClient({ rows: {} });
    const loaded = await loadCoreState(client, offlineState, { pendingRecordIds });

    expect(loaded.classes.map((c) => c.id)).toEqual([classId]);
    expect(loaded.students.map((s) => s.id)).toEqual([studentId]);
    expect(loaded.sessions.map((s) => s.id)).toEqual([sessionId]);
    expect(loaded.sessions[0].attendance).toEqual({ [studentId]: 'ABSENT' });
    expect(loaded.sessions[0].disruptions).toEqual([studentId]);
  });
});

describe('§7 outbox helpers', () => {
  it('lists pending record ids across every operation of an entry', async () => {
    await enqueueSyncOperations(ownerId, [
      { id: 'class:c1', entity: 'class', action: 'upsert', recordId: 'c1' },
      { id: 'student:s1', entity: 'student', action: 'delete', recordId: 's1' },
    ], 1, '2026-09-24T10:00:00.000Z');

    const pending = await listPendingRecordIds(ownerId);
    expect([...pending].sort()).toEqual(['class:c1', 'student:s1']);
    await clearSyncOutbox(ownerId);
  });

  it('records the tombstone override flag only for the conflict-resolution path', async () => {
    await enqueueSyncOperations(ownerId, [{ id: 'class:c1', entity: 'class', action: 'upsert', recordId: 'c1' }], 1, '2026-09-24T10:00:00.000Z');
    const entries = await listSyncOutbox(ownerId);
    expect(entries[0].allowTombstoneOverride).toBe(false);
    await clearSyncOutbox(ownerId);
  });
});
