import type { AuthService as IAuthService } from "@vi/application";
import { UnauthorizedAppError } from "@vi/application";
import { createWebUserSupabaseClient } from "./supabase-server";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

function extractBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new UnauthorizedAppError();
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (token.length === 0) {
    throw new UnauthorizedAppError();
  }

  return token;
}

export async function requireAuthenticatedUser(
  request: Request,
): Promise<AuthenticatedUser> {
  const token = extractBearerToken(request);
  const supabase = createWebUserSupabaseClient(token);

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error !== null || data.user === null) {
      throw new UnauthorizedAppError();
    }

    return {
      id: data.user.id,
      email: data.user.email ?? null,
    };
  } catch {
    throw new UnauthorizedAppError();
  }
}

export class SupabaseAuthService implements IAuthService {
  public async requireUserFromRequest(request: Request): Promise<AuthenticatedUser> {
    return requireAuthenticatedUser(request);
  }
}
