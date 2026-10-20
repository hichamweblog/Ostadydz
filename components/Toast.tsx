'use client';
import { useEffect, useState } from 'react';

type ToastType = 'success' | 'error' | 'warning';

interface ToastEvent {
  message: string;
  type: ToastType;
}

let toastListener: ((event: ToastEvent) => void) | null = null;

export const showToast = (message: string, type: ToastType) => {
  if (toastListener) {
    toastListener({ message, type });
  }
};

export default function ToastContainer() {
  const [toast, setToast] = useState<ToastEvent | null>(null);

  useEffect(() => {
    toastListener = (event: ToastEvent) => {
      setToast(event);
      setTimeout(() => setToast(null), 5000);
    };
    return () => {
      toastListener = null;
    };
  }, []);

  if (!toast) return null;

  const bgColors = {
    success: 'bg-[var(--success)]', // emerald
    error: 'bg-[var(--danger)]',
    warning: 'bg-[var(--warning)] text-white', // royal gold
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[140] animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-none">
      <div className={`${bgColors[toast.type]} ${toast.type !== 'warning' ? 'text-white' : ''} px-6 py-3 rounded-lg shadow-lg font-tajawal text-sm flex items-center gap-2 dir-rtl`} dir="rtl">
        {toast.message}
      </div>
    </div>
  );
}
