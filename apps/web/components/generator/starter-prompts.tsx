"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export interface StarterPromptPreset {
  id: string;
  label: string;
  text: string;
  creativeMode: "fast" | "balanced" | "directed";
  category: string;
}

export function StarterPrompts(props: {
  presets: StarterPromptPreset[];
  onSelect: (presetId: string) => void;
  onGenerate?: (presetId: string) => void;
  headline?: string;
  description?: string;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.headline ?? "Ne üretmek istediğini seç"}</CardTitle>
        <CardDescription>
          {props.description ??
            "Bir öneriye dokun, prompt otomatik dolsun. İstersen tek tıkla hemen üret."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {props.presets.map((preset) => (
          <article
            key={preset.id}
            className="rounded-2xl border border-border/60 bg-secondary/25 px-3 py-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-white">{preset.label}</p>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {preset.category}
              </span>
            </div>
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{preset.text}</p>
            <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              mod: {preset.creativeMode}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-white/15"
                onClick={() => props.onSelect(preset.id)}
              >
                Doldur
              </button>
              {props.onGenerate !== undefined ? (
                <button
                  type="button"
                  className="rounded-full bg-primary/75 px-3 py-1.5 text-xs text-white transition hover:bg-primary"
                  onClick={() => props.onGenerate?.(preset.id)}
                >
                  Hemen üret
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
