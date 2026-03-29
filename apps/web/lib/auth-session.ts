"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "./supabase-browser";

export type AuthSessionStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthSessionState {
  status: AuthSessionStatus;
  user: User | null;
}

export function useAuthSession(): AuthSessionState {
  const [state, setState] = useState<AuthSessionState>({
    status: "loading",
    user: null,
  });

  const supabase = useMemo(() => getBrowserSupabaseClient(), []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async (): Promise<void> => {
      const { data, error } = await supabase.auth.getUser();
      if (cancelled) {
        return;
      }

      if (error !== null || data.user === null) {
        setState({ status: "unauthenticated", user: null });
        return;
      }

      setState({ status: "authenticated", user: data.user });
    };

    void initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user !== undefined) {
        setState({ status: "authenticated", user: session.user });
        return;
      }

      setState({ status: "unauthenticated", user: null });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  return state;
}
