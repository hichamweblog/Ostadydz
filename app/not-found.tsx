import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] px-6 text-center"
      dir="rtl"
    >
      <section className="max-w-md rounded-3xl border border-[var(--border-default)] bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-[var(--primary)]">معين الأستاذ</p>
        <h1 className="mt-3 text-2xl font-black text-[var(--text-primary)]">
          الصفحة غير موجودة
        </h1>
        <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
          تعذر العثور على الصفحة المطلوبة. تحقق من الرابط أو عد إلى لوحة التحكم.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex min-h-[var(--touch-target)] items-center rounded-xl bg-[var(--primary)] px-5 text-sm font-bold text-white"
        >
          العودة إلى لوحة التحكم
        </Link>
      </section>
    </main>
  );
}
