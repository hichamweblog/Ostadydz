export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return null;
  }
  if (publishableKey.startsWith('http://') || publishableKey.startsWith('https://')) {
    console.error('Invalid Supabase publishable key: a URL was provided instead of a key.');
    return null;
  }

  return { url, publishableKey };
}

export function getPublicAppUrl(): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configuredUrl) return null;
  try {
    return new URL(configuredUrl).origin;
  } catch {
    console.error('Invalid NEXT_PUBLIC_APP_URL. Expected an absolute URL.');
    return null;
  }
}
