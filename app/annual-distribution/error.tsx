'use client';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[50vh] items-center justify-center p-6" role="alert">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-center shadow-sm">
        <h1 className="mb-3 text-xl font-bold text-[var(--foreground)]">تعذر تحميل مساحة العمل</h1>
        <p className="mb-5 text-[var(--muted-foreground)]">حدث خطأ مؤقت. حاول تحديث الصفحة.</p>
        <button type="button" onClick={reset} className="rounded-xl bg-[var(--primary)] px-5 py-2.5 font-bold text-[var(--primary-foreground)] transition-colors hover:bg-[var(--primary-hover)]">
          حاول مرة أخرى
        </button>
      </div>
    </main>
  );
}
