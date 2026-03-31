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
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4 md:px-6">
      <div className="flex items-center justify-between">
        <Link href="/gallery" className={buttonVariants({ variant: "ghost", className: "rounded-full bg-white/8 px-4" })}>
          Galeri
        </Link>
        <Link
          href={`/login?next=${encodeURIComponent(`/share/${slug}?auto_remix=1${initialRemixType !== null ? `&remix_type=${initialRemixType}` : ""}&from=share_cta`)}`}
          className={buttonVariants({ variant: "default", className: "rounded-full px-5" })}
        >
          Remixle
        </Link>
      </div>
      <PublicGenerationShareView
        shareSlug={slug}
        autoRemix={autoRemix}
        initialRemixType={initialRemixType}
      />
    </div>
  );
}
