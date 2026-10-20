"use client";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="p-6 text-center">
      <p className="text-sm text-[var(--danger)]">تعذر تحميل قوائم التلاميذ.</p>
      <button className="mt-3 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm text-white" onClick={reset}>
        إعادة المحاولة
      </button>
    </div>
  );
}
