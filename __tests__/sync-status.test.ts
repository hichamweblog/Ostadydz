import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCoalescer } from '@/lib/coalescer';
import {
  BACKUP_NUDGE_INTERVAL_DAYS,
  backupNudge,
  formatAge,
  isBackupNudgeDismissed,
  offlinePdfAvailability,
  pendingSummary,
  restoreProgressMessage,
  shortDeviceId,
  syncStatusSummary,
} from '@/lib/sync-status';

const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe('§1 status summary', () => {
  it('reports a quiet, confident state when everything is confirmed', () => {
    const summary = syncStatusSummary('ready', 0);
    expect(summary.tone).toBe('ok');
    expect(summary.label).toBe('محفوظة في السحابة');
  });

  it('never claims the cloud holds work that is still queued', () => {
    const summary = syncStatusSummary('sync-pending', 3);
    expect(summary.tone).toBe('busy');
    expect(summary.detail).toContain('3');
  });

  it('reassures the user that failed syncs are not lost work', () => {
    const summary = syncStatusSummary('sync-failed', 2);
    expect(summary.tone).toBe('error');
    expect(summary.detail).toContain('محفوظة على هذا الجهاز');
  });

  it('explains local-only mode instead of showing an error', () => {
    const summary = syncStatusSummary('local-only', 5);
    expect(summary.tone).toBe('warn');
    expect(summary.detail).toContain('عند عودة الاتصال');
  });

  it('covers every status without falling through', () => {
    const statuses = ['loading', 'ready', 'sync-pending', 'sync-failed', 'conflict', 'local-only'] as const;
    for (const status of statuses) {
      const summary = syncStatusSummary(status, 0);
      expect(summary.label.length).toBeGreaterThan(0);
      expect(summary.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('§2 pending-work wording', () => {
  it('handles zero, one, two and many with correct Arabic forms', () => {
    expect(pendingSummary(0)).toContain('لا توجد');
    expect(pendingSummary(1)).toContain('عملية واحدة');
    expect(pendingSummary(2)).toContain('عمليتان');
    expect(pendingSummary(7)).toContain('7 عمليات');
  });
});

describe('§3 device id', () => {
  it('shortens long ids and keeps short ones intact', () => {
    expect(shortDeviceId('12345678-1234-1234-1234-123456789012')).toBe('12345678…');
    expect(shortDeviceId('abc')).toBe('abc');
    expect(shortDeviceId(null)).toBe('—');
  });
});

describe('§4 backup nudge', () => {
  it('prompts a teacher who has never exported a backup', () => {
    const nudge = backupNudge(null, NOW);
    expect(nudge.level).toBe('due');
    expect(nudge.prominent).toBe(true);
    expect(nudge.message).toContain('لم تُنشئ');
  });

  it('stays quiet while the last backup is recent', () => {
    const nudge = backupNudge(daysAgo(2), NOW);
    expect(nudge.level).toBe('ok');
    expect(nudge.prominent).toBe(false);
  });

  it('becomes due exactly at the interval', () => {
    expect(backupNudge(daysAgo(BACKUP_NUDGE_INTERVAL_DAYS), NOW).level).toBe('due');
    expect(backupNudge(daysAgo(BACKUP_NUDGE_INTERVAL_DAYS - 1), NOW).level).toBe('ok');
  });

  it('escalates when the backup is very old', () => {
    const nudge = backupNudge(daysAgo(40), NOW);
    expect(nudge.level).toBe('overdue');
    expect(nudge.daysSinceLastBackup).toBe(40);
  });

  it('treats an unparseable date as never backed up', () => {
    expect(backupNudge('not-a-date', NOW).level).toBe('due');
  });

  it('honours a recent dismissal for a few days only', () => {
    expect(isBackupNudgeDismissed(daysAgo(1), NOW)).toBe(true);
    expect(isBackupNudgeDismissed(daysAgo(5), NOW)).toBe(false);
    expect(isBackupNudgeDismissed(null, NOW)).toBe(false);
  });
});

describe('§5 age labels', () => {
  it('describes recent, same-day, yesterday and older values', () => {
    expect(formatAge(new Date(NOW - 30_000).toISOString(), NOW)).toBe('قبل لحظات');
    expect(formatAge(new Date(NOW - 3 * 60 * 60 * 1000).toISOString(), NOW)).toBe('قبل 3 ساعة');
    expect(formatAge(daysAgo(1), NOW)).toBe('أمس');
    expect(formatAge(daysAgo(2), NOW)).toBe('قبل يومين');
    expect(formatAge(daysAgo(5), NOW)).toBe('قبل 5 يوماً');
    expect(formatAge(daysAgo(65), NOW)).toBe('قبل شهرين');
  });

  it('handles a missing or invalid timestamp', () => {
    expect(formatAge(null, NOW)).toBe('لا يوجد بعد');
    expect(formatAge('', NOW)).toBe('لا يوجد بعد');
    expect(formatAge('bogus', NOW)).toBe('لا يوجد بعد');
  });
});

describe('§6 offline PDF availability', () => {
  it('tells the teacher which memoranda open without a connection', () => {
    const result = offlinePdfAvailability(['u1', 'u2', 'u3'], ['u1', 'u3']);
    expect(result.available).toEqual(['u1', 'u3']);
    expect(result.missing).toEqual(['u2']);
    expect(result.complete).toBe(false);
  });

  it('reports completeness when everything is stored', () => {
    expect(offlinePdfAvailability(['u1'], ['u1', 'u2']).complete).toBe(true);
  });

  it('is complete when nothing is attached', () => {
    expect(offlinePdfAvailability([], []).complete).toBe(true);
  });

  it('ignores stored files for units that are no longer attached', () => {
    const result = offlinePdfAvailability(['u1'], ['u2', 'u3']);
    expect(result.available).toEqual([]);
    expect(result.missing).toEqual(['u1']);
  });
});

describe('§7 restore banner', () => {
  it('uses the dual form for one and two of each entity', () => {
    expect(restoreProgressMessage(1, 1)).toContain('قسم واحد');
    expect(restoreProgressMessage(1, 1)).toContain('تلميذ واحد');
    expect(restoreProgressMessage(2, 2)).toContain('قسمان');
    expect(restoreProgressMessage(2, 2)).toContain('تلميذان');
  });

  it('uses the plural form for larger counts', () => {
    expect(restoreProgressMessage(5, 120)).toContain('5 أقسام');
    expect(restoreProgressMessage(5, 120)).toContain('120 تلميذاً');
  });

  it('explains the wait for an empty workspace instead of showing nothing', () => {
    expect(restoreProgressMessage(0, 0)).toContain('جارٍ التحقق');
  });
});

describe('§8 coalescer collapses bursts into one call', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once after a burst of events', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(250, run);

    for (let i = 0; i < 20; i++) coalescer.schedule();
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again for a new burst after the quiet period', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(250, run);

    coalescer.schedule();
    vi.advanceTimersByTime(250);
    coalescer.schedule();
    vi.advanceTimersByTime(250);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancels a scheduled call (sign-out must not fetch afterwards)', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(250, run);

    coalescer.schedule();
    expect(coalescer.isScheduled()).toBe(true);
    coalescer.cancel();

    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
    expect(coalescer.isScheduled()).toBe(false);
  });

  it('is idle before any event', () => {
    expect(createCoalescer(250, vi.fn()).isScheduled()).toBe(false);
  });
});
