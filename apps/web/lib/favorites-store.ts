"use client";

const FAVORITES_STORAGE_KEY = "vi_favorites_v1";

export interface FavoriteEntry {
  imageVariantId: string;
  generationId: string;
  runId: string;
  addedAt: string;
}

function isFavoriteEntry(candidate: unknown): candidate is FavoriteEntry {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const value = candidate as Record<string, unknown>;
  return (
    typeof value.imageVariantId === "string" &&
    typeof value.generationId === "string" &&
    typeof value.runId === "string" &&
    typeof value.addedAt === "string"
  );
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && window.localStorage !== undefined;
}

export function readFavorites(): FavoriteEntry[] {
  if (!canUseStorage()) {
    return [];
  }

  const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
  if (raw === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isFavoriteEntry);
  } catch {
    return [];
  }
}

function persistFavorites(entries: FavoriteEntry[]): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(entries));
}

export function isFavorited(imageVariantId: string): boolean {
  return readFavorites().some((entry) => entry.imageVariantId === imageVariantId);
}

export function addFavorite(input: {
  imageVariantId: string;
  generationId: string;
  runId: string;
}): FavoriteEntry[] {
  const current = readFavorites();
  if (current.some((entry) => entry.imageVariantId === input.imageVariantId)) {
    return current;
  }

  const next: FavoriteEntry[] = [
    {
      imageVariantId: input.imageVariantId,
      generationId: input.generationId,
      runId: input.runId,
      addedAt: new Date().toISOString(),
    },
    ...current,
  ];

  persistFavorites(next);
  return next;
}

export function removeFavorite(imageVariantId: string): FavoriteEntry[] {
  const next = readFavorites().filter((entry) => entry.imageVariantId !== imageVariantId);
  persistFavorites(next);
  return next;
}
