import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STREAMS,
  ACTIVE_SUBJECTS,
  ASSIGNMENT_BUNDLES,
  getOfferingsForSubject,
  getRelatedSubjectsForAssignment,
  getSubjectsForStream,
  OFFERINGS_2006,
  resolveClassAssignedSubjects,
  resolveCoefficient,
  resolveEffectiveScheme,
  resolveWeeklyHours,
} from '@/lib/education';
import { calculateStudentAverage } from '@/lib/grade-calculator';
import { INITIAL_STATE } from '@/lib/storage';
import {
  selectClassAssignedSubjectIds,
  selectEffectiveSubjectId,
  selectGradesByClassAndTrimester,
  selectTeacherSubjectIds,
} from '@/lib/state-selectors';

describe('Decision 186/2006 Catalog, Multi-Subject Assignment & Evaluation Schemes', () => {
  it('registers all 18 active secondary subjects and active streams', () => {
    expect(ACTIVE_SUBJECTS.length).toBeGreaterThanOrEqual(18);
    expect(ACTIVE_STREAMS.length).toBeGreaterThanOrEqual(8);
    expect(OFFERINGS_2006.length).toBeGreaterThan(80);
  });

  it('resolves exact Decision 186/2006 coefficients and weekly hours across streams', () => {
    // 1. Physics in 3AS MATH vs 3AS EXP_SCI vs 2AS LIT_PHIL
    expect(
      resolveCoefficient({ levelCode: '3AS', streamId: 'MATH', subjectId: 'PHYSICS' })
    ).toBe(6);
    expect(
      resolveWeeklyHours({ levelCode: '3AS', streamId: 'MATH', subjectId: 'PHYSICS' }).total
    ).toBe(6);

    expect(
      resolveCoefficient({ levelCode: '3AS', streamId: 'EXP_SCI', subjectId: 'PHYSICS' })
    ).toBe(5);
    expect(
      resolveWeeklyHours({ levelCode: '3AS', streamId: 'EXP_SCI', subjectId: 'PHYSICS' }).total
    ).toBe(5);

    expect(
      resolveCoefficient({ levelCode: '2AS', streamId: 'LIT_PHIL', subjectId: 'PHYSICS' })
    ).toBe(2);
    expect(
      resolveWeeklyHours({ levelCode: '2AS', streamId: 'LIT_PHIL', subjectId: 'PHYSICS' }).total
    ).toBe(2);

    // 2. Islamic Sciences: 1AS TC_SCI = 1h (coeff 2), 1AS TC_ARTS = 2h (coeff 2), 3AS = 2h (coeff 2)
    expect(
      resolveWeeklyHours({ levelCode: '1AS', streamId: 'TC_SCI', subjectId: 'ISLAMIC' }).total
    ).toBe(1);
    expect(
      resolveWeeklyHours({ levelCode: '1AS', streamId: 'TC_ARTS', subjectId: 'ISLAMIC' }).total
    ).toBe(2);
    expect(
      resolveCoefficient({ levelCode: '3AS', streamId: 'EXP_SCI', subjectId: 'ISLAMIC' })
    ).toBe(2);

    // 3. Management & Economy (2AS / 3AS MGMT_ECO): Accounting, Economy, Law
    expect(
      resolveCoefficient({ levelCode: '3AS', streamId: 'MGMT_ECO', subjectId: 'ACCOUNTING_FIN' })
    ).toBe(6);
    expect(
      resolveCoefficient({ levelCode: '3AS', streamId: 'MGMT_ECO', subjectId: 'ECON_MGMT' })
    ).toBe(5);
    expect(
      resolveCoefficient({ levelCode: '3AS', streamId: 'MGMT_ECO', subjectId: 'LAW' })
    ).toBe(2);
  });

  it('supports pedagogical multi-subject assignment bundles (Management+Law, Tech+CS, Physics+Tech)', () => {
    expect(ASSIGNMENT_BUNDLES.length).toBeGreaterThanOrEqual(4);
    const mgmtBundle = ASSIGNMENT_BUNDLES.find(b => b.id === 'MGMT_ECO_ALL');
    expect(mgmtBundle?.subjectIds).toEqual(['ACCOUNTING_FIN', 'ECON_MGMT', 'LAW']);

    const techCsBundle = ASSIGNMENT_BUNDLES.find(b => b.id === 'TECH_WITH_INF');
    expect(techCsBundle?.subjectIds).toEqual(['TECHNOLOGY', 'COMPUTER_SCI']);

    expect(getRelatedSubjectsForAssignment('TECHNOLOGY')).toContain('COMPUTER_SCI');
    expect(getRelatedSubjectsForAssignment('ECON_MGMT')).toContain('LAW');
    expect(getRelatedSubjectsForAssignment('PHYSICS')).toContain('TECHNOLOGY');
  });

  it('intersects teacher assigned subjects with stream offerings for each class', () => {
    // Teacher assigned Accounting + Economy + Law
    const assigned2AsMgmt = resolveClassAssignedSubjects({
      teacherSubjectIds: ['ACCOUNTING_FIN', 'ECON_MGMT', 'LAW'],
      primarySubjectId: 'ACCOUNTING_FIN',
      levelCode: '2AS',
      streamId: 'MGMT_ECO',
    });
    expect(assigned2AsMgmt).toEqual(['ACCOUNTING_FIN', 'ECON_MGMT', 'LAW']);

    // Teacher assigned Physics + Technology:
    // - For 1AS TC_SCI class: both Physics and Technology are taught in 1AS TC_SCI
    const assigned1AsSci = resolveClassAssignedSubjects({
      teacherSubjectIds: ['PHYSICS', 'TECHNOLOGY'],
      primarySubjectId: 'PHYSICS',
      levelCode: '1AS',
      streamId: 'TC_SCI',
    });
    expect(assigned1AsSci).toEqual(['PHYSICS', 'TECHNOLOGY']);

    // - For 3AS EXP_SCI class: only Physics is in the stream offerings (Technology is Engineering stream)
    const assigned3AsExp = resolveClassAssignedSubjects({
      teacherSubjectIds: ['PHYSICS', 'TECHNOLOGY'],
      primarySubjectId: 'PHYSICS',
      levelCode: '3AS',
      streamId: 'EXP_SCI',
    });
    expect(assigned3AsExp).toEqual(['PHYSICS']);
  });

  it('calculates multi-subject student averages with dynamic schemes and overrides', () => {
    // Standard STD4: (continuous + devoir + exam*2) / 4
    expect(calculateStudentAverage(14, 16, 15)).toBe(15);

    // Lab scheme LAB5: (continuous + devoir + practical + exam*2) / 5
    const physicsScheme = resolveEffectiveScheme({
      subjectId: 'PHYSICS',
      levelCode: '2AS',
      streamId: 'EXP_SCI',
    });
    expect(physicsScheme.hasPractical).toBe(true);
    expect(physicsScheme.divisor).toBe(5);
    expect(
      calculateStudentAverage(15, 13, 16, {
        subjectId: 'PHYSICS',
        levelCode: '2AS',
        streamId: 'EXP_SCI',
        practicalWork: 14,
      })
    ).toBe((15 + 13 + 14 + 16 * 2) / 5);

    // Language scheme LANG5: (continuous + devoir + oral + exam*2) / 5
    const frenchScheme = resolveEffectiveScheme({
      subjectId: 'FRENCH',
      levelCode: '2AS',
      streamId: 'LIT_PHIL',
    });
    expect(frenchScheme.hasOral).toBe(true);
    expect(frenchScheme.divisor).toBe(5);
    expect(
      calculateStudentAverage(14, 12, 15, {
        subjectId: 'FRENCH',
        levelCode: '2AS',
        streamId: 'LIT_PHIL',
        oralExpression: 16,
      })
    ).toBe((14 + 12 + 16 + 15 * 2) / 5);

    // Teacher override: 2 devoirs enabled on Math
    const overrides = {
      version: 1 as const,
      schemes: {},
      schemeBySubject: {
        MATH: {
          devoirCount: 2,
        },
      },
    };
    const mathScheme = resolveEffectiveScheme({
      subjectId: 'MATH',
      levelCode: '3AS',
      streamId: 'MATH',
      overrides,
    });
    expect(mathScheme.devoirCount).toBe(2);
    // Devoir mean = (12 + 16) / 2 = 14; total = (14 + 14 + 15*2) / 4 = 14.5
    expect(
      calculateStudentAverage(14, 12, 15, {
        subjectId: 'MATH',
        levelCode: '3AS',
        streamId: 'MATH',
        devoir2: 16,
        overrides,
      })
    ).toBe(14.5);
  });

  it('isolates grades per subject when a teacher teaches multiple subjects to the same class', () => {
    const cls = {
      id: 'cls-2ge',
      name: '2 تسيير 1',
      level: '2AS' as const,
      levelCode: '2AS' as const,
      streamId: 'MGMT_ECO' as const,
      stream: 'تسيير واقتصاد',
      assignedSubjectIds: ['ACCOUNTING_FIN', 'ECON_MGMT', 'LAW'] as const,
    };

    const state = {
      ...INITIAL_STATE,
      activeSubjectId: 'LAW' as const,
      profile: {
        ...INITIAL_STATE.profile,
        primarySubjectId: 'ACCOUNTING_FIN' as const,
        taughtSubjectIds: ['ACCOUNTING_FIN', 'ECON_MGMT', 'LAW'] as const,
      },
      classes: [{ ...cls, assignedSubjectIds: [...cls.assignedSubjectIds] }],
      grades: [
        {
          id: 'g-acc',
          studentId: 'st-1',
          classId: 'cls-2ge',
          subjectId: 'ACCOUNTING_FIN' as const,
          trimester: 1 as const,
          continuousEval: 15,
          quiz: 16,
          exam: 17,
        },
        {
          id: 'g-law',
          studentId: 'st-1',
          classId: 'cls-2ge',
          subjectId: 'LAW' as const,
          trimester: 1 as const,
          continuousEval: 12,
          quiz: 13,
          exam: 14,
        },
      ],
    };

    expect(selectTeacherSubjectIds(state)).toEqual(['ACCOUNTING_FIN', 'ECON_MGMT', 'LAW']);
    expect(selectClassAssignedSubjectIds(state, state.classes[0])).toEqual([
      'ACCOUNTING_FIN',
      'ECON_MGMT',
      'LAW',
    ]);
    expect(selectEffectiveSubjectId(state, state.classes[0])).toBe('LAW');

    const lawGrades = selectGradesByClassAndTrimester(state, 'cls-2ge', 1, 'LAW');
    expect(lawGrades).toHaveLength(1);
    expect(lawGrades[0].id).toBe('g-law');

    const accountingGrades = selectGradesByClassAndTrimester(state, 'cls-2ge', 1, 'ACCOUNTING_FIN');
    expect(accountingGrades).toHaveLength(1);
    expect(accountingGrades[0].id).toBe('g-acc');

    expect(getOfferingsForSubject('LAW').length).toBeGreaterThanOrEqual(2);
    expect(getSubjectsForStream('2AS', 'MGMT_ECO').some(o => o.subjectId === 'LAW')).toBe(true);
  });

  it('preserves multi-subject grades during outbox replay without clobbering across subjects', async () => {
    const { replayOutboxEntriesOnState } = await import('@/lib/sync-outbox');
    const baseState = {
      ...INITIAL_STATE,
      grades: [
        {
          id: 'g-acc-1',
          studentId: 'st-1',
          classId: 'cls-2ge',
          subjectId: 'ACCOUNTING_FIN' as const,
          trimester: 1 as const,
          continuousEval: 15,
          quiz: 16,
          exam: 17,
        },
      ],
    };

    const replayed = replayOutboxEntriesOnState(baseState, [
      {
        id: 'entry-1',
        ownerId: 'owner-1',
        revision: 1,
        updatedAt: '2026-10-19T12:00:00Z',
        createdAt: '2026-10-19T12:00:00Z',
        operations: [
          {
            id: 'grade:g-law-1',
            entity: 'grade',
            action: 'upsert',
            recordId: 'g-law-1',
            payload: {
              id: 'g-law-1',
              studentId: 'st-1',
              classId: 'cls-2ge',
              subjectId: 'LAW',
              trimester: 1,
              continuousEval: 13,
              quiz: 14,
              exam: 15,
            },
          },
        ],
      },
    ]);

    expect(replayed.grades).toHaveLength(2);
    expect(replayed.grades.find(g => g.subjectId === 'ACCOUNTING_FIN')?.exam).toBe(17);
    expect(replayed.grades.find(g => g.subjectId === 'LAW')?.exam).toBe(15);
  });

  it('extracts Supabase project ref and detects missing table errors accurately', async () => {
    const {
      extractSupabaseProjectRef,
      isMissingTableResponse,
      REQUIRED_SUPABASE_TABLES,
    } = await import('@/lib/supabase/schema-diagnostics');

    expect(extractSupabaseProjectRef('https://hfoepqrnfsigfjpwxcmf.supabase.co')).toBe(
      'hfoepqrnfsigfjpwxcmf'
    );
    expect(REQUIRED_SUPABASE_TABLES.length).toBe(18);
    expect(
      isMissingTableResponse({
        code: 'PGRST205',
        message: "Could not find the table 'public.classes' in the schema cache",
      })
    ).toBe(true);
    expect(
      isMissingTableResponse({
        code: '42501',
        message: 'permission denied for table classes',
      })
    ).toBe(false);
  });
});
