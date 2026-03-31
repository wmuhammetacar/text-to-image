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
  { href: "/billing", label: "Krediler", icon: CreditCard },
];

export function AppShell(props: {
  userEmail: string | null;
  onSignOut: () => Promise<void>;
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] gap-3 px-3 py-3 md:px-5">
      <aside className="hidden w-44 shrink-0 rounded-3xl bg-white/[0.035] p-2.5 backdrop-blur-xl md:flex md:flex-col md:justify-between">
        <div className="space-y-3">
          <div className="px-2 pt-1">
            <h1 className="text-sm font-semibold tracking-tight text-white/90">Pixora</h1>
            <p className="text-[10px] text-white/35">Yaratıcı işletim sistemi</p>
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
                    "flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition duration-200",
                    isActive
                      ? "soft-glow bg-primary/90 text-primary-foreground"
                      : "text-foreground/55 hover:bg-white/8 hover:text-white/90",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-[13px]">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="space-y-2 border-t border-white/5 px-1 pt-2.5">
          <p className="truncate text-[10px] text-white/25">{props.userEmail ?? "Kullanıcı"}</p>
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            className="justify-start text-white/70 hover:text-white"
            onClick={() => void props.onSignOut()}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Çıkış Yap
          </Button>
        </div>
      </aside>

      <div className="flex min-h-full flex-1 flex-col gap-4">
        <header className="glass-panel rounded-2xl p-2 md:hidden">
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
                    isActive ? "soft-glow bg-primary text-primary-foreground" : "bg-white/6 text-white/85",
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
