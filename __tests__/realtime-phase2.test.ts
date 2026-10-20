import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SYNCHRONIZED_TABLES,
  isSelfAuthoredChange,
  nextRevisionFloor,
  shouldApplyRemoteRefresh,
  shouldFlushOnBackground,
  type RemoteRefreshPreconditions,
} from '@/lib/realtime-guard';

/**
 * Phase-2 contract: a deletion must reach every open tab, and a refresh must never overwrite
 * work the user produced while that refresh was in flight.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');
}

/** Tables named by a `foreach ... in array array[...]` block whose body follows `needle`. */
function loopTables(sql: string, blockNeedle: RegExp, needle: RegExp): Set<string> {
  const names = new Set<string>();
  for (const match of sql.matchAll(/foreach\s+\w+\s+in\s+array\s+array\[([^\]]+)\]/gi)) {
    const body = sql.slice(match.index, match.index + 900);
    if (!blockNeedle.test(body) || !needle.test(body)) continue;
    for (const raw of match[1].split(',')) {
      const name = raw.trim().replace(/'/g, '');
      if (name) names.add(name);
    }
  }
  return names;
}

describe('§1 Realtime deletes can be filtered by owner (schema contract)', () => {
  const sql = allMigrationSql();
  const replicaIdentityTables = loopTables(sql, /replica\s+identity\s+full/i, /replica\s+identity\s+full/i);

  it('gives every synchronized table a full replica identity', () => {
    // Without `replica identity full` the old record of a DELETE carries only the primary
    // key, so Realtime can never match an `owner_id=eq.<uid>` filter and the delete event
    // never reaches the client (the synchronization contract in AGENTS.md). Either form counts: a literal
    // statement or the migration loop that applies it to every published table.
    const missing = SYNCHRONIZED_TABLES.filter((table) => {
      const literal = new RegExp(
        `alter\\s+table\\s+(public\\.)?${table}\\s+replica\\s+identity\\s+full`,
        'i',
      ).test(sql);
      return !literal && !replicaIdentityTables.has(table);
    });

    expect(missing).toEqual([]);
  });

  it('publishes exactly the tables the client subscribes to', () => {
    // A table added to the client's subscription list without being published (or the other
    // way round) means silent gaps: the tab that should refresh never hears about the change.
    const published = loopTables(sql, /alter\s+publication\s+supabase_realtime\s+add\s+table/i, /supabase_realtime/);
    published.add('sync_tombstones'); // added on its own in the audit migration

    const missing = [...SYNCHRONIZED_TABLES].filter((table) => !published.has(table));
    expect(missing).toEqual([]);
    expect([...published].filter((table) => !SYNCHRONIZED_TABLES.includes(table as never))).toEqual([]);
  });

  it('publishes sync_tombstones on the realtime publication', () => {
    // Tombstone INSERTs are what let other open tabs drop a deleted record immediately.
    expect(sql).toMatch(/alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.sync_tombstones/i);
  });
});

describe('§2 own writes are ignored, remote ones are not', () => {
  const deviceId = 'device-local';

  it('ignores the echo of a write made on this device', () => {
    expect(isSelfAuthoredChange({ new: { sync_device_id: deviceId } }, deviceId)).toBe(true);
  });

  it('ignores the echo of a delete made on this device (tombstone carries device_id)', () => {
    expect(isSelfAuthoredChange({ new: { device_id: deviceId } }, deviceId)).toBe(true);
  });

  it('reacts to a change made by another device', () => {
    expect(isSelfAuthoredChange({ new: { sync_device_id: 'device-other' } }, deviceId)).toBe(false);
  });

  it('reacts to a DELETE payload, which only carries the old record', () => {
    // With replica identity full the old row is present, so a delete by another device is
    // recognised as remote work and triggers the refresh.
    expect(isSelfAuthoredChange({ old: { sync_device_id: 'device-other' } }, deviceId)).toBe(false);
    expect(isSelfAuthoredChange({ old: { sync_device_id: deviceId } }, deviceId)).toBe(true);
  });

  it('stays safe on empty or partial payloads', () => {
    expect(isSelfAuthoredChange(null, deviceId)).toBe(false);
    expect(isSelfAuthoredChange({}, deviceId)).toBe(false);
    expect(isSelfAuthoredChange({ new: {} }, deviceId)).toBe(false);
    expect(isSelfAuthoredChange({ new: { sync_device_id: 'device-local' } }, '')).toBe(false);
  });
});

describe('§3 the clobber race: a stale fetch never replaces newer local state', () => {
  const clean: RemoteRefreshPreconditions = {
    active: true,
    authenticated: true,
    syncing: false,
    pendingSaveScheduled: false,
    pendingOutboxCount: 0,
    generationChanged: false,
    localEditsDuringFetch: 0,
  };

  it('applies the refresh when nothing local is in flight', () => {
    expect(shouldApplyRemoteRefresh(clean)).toBe(true);
  });

  it('drops the response when the user edited while the fetch was in flight', () => {
    expect(shouldApplyRemoteRefresh({ ...clean, localEditsDuringFetch: 1 })).toBe(false);
  });

  it.each([
    ['the channel was closed (sign-out) while fetching', { active: false }],
    ['the session no longer owns the workspace', { authenticated: false }],
    ['an outbox flush owns the final state', { syncing: true }],
    ['a debounced local save has not been persisted yet', { pendingSaveScheduled: true }],
    ['the outbox still holds unsynced operations', { pendingOutboxCount: 2 }],
    ['the save generation was bumped (reset/conflict resolution)', { generationChanged: true }],
  ])('drops the response when %s', (_label, override) => {
    expect(shouldApplyRemoteRefresh({ ...clean, ...override })).toBe(false);
  });
});

describe('§4 backgrounding the tab persists work', () => {
  it('flushes when a debounced save is still only in memory', () => {
    expect(shouldFlushOnBackground({ pendingSaveScheduled: true, pendingOutboxCount: 0, status: 'sync-pending' })).toBe(true);
  });

  it('flushes when the outbox still has operations', () => {
    expect(shouldFlushOnBackground({ pendingSaveScheduled: false, pendingOutboxCount: 3, status: 'ready' })).toBe(true);
  });

  it('does nothing when there is no work', () => {
    expect(shouldFlushOnBackground({ pendingSaveScheduled: false, pendingOutboxCount: 0, status: 'ready' })).toBe(false);
  });

  it('does not auto-retry an unresolved conflict', () => {
    expect(shouldFlushOnBackground({ pendingSaveScheduled: true, pendingOutboxCount: 1, status: 'conflict' })).toBe(false);
  });
});

describe('§5 the revision clock never goes backwards', () => {
  it('seeds from the last known cloud revision', () => {
    // Starting again from 0 after an offline start would make `conflictIfStale` believe the
    // local write is older than every remote row and overwrite them silently.
    expect(nextRevisionFloor(0, 42)).toBe(42);
  });

  it('keeps the highest candidate and ignores junk', () => {
    expect(nextRevisionFloor(7, undefined, null, Number.NaN, -3, 5)).toBe(7);
    expect(nextRevisionFloor(undefined, null)).toBe(0);
  });
});

describe('§6 service worker never serves Supabase or auth from cache', () => {
  const source = readFileSync(join(process.cwd(), 'app', 'sw.ts'), 'utf8');

  it('routes Supabase URLs through NetworkOnly before the default cache rules', () => {
    const supabaseRule = source.indexOf('isSupabaseUrl(url)');
    const defaultCache = source.indexOf('...defaultCache');

    expect(supabaseRule).toBeGreaterThan(-1);
    expect(defaultCache).toBeGreaterThan(-1);
    // First matching route wins, so the NetworkOnly rule has to be registered first.
    expect(supabaseRule).toBeLessThan(defaultCache);
    expect(source).toMatch(/isSupabaseUrl[\s\S]*?NetworkOnly/);
  });

  it('recognises managed Supabase hosts even without the inlined env var', () => {
    expect(source).toMatch(/\.supabase\.co/);
    expect(source).toMatch(/networkOnly|NetworkOnly/i);
  });

  it('keeps one-time auth callbacks out of the cache', () => {
    expect(source).toMatch(/isAuthFlow[\s\S]*?NetworkOnly/);
  });
});
