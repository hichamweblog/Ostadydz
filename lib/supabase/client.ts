import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { getSupabaseEnv } from './env'

export function createClient(): SupabaseClient<Database> | null {
  const env = getSupabaseEnv()
  if (!env) return null

  return createBrowserClient<Database>(env.url, env.publishableKey)
}
