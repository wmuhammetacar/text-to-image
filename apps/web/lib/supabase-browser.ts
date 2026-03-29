"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let singleton: SupabaseClient | null = null;

function getPublicSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url === undefined || url.length === 0) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL tanimli degil.");
  }

  if (anonKey === undefined || anonKey.length === 0) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY tanimli degil.");
  }

  return {
    url,
    anonKey,
  };
}

export function getBrowserSupabaseClient(): SupabaseClient {
  if (singleton !== null) {
    return singleton;
  }

  const config = getPublicSupabaseConfig();
  singleton = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return singleton;
}
