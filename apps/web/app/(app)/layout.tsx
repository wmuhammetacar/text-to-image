"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "../../components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { useAuthSession } from "../../lib/auth-session";
import { getBrowserSupabaseClient } from "../../lib/supabase-browser";

export default function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  const session = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session.status !== "unauthenticated") {
      return;
    }

    const next = pathname.length > 0 ? pathname : "/";
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [pathname, router, session.status]);

  if (session.status === "loading") {
    return (
      <div className="mx-auto grid min-h-screen w-full max-w-4xl place-items-center px-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Oturum doğrulanıyor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (session.status === "unauthenticated") {
    return (
      <div className="mx-auto grid min-h-screen w-full max-w-4xl place-items-center px-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Giriş sayfasına yönlendiriliyor</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <AppShell
      userEmail={session.user?.email ?? null}
      onSignOut={async () => {
        const supabase = getBrowserSupabaseClient();
        await supabase.auth.signOut();
        router.replace("/login");
      }}
    >
      {children}
    </AppShell>
  );
}
