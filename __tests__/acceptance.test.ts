import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The acceptance matrix from AGENTS.md §6, asserted against the real modules.
 *
 * Rows that need two browsers or a live Supabase instance are covered at the boundary that
 * actually decides the outcome (the reconciliation, the queue and the purge); rows that are
 * purely presentational live in sync-status.test.ts.
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
import { loadCoreState } from '@/lib/supabase/core-sync';
import { enqueueSyncDelta, listPendingRecordIds, listSyncOutbox } from '@/lib/sync-outbox';
import { loadAppStateCache, saveAppStateCache } from '@/lib/state-cache';
import { purgeLocalUserData } from '@/lib/local-user-data';
import { readBackupReminder, recordBackupExported, dismissBackupNudge } from '@/lib/backup-reminder';
import { listStoredPdfUnitIds, savePdfBinary } from '@/lib/binary-storage';

/**
 * SQL assertions must ignore comments: a comment mentioning `security_invoker = true` made an
 * earlier version of these tests pass while the actual clause said `false`.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const ownerId = 'owner-1';
const otherOwnerId = 'owner-2';
const classId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const studentId = 'ssssssss-ssss-4sss-8sss-ssssssssssss';

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
      return new Proxy(chain, {
        get(target, prop: string) {
          if (prop === '__table') return target.__table;
          return target[prop];
        },
      });
    },
  };
  // Bind each table access so `rows[table]` resolves correctly per query.
  const bound = new Proxy(client, {
    get(target, prop) {
      if (prop !== 'from') return target[prop];
      return (table: string) => {
        const chain = target.from();
        chain.__table = table;
        return chain;
      };
    },
  });
  return bound as any;
}

function installWindow() {
  const storage = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  };
  return storage;
}

beforeEach(() => {
  idb.values.clear();
  vi.clearAllMocks();
});

describe('Row 1 — delete then reload keeps the workspace empty', () => {
  it('does not resurrect a class from a stale cache when the cloud is empty', async () => {
    const stale = { ...getEmptyState(), classes: [{ id: classId, name: 'قسم', level: '3AS' as const, stream: '' }] };
    const loaded = await loadCoreState(makeClient({}), stale);
    expect(loaded.classes).toEqual([]);
  });
});

describe('Row 3 — editing a record deleted elsewhere cannot re-create it', () => {
  it('keeps local state consistent when the cloud rejects the edit', async () => {
    const local = {
      ...getEmptyState(),
      classes: [{ id: classId, name: 'قسم محلي', level: '3AS' as const, stream: '' }],
    };
    // A tombstone exists on the server for that class.
    const loaded = await loadCoreState(makeClient({ sync_tombstones: [{ entity_type: 'class', entity_id: classId }] }), local);
    expect(loaded.classes).toEqual([]);
  });
});

describe('Row 4 — offline edits are queued and survive a reload', () => {
  it('keeps a whole offline session until the queue drains', async () => {
    const offline = {
      ...getEmptyState(),
      classes: [{ id: classId, name: 'قسم دون اتصال', level: '3AS' as const, stream: '' }],
      students: [{ id: studentId, classId, fullName: 'تلميذ', numberInList: 1 }],
    };
    await enqueueSyncDelta(ownerId, getEmptyState(), offline, 3, '2026-09-24T09:00:00.000Z');
    const pending = await listPendingRecordIds(ownerId);

    const loaded = await loadCoreState(makeClient({}), offline, { pendingRecordIds: pending });
    expect(loaded.classes.map((c) => c.id)).toEqual([classId]);
    expect(loaded.students.map((s) => s.id)).toEqual([studentId]);
  });

  it('reports the queued work so the UI can warn before sign-out', async () => {
    const offline = { ...getEmptyState(), classes: [{ id: classId, name: 'ق', level: '3AS' as const, stream: '' }] };
    await enqueueSyncDelta(ownerId, getEmptyState(), offline, 2, '2026-09-24T09:00:00.000Z');
    expect((await listSyncOutbox(ownerId)).length).toBeGreaterThan(0);
  });
});

describe('Row 6 — clear site data restores everything from the cloud', () => {
  it('rebuilds the workspace from Postgres with an empty cache', async () => {
    const rows = {
      classes: [{ id: classId, name: 'قسم', level: '3AS', section: '', sync_revision: 4 }],
      students: [{ id: studentId, class_id: classId, full_name: 'تلميذ', number_in_list: 1, sync_revision: 4 }],
      app_settings: [{ settings: { activeTrimester: 1 }, sync_revision: 4 }],
    };
    const loaded = await loadCoreState(makeClient(rows), getEmptyState());
    expect(loaded.classes).toHaveLength(1);
    expect(loaded.students).toHaveLength(1);
    expect(loaded.cloudRevision).toBe(4);
  });
});

describe('Row 7 — switching accounts on one device leaks nothing', () => {
  it('purges the signed-out owner only', async () => {
    installWindow();
    await saveAppStateCache({ ...getEmptyState(), classes: [{ id: classId, name: 'ق', level: '3AS' as const, stream: '' }] }, ownerId);
    await saveAppStateCache({ ...getEmptyState(), classes: [{ id: classId, name: 'ب', level: '3AS' as const, stream: '' }] }, otherOwnerId);
    await savePdfBinary('unit-1', 'data:application/pdf;base64,AAA', ownerId);
    await savePdfBinary('unit-1', 'data:application/pdf;base64,BBB', otherOwnerId);

    await purgeLocalUserData(ownerId);

    expect(await loadAppStateCache(ownerId)).toBeNull();
    expect(await loadAppStateCache(otherOwnerId)).not.toBeNull();
    expect(await listStoredPdfUnitIds(ownerId)).toEqual([]);
    expect(await listStoredPdfUnitIds(otherOwnerId)).toEqual(['unit-1']);
  });
});

describe('Row 9 — offline cold start shows the cached workspace, not an empty one', () => {
  it('returns the cached state and its revision for the next write', async () => {
    installWindow();
    const cached = { ...getEmptyState(), classes: [{ id: classId, name: 'قسم', level: '3AS' as const, stream: '' }], cloudRevision: 12 };
    await saveAppStateCache(cached, ownerId);

    const restored = await loadAppStateCache(ownerId);
    expect(restored?.classes).toHaveLength(1);
    // The stored revision is what keeps an offline write from silently overwriting newer
    // server rows once the connection returns.
    expect(restored?.cloudRevision).toBe(12);
  });

  it('survives a cache write that strips heavy blobs', async () => {
    installWindow();
    await saveAppStateCache({
      ...getEmptyState(),
      unitPdfFiles: { 'unit-1': { fileName: 'م.pdf', fileStorageKey: 'sanad:pdf:x:unit-1', fileDataUrl: 'data:application/pdf;base64,' + 'A'.repeat(200_000) } },
    }, ownerId);

    const restored = await loadAppStateCache(ownerId);
    expect(restored?.unitPdfFiles?.['unit-1']?.fileStorageKey).toBe('sanad:pdf:x:unit-1');
    expect((restored?.unitPdfFiles?.['unit-1'] as { fileDataUrl?: string })?.fileDataUrl).toBeUndefined();
  });
});

describe('Row 10 — a fresh account never sees demo or previous data', () => {
  it('starts from an empty, clearly-defaulted workspace', () => {
    const state = getEmptyState();
    expect(state.classes).toEqual([]);
    expect(state.students).toEqual([]);
    expect(state.sessions).toEqual([]);
  });
});

describe('Backup reminders are per account and survive a purge', () => {
  it('records and reads back an export per owner', () => {
    installWindow();
    recordBackupExported(ownerId, new Date('2026-09-24T10:00:00.000Z'));

    expect(readBackupReminder(ownerId).lastBackupAt).toBe('2026-09-24T10:00:00.000Z');
    expect(readBackupReminder(otherOwnerId).lastBackupAt).toBeNull();
  });

  it('keeps the reminder after local data is purged, so the user is not re-nudged wrongly', async () => {
    installWindow();
    recordBackupExported(ownerId, new Date('2026-09-20T10:00:00.000Z'));
    await purgeLocalUserData(ownerId);
    expect(readBackupReminder(ownerId).lastBackupAt).toBe('2026-09-20T10:00:00.000Z');
  });

  it('records a dismissal without touching the last export time', () => {
    installWindow();
    recordBackupExported(ownerId, new Date('2026-09-01T10:00:00.000Z'));
    dismissBackupNudge(ownerId, new Date('2026-09-24T10:00:00.000Z'));

    const reminder = readBackupReminder(ownerId);
    expect(reminder.lastBackupAt).toBe('2026-09-01T10:00:00.000Z');
    expect(reminder.dismissedAt).toBe('2026-09-24T10:00:00.000Z');
  });

  it('tolerates corrupt stored JSON', () => {
    const storage = installWindow();
    storage.set('sanad:backup-reminder:owner-1', '{not json');
    expect(readBackupReminder(ownerId)).toEqual({ lastBackupAt: null, dismissedAt: null });
  });
});

describe('Phase 3 egress: listing the queue touches this account only', () => {
  it('does not deserialize another account entries', async () => {
    const mine = `${ownerId}:device-a:3:2026-09-24T09:00:00.000Z`;
    const theirs = `${otherOwnerId}:device-b:7:2026-09-24T09:10:00.000Z`;
    idb.values.set(`sanad:sync-outbox:${mine}`, {
      id: mine,
      ownerId,
      revision: 3,
      updatedAt: '2026-09-24T09:00:00.000Z',
      operations: [{ id: `class:${classId}`, entity: 'class', action: 'upsert', recordId: classId }],
      createdAt: '2026-09-24T09:00:00.000Z',
    });
    idb.values.set(`sanad:sync-outbox:${theirs}`, {
      id: theirs,
      ownerId: otherOwnerId,
      revision: 7,
      updatedAt: '2026-09-24T09:10:00.000Z',
      operations: [{ id: `class:${classId}`, entity: 'class', action: 'upsert', recordId: classId }],
      createdAt: '2026-09-24T09:10:00.000Z',
    });
    idb.get.mockClear();

    const entries = await listSyncOutbox(ownerId);

    expect(entries.map((entry) => entry.id)).toEqual([mine]);
    const readKeys = idb.get.mock.calls.map(([key]) => key as string);
    expect(readKeys).toContain(`sanad:sync-outbox:${mine}`);
    expect(readKeys).not.toContain(`sanad:sync-outbox:${theirs}`);
  });

  it('still finds a uuid-era entry belonging to this owner', async () => {
    const legacyUuid = '11111111-2222-4333-8444-555555555555';
    idb.values.set(`sanad:sync-outbox:${legacyUuid}`, {
      id: legacyUuid,
      ownerId,
      revision: 1,
      updatedAt: '2026-09-01T09:00:00.000Z',
      operations: [{ id: `class:${classId}`, entity: 'class', action: 'upsert', recordId: classId }],
      createdAt: '2026-09-01T09:00:00.000Z',
    });

    const entries = await listSyncOutbox(ownerId);
    expect(entries.map((entry) => entry.id)).toEqual([legacyUuid]);
  });

  it('ignores a uuid-era entry that belongs to another account', async () => {
    const legacyUuid = '99999999-2222-4333-8444-555555555555';
    idb.values.set(`sanad:sync-outbox:${legacyUuid}`, {
      id: legacyUuid,
      ownerId: otherOwnerId,
      revision: 1,
      updatedAt: '2026-09-01T09:00:00.000Z',
      operations: [{ id: `class:${classId}`, entity: 'class', action: 'upsert', recordId: classId }],
      createdAt: '2026-09-01T09:00:00.000Z',
    });

    expect(await listSyncOutbox(ownerId)).toEqual([]);
    expect(idb.values.has(`sanad:sync-outbox:${legacyUuid}`)).toBe(true);
  });
});

describe('§5.13 diagnostics: sync_health is RLS-safe and covers every synced table', () => {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const sql = stripSqlComments(readFileSync(join(dir, '20260924130000_sync_health_view.sql'), 'utf8'));

  it('uses security_invoker so one teacher cannot read another (a view otherwise bypasses RLS)', () => {
    expect(sql).toMatch(/with\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
    expect(sql).not.toMatch(/security_invoker\s*=\s*false/i);
  });

  it('aggregates every table the client syncs, plus tombstones and conflicts', () => {
    const tables = [
      'classes', 'students', 'grades', 'sessions', 'attendance', 'session_behaviors',
      'timetable_slots', 'custom_units', 'lesson_progress', 'lesson_plans', 'app_settings',
      'memoranda_files', 'dashboard_tasks', 'sync_conflicts', 'sync_tombstones',
    ];
    const missing = tables.filter((table) => !new RegExp(`from\\s+public\\.${table}\\b`, 'i').test(sql));
    expect(missing).toEqual([]);
  });

  it('reports per-entity tombstone counts, which is where a lost delete becomes visible', () => {
    expect(sql).toMatch(/group by entity_type/i);
    expect(sql).toMatch(/'tombstones:'\s*\|\|\s*entity_type/);
  });

  it('never grants the view to anonymous callers', () => {
    expect(sql).toMatch(/revoke all on public\.sync_health from anon/i);
    expect(sql).toMatch(/grant select on public\.sync_health to authenticated/i);
  });
});

describe('Phase 3 hygiene: the roster-import migration exists exactly once', () => {
  it('keeps one authoritative definition and no byte-identical duplicate', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const atomic = readFileSync(join(dir, '20260921071000_atomic_roster_import.sql'), 'utf8');
    const resilient = readFileSync(join(dir, '20260922080000_resilient_roster_import.sql'), 'utf8');

    expect(atomic).toMatch(/create or replace function public\.import_roster_batch/i);
    // The later file must stay a no-op so environments that already applied it keep a stable
    // history, and a future edit cannot land in only one of the two copies.
    expect(resilient).not.toMatch(/create or replace function/i);
    expect(resilient).toMatch(/Intentionally empty/i);
  });
});

describe('Phase 3 hardening: untrusted Excel input is bounded', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'excel-sync.ts'), 'utf8');

  it('caps file size, sheet count, rows and wall-clock time', () => {
    expect(source).toMatch(/MAX_EXCEL_FILE_SIZE_BYTES\s*=/);
    expect(source).toMatch(/MAX_EXCEL_SHEETS\s*=/);
    expect(source).toMatch(/MAX_EXCEL_ROWS_TOTAL\s*=/);
    expect(source).toMatch(/MAX_EXCEL_PARSE_MS\s*=/);
  });

  it('enforces the budget while parsing, not only up front', () => {
    expect(source).toMatch(/assertSheetBudget\(workbook\.SheetNames\.length\)/);
    expect(source).toMatch(/assertRowBudget\(totalRowsSeen\)/);
    expect(source).toMatch(/assertTimeBudget\(parseStartedAt\)/);
  });

  it('still lazy-loads xlsx so it is not in the initial bundle', () => {
    expect(source).toMatch(/await import\('xlsx'\)/);
    expect(source).not.toMatch(/^import \* as XLSX from 'xlsx'/m);
  });
});

describe('Phase 3 CI: the pipeline actually gates on the checks we run locally', () => {
  const ci = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');

  it('installs from the lockfile, type-checks, lints, tests and builds', () => {
    expect(ci).toMatch(/npm ci/);
    expect(ci).toMatch(/npx tsc --noEmit/);
    expect(ci).toMatch(/npm run lint/);
    expect(ci).toMatch(/npm run test/);
    expect(ci).toMatch(/npm run build/);
  });

  it('runs on pull requests against main', () => {
    expect(ci).toMatch(/pull_request:/);
    expect(ci).toMatch(/branches: \[main\]/);
  });
});

describe('Phase 4 / Performance: Unindexed Foreign Keys have covering indexes on owner_id', () => {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const allSql = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');

  it('indexes owner_id on high-density tables grades, attendance, and session_behaviors', () => {
    expect(allSql).toMatch(/create\s+index\s+(if\s+not\s+exists\s+)?grades_owner_idx\s+on\s+public\.grades\s*\(\s*owner_id\s*\)/i);
    expect(allSql).toMatch(/create\s+index\s+(if\s+not\s+exists\s+)?attendance_owner_idx\s+on\s+public\.attendance\s*\(\s*owner_id\s*\)/i);
    expect(allSql).toMatch(/create\s+index\s+(if\s+not\s+exists\s+)?attendance_workspace_owner_idx\s+on\s+public\.attendance\s*\(\s*workspace_id,\s*owner_id\s*\)/i);
    expect(allSql).toMatch(/create\s+index\s+(if\s+not\s+exists\s+)?session_behaviors_owner_idx\s+on\s+public\.session_behaviors\s*\(\s*owner_id\s*\)/i);
    expect(allSql).toMatch(/create\s+index\s+(if\s+not\s+exists\s+)?session_behaviors_workspace_owner_idx\s+on\s+public\.session_behaviors\s*\(\s*workspace_id,\s*owner_id\s*\)/i);
  });

  it('indexes owner_id across all other user-scoped relational tables', () => {
    const tables = [
      'classes',
      'students',
      'sessions',
      'timetable_slots',
      'lesson_progress',
      'lesson_plans',
      'custom_units',
      'curriculum_units',
      'memoranda_files',
      'app_settings',
      'sync_tombstones',
      'sync_conflicts',
    ];
    for (const table of tables) {
      const pattern = new RegExp(`create\\s+index\\s+(if\\s+not\\s+exists\\s+)?${table}_owner_idx\\s+on\\s+public\\.${table}\\s*\\(\\s*owner_id\\s*\\)`, 'i');
      expect(allSql).toMatch(pattern);
    }
  });
});
