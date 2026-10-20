'use client';

import type { SyncConflictDescriptor } from '@/lib/sync-outbox';

function preview(value: unknown): string {
  if (value === undefined) return 'لا توجد بيانات قابلة للعرض';
  return JSON.stringify(value, null, 2);
}

export function SyncConflictDialog({
  conflict,
  busy,
  onKeepRemote,
  onKeepLocal,
}: {
  conflict: SyncConflictDescriptor | null;
  busy: boolean;
  onKeepRemote: () => Promise<void>;
  onKeepLocal: () => Promise<void>;
}) {
  if (!conflict) return null;
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/40 p-4" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl">
        <h2 id="sync-conflict-title" className="text-lg font-bold text-slate-900">مراجعة تعارض المزامنة</h2>
        <p className="mt-2 text-sm text-slate-600">
          يوجد تعديل سحابي أحدث من التعديل المحلي. لن يتم الكتابة فوق أي نسخة دون اختيارك.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <h3 className="font-bold text-amber-900">النسخة المحلية (revision {conflict.localRevision})</h3>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-amber-950">{preview(conflict.localPayload)}</pre>
          </section>
          <section className="rounded-xl border border-sky-200 bg-sky-50 p-3">
            <h3 className="font-bold text-sky-900">النسخة السحابية (revision {conflict.remoteRevision})</h3>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-sky-950">{preview(conflict.remotePayload)}</pre>
          </section>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => void onKeepRemote()} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">الاحتفاظ بالسحابية</button>
          <button type="button" disabled={busy} onClick={() => void onKeepLocal()} className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">الاحتفاظ بالمحلية</button>
        </div>
      </div>
    </div>
  );
}
