import { getConfig } from "@vi/config";
import {
  createSupabaseServiceRoleClient,
  createSupabaseUserServerClient,
} from "@vi/db";
import type { SupabaseClient } from "@supabase/supabase-js";

let cachedServiceClient: SupabaseClient | null = null;

export function createWebUserSupabaseClient(accessToken: string): SupabaseClient {
  const config = getConfig();
  return createSupabaseUserServerClient({
    supabaseUrl: config.SUPABASE_URL,
    supabaseAnonKey: config.SUPABASE_ANON_KEY,
    accessToken,
  });
}

export function getWebServiceSupabaseClient(): SupabaseClient {
  if (cachedServiceClient !== null) {
    return cachedServiceClient;
  }

  const config = getConfig();
  cachedServiceClient = createSupabaseServiceRoleClient({
    supabaseUrl: config.SUPABASE_URL,
    supabaseServiceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
  });

  return cachedServiceClient;
}
