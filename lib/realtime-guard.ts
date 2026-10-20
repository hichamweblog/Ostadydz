/**
 * Pure decision helpers for the Realtime sync path.
 *
 * They live outside the hook so the two rules that used to be implicit — "ignore my own
 * echo" and "never clobber a local edit with a fetch that started before it" — can be
 * tested without a browser or a live Supabase channel.
 */

/**
 * Tables whose Realtime changes should trigger a refresh. Every entry must also have
 * `replica identity full` in the migrations, otherwise DELETE events cannot be filtered by
 * owner and would be invisible to the client.
 */
export const SYNCHRONIZED_TABLES = [
  'profiles', 'classes', 'students', 'grades', 'sessions', 'attendance',
  'session_behaviors', 'timetable_slots', 'custom_units', 'lesson_progress',
  'lesson_plans', 'app_settings', 'dashboard_tasks', 'memoranda_files',
  'sync_tombstones',
] as const;

export interface RealtimeChangePayload {
  eventType?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}

/**
 * True when this change was written by this very device.
 *
 * Our own writes are echoed back on the channel. Re-loading for them is wasted work, and
 * worse: the fetch would run against in-memory state that the user has already moved past.
 *
 * `sync_device_id` is the column on the data tables, `device_id` the one on
 * `sync_tombstones`; DELETE payloads only carry `old` (and only when the table has
 * `replica identity full`).
 */
export function isSelfAuthoredChange(payload: RealtimeChangePayload | null | undefined, deviceId: string): boolean {
  if (!payload || !deviceId) return false;
  for (const record of [payload.new, payload.old]) {
    if (!record) continue;
    const author = record.sync_device_id ?? record.device_id;
    if (typeof author === 'string' && author === deviceId) return true;
  }
  return false;
}

export interface RemoteRefreshPreconditions {
  /** The channel subscription is still live (the user did not sign out meanwhile). */
  active: boolean;
  /** The session still belongs to the user we fetched for. */
  authenticated: boolean;
  /** An outbox flush is already running; it owns the final state and status. */
  syncing: boolean;
  /** A debounced local save is scheduled and has not been persisted yet. */
  pendingSaveScheduled: boolean;
  /** Unacknowledged operations in the outbox: the local state is ahead of the cloud. */
  pendingOutboxCount: number;
  /** A save generation bump happened while fetching (sign-out, conflict resolution, ...). */
  generationChanged: boolean;
  /** Local edits committed while fetching. */
  localEditsDuringFetch: number;
}

/**
 * Whether a fetched remote state may replace the in-memory state.
 *
 * Every clause protects a specific way the refresh used to lose data:
 * - `pendingSaveScheduled` / `pendingOutboxCount` — unsynced local work exists.
 * - `syncing` — a flush is mid-flight and will publish its own (newer) result.
 * - `generationChanged` — the session was reset while we were fetching.
 * - `localEditsDuringFetch` — this is the clobber race: the user edited during the round
 *   trip, so the response is already stale and must be dropped rather than applied.
 */
export function shouldApplyRemoteRefresh(preconditions: RemoteRefreshPreconditions): boolean {
  return preconditions.active
    && preconditions.authenticated
    && !preconditions.syncing
    && !preconditions.pendingSaveScheduled
    && preconditions.pendingOutboxCount === 0
    && !preconditions.generationChanged
    && preconditions.localEditsDuringFetch === 0;
}

export interface BackgroundFlushPreconditions {
  /** A debounced save is scheduled: its delta is still only in memory. */
  pendingSaveScheduled: boolean;
  /** Operations already persisted to the outbox. */
  pendingOutboxCount: number;
  /** Current cloud status; an unresolved conflict must not be auto-retried. */
  status: string;
}

/**
 * Whether closing/backgrounding the tab should try to persist and flush.
 *
 * This is best-effort by nature: the browser may kill the page before the network call
 * finishes. It exists because the debounce window (300ms) otherwise holds the newest edit
 * in memory only, and a tab closed in that window lost it.
 */
export function shouldFlushOnBackground(preconditions: BackgroundFlushPreconditions): boolean {
  if (preconditions.status === 'conflict') return false;
  return preconditions.pendingSaveScheduled || preconditions.pendingOutboxCount > 0;
}

/**
 * The revision clock the outbox should continue from.
 *
 * `conflictIfStale` only rejects a write when the server revision is strictly greater than
 * the one we send, so the clock must never go backwards: an offline session that starts
 * with revision 0 would otherwise overwrite rows it should have conflicted with. Seeding
 * from the last known cloud revision is always safe.
 */
export function nextRevisionFloor(...candidates: Array<number | null | undefined>): number {
  let floor = 0;
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > floor) floor = value;
  }
  return floor;
}
