import { createSupabaseBrowserClient } from './browser';
import { getSupabaseEnv } from './env';

export const REQUIRED_SUPABASE_TABLES = [
  'profiles',
  'workspaces',
  'app_settings',
  'classes',
  'students',
  'grades',
  'sessions',
  'attendance',
  'session_behaviors',
  'timetable_slots',
  'custom_units',
  'lesson_progress',
  'lesson_plans',
  'dashboard_tasks',
  'memoranda_files',
  'sync_operations',
  'sync_conflicts',
  'sync_tombstones',
] as const;

export type RequiredSupabaseTable = (typeof REQUIRED_SUPABASE_TABLES)[number];

export interface TableDiagnosticResult {
  table: RequiredSupabaseTable;
  labelAr: string;
  status: 'ready' | 'missing' | 'error';
  detail?: string;
}

export interface SupabaseReadinessReport {
  configured: boolean;
  projectUrl: string | null;
  projectRef: string | null;
  sqlEditorUrl: string | null;
  authenticated: boolean;
  userEmail: string | null;
  allTablesReady: boolean;
  readyCount: number;
  totalCount: number;
  checkedAt: string;
  tables: TableDiagnosticResult[];
}

export const SUPABASE_TABLE_LABELS_AR: Record<RequiredSupabaseTable, string> = {
  profiles: 'الملف المهني للأستاذ (profiles)',
  workspaces: 'مساحات العمل (workspaces)',
  app_settings: 'إعدادات التطبيق والتقويم (app_settings)',
  classes: 'الأفواج التربوية (classes)',
  students: 'قوائم التلاميذ (students)',
  grades: 'النقاط والعلامات الفصلية (grades)',
  sessions: 'حصص الدفتر اليومي (sessions)',
  attendance: 'سجل الغيابات والمواظبة (attendance)',
  session_behaviors: 'المتابعة السلوكية والبيداغوجية (session_behaviors)',
  timetable_slots: 'جدول التوقيت الأسبوعي (timetable_slots)',
  custom_units: 'وحدات المنهاج المخصصة (custom_units)',
  lesson_progress: 'تقدم إنجاز الدروس (lesson_progress)',
  lesson_plans: 'بطاقات تحضير الدروس (lesson_plans)',
  dashboard_tasks: 'مهام لوحة القيادة (dashboard_tasks)',
  memoranda_files: 'ملفات المذكرات PDF (memoranda_files)',
  sync_operations: 'سجل عمليات المزامنة (sync_operations)',
  sync_conflicts: 'سجل تعارضات المزامنة (sync_conflicts)',
  sync_tombstones: 'شواهد الحذف المتزامن (sync_tombstones)',
};

export function extractSupabaseProjectRef(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.split('.');
    if (hostParts.length >= 3 && hostParts[1] === 'supabase') {
      return hostParts[0] || null;
    }
    return null;
  } catch {
    return null;
  }
}

export function isMissingTableResponse(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ');
  return /could not find the table|relation .* does not exist|schema cache/i.test(text);
}

export async function checkSupabaseReadiness(): Promise<SupabaseReadinessReport> {
  const env = getSupabaseEnv();
  const checkedAt = new Date().toISOString();

  if (!env) {
    return {
      configured: false,
      projectUrl: null,
      projectRef: null,
      sqlEditorUrl: null,
      authenticated: false,
      userEmail: null,
      allTablesReady: false,
      readyCount: 0,
      totalCount: REQUIRED_SUPABASE_TABLES.length,
      checkedAt,
      tables: REQUIRED_SUPABASE_TABLES.map((table) => ({
        table,
        labelAr: SUPABASE_TABLE_LABELS_AR[table],
        status: 'missing',
        detail: 'لم يتم ضبط متغيرات البيئة لـ Supabase',
      })),
    };
  }

  const projectRef = extractSupabaseProjectRef(env.url);
  const sqlEditorUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
    : 'https://supabase.com/dashboard';

  const client = createSupabaseBrowserClient();
  if (!client) {
    return {
      configured: true,
      projectUrl: env.url,
      projectRef,
      sqlEditorUrl,
      authenticated: false,
      userEmail: null,
      allTablesReady: false,
      readyCount: 0,
      totalCount: REQUIRED_SUPABASE_TABLES.length,
      checkedAt,
      tables: REQUIRED_SUPABASE_TABLES.map((table) => ({
        table,
        labelAr: SUPABASE_TABLE_LABELS_AR[table],
        status: 'error',
        detail: 'تعذر تهيئة عميل المتصفح',
      })),
    };
  }

  let authenticated = false;
  let userEmail: string | null = null;
  try {
    const { data } = await client.auth.getSession();
    authenticated = Boolean(data.session?.user);
    userEmail = data.session?.user?.email ?? null;
  } catch {
    authenticated = false;
  }

  const selectColumnFor = (table: RequiredSupabaseTable): string => {
    if (table === 'sync_operations') return 'operation_id';
    if (table === 'sync_tombstones') return 'entity_id';
    return 'id';
  };

  type GenericTableClient = {
    from: (table: string) => {
      select: (
        columns: string,
        options: { head: boolean; count: 'exact' },
      ) => {
        limit: (count: number) => Promise<{
          error: { code?: string; message?: string; details?: string; hint?: string } | null;
        }>;
      };
    };
  };

  const tableClient = client as unknown as GenericTableClient;

  const tableChecks = await Promise.all(
    REQUIRED_SUPABASE_TABLES.map(async (table): Promise<TableDiagnosticResult> => {
      try {
        const col = selectColumnFor(table);
        const { error } = await tableClient
          .from(table)
          .select(col, { head: true, count: 'exact' })
          .limit(1);

        if (!error) {
          return {
            table,
            labelAr: SUPABASE_TABLE_LABELS_AR[table],
            status: 'ready',
          };
        }

        if (isMissingTableResponse(error)) {
          return {
            table,
            labelAr: SUPABASE_TABLE_LABELS_AR[table],
            status: 'missing',
            detail: 'الجدول غير منشأ بعد في قاعدة البيانات',
          };
        }

        // Permission denied (42501 / PGRST301) when unauthenticated still proves the table exists in PostgREST schema cache
        if (error.code === '42501' || error.code === 'PGRST301') {
          return {
            table,
            labelAr: SUPABASE_TABLE_LABELS_AR[table],
            status: 'ready',
            detail: 'الجدول موجود ومحمي بسياسات RLS',
          };
        }

        return {
          table,
          labelAr: SUPABASE_TABLE_LABELS_AR[table],
          status: 'error',
          detail: error.message || 'خطأ في فحص الجدول',
        };
      } catch (err) {
        return {
          table,
          labelAr: SUPABASE_TABLE_LABELS_AR[table],
          status: 'error',
          detail: err instanceof Error ? err.message : 'تعذر الاتصال بالخادم',
        };
      }
    }),
  );

  const readyCount = tableChecks.filter((t) => t.status === 'ready').length;
  return {
    configured: true,
    projectUrl: env.url,
    projectRef,
    sqlEditorUrl,
    authenticated,
    userEmail,
    allTablesReady: readyCount === REQUIRED_SUPABASE_TABLES.length,
    readyCount,
    totalCount: REQUIRED_SUPABASE_TABLES.length,
    checkedAt,
    tables: tableChecks,
  };
}
