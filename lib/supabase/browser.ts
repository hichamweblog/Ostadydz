'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from './env';
import type { Database } from './database.types';
import { createEgressDebugFetch } from './egress-debug';

let browserClient: SupabaseClient<Database> | null = null;

export function createSupabaseBrowserClient(): SupabaseClient<Database> | null {
  if (browserClient) return browserClient;

  const env = getSupabaseEnv();
  if (!env) return null;

  const debugEnabled = process.env.NEXT_PUBLIC_SUPABASE_EGRESS_DEBUG === 'true';
  browserClient = createBrowserClient(env.url, env.publishableKey, {
    global: debugEnabled
      ? { fetch: createEgressDebugFetch(window.fetch.bind(window)) }
      : undefined,
  });
  return browserClient;
}
