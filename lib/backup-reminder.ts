/**
 * Remembers when the teacher last exported a backup, so the app can nudge them before the
 * only copy of their work gets too old (the backup contract in AGENTS.md).
 *
 * Stored outside the app cache on purpose: it must survive `purgeLocalUserData` (clearing the
 * reminder would re-nudge immediately) and it is per-owner, since two teachers can share a
 * device.
 */
const REMINDER_KEY_PREFIX = 'sanad:backup-reminder:';

export interface BackupReminder {
  /** ISO timestamp of the last successful JSON/ZIP export. */
  lastBackupAt: string | null;
  /** ISO timestamp of the last dismissal of the weekly prompt. */
  dismissedAt: string | null;
}

const EMPTY: BackupReminder = { lastBackupAt: null, dismissedAt: null };

const keyFor = (ownerId: string | null | undefined) => `${REMINDER_KEY_PREFIX}${ownerId || 'anon'}`;

export function readBackupReminder(ownerId: string | null | undefined): BackupReminder {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(keyFor(ownerId));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<BackupReminder>;
    return {
      lastBackupAt: typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : null,
      dismissedAt: typeof parsed.dismissedAt === 'string' ? parsed.dismissedAt : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeBackupReminder(ownerId: string | null | undefined, reminder: BackupReminder): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyFor(ownerId), JSON.stringify(reminder));
  } catch {
    // localStorage can be unavailable (private mode/quota); a missed reminder is not fatal.
  }
}

/** Records a successful export with the current time. */
export function recordBackupExported(
  ownerId: string | null | undefined,
  at: Date = new Date(),
): BackupReminder {
  const next: BackupReminder = { ...readBackupReminder(ownerId), lastBackupAt: at.toISOString() };
  writeBackupReminder(ownerId, next);
  return next;
}

export function dismissBackupNudge(
  ownerId: string | null | undefined,
  at: Date = new Date(),
): BackupReminder {
  const next: BackupReminder = { ...readBackupReminder(ownerId), dismissedAt: at.toISOString() };
  writeBackupReminder(ownerId, next);
  return next;
}
