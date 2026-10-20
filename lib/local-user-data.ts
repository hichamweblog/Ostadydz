import { clearTeacherBinaryFiles } from './binary-storage';
import { clearDashboardTasks } from './dashboard-tasks';
import { clearAppStateCache } from './state-cache';
import { clearAvatarOutbox } from './supabase/avatar-outbox';
import { clearMemorandaOutbox } from './supabase/memoranda-outbox';
import { clearSyncOutbox } from './sync-outbox';

/**
 * Removes every local trace of one teacher's workspace: the IndexedDB cache, the cached
 * PDF binaries, the avatar blob and the pending upload queues.
 *
 * Nothing here touches the cloud. Call it only after the outbox was flushed (or after the
 * user explicitly accepted losing unacknowledged work), so a shared device never keeps —
 * and never re-uploads — another account's data.
 */
export async function purgeLocalUserData(userId?: string | null): Promise<void> {
  if (typeof window === 'undefined') return;

  const results = await Promise.allSettled([
    clearAppStateCache(userId),
    clearTeacherBinaryFiles(userId),
    clearAvatarOutbox(),
    userId ? clearMemorandaOutbox(userId) : Promise.resolve(),
    userId ? clearSyncOutbox(userId) : Promise.resolve(),
    clearDashboardTasks(),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Local user data purge warning:', result.reason);
    }
  }
}
