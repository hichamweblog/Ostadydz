/**
 * Pure presentation/decision logic for the sync surfaces (Settings → sync panel, the
 * restore banner, offline-PDF availability and the backup nudge).
 *
 * Kept out of the components so the wording rules, thresholds and edge cases can be tested
 * without a DOM.
 */

export type CloudSyncStatusLike =
  | 'loading'
  | 'ready'
  | 'sync-pending'
  | 'sync-failed'
  | 'conflict'
  | 'local-only';

export interface SyncStatusSummary {
  /** Short label for the status pill/line. */
  label: string;
  /** Longer explanation shown under the label. */
  detail: string;
  tone: 'ok' | 'busy' | 'warn' | 'error';
}

/** Days after which the export reminder becomes prominent. */
export const BACKUP_NUDGE_INTERVAL_DAYS = 7;
/** Days after which the reminder escalates. */
export const BACKUP_OVERDUE_DAYS = 21;
export const BACKUP_NUDGE_DISMISS_MS = 3 * 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, now: number): number | null {
  const then = Date.parse(fromIso);
  if (!Number.isFinite(then)) return null;
  return Math.floor((now - then) / (24 * 60 * 60 * 1000));
}

/** Compact Arabic age label for "last saved" and "last backup" lines. */
export function formatAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'لا يوجد بعد';
  const days = daysBetween(iso, now);
  if (days === null) return 'لا يوجد بعد';
  if (days <= 0) {
    const minutes = Math.floor((now - Date.parse(iso)) / 60000);
    if (minutes < 1) return 'قبل لحظات';
    if (minutes < 60) return `قبل ${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    return `قبل ${hours} ساعة`;
  }
  if (days === 1) return 'أمس';
  if (days === 2) return 'قبل يومين';
  if (days < 30) return `قبل ${days} يوماً`;
  const months = Math.floor(days / 30);
  if (months <= 1) return 'قبل شهر';
  if (months === 2) return 'قبل شهرين';
  return `قبل ${months} أشهر`;
}

export function syncStatusSummary(status: CloudSyncStatusLike, pendingCount: number): SyncStatusSummary {
  switch (status) {
    case 'loading':
      return {
        label: 'جارٍ التحميل',
        detail: 'يتم الآن جلب أحدث نسخة من الخادم.',
        tone: 'busy',
      };
    case 'sync-pending':
      return {
        label: 'قيد المزامنة',
        detail: pendingCount > 0
          ? `هناك ${pendingCount} عملية بانتظار الرفع إلى الخادم.`
          : 'يتم الآن حفظ آخر التعديلات.',
        tone: 'busy',
      };
    case 'conflict':
      return {
        label: 'يوجد تعارض',
        detail: 'عدّل سجل تغيّر على جهاز آخر. اختر النسخة التي تريد الاحتفاظ بها.',
        tone: 'error',
      };
    case 'sync-failed':
      return {
        label: 'فشلت المزامنة',
        detail: 'تعديلاتك محفوظة على هذا الجهاز وسيُعاد المحاولة تلقائياً عند عودة الاتصال.',
        tone: 'error',
      };
    case 'local-only':
      return {
        label: 'دون اتصال',
        detail: 'تعمل الآن محلياً. سيتم رفع كل التعديلات تلقائياً عند عودة الاتصال.',
        tone: 'warn',
      };
    case 'ready':
    default:
      return {
        label: 'محفوظة في السحابة',
        detail: 'كل التعديلات مؤكدة على الخادم.',
        tone: 'ok',
      };
  }
}

/** Pending-work line for the sync panel and the sign-out dialog. */
export function pendingSummary(pendingCount: number): string {
  if (pendingCount <= 0) return 'لا توجد أي عملية بانتظار الرفع.';
  if (pendingCount === 1) return 'عملية واحدة بانتظار الرفع إلى الخادم.';
  if (pendingCount === 2) return 'عمليتان بانتظار الرفع إلى الخادم.';
  return `${pendingCount} عمليات بانتظار الرفع إلى الخادم.`;
}

/** Short, human-copyable device id for the sync panel. */
export function shortDeviceId(deviceId: string | null | undefined): string {
  if (!deviceId) return '—';
  return deviceId.length <= 12 ? deviceId : `${deviceId.slice(0, 8)}…`;
}

export type BackupNudgeLevel = 'ok' | 'due' | 'overdue';

export interface BackupNudge {
  level: BackupNudgeLevel;
  /** Null when the teacher has never exported a backup. */
  daysSinceLastBackup: number | null;
  message: string;
  /** Whether the panel should mark this as needing attention. */
  prominent: boolean;
}

/**
 * The onboarding tools (JSON/ZIP export) are good but were never mentioned again, so backups
 * silently aged forever. This turns the age into an explicit, dismissible prompt.
 */
export function backupNudge(
  lastBackupAt: string | null | undefined,
  now: number = Date.now(),
  intervalDays: number = BACKUP_NUDGE_INTERVAL_DAYS,
): BackupNudge {
  const days = lastBackupAt ? daysBetween(lastBackupAt, now) : null;

  if (days === null) {
    return {
      level: 'due',
      daysSinceLastBackup: null,
      message: 'لم تُنشئ أي نسخة احتياطية بعد. صدّر نسخة لحماية بياناتك.',
      prominent: true,
    };
  }
  if (days >= BACKUP_OVERDUE_DAYS) {
    return {
      level: 'overdue',
      daysSinceLastBackup: days,
      message: `آخر نسخة احتياطية كانت قبل ${days} يوماً. يُنصح بتصدير نسخة جديدة الآن.`,
      prominent: true,
    };
  }
  if (days >= intervalDays) {
    return {
      level: 'due',
      daysSinceLastBackup: days,
      message: `آخر نسخة احتياطية كانت ${formatAge(lastBackupAt, now)}. حان وقت تصدير نسخة جديدة.`,
      prominent: true,
    };
  }
  return {
    level: 'ok',
    daysSinceLastBackup: days,
    message: `آخر نسخة احتياطية: ${formatAge(lastBackupAt, now)}.`,
    prominent: false,
  };
}

/** Whether a nudged reminder should be hidden again because the teacher dismissed it recently. */
export function isBackupNudgeDismissed(
  dismissedAt: string | null | undefined,
  now: number = Date.now(),
  dismissForMs: number = BACKUP_NUDGE_DISMISS_MS,
): boolean {
  if (!dismissedAt) return false;
  const dismissed = Date.parse(dismissedAt);
  if (!Number.isFinite(dismissed)) return false;
  return now - dismissed < dismissForMs;
}

export interface OfflinePdfAvailability {
  /** Unit keys whose PDF is stored on this device. */
  available: string[];
  /** Unit keys that are attached in the cloud but unavailable without a connection. */
  missing: string[];
  /** True when every attached memorandum works offline. */
  complete: boolean;
}

/**
 * "Preserve offline PDFs with intent": the teacher must be able to tell, before class,
 * whether a memorandum will open without signal.
 */
export function offlinePdfAvailability(
  attachedUnitKeys: string[],
  storedUnitKeys: Iterable<string>,
): OfflinePdfAvailability {
  const stored = new Set(storedUnitKeys);
  const available: string[] = [];
  const missing: string[] = [];
  for (const unitKey of attachedUnitKeys) {
    if (stored.has(unitKey)) available.push(unitKey);
    else missing.push(unitKey);
  }
  return { available, missing, complete: missing.length === 0 };
}

/** Line for the restore banner while the cloud workspace is being fetched. */
export function restoreProgressMessage(classes: number, students: number): string {
  if (classes === 0 && students === 0) return 'جارٍ التحقق من مساحة العمل في السحابة…';
  const parts: string[] = [];
  parts.push(classes === 1 ? 'قسم واحد' : classes === 2 ? 'قسمان' : `${classes} أقسام`);
  parts.push(students === 1 ? 'تلميذ واحد' : students === 2 ? 'تلميذان' : `${students} تلميذاً`);
  return `تم استرجاع ${parts.join(' و ')} من السحابة.`;
}
