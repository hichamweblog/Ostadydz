'use client';

import React, { useState } from 'react';
import { AccessibleDialog } from './AccessibleDialog';
import { AlertTriangle, CloudUpload, Download, LogOut } from 'lucide-react';

interface SignOutDialogProps {
  isOpen: boolean;
  pendingOperations: number;
  cloudStatus: string;
  syncError?: string | null;
  onSyncThenSignOut: () => Promise<boolean>;
  onExportBackup: () => void;
  onSignOutAnyway: () => void;
  onCancel: () => void;
}

/**
 * Sign-out is destructive for this device: the local workspace copy is removed so a shared
 * device never keeps (or re-uploads) the teacher's data. When anything is still unsynced we
 * stop and ask instead of silently discarding work.
 */
export const SignOutDialog: React.FC<SignOutDialogProps> = ({
  isOpen,
  pendingOperations,
  cloudStatus,
  syncError,
  onSyncThenSignOut,
  onExportBackup,
  onSignOutAnyway,
  onCancel,
}) => {
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const handleSyncThenSignOut = async () => {
    setWorking(true);
    setFailure(null);
    const flushed = await onSyncThenSignOut();
    setWorking(false);
    if (!flushed) {
      setFailure('تعذرت المزامنة الكاملة (شبكة أو خادم). يمكنك تصدير نسخة احتياطية ثم الخروج، أو المحاولة لاحقاً.');
    }
  };

  return (
    <AccessibleDialog
      open={isOpen}
      titleId="signout-dialog-title"
      describedBy="signout-dialog-message"
      onClose={onCancel}
      className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200"
    >
      <div>
        <h3 id="signout-dialog-title" className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-[var(--danger)]" />
          تغييرات لم تُزامن بعد
        </h3>
        <p id="signout-dialog-message" className="text-sm text-slate-600 leading-7">
          {pendingOperations > 0
            ? `يوجد ${pendingOperations} تغيير في انتظار الرفع إلى الحساب السحابي.`
            : 'الحالة السحابية لهذا الجهاز غير مستقرة حالياً.'}
          {' '}الخروج يحذف نسخة هذا المتصفح، لذا زامن التغييرات أو صدّر نسخة احتياطية أولاً.
          {syncError ? ` (${syncError})` : ''}
        </p>
        <p className="mt-2 text-[11px] font-bold text-slate-500">حالة المزامنة: {cloudStatus}</p>

        {failure && (
          <p role="alert" className="mt-4 rounded-lg bg-[var(--danger)]/10 px-3 py-2 text-xs font-bold text-[var(--danger)]">
            {failure}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={working}
            onClick={() => void handleSyncThenSignOut()}
            className="min-h-11 w-full rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] px-4 py-2 font-bold text-white transition-colors disabled:cursor-wait disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
          >
            <CloudUpload className="w-4 h-4" />
            {working ? 'جارٍ المزامنة...' : 'مزامنة الآن ثم الخروج'}
          </button>
          <button
            type="button"
            disabled={working}
            onClick={onExportBackup}
            className="min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2 font-bold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[var(--primary)]" />
            تصدير نسخة احتياطية (JSON)
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 flex-1 rounded-xl px-4 py-2 font-bold text-slate-600 transition-colors hover:bg-slate-100 cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={working}
              onClick={onSignOutAnyway}
              className="min-h-11 flex-1 rounded-xl bg-[var(--danger)] px-4 py-2 font-bold text-white transition-colors hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              الخروج دون مزامنة
            </button>
          </div>
        </div>
      </div>
    </AccessibleDialog>
  );
};
