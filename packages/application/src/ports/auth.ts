export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

export interface AuthService {
  requireUserFromRequest(request: Request): Promise<AuthenticatedUser>;
}
