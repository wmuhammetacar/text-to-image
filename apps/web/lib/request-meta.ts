export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

function normalizeIp(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) {
    return null;
  }
  if (value.length > 128) {
    return null;
  }
  return value;
}

function parseForwardedFor(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const first = value.split(",")[0] ?? "";
  return normalizeIp(first);
}

export function getRequestMeta(request: Request): RequestMeta {
  const xff = parseForwardedFor(request.headers.get("x-forwarded-for"));
  const xri = normalizeIp(request.headers.get("x-real-ip") ?? "");
  const cf = normalizeIp(request.headers.get("cf-connecting-ip") ?? "");
  const ipAddress = xff ?? xri ?? cf ?? null;

  const userAgentRaw = request.headers.get("user-agent");
  const userAgent = userAgentRaw !== null && userAgentRaw.length > 0
    ? userAgentRaw.slice(0, 512)
    : null;

  return {
    ipAddress,
    userAgent,
  };
}
