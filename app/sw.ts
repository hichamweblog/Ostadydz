import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Supabase responses must never be served from a cache.
 *
 * `defaultCache` routes every cross-origin GET through `NetworkFirst` with a one-hour
 * expiration. That covers the whole Supabase REST API (classes, students, grades, sessions,
 * `sync_tombstones`, ...), so a record deleted on another device could be replayed from the
 * HTTP cache for up to an hour — the local database would then hold rows the server has
 * already forgotten, and a reload could resurrect them. Reads are cheap and already
 * authoritative; they must always hit the network.
 */
const configuredSupabaseUrl = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.NEXT_PUBLIC_SUPABASE_URL;

const configuredSupabaseHost = (() => {
  try {
    return configuredSupabaseUrl ? new URL(configuredSupabaseUrl).hostname : null;
  } catch {
    return null;
  }
})();

function isSupabaseUrl(url: URL): boolean {
  if (configuredSupabaseHost && url.hostname === configuredSupabaseHost) return true;
  // Managed Supabase projects, for when the env var is not inlined into this bundle.
  return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in');
}

/**
 * Auth callbacks are single-use and carry one-time codes; replaying a cached response would
 * break sign-in and could bind the wrong session.
 */
function isAuthFlow(url: URL): boolean {
  return url.pathname.startsWith('/auth/');
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Order matters: the first matching route wins, so these rules must precede defaultCache.
  runtimeCaching: [
    {
      matcher: ({ url }: { url: URL }) => isSupabaseUrl(url),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url }: { url: URL }) => isAuthFlow(url),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
