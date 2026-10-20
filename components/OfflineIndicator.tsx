"use client"
import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { CloudOff, RefreshCw, WifiOff } from 'lucide-react';

type SyncStatus = 'loading' | 'ready' | 'sync-pending' | 'sync-failed' | 'conflict' | 'local-only';

export const OfflineIndicator: React.FC<{
  cloudStatus?: SyncStatus;
  syncError?: string | null;
  localStorageError?: string | null;
  onRetry?: () => void;
  onOpenConflict?: () => void;
}> = ({ cloudStatus = 'ready', syncError, localStorageError, onRetry, onOpenConflict }) => {
  const isOnline = useOnlineStatus();

  if (isOnline && cloudStatus === 'ready' && !localStorageError) return null;

  return (
    <div
      className="fixed top-18 inset-x-3 sm:inset-x-auto sm:left-4 z-50 flex items-center justify-between sm:justify-start gap-2 rounded-xl bg-slate-900/95 backdrop-blur-md px-3.5 py-2.5 text-xs font-bold text-white shadow-xl animate-in slide-in-from-top-2 fade-in max-w-lg sm:max-w-md"
      dir="rtl"
      role="status"
    >
      <div className="flex items-center gap-2 min-w-0">
        {localStorageError
          ? <CloudOff className="w-4 h-4 text-rose-400 shrink-0" />
          : !isOnline
            ? <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
            : cloudStatus === 'sync-pending' || cloudStatus === 'loading'
              ? <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
              : <CloudOff className="w-4 h-4 text-rose-400 shrink-0" />}
        <span className="truncate sm:whitespace-normal">
          {localStorageError
            ? `خطأ في الحفظ المحلي — صدّر نسخة احتياطية فوراً: ${localStorageError}`
            : !isOnline
            ? 'وضع عدم الاتصال — يتم حفظ أعمالك محلياً.'
            : cloudStatus === 'loading'
              ? 'جارٍ مزامنة مساحة العمل...'
              : cloudStatus === 'sync-pending'
                ? 'جارٍ حفظ التغييرات...'
                : cloudStatus === 'conflict'
                  ? `يوجد تعارض يحتاج إعادة المحاولة${syncError ? `: ${syncError}` : ''}`
                  : cloudStatus === 'sync-failed'
                    ? 'تعذّر الحفظ السحابي — ستتم إعادة المحاولة تلقائياً.'
                    : 'الحفظ السحابي متوقف — تغييراتك محفوظة محلياً.'}
        </span>
      </div>
      {isOnline && cloudStatus === 'conflict' && onOpenConflict && (
        <button type="button" onClick={onOpenConflict} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white/15 px-2 text-[11px] hover:bg-white/25">
          مراجعة
        </button>
      )}
      {isOnline && cloudStatus === 'sync-failed' && onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white/15 px-2 text-[11px] hover:bg-white/25">
          <RefreshCw className="h-3.5 w-3.5" />
          إعادة المحاولة
        </button>
      )}
    </div>
  );
};
