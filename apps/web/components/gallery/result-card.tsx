"use client";

import React from "react";
import Link from "next/link";
import type { PublicGalleryResponseDto } from "@vi/contracts";
import { Flame, Sparkles, Star } from "lucide-react";
import { Badge } from "../ui/badge";
import { buttonVariants } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

type GalleryItem = PublicGalleryResponseDto["items"][number];

export function ResultCard(props: {
  item: GalleryItem;
}): React.JSX.Element {
  const { item } = props;

  return (
    <Card className="overflow-hidden border-border/80 bg-card/95 backdrop-blur">
      <div className="relative">
        <div className="aspect-[4/5] bg-secondary">
          {item.featured_image_url !== null ? (
            <img
              src={item.featured_image_url}
              alt={item.summary}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Önizleme hazır değil
            </div>
          )}
        </div>
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <Badge variant="muted" className="border-white/20 bg-black/60 text-white">
            <Sparkles className="mr-1 h-3 w-3" />
            Pixora
          </Badge>
          {item.featured ? (
            <Badge variant="default" className="bg-emerald-600 text-white">
              <Star className="mr-1 h-3 w-3" />
              Featured
            </Badge>
          ) : null}
        </div>
      </div>

      <CardHeader className="space-y-2">
        <CardTitle className="line-clamp-2 text-base">{item.summary}</CardTitle>
        <CardDescription>
          {item.creator_display_name} · @{item.creator_profile_handle} ·{" "}
          {new Date(item.published_at).toLocaleString("tr-TR")}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {item.style_tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="muted">
              {tag}
            </Badge>
          ))}
          {item.mood_tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="default">
              {tag}
            </Badge>
          ))}
          {item.discovery_badges.slice(0, 3).map((badge) => (
            <Badge key={badge} variant="muted">
              {badge}
            </Badge>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <span>Run: {item.total_runs}</span>
          <span>Variation: {item.variation_count}</span>
          <span>Remix: {item.remix_count}</span>
          <span>Branch: {item.branch_count}</span>
          <span>Refine: {item.refinement_count}</span>
          <span>Variant: {item.total_public_variants}</span>
          <span>Quality: {item.quality_score.toFixed(1)}</span>
          <span className="inline-flex items-center gap-1">
            <Flame className="h-3 w-3" />
            Rank: {item.ranking_score.toFixed(1)}
          </span>
        </div>

        <p className="rounded-xl border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          {item.sort_reason}
        </p>

        <Link
          href={`/share/${item.share_slug}`}
          className={buttonVariants({ fullWidth: true })}
        >
          İncele
        </Link>
      </CardContent>
    </Card>
  );
}
