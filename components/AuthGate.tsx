'use client';

import { useEffect, useState } from 'react';
import { Globe, Mail, X } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { clearAppStateCache } from '@/lib/state-cache';
import type { User } from '@supabase/supabase-js';

interface AuthGateProps {
  children: (user: User | null, onSignOut: () => void) => React.ReactNode;
}

/**
 * Non-blocking AuthGate:
 * - Opens immediately in local workspace mode (`user = null`) with zero loading screen delay.
 * - Listens in the background for an active Supabase session (`getSession` + `onAuthStateChange`)
 *   so cloud sync activates automatically whenever the teacher signs in.
 */
export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<User | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted && data?.session?.user) {
          setUser(data.session.user);
        }
      })
      .catch(() => {});

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (nextUser) {
        setShowLoginModal(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleAuthAction = () => {
    if (user) {
      void supabaseSignOut().then(() => setUser(null));
    } else {
      setShowLoginModal(true);
    }
  };

  return (
    <>
      {children(user, handleAuthAction)}
      {showLoginModal && !user && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" dir="rtl">
          <div
            className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs transition-opacity"
            onClick={() => setShowLoginModal(false)}
          />
          <div
            className="relative z-10 w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-[var(--border-default)] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="تسجيل الدخول السحابي"
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-2">
              <div>
                <h2 className="text-lg font-black text-[var(--text-primary)]">
                  تسجيل الدخول السحابي (اختياري)
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  تعمل المنصة حالياً في الوضع التجريبي المحلي دون الحاجة لحساب
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="إغلاق نافذة تسجيل الدخول"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <LoginPanel onClose={() => setShowLoginModal(false)} />
          </div>
        </div>
      )}
    </>
  );
}

async function supabaseSignOut() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user?.id) {
      await clearAppStateCache(data.user.id);
    } else {
      await clearAppStateCache();
    }
  } catch {
    await clearAppStateCache();
  }
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Supabase sign-out failed:', error);
}

function LoginPanel({ onClose }: { onClose?: () => void }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const signIn = async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setWorking(true);
    setErrorMessage(null);
    try {
      const next = `${window.location.pathname}${window.location.search}`;
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) throw error;
    } catch (error) {
      console.error('Google sign-in failed:', error);
      setErrorMessage('تعذر بدء تسجيل الدخول. أعد المحاولة بعد قليل.');
      setWorking(false);
    }
  };

  const signInWithEmail = async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !email.trim()) return;
    setWorking(true);
    setErrorMessage(null);
    try {
      const next = `${window.location.pathname}${window.location.search}`;
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setEmailSent(true);
    } catch (error) {
      console.error('Email sign-in failed:', error);
      setErrorMessage('تعذر إرسال رابط الدخول. تحقق من البريد وأعد المحاولة.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="px-6 pb-6 pt-3 w-full max-w-md mx-auto flex flex-col gap-4">
      {errorMessage && (
        <div className="p-3 bg-red-50 text-red-700 text-xs font-bold rounded-xl border border-red-100">
          {errorMessage}
        </div>
      )}

      <button
        type="button"
        disabled={working}
        onClick={signIn}
        className="w-full min-h-12 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-center gap-3 hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
      >
        <Globe className="w-5 h-5 text-[var(--primary)]" />
        <span className="font-bold text-sm text-slate-700">المتابعة باستخدام Google</span>
      </button>

      <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
        <div className="h-px bg-slate-200 flex-1"></div>
        أو عبر البريد الإلكتروني
        <div className="h-px bg-slate-200 flex-1"></div>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="بريدك الإلكتروني"
            className="w-full min-h-12 rounded-2xl bg-slate-50 border border-slate-200 px-4 text-center text-sm outline-none focus:border-[var(--primary)] focus:bg-white transition-all"
            dir="ltr"
          />
        </div>
        <button
          type="button"
          disabled={working || !email.trim()}
          onClick={() => void signInWithEmail()}
          className="w-full min-h-12 rounded-2xl bg-[var(--primary)] text-white text-sm font-bold shadow-md shadow-[var(--primary)]/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2 cursor-pointer"
        >
          <Mail className="w-4 h-4" />
          <span>
            {emailSent
              ? 'تم الإرسال (راجع بريدك)'
              : working
              ? 'جارٍ الإرسال...'
              : email.trim()
              ? 'إرسال رابط الدخول'
              : 'أدخل بريدك أولاً'}
          </span>
        </button>
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-11 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          الاستمرار في التجربة المحلية دون تسجيل دخول
        </button>
      )}
    </div>
  );
}
