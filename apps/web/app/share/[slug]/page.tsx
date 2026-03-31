import Link from "next/link";
import type { VariationRequestDto } from "@vi/contracts";
import { PublicGenerationShareView } from "../../../components/gallery/public-generation-share-view";
import { buttonVariants } from "../../../components/ui/button";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    auto_remix?: string;
    remix_type?: string;
    from?: string;
  }>;
}

function isVariationType(value: string | undefined): value is VariationRequestDto["variation_type"] {
  return value === "more_dramatic" ||
    value === "more_minimal" ||
    value === "more_realistic" ||
    value === "more_stylized" ||
    value === "change_lighting" ||
    value === "change_environment" ||
    value === "change_mood" ||
    value === "increase_detail" ||
    value === "simplify_scene" ||
    value === "keep_subject_change_environment" ||
    value === "keep_composition_change_style" ||
    value === "keep_mood_change_realism" ||
    value === "keep_style_change_subject" ||
    value === "upscale";
}

export default async function SharePage({ params, searchParams }: PageProps): Promise<React.JSX.Element> {
  const { slug } = await params;
  const query = await searchParams;
  const autoRemix = query.auto_remix === "1";
  const initialRemixType = isVariationType(query.remix_type) ? query.remix_type : null;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 md:px-6">
      <div className="glass-panel flex flex-wrap items-center justify-between gap-2 rounded-3xl px-4 py-3">
        <div className="text-xs text-muted-foreground">
          Pixora paylaşım · Yaratıcı üretim vitrini
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/login?next=${encodeURIComponent(`/share/${slug}?auto_remix=1${initialRemixType !== null ? `&remix_type=${initialRemixType}` : ""}&from=share_cta`)}`}
            className={buttonVariants({ variant: "default", className: "rounded-full px-5" })}
          >
            Bu görseli remixle
          </Link>
          <Link href="/login?next=%2F" className={buttonVariants({ variant: "outline", className: "rounded-full px-5" })}>
            Kendi görselini üret
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/gallery" className={buttonVariants({ variant: "ghost", className: "rounded-full bg-white/8 px-4" })}>
          Galeriye dön
        </Link>
        <Link href="/" className={buttonVariants({ variant: "ghost", className: "rounded-full bg-white/8 px-4" })}>
          Uygulamaya dön
        </Link>
      </div>
      <PublicGenerationShareView
        shareSlug={slug}
        autoRemix={autoRemix}
        initialRemixType={initialRemixType}
      />

      <footer className="glass-panel rounded-3xl px-4 py-3 text-center text-xs text-muted-foreground">
        Pixora ile üretildi · Paylaş, remixle, dönüştür
      </footer>
    </div>
  );
}
