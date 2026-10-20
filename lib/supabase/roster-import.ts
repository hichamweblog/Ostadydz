import { createSupabaseBrowserClient } from './browser';
import type { GradeLevel, Student } from '@/lib/types';
import { normalizeDateToIso } from '@/lib/date-utils';
import { getCloudRecordId } from './core-sync';
import { getWeeklyHours } from '@/lib/curriculum-data';
import { DEFAULT_CLASS_COLOR, pickClassColor } from '@/lib/class-colors';

export interface RosterImportClass {
  id: string;
  name: string;
  level: GradeLevel;
  stream: string;
  roomNumber?: string;
  /** لون تمييز القسم (يُختار تلقائياً إن لم يرفقه المستورد) */
  color?: string;
}

export interface RosterImportStudent extends Omit<Student, 'classId'> {
  classId: string;
}

export interface CommittedRoster {
  classes: RosterImportClass[];
  students: RosterImportStudent[];
}

export async function commitRosterImportBatch(
  classes: RosterImportClass[],
  students: RosterImportStudent[],
): Promise<CommittedRoster> {
  if (classes.length === 0) return { classes: [], students: [] };
  const client = createSupabaseBrowserClient();
  if (!client) {
    throw new Error('تعذر الوصول إلى الخادم السحابي لتأكيد استيراد القوائم.');
  }

  const { data: authData } = await client.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    throw new Error('يجب تسجيل الدخول لتأكيد استيراد القوائم في السحابة.');
  }

  // كل قسم يحصل على لون مختلف عن بقية الأقسام في نفس الاستيراد
  const usedColors: string[] = [];
  const mappedClasses = classes.map((c) => {
    const requested = typeof c.color === 'string' ? c.color.trim() : '';
    const color = requested || pickClassColor(usedColors);
    usedColors.push(color);
    return {
      id: getCloudRecordId(userId, 'class', c.id),
      name: c.name.trim(),
      level: c.level,
      stream: c.stream || '',
      section: c.stream || '',
      roomNumber: c.roomNumber?.trim() || null,
      color,
    };
  });

  const mappedStudents = students.map((s) => ({
    id: getCloudRecordId(userId, 'student', s.id),
    class_id: getCloudRecordId(userId, 'class', s.classId),
    classId: getCloudRecordId(userId, 'class', s.classId),
    full_name: s.fullName.trim(),
    fullName: s.fullName.trim(),
    number_in_list: s.numberInList,
    numberInList: s.numberInList,
    reg_number: s.regNumber || null,
    registration_number: s.registrationNumber || s.regNumber || null,
    gender: s.gender === 'M' ? 'M' : s.gender === 'F' ? 'F' : null,
    birth_date: normalizeDateToIso(s.birthDate) || null,
    is_repeater: Boolean(s.isRepeater),
    guardian_phone: s.guardianPhone || null,
    notes: s.notes || null,
  }));

  // Resolve Workspace
  let wid: string | null = null;
  const widResult = await (client as any).rpc('default_workspace_id');
  if (typeof widResult.data === 'string' && widResult.data) {
    wid = widResult.data;
  } else {
    const { data: ws } = await (client as any).from('workspaces').select('id').eq('owner_id', userId).maybeSingle();
    if (ws?.id) {
      wid = ws.id;
    } else {
      const { data: createdWs } = await (client as any).from('workspaces').upsert({ owner_id: userId }, { onConflict: 'owner_id' }).select('id').single();
      if (createdWs?.id) wid = createdWs.id;
    }
  }

  // Check for existing classes by name to prevent unique constraint collision on (workspace_id, name, academic_year)
  const { data: existingClasses } = await (client as any)
    .from('classes')
    .select('id, name')
    .eq('owner_id', userId);

  const existingClassMap = new Map<string, string>();
  for (const c of (existingClasses || []) as Array<{ id?: string; name?: string }>) {
    if (typeof c.name === 'string' && typeof c.id === 'string') {
      existingClassMap.set(c.name.trim(), c.id);
    }
  }

  for (const c of mappedClasses) {
    const matchedExistingId = existingClassMap.get(c.name);
    if (matchedExistingId && matchedExistingId !== c.id) {
      for (const s of mappedStudents) {
        if (s.class_id === c.id || s.classId === c.id) {
          s.class_id = matchedExistingId;
          s.classId = matchedExistingId;
        }
      }
      c.id = matchedExistingId;
    }
  }

  const classIds = Array.from(new Set(mappedClasses.map((c) => c.id)));

  // Reconcile students with existing DB records to prevent unique constraint collisions
  // on (workspace_id, class_id, number_in_list) and preserve grades/attendance foreign keys
  let existingDbStudents: any[] = [];
  if (classIds.length > 0) {
    try {
      const { data: dbStudents } = await (client as any)
        .from('students')
        .select('id, class_id, number_in_list, reg_number, registration_number, full_name')
        .in('class_id', classIds)
        .eq('owner_id', userId);
      if (dbStudents) existingDbStudents = dbStudents;
    } catch (e) {
      console.warn('Error fetching existing students for reconciliation:', e);
    }
  }

  if (existingDbStudents.length > 0) {
    const usedDbStudentIds = new Set<string>();
    for (const s of mappedStudents) {
      const candidates = existingDbStudents.filter(
        (ex: any) => ex.class_id === s.class_id && !usedDbStudentIds.has(ex.id)
      );

      let match = candidates.find((ex: any) =>
        s.reg_number && (ex.reg_number === s.reg_number || ex.registration_number === s.reg_number)
      );

      if (!match) {
        match = candidates.find((ex: any) =>
          ex.number_in_list === s.number_in_list &&
          (ex.full_name?.trim() === s.full_name || !ex.full_name)
        );
      }

      if (!match) {
        match = candidates.find((ex: any) => ex.number_in_list === s.number_in_list);
      }

      if (match) {
        usedDbStudentIds.add(match.id);
        s.id = match.id;
      }
    }
  }

  const studentIds = mappedStudents.map((s) => s.id);

  // Clear stale tombstones for these classes and students so they are never blocked by stale deletions
  try {
    await (client as any)
      .from('sync_tombstones')
      .delete()
      .eq('owner_id', userId)
      .in('entity_type', ['class', 'student'])
      .in('entity_id', [...classIds, ...studentIds]);
  } catch (err) {
    console.warn('Tombstone cleanup warning during roster import:', err);
  }

  const dbClasses = mappedClasses.map((c) => ({
    id: c.id,
    workspace_id: wid,
    owner_id: userId,
    name: c.name,
    level: c.level,
    section: c.section || null,
    weekly_hours: getWeeklyHours(c.level),
    academic_year: null,
    room_number: c.roomNumber?.trim() || null,
    color: c.color || DEFAULT_CLASS_COLOR,
    updated_by: userId,
  }));

  const { error: classesErr } = await (client as any)
    .from('classes')
    .upsert(dbClasses, { onConflict: 'id' });
  if (classesErr) throw classesErr;

  // Avoid wiping existing students (which cascades to delete their grades/attendance).
  // Only delete students belonging to these classes who are truly absent from the new import.
  if (classIds.length > 0 && existingDbStudents.length > 0) {
    try {

      if (existingDbStudents && existingDbStudents.length > 0) {
        const importedIdSet = new Set(mappedStudents.map((s) => s.id));
        const idsToDelete = existingDbStudents
          .map((s: any) => s.id)
          .filter((id: string) => !importedIdSet.has(id));

        if (idsToDelete.length > 0) {
          for (let i = 0; i < idsToDelete.length; i += 100) {
            await (client as any)
              .from('students')
              .delete()
              .in('id', idsToDelete.slice(i, i + 100));
          }
        }

        // Temporarily shift existing retained students' numbers by +10000 to prevent
        // duplicate key constraint violations on (workspace_id, class_id, number_in_list) during renumbering
        const retained = existingDbStudents.filter((s: any) => importedIdSet.has(s.id));
        if (retained.length > 0) {
          for (let i = 0; i < retained.length; i += 50) {
            const batch = retained.slice(i, i + 50);
            await Promise.all(
              batch.map((row: any) =>
                (client as any)
                  .from('students')
                  .update({ number_in_list: row.number_in_list + 10000 })
                  .eq('id', row.id)
              )
            );
          }
        }
      }
    } catch (cleanErr) {
      console.warn('Non-destructive student cleanup warning:', cleanErr);
    }
  }

  const dbStudents = mappedStudents.map((s) => ({
    id: s.id,
    workspace_id: wid,
    owner_id: userId,
    class_id: s.class_id,
    full_name: s.full_name,
    number_in_list: s.number_in_list,
    reg_number: s.reg_number,
    registration_number: s.registration_number,
    gender: s.gender === 'M' ? 'male' : s.gender === 'F' ? 'female' : null,
    birth_date: s.birth_date,
    is_repeater: s.is_repeater,
    guardian_phone: s.guardian_phone,
    notes: s.notes,
    updated_by: userId,
  }));

  for (let i = 0; i < dbStudents.length; i += 100) {
    const chunk = dbStudents.slice(i, i + 100);
    const { error: studentsErr } = await (client as any)
      .from('students')
      .upsert(chunk, { onConflict: 'id' });
    if (studentsErr) throw studentsErr;
  }

  return {
    classes: mappedClasses.map((c) => ({
      id: c.id,
      name: c.name,
      level: c.level,
      stream: c.stream,
      roomNumber: c.roomNumber || undefined,
      color: c.color,
    })),
    students: mappedStudents.map((s) => ({
      id: s.id,
      classId: s.class_id,
      fullName: s.full_name,
      numberInList: s.number_in_list,
      regNumber: s.reg_number || undefined,
      registrationNumber: s.registration_number || undefined,
      gender: s.gender === 'M' || s.gender === 'F' ? s.gender : undefined,
      birthDate: s.birth_date || undefined,
      isRepeater: s.is_repeater,
      guardianPhone: s.guardian_phone || undefined,
      notes: s.notes || undefined,
    })),
  };
}
