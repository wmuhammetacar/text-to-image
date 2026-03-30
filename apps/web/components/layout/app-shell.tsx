"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, CreditCard, Heart, History, LogOut, PanelTopOpen } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { href: "/", label: "Oluştur", icon: Compass },
  { href: "/history", label: "Geçmiş", icon: History },
  { href: "/favorites", label: "Favoriler", icon: Heart },
  { href: "/gallery", label: "Galeri", icon: PanelTopOpen },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

export function AppShell(props: {
  userEmail: string | null;
  onSignOut: () => Promise<void>;
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl gap-4 px-4 py-4 md:px-6">
      <aside className="hidden w-60 shrink-0 rounded-2xl border border-border bg-card p-4 shadow-soft md:flex md:flex-col md:justify-between">
        <div className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Visual Intelligence</h1>
            <p className="text-xs text-muted-foreground">Duygudan görsele üretim</p>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-secondary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <p className="truncate text-xs text-muted-foreground">{props.userEmail ?? "Kullanıcı"}</p>
          <Button variant="outline" size="sm" fullWidth onClick={() => void props.onSignOut()}>
            <LogOut className="mr-2 h-4 w-4" />
            Çıkış Yap
          </Button>
        </div>
      </aside>

      <div className="flex min-h-full flex-1 flex-col gap-4">
        <header className="rounded-2xl border border-border bg-card p-3 shadow-soft md:hidden">
          <nav
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm",
                    isActive ? "bg-primary text-primary-foreground" : "bg-secondary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="flex-1">{props.children}</main>
      </div>
    </div>
  );
}
