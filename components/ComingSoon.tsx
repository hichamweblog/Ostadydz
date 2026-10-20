'use client';

import React from 'react';
import Image from 'next/image';
import { Wrench } from 'lucide-react';

interface ComingSoonProps {
  onRequestLogin: () => void;
}

export const ComingSoon: React.FC<ComingSoonProps> = ({ onRequestLogin }) => {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg-page)] px-4 py-10 text-center"
      dir="rtl"
    >
      <Image src="/pwa-192x192.png" alt="معين" width={80} height={80} className="rounded-2xl" priority />

      <div className="mt-8 flex items-center gap-2 rounded-full bg-[var(--warning-soft)] px-4 py-1.5 text-xs font-bold text-[var(--warning)]">
        <Wrench className="h-3.5 w-3.5" />
        قيد التعديل حالياً
      </div>

      <h1 className="mt-6 text-2xl font-black text-[var(--text-primary)] sm:text-3xl">
        معين الأستاذ
      </h1>

      <p className="mt-4 max-w-md text-sm leading-7 text-[var(--text-secondary)]">
        نعمل حالياً على تطوير الموقع وتحسينه. سيعود التطبيق للعمل قريباً، نشكر صبركم.
      </p>

      <footer className="mt-16 flex flex-col items-center gap-3 text-xs text-[var(--text-tertiary)]">
        <span>© {new Date().getFullYear()} معين الأستاذ</span>
        <button
          type="button"
          onClick={onRequestLogin}
          className="text-[var(--text-tertiary)] underline-offset-2 transition-colors hover:text-[var(--primary)] hover:underline"
        >
          دخول
        </button>
      </footer>
    </main>
  );
};
