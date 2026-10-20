import { describe, expect, it } from 'vitest';

import {
  BEHAVIOR_FIELDS,
  isDeletedLocally,
  isPending,
  isTombstoned,
  reconcileEntityList,
  reconcileSessionMarks,
  type ReconciliationContext,
  type SessionMarksLike,
} from '@/lib/sync-reconcile';

/**
 * The single merge seam (AGENTS.md §4). Every path — initial load, Realtime refresh,
 * retry, restore, full re-sync — routes through these functions, so the rules are tested once
 * here and cannot quietly differ per entity.
 */

const base: ReconciliationContext = {
  cloudIdFor: (_entity, localId) => `11111111-1111-4111-8111-${localId.padStart(12, '0')}`,
  pendingRecordIds: new Set<string>(),
  deletedRecordIds: [],
  tombstonedKeys: new Set<string>(),
};

const remote = (id: string, name = 'سحابي') => ({ id, name });
const local = (id: string, name = 'محلي') => ({ id, name });

describe('§1 entity lists: remote wins', () => {
  it('returns the remote list untouched when there is no local copy', () => {
    expect(reconcileEntityList('class', [remote('a')], undefined, base)).toEqual([remote('a')]);
    expect(reconcileEntityList('class', [remote('a')], [], base)).toEqual([remote('a')]);
  });

  it('keeps the remote version when the same record exists locally', () => {
    const result = reconcileEntityList('class', [remote('a', 'النسخة السحابية')], [local('a', 'النسخة المحلية')], base);
    expect(result).toEqual([remote('a', 'النسخة السحابية')]);
  });

  it('drops a local-only record that has no queued work', () => {
    expect(reconcileEntityList('class', [], [local('a')], base)).toEqual([]);
  });

  it('keeps a local-only record while the outbox still holds work for it', () => {
    const context = { ...base, pendingRecordIds: new Set(['class:a']) };
    expect(reconcileEntityList('class', [], [local('a')], context)).toEqual([local('a')]);
  });

  it('recognises a record that already exists remotely under its cloud id', () => {
    // A `local-*` id maps to a server uuid; matching only on the local id would keep a
    // duplicate copy of a record that is already in the cloud.
    const context = { ...base, pendingRecordIds: new Set(['class:a']) };
    const cloudId = base.cloudIdFor('class', 'a');
    expect(reconcileEntityList('class', [remote(cloudId)], [local('a')], context)).toEqual([remote(cloudId)]);
  });

  it('drops a record deleted in this session even while it is queued', () => {
    const context = {
      ...base,
      pendingRecordIds: new Set(['class:a']),
      deletedRecordIds: ['class:a'],
    };
    expect(reconcileEntityList('class', [], [local('a')], context)).toEqual([]);
  });

  it('drops a record the server reports as deleted, by either id spelling', () => {
    const cloudId = base.cloudIdFor('class', 'a');
    const byCloudId = { ...base, pendingRecordIds: new Set(['class:a']), tombstonedKeys: new Set([`class:${cloudId}`]) };
    const byLocalId = { ...base, pendingRecordIds: new Set(['class:a']), tombstonedKeys: new Set(['class:a']) };

    expect(reconcileEntityList('class', [], [local('a')], byCloudId)).toEqual([]);
    expect(reconcileEntityList('class', [], [local('a')], byLocalId)).toEqual([]);
  });

  it('appends pending locals after the remote list without disturbing it', () => {
    const context = { ...base, pendingRecordIds: new Set(['class:b']) };
    const result = reconcileEntityList('class', [remote('a')], [local('a'), local('b')], context);
    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('treats an empty tombstone set as "nothing is deleted" rather than bailing out early', () => {
    const context = { ...base, pendingRecordIds: new Set(['class:a']), tombstonedKeys: new Set<string>() };
    expect(reconcileEntityList('class', [], [local('a')], context)).toHaveLength(1);
  });

  it('works for every entity name the engine uses', () => {
    const entities = ['class', 'student', 'grade', 'session', 'timetable', 'lessonProgress', 'customUnit', 'lessonPlan', 'dashboardTask'] as const;
    for (const entity of entities) {
      const context = { ...base, pendingRecordIds: new Set([`${entity}:a`]) };
      expect(reconcileEntityList(entity, [], [local('a')], context), entity).toHaveLength(1);
      expect(reconcileEntityList(entity, [], [local('a')], base), entity).toHaveLength(0);
    }
  });
});

describe('§2 predicate helpers', () => {
  it('scopes pending/deleted/tombstoned lookups to entity + record id', () => {
    const context: ReconciliationContext = {
      ...base,
      pendingRecordIds: new Set(['student:s1']),
      deletedRecordIds: ['class:c1'],
      tombstonedKeys: new Set(['grade:g1']),
    };
    expect(isPending(context, 'student', 's1')).toBe(true);
    expect(isPending(context, 'class', 's1')).toBe(false);
    expect(isPending(context, 'student', 's2')).toBe(false);
    expect(isDeletedLocally(context, 'class', 'c1')).toBe(true);
    expect(isTombstoned(context, 'grade', 'g1')).toBe(true);
    expect(isTombstoned(context, 'grade', 'g2')).toBe(false);
    expect(isTombstoned(base, 'grade', 'g1')).toBe(false);
  });

  it('checks both id spellings for tombstones', () => {
    const context: ReconciliationContext = { ...base, tombstonedKeys: new Set(['class:server-id']) };
    expect(isTombstoned(context, 'class', 'server-id', 'local-id')).toBe(true);
    expect(isTombstoned(context, 'class', 'other', 'local-id')).toBe(false);
  });
});

describe('§3 session marks: the cloud is the baseline, pending marks override', () => {
  const attendanceRows = [
    { session_id: 's1', student_id: 'st-cloud', status: 'absent' },
    { session_id: 's1', student_id: 'st-late', status: 'late' },
    { session_id: 's1', student_id: 'st-excused', status: 'excused' },
    { session_id: 's1', student_id: 'st-present', status: 'present' },
    { session_id: 's1', student_id: 'st-weird', status: 'something-else' },
  ];
  const behaviorRows = [
    { session_id: 's1', student_id: 'st-cloud', behavior: 'disruptions' },
    { session_id: 's1', student_id: 'st-cloud', behavior: 'not-a-real-field' },
  ];

  function run(localSessions: SessionMarksLike[], pending: string[] = []) {
    const sessions: SessionMarksLike[] = [{ id: 's1' }];
    const result = reconcileSessionMarks(
      sessions,
      new Map(localSessions.map((session) => [session.id, session])),
      attendanceRows,
      behaviorRows,
      { ...base, pendingRecordIds: new Set(pending) },
    );
    return { session: sessions[0], result };
  }

  it('applies cloud marks and maps every status to the client vocabulary', () => {
    const { session } = run([]);
    expect(session.attendance).toEqual({
      'st-cloud': 'ABSENT',
      'st-late': 'LATE',
      'st-excused': 'EXCUSED',
      'st-present': 'PRESENT',
      'st-weird': 'PRESENT',
    });
  });

  it('collects behaviours into their fields and ignores unknown ones', () => {
    const { session } = run([]);
    expect(session.disruptions).toEqual(['st-cloud']);
    expect(session.unwrittenLessons).toEqual([]);
    expect(session.poorParticipation).toEqual([]);
    expect(session.goodParticipation).toEqual([]);
  });

  it('keeps an offline attendance mark that the cloud has not received yet', () => {
    const { session, result } = run(
      [{ id: 's1', attendance: { 'st-offline': 'ABSENT' } }],
      ['attendance:s1:st-offline'],
    );
    expect(session.attendance?.['st-offline']).toBe('ABSENT');
    expect(result.pendingAttendance.get('s1')?.has('st-offline')).toBe(true);
  });

  it('drops an unpending local attendance mark (cloud deletion wins)', () => {
    const { session } = run([{ id: 's1', attendance: { 'st-gone': 'ABSENT' } }], []);
    expect(session.attendance?.['st-gone']).toBeUndefined();
  });

  it('lets a pending mark override the cloud value for the same student', () => {
    const { session } = run(
      [{ id: 's1', attendance: { 'st-cloud': 'PRESENT' } }],
      ['attendance:s1:st-cloud'],
    );
    expect(session.attendance?.['st-cloud']).toBe('PRESENT');
    expect(session.attendance?.['st-late']).toBe('LATE'); // other students follow the cloud
  });

  it('keeps a pending behaviour and drops an unpending one', () => {
    const { session, result } = run(
      [{ id: 's1', disruptions: ['st-pending'], goodParticipation: ['st-gone'] }],
      ['behavior:s1:st-pending:disruptions'],
    );
    expect(session.disruptions).toEqual(['st-pending', 'st-cloud']);
    expect(session.goodParticipation).toEqual([]);
    expect(result.pendingBehaviors.get('s1')?.has('st-pending:disruptions')).toBe(true);
  });

  it('does not duplicate a student already present from the cloud', () => {
    const { session } = run(
      [{ id: 's1', disruptions: ['st-cloud'] }],
      ['behavior:s1:st-cloud:disruptions'],
    );
    expect(session.disruptions).toEqual(['st-cloud']);
  });

  it('ignores a behaviour row whose field is not part of the client shape', () => {
    const sessions: SessionMarksLike[] = [{ id: 's1' }];
    reconcileSessionMarks(sessions, new Map(), [], [{ session_id: 's1', student_id: 'st', behavior: 'unknown' }], base);
    for (const field of BEHAVIOR_FIELDS) expect(sessions[0][field]).toEqual([]);
  });

  it('resets every behaviour field on each pass so a removed mark cannot linger', () => {
    const sessions: SessionMarksLike[] = [{ id: 's1', disruptions: ['st-old'], goodParticipation: ['st-old'] }];
    reconcileSessionMarks(sessions, new Map(), [], [], base);
    expect(sessions[0].disruptions).toEqual([]);
    expect(sessions[0].goodParticipation).toEqual([]);
  });

  it('ignores rows for sessions that are not in the remote workspace', () => {
    const sessions: SessionMarksLike[] = [{ id: 's1' }];
    reconcileSessionMarks(sessions, new Map(), [{ session_id: 'other', student_id: 'st', status: 'absent' }], [], base);
    expect(sessions[0].attendance).toEqual({});
  });
});
