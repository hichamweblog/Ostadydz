'use client';

import React, {useEffect, useRef} from 'react';

interface AccessibleDialogProps {
  open: boolean;
  titleId: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  describedBy?: string;
}

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function AccessibleDialog({
  open,
  titleId,
  onClose,
  children,
  className = '',
  describedBy,
}: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusFirst = () => {
      // Do not steal focus if an element inside the dialog is already focused (e.g. active input or autoFocus)
      if (dialogRef.current && dialogRef.current.contains(document.activeElement)) {
        return;
      }
      const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const frameId = requestAnimationFrame(focusFirst);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frameId);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCloseRef.current?.();
      }}
      role="presentation" >
      <div
        ref={dialogRef}
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={describedBy}
        dir="rtl" className={className}
      >
        {children}
      </div>
    </div>
  );
}
