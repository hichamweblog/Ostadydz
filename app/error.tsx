'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6" role="alert">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center shadow-sm">
        <h1 className="mb-4 text-2xl font-bold text-[var(--foreground)]">خطأ غير متوقع</h1>
        <p className="mb-6 text-[var(--muted-foreground)]">حدث خطأ أثناء معالجة طلبك.</p>
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-[var(--primary)] px-6 py-3 font-bold text-[var(--primary-foreground)] transition-colors hover:bg-[var(--primary-hover)]"
        >
          حاول مرة أخرى
        </button>
      </div>
    </main>
  );
}
