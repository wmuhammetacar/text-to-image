"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export interface StarterPromptPreset {
  id: string;
  label: string;
  text: string;
  creativeMode: "fast" | "balanced" | "directed";
}

export function StarterPrompts(props: {
  presets: StarterPromptPreset[];
  onSelect: (presetId: string) => void;
  headline?: string;
  description?: string;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.headline ?? "İlk üretimi başlat"}</CardTitle>
        <CardDescription>
          {props.description ??
            "Başlangıç için hazır yaratıcı önerilerden birini seçip 30 saniyede ilk sonucu görebilirsin."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {props.presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="rounded-xl border border-border bg-secondary/30 px-3 py-3 text-left transition hover:border-primary/40"
            onClick={() => props.onSelect(preset.id)}
          >
            <p className="text-sm font-semibold">{preset.label}</p>
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
              {preset.text}
            </p>
            <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              mod: {preset.creativeMode}
            </p>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
