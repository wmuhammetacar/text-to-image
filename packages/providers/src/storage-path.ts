export function assertSafeBucketName(bucket: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket)) {
    throw new Error("INVALID_STORAGE_BUCKET");
  }
}

export function assertSafeStoragePath(path: string): void {
  if (path.length === 0 || path.length > 1024) {
    throw new Error("INVALID_STORAGE_PATH_LENGTH");
  }

  if (path !== path.trim()) {
    throw new Error("INVALID_STORAGE_PATH_WHITESPACE");
  }

  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\u0000")
  ) {
    throw new Error("INVALID_STORAGE_PATH_FORMAT");
  }

  const parts = path.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error("INVALID_STORAGE_PATH_TRAVERSAL");
  }
}
