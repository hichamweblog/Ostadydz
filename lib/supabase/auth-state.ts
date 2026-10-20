'use client';

import type { Session, User } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from './browser';

type AuthSubscriber = (user: User | null) => void;

let initialized = false;
let currentUser: User | null = null;
let initialization: Promise<User | null> | null = null;
const subscribers = new Set<AuthSubscriber>();

function publish(session: Session | null): void {
  currentUser = session?.user ?? null;
  for (const subscriber of subscribers) subscriber(currentUser);
}

export async function initializeAuthState(): Promise<User | null> {
  if (initialized) return currentUser;
  if (initialization) return initialization;

  const client = createSupabaseBrowserClient();
  if (!client) {
    initialized = true;
    return null;
  }

  initialization = (async () => {
    client.auth.onAuthStateChange((_event, session) => publish(session));
    const { data, error } = await client.auth.getUser();
    if (error && error.message !== 'Auth session missing!') throw error;
    currentUser = data.user ?? null;
    initialized = true;
    return currentUser;
  })().finally(() => {
    initialization = null;
  });

  return initialization;
}

export function subscribeToAuthState(subscriber: AuthSubscriber): () => void {
  subscribers.add(subscriber);
  if (initialized) subscriber(currentUser);
  return () => subscribers.delete(subscriber);
}

export function getCachedAuthUser(): User | null | undefined {
  return initialized ? currentUser : undefined;
}
