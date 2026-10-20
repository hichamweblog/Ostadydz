import { del, get, set } from 'idb-keyval';

export interface UrgentTask {
  id: string;
  text: string;
  done: boolean;
}

const TASKS_KEY = 'sanad:dashboard-tasks:v1';

export async function loadDashboardTasks(): Promise<UrgentTask[] | null> {
  if (typeof window === 'undefined') return null;
  return (await get<UrgentTask[]>(TASKS_KEY)) ?? null;
}

export async function saveDashboardTasks(tasks: UrgentTask[]): Promise<void> {
  if (typeof window === 'undefined') return;
  await set(TASKS_KEY, tasks);
}

export async function clearDashboardTasks(): Promise<void> {
  if (typeof window === 'undefined') return;
  await del(TASKS_KEY);
}
