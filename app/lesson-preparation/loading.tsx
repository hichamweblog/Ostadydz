export default function Loading() {
  return (
    <main className="flex min-h-[50vh] items-center justify-center p-6" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3 text-[var(--muted-foreground)]">
        <span className="size-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]" aria-hidden="true" />
        <span>جارٍ تحميل مساحة العمل…</span>
      </div>
    </main>
  );
}
