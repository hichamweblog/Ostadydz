import type { AppState } from './storage';
import type { SessionRecord, TimetableSlot } from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * How many parts (حصص) a single curriculum unit may be split into in the notebook.
 * Raised from 4 to 5 so a five-hour unit can be documented part by part.
 */
export const SESSION_PART_NUMBERS = [1, 2, 3, 4, 5] as const;

export const MAX_SESSION_PARTS = SESSION_PART_NUMBERS.length;

/** Quick-pick reasons for documenting a session that could not be taught. */
export const CANCELLATION_REASON_PRESETS = [
  'الغياب',
  'اجتماع بيداغوجي / إداري',
  'مجلس القسم / التنسيق',
  'ندوة تربوية / يوم تكويني',
  'فترة الفروض والاختبارات',
  'غياب التلاميذ',
  'عطلة رسمية / مناسبة',
  'ظروف طارئة',
] as const;

export const DEFAULT_CANCELLATION_REASON = 'سبب طارئ / غير محدد';

/**
 * The first session of the year carries no curriculum unit: it is dedicated to general
 * guidance and presenting the annual programme. The sentinel id is used only inside the
 * notebook form; stored sessions keep `unitId` undefined and `sessionKind: 'orientation'`.
 */
export const ORIENTATION_SESSION_UNIT_ID = '__ORIENTATION_SESSION__';

export const ORIENTATION_SESSION_TOPIC = 'تقديم توجيهات عامة + تقديم البرنامج';

export const ORIENTATION_SESSION_GOALS = [
  '• التعريف بالمادة وبأهميتها في الحياة الدراسية والتربوية.',
  '• تقديم توجيهات عامة: طريقة العمل في القسم، تنظيم الكراس والدفتر، الواجبات المنزلية.',
  '• تقديم البرنامج السنوي: الميادين والوحدات التعليمية والتوزيع الزمني المتوقع.',
  '• شرح طريقة التقويم المستمر والاختبارات وشروطها.',
].join('\n');

/** Whether a stored session is the orientation session (no unit, guidance topic). */
export function isOrientationSession(
  session: Pick<SessionRecord, 'sessionKind' | 'unitId' | 'customTopic'> | undefined | null,
): boolean {
  if (!session) return false;
  if (session.sessionKind === 'orientation') return true;
  return !session.unitId && session.customTopic?.trim() === ORIENTATION_SESSION_TOPIC;
}

/** A session the teacher recorded as not taught. */
export function isSessionCancelled(session: Pick<SessionRecord, 'sessionStatus'> | undefined | null): boolean {
  return session?.sessionStatus === 'CANCELLED';
}

/**
 * Whether a session counts as "documented" in the notebook.
 *
 * A cancelled session is documented too: the official journal must show that the slot existed
 * and why nothing was taught, so it is never reported as "بانتظار التوثيق".
 */
export function isSessionDocumented(session: SessionRecord): boolean {
  return Boolean(
    isSessionCancelled(session) ||
    session.unitId ||
    session.customTopic?.trim() ||
    session.accomplishments?.trim() ||
    session.notes?.trim() ||
    session.summary?.trim()
  );
}

/** Clamps a part number into the supported 1..MAX_SESSION_PARTS range. */
export function normalizeSessionPart(part: number | undefined | null): number {
  const value = Number(part);
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), MAX_SESSION_PARTS);
}

/**
 * Reads the part number back off a session: the explicit field first, then the `(n)` suffix the
 * notebook writes into `customTopic` (the only place older builds stored it).
 */
export function readSessionPart(session: SessionRecord): number {
  if (typeof session.partNumber === 'number') return normalizeSessionPart(session.partNumber);
  const match = session.customTopic?.match(/\((\d+)\)/);
  return match ? normalizeSessionPart(parseInt(match[1], 10)) : 1;
}

/** The title written into the notebook for a session. */
export function buildSessionTitle(
  unitTitle: string | undefined,
  partNumber: number,
  status: { cancelled: boolean; reason?: string },
): string {
  if (status.cancelled) {
    const reason = status.reason?.trim() || DEFAULT_CANCELLATION_REASON;
    return unitTitle ? `حصة ملغاة (${reason}) — ${unitTitle}` : `حصة ملغاة (${reason})`;
  }
  return unitTitle ? `${unitTitle} (${partNumber})` : `حصة تعليمية (${partNumber})`;
}

/** What goes into the documentation field when the session is cancelled. */
export function buildCancellationNote(reason: string | undefined, extraNotes?: string): string {
  const cleanReason = reason?.trim() || DEFAULT_CANCELLATION_REASON;
  const heading = `حصة ملغاة بسبب: ${cleanReason}`;
  return extraNotes?.trim() ? `${heading}\n${extraNotes.trim()}` : heading;
}

export interface ResolvedSession {
  state: AppState;
  sessionId: string;
  created: boolean;
}

/**
 * Resolves the teaching session represented by a timetable slot.
 *
 * The logical identity is intentionally based on class/date/start time. This
 * mirrors the cloud uniqueness rule and makes repeated taps on "ابدأ الحصة"
 * idempotent, including while the first write is still waiting in the outbox.
 */
export function resolveOrCreateSession(
  state: AppState,
  slot: TimetableSlot,
  date: string,
  createId: () => string = uuidv4,
): ResolvedSession {
  const existing = state.sessions.find(session =>
    session.classId === slot.classId &&
    session.date === date &&
    session.startTime === slot.startTime
  );

  if (existing) {
    return {
      state: state.activeClassId === slot.classId
        ? state
        : { ...state, activeClassId: slot.classId },
      sessionId: existing.id,
      created: false,
    };
  }

  const session: SessionRecord = {
    id: createId(),
    classId: slot.classId,
    date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    room: slot.room,
    sessionGoals: '',
    accomplishments: '',
    nextSteps: '',
    teacherNotes: '',
    attendance: {},
  };

  return {
    state: {
      ...state,
      activeClassId: slot.classId,
      sessions: [session, ...state.sessions],
    },
    sessionId: session.id,
    created: true,
  };
}
