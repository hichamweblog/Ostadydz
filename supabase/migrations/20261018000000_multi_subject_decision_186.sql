-- Migration: 20261018000000_multi_subject_decision_186.sql
-- Adds multi-subject grade columns and removes the single-subject unique constraint on (workspace_id, student_id, trimester)
-- so a teacher teaching multiple subjects to the same class (e.g., Accounting + Economy + Law) can store independent marks per subject.

alter table public.grades
  add column if not exists subject_id text,
  add column if not exists devoir2 numeric(5,2) check (devoir2 between 0 and 20),
  add column if not exists practical_work numeric(5,2) check (practical_work between 0 and 20),
  add column if not exists oral_expression numeric(5,2) check (oral_expression between 0 and 20);

alter table public.grades
  drop constraint if exists grades_workspace_id_student_id_trimester_key;

alter table public.classes
  drop constraint if exists classes_weekly_hours_check;

alter table public.classes
  add constraint classes_weekly_hours_check check (weekly_hours between 1 and 20);
