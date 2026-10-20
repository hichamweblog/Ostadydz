import { getEmptyState } from '@/lib/storage';
import { describe, expect, it } from 'vitest';
import type { AppState } from '../lib/storage';
import type { SessionRecord, TimetableSlot } from '../lib/types';
import { resolveOrCreateSession } from '../lib/session-flow';

const slot: TimetableSlot = {
  id: 'slot-1',
  classId: 'class-1',
  dayOfWeek: 4,
  startTime: '10:00',
  endTime: '11:00',
};

function stateWithSessions(sessions: SessionRecord[] = []): AppState {
  return {
    activeClassId: null,
    sessions,
  } as AppState;
}

describe('resolveOrCreateSession', () => {
  it('creates a session from the timetable time and activates its class', () => {
    const result = resolveOrCreateSession(
      stateWithSessions(),
      slot,
      '2026-10-01',
      () => 'session-1',
    );

    expect(result.created).toBe(true);
    expect(result.sessionId).toBe('session-1');
    expect(result.state.activeClassId).toBe('class-1');
    expect(result.state.sessions[0]).toMatchObject({
      id: 'session-1',
      classId: 'class-1',
      date: '2026-10-01',
      startTime: '10:00',
      endTime: '11:00',
      attendance: {},
    });
  });

  it('is idempotent for repeated start-session actions', () => {
    const existing: SessionRecord = {
      id: 'existing-session',
      classId: 'class-1',
      date: '2026-10-01',
      startTime: '10:00',
      endTime: '11:00',
      sessionGoals: 'درس قائم',
      accomplishments: '',
      nextSteps: '',
      teacherNotes: '',
      attendance: {},
    };

    const result = resolveOrCreateSession(
      stateWithSessions([existing]),
      slot,
      '2026-10-01',
      () => 'must-not-be-used',
    );

    expect(result.created).toBe(false);
    expect(result.sessionId).toBe('existing-session');
    expect(result.state.sessions).toHaveLength(1);
    expect(result.state.sessions[0].sessionGoals).toBe('درس قائم');
  });

  it('allows the same timetable slot on another date', () => {
    const previous: SessionRecord = {
      id: 'previous-session',
      classId: 'class-1',
      date: '2026-09-24',
      startTime: '10:00',
      endTime: '11:00',
      sessionGoals: '',
      accomplishments: '',
      nextSteps: '',
      teacherNotes: '',
      attendance: {},
    };

    const result = resolveOrCreateSession(
      stateWithSessions([previous]),
      slot,
      '2026-10-01',
      () => 'new-session',
    );

    expect(result.created).toBe(true);
    expect(result.state.sessions.map(session => session.id)).toEqual([
      'new-session',
      'previous-session',
    ]);
  });
});


describe('orientation session without a curriculum unit', () => {
  it('recognises both the new kind and a legacy unlinked orientation title', async () => {
    const { isOrientationSession, ORIENTATION_SESSION_TOPIC, isSessionDocumented } = await import('@/lib/session-flow');
    const empty = getEmptyState();
    const slot = { id: 'slot', classId: 'class', dayOfWeek: 0, startTime: '08:00', endTime: '09:00', room: '' };
    const { state } = resolveOrCreateSession(empty, slot, '2026-09-20', () => 'orientation');
    const session = { ...state.sessions[0], sessionKind: 'orientation' as const, unitId: undefined, customTopic: ORIENTATION_SESSION_TOPIC };
    expect(isOrientationSession(session)).toBe(true);
    expect(isSessionDocumented(session)).toBe(true);
    expect(session.unitId).toBeUndefined();
    expect(state.lessonProgress).toEqual([]);
    expect(isOrientationSession({ customTopic: ORIENTATION_SESSION_TOPIC })).toBe(true);
    expect(isOrientationSession({ unitId: 'unit', customTopic: ORIENTATION_SESSION_TOPIC })).toBe(false);
  });
});
