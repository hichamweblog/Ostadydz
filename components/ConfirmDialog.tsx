import React from 'react';
import { AccessibleDialog } from './AccessibleDialog';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
}) => {
  return (
    <AccessibleDialog open={isOpen} titleId="confirm-dialog-title" describedBy="confirm-dialog-message" onClose={onCancel} className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
      <div>
        <h3 id="confirm-dialog-title" className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
        <p id="confirm-dialog-message" className="text-sm text-slate-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="min-h-11 px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] transition-colors cursor-pointer" >
            إلغاء
          </button>
          <button
            onClick={onConfirm}
            className="min-h-11 px-4 py-2 rounded-xl bg-[var(--danger)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)] text-white font-bold transition-colors shadow-xs cursor-pointer" >
            تأكيد الحذف
          </button>
        </div>
      </div>
    </AccessibleDialog>
  );
};
