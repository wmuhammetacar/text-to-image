"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiClientError } from "../../lib/api-client";
import { getBrowserSupabaseClient } from "../../lib/supabase-browser";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

type AuthMode = "signin" | "signup";

function normalizeNextPath(raw: string | null): string {
  if (raw === null || raw.length === 0) {
    return "/";
  }

  if (!raw.startsWith("/")) {
    return "/";
  }

  return raw;
}

function mapAuthErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Giriş sırasında beklenmeyen bir hata oluştu.";
}

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const nextPath = useMemo(() => normalizeNextPath(searchParams.get("next")), [searchParams]);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user !== null) {
        router.replace(nextPath);
      }
    });
  }, [nextPath, router]);

  const submitLabel = mode === "signin" ? "Giriş Yap" : "Hesap Oluştur";

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const supabase = getBrowserSupabaseClient();

      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error !== null) {
          throw error;
        }

        router.replace(nextPath);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error !== null) {
        throw error;
      }

      if (data.session === null) {
        setInfoMessage(
          "Hesap oluşturuldu. E-posta doğrulama açıksa kutunuzu kontrol edin, sonra giriş yapın.",
        );
      } else {
        router.replace(nextPath);
      }
    } catch (error) {
      setErrorMessage(mapAuthErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-5xl place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Visual Intelligence</CardTitle>
          <CardDescription>
            Duygudan görsele üretim için oturum açın.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">E-posta</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Şifre</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={6}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {errorMessage !== null ? (
              <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {errorMessage}
              </p>
            ) : null}

            {infoMessage !== null ? (
              <p className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
                {infoMessage}
              </p>
            ) : null}

            <Button type="submit" fullWidth disabled={loading}>
              {loading ? "İşleniyor..." : submitLabel}
            </Button>
          </form>

          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>{mode === "signin" ? "Hesabın yok mu?" : "Hesabın var mı?"}</span>
            <button
              type="button"
              className="font-medium text-primary"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Hesap oluştur" : "Giriş yap"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
