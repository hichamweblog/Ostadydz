"use client"
import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, X } from 'lucide-react';
import { AccessibleDialog } from './AccessibleDialog';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--accent-gold)] hover:bg-[var(--accent-gold-hover)] text-[var(--accent-navy)] text-xs font-black shadow-sm transition-colors cursor-pointer"
        title="تثبيت التطبيق"
        aria-label="تثبيت التطبيق" >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">تثبيت التطبيق</span>
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--accent-gold)] hover:bg-[var(--accent-gold-hover)] text-[var(--accent-navy)] text-xs font-black shadow-sm transition-colors cursor-pointer"
          title="تثبيت التطبيق"
          aria-label="تثبيت التطبيق" >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">تثبيت التطبيق</span>
        </button>

        {showIOSGuide && (
          <AccessibleDialog open={showIOSGuide} titleId="ios-install-title" onClose={() => setShowIOSGuide(false)} className="bg-white rounded-xl p-5 max-w-sm w-full shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 id="ios-install-title" className="font-bold text-[var(--text-primary)] text-lg">تثبيت التطبيق (iOS)</h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-10 min-w-10 text-slate-400 hover:text-slate-700 transition-colors p-1 rounded-lg flex items-center justify-center"
                  aria-label="إغلاق إرشادات تثبيت التطبيق" >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
                <p>لتثبيت <strong>معين</strong> على هاتف iPhone أو iPad، اتبع الخطوات التالية:</p>
                <ol className="list-decimal list-inside space-y-2 font-medium">
                  <li>اضغط على زر المشاركة <strong>(Share)</strong> في شريط متصفح سفاري أسفل الشاشة.</li>
                  <li>مرر للأسفل واختر <strong>إضافة إلى الصفحة الرئيسية (Add to Home Screen)</strong>.</li>
                  <li>اضغط على <strong>إضافة (Add)</strong> في أعلى الشاشة.</li>
                </ol>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-11 mt-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2.5 rounded-xl transition-colors" >
                حسناً، فهمت
              </button>
          </AccessibleDialog>
        )}
      </>
    );
  }

  return null;
};
