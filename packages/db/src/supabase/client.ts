import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

interface SupabaseBaseConfig {
  supabaseUrl: string;
}

interface UserScopedConfig extends SupabaseBaseConfig {
  supabaseAnonKey: string;
  accessToken: string;
}

interface ServiceRoleConfig extends SupabaseBaseConfig {
  supabaseServiceRoleKey: string;
}

export function createSupabaseUserServerClient(
  config: UserScopedConfig,
): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createSupabaseServiceRoleClient(
  config: ServiceRoleConfig,
): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
