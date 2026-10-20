import { NextResponse } from 'next/server';
import { getPublicAppUrl } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestOrigin = getPublicOrigin(request, url);
  const configuredOrigin = getPublicAppUrl();
  const origin = requestOrigin ?? configuredOrigin ?? url.origin;
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!code) {
    return NextResponse.redirect(new URL('/?auth=error&reason=missing_code', origin));
  }

  // Supabase can fall back to its Site URL after the provider callback. Forward
  // the still-unused code to the canonical app origin so the PKCE cookie created
  // there is available for the exchange.
  if (
    configuredOrigin &&
    configuredOrigin !== requestOrigin &&
    url.hostname.endsWith('.vercel.app')
  ) {
    const canonicalCallback = new URL('/auth/callback', configuredOrigin);
    canonicalCallback.searchParams.set('code', code);
    if (next) canonicalCallback.searchParams.set('next', next);
    return NextResponse.redirect(canonicalCallback);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(new URL('/?auth=error&reason=missing_supabase_config', origin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('OAuth code exchange failed:', error);
    return NextResponse.redirect(new URL('/?auth=error&reason=code_exchange_failed', origin));
  }

  const destination = new URL(safeNext, origin);
  return NextResponse.redirect(destination);
}

function getPublicOrigin(request: Request, fallbackUrl: URL): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (!forwardedHost) return fallbackUrl.origin;

  try {
    const origin = new URL(`${forwardedProto || fallbackUrl.protocol.replace(':', '')}://${forwardedHost}`);
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') return fallbackUrl.origin;
    return origin.origin;
  } catch {
    return fallbackUrl.origin;
  }
}
