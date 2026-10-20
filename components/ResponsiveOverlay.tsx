'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { AccessibleDialog } from './AccessibleDialog';

interface ResponsiveOverlayProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  overlayId?: string;
  className?: string;
}

/**
 * Shared overlay primitive: bottom sheet on phones and centered dialog on larger
 * screens. It participates in browser history so Android Back closes the sheet.
 */
export function ResponsiveOverlay({
  open,
  title,
  onClose,
  children,
  overlayId,
  className = '',
}: ResponsiveOverlayProps) {
  const generatedId = useId().replace(/:/g, '');
  const id = overlayId || generatedId;
  const titleId = `${id}-title`;
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const marker = `overlay:${id}`;
    window.history.pushState({ ...window.history.state, overlay: marker }, '');
    const handlePopState = () => onCloseRef.current();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [open, id]);

  const close = () => {
    if (window.history.state?.overlay === `overlay:${id}`) window.history.back();
    else onClose();
  };

  return (
    <AccessibleDialog
      open={open}
      titleId={titleId}
      onClose={close}
      className={`fixed inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:static sm:max-h-[88dvh] sm:w-full sm:max-w-lg sm:rounded-2xl ${className}`}
    >
      <div className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-white/95 px-5 pb-3 pt-2 backdrop-blur sm:rounded-t-2xl">
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" aria-hidden="true" />
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 id={titleId} className="text-base font-black text-[var(--text-primary)]">{title}</h2>
          <button type="button" onClick={close} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label={`إغلاق ${title}`}>
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      {children}
    </AccessibleDialog>
  );
}
