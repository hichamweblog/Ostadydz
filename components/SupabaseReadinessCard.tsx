'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  checkSupabaseReadiness,
  type SupabaseReadinessReport,
} from '@/lib/supabase/schema-diagnostics';
import { showToast } from './Toast';

interface SupabaseReadinessCardProps {
  onSchemaReady?: () => void;
}

export const SupabaseReadinessCard: React.FC<SupabaseReadinessCardProps> = ({
  onSchemaReady,
}) => {
  const [report, setReport] = useState<SupabaseReadinessReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [copyingSql, setCopyingSql] = useState(false);
  const [showTableDetails, setShowTableDetails] = useState(false);

  const runDiagnostics = useCallback(async (notifyToast = false) => {
    setChecking(true);
    try {
      const nextReport = await checkSupabaseReadiness();
      setReport(nextReport);
      if (notifyToast) {
        if (nextReport.allTablesReady) {
          showToast(
            'تم التحقق بنجاح: جميع جداول Supabase الـ 18 جاهزة للمزامنة اللحظية.',
            'success',
          );
          onSchemaReady?.();
        } else {
          showToast(
            `قاعدة البيانات تحتاج إلى تهيئة (${nextReport.readyCount}/${nextReport.totalCount} جدولاً جاهزاً). انسخ كود SQL وشغّله في Supabase Studio.`,
            'error',
          );
        }
      }
    } catch (error) {
      console.error('Supabase readiness check failed:', error);
      if (notifyToast) {
        showToast('تعذر إتمام فحص جاهزية Supabase.', 'error');
      }
    } finally {
      setChecking(false);
    }
  }, [onSchemaReady]);

  useEffect(() => {
    let active = true;
    checkSupabaseReadiness()
      .then((nextReport) => {
        if (active) {
          setReport(nextReport);
        }
      })
      .catch((error) => {
        console.error('Supabase readiness check failed:', error);
      })
      .finally(() => {
        if (active) {
          setChecking(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleCopyBootstrapSql = async () => {
    setCopyingSql(true);
    try {
      const response = await fetch('/api/supabase-bootstrap');
      if (!response.ok) {
        throw new Error('تعذر تحميل ملف SQL التأسيسي');
      }
      const data = (await response.json()) as { sql?: string };
      if (!data.sql) {
        throw new Error('محتوى SQL فارغ');
      }
      await navigator.clipboard.writeText(data.sql);
      showToast(
        'تم نسخ كود SQL التأسيسي الكامل! الصقه في Supabase SQL Editor واضغط Run.',
        'success',
      );
    } catch (error) {
      console.error('Copy SQL failed:', error);
      showToast(
        'تعذر نسخ كود SQL تلقائياً؛ يمكنك تنزيل ملف supabase-schema.sql مباشرة.',
        'error',
      );
    } finally {
      setCopyingSql(false);
    }
  };

  const handleDownloadBootstrapSql = async () => {
    try {
      const response = await fetch('/api/supabase-bootstrap');
      if (!response.ok) {
        throw new Error('تعذر تحميل ملف SQL التأسيسي');
      }
      const data = (await response.json()) as { sql?: string };
      if (!data.sql) {
        throw new Error('محتوى SQL فارغ');
      }
      const blob = new Blob([data.sql], { type: 'text/sql;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mueen-al-ostad-supabase-schema.sql';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('تم تنزيل ملف المخطط التأسيسي (mueen-al-ostad-supabase-schema.sql).', 'success');
    } catch (error) {
      console.error('Download SQL failed:', error);
      showToast('تعذر تنزيل ملف SQL التأسيسي.', 'error');
    }
  };

  const missingTables = report?.tables.filter((t) => t.status !== 'ready') ?? [];

  return (
    <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-4 h-4 text-[var(--primary)]" />
            <span>فحص جاهزية قاعدة بيانات Supabase والمزامنة السحابية</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            يتحقق آلياً من اتصال المشروع السحابي ووجود الجداول الـ 18 اللازمة للمزامنة اللحظية وتعدد المواد.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runDiagnostics(true)}
          disabled={checking}
          className="min-h-11 inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shrink-0">
          <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
          <span>{checking ? 'جارٍ فحص الجداول...' : 'إعادة فحص الجاهزية'}</span>
        </button>
      </div>

      {report && (
        <div
          className={`rounded-xl border p-4 space-y-3 ${
            report.allTablesReady
              ? 'border-emerald-200 bg-emerald-50/60'
              : 'border-amber-200 bg-amber-50/70'
          }`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2.5">
              {report.allTablesReady ? (
                <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900">
                  {report.allTablesReady
                    ? 'قاعدة البيانات السحابية مهيأة بالكامل وجاهزة للمزامنة اللحظية'
                    : `مشروع Supabase متصل ولكن الجداول التأسيسية لم تُنشأ بعد (${report.readyCount} من ${report.totalCount} جاهز)`}
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {report.projectUrl ? (
                    <>
                      المشروع المربوط:{' '}
                      <span className="font-mono text-slate-800" dir="ltr">
                        {report.projectUrl}
                      </span>
                      {' · '}
                      <span>
                        الجلسة:{' '}
                        {report.authenticated
                          ? `مسجّل الدخول (${report.userEmail || 'حساب نشط'})`
                          : 'وضع محلي / غير مسجّل الدخول حالياً'}
                      </span>
                    </>
                  ) : (
                    'لم يتم العثور على رابط NEXT_PUBLIC_SUPABASE_URL في البيئة.'
                  )}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowTableDetails((prev) => !prev)}
              className="text-xs font-bold text-[var(--primary)] hover:underline cursor-pointer shrink-0">
              {showTableDetails ? 'إخفاء تفاصيل الجداول' : 'عرض حالة الجداول (18)'}
            </button>
          </div>

          {!report.allTablesReady && report.configured && (
            <div className="bg-white border border-amber-200/80 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-slate-900">
                خطوات تفعيل الجداول والمزامنة اللحظية في مشروع Supabase الجديد (خلال دقيقة واحدة):
              </p>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 leading-relaxed">
                <li>
                  اضغط على زر <strong>«نسخ كود SQL التأسيسي الكامل»</strong> أدناه (يضم الجداول الـ 18، سياسات RLS، ودعم المواد المتعددة).
                </li>
                <li>
                  افتح محرر الاستعلامات في مشروعك عبر رابط <strong>«فتح Supabase SQL Editor»</strong> ثم الصق الكود واضغط <strong>Run</strong>.
                </li>
                <li>
                  عد إلى هذه الصفحة واضغط <strong>«إعادة فحص الجاهزية»</strong> ثم <strong>«مزامنة الآن»</strong>.
                </li>
              </ol>

              <div className="flex items-center gap-2.5 flex-wrap pt-1">
                <button
                  type="button"
                  onClick={() => void handleCopyBootstrapSql()}
                  disabled={copyingSql}
                  className="min-h-11 inline-flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-xl text-xs font-bold shadow-xs hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50">
                  <Copy className="w-4 h-4" />
                  <span>{copyingSql ? 'جارٍ النسخ...' : '1. نسخ كود SQL التأسيسي الكامل'}</span>
                </button>

                {report.sqlEditorUrl && (
                  <a
                    href={report.sqlEditorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-11 inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-xs font-bold shadow-xs transition-colors">
                    <ExternalLink className="w-4 h-4 text-[var(--primary)]" />
                    <span>2. فتح Supabase SQL Editor</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => void handleDownloadBootstrapSql()}
                  className="min-h-11 inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer">
                  <Download className="w-4 h-4 text-slate-600" />
                  <span>تنزيل ملف .sql</span>
                </button>
              </div>
            </div>
          )}

          {showTableDetails && (
            <div className="pt-2 border-t border-slate-200/70 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              {report.tables.map((item) => (
                <div
                  key={item.table}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200/80">
                  <span className="font-medium text-slate-800 truncate" title={item.labelAr}>
                    {item.labelAr}
                  </span>
                  {item.status === 'ready' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-bold shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>جاهز</span>
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-rose-700 font-bold shrink-0"
                      title={item.detail}>
                      <XCircle className="w-3.5 h-3.5" />
                      <span>غير منشأ</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {!showTableDetails && missingTables.length > 0 && missingTables.length < report.totalCount && (
            <p className="text-[11px] text-amber-800">
              الجداول الناقصة: {missingTables.map((t) => t.table).join('، ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
