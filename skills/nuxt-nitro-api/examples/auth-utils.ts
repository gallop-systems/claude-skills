// server/utils/auth.ts
// Reusable auth helpers (auto-imported in /server)
import type { H3Event } from "h3";

// Type for user in session
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user";
}

/**
 * Get authenticated user or throw 401
 */
export async function getAuthenticatedUser(event: H3Event): Promise<SessionUser> {
  const session = await getUserSession(event);
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return session.user as SessionUser;
}

/**
 * Require specific role(s) or throw 403
 */
export async function requireRole(
  event: H3Event,
  allowedRoles: SessionUser["role"][]
): Promise<SessionUser> {
  const user = await getAuthenticatedUser(event);
  if (!allowedRoles.includes(user.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Forbidden - Requires one of: ${allowedRoles.join(", ")}`,
    });
  }
  return user;
}

/**
 * Shorthand for requiring admin role
 */
export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  return requireRole(event, ["admin"]);
}

// Usage in API handlers:
// const user = await getAuthenticatedUser(event);
// const admin = await requireAdmin(event);
// const manager = await requireRole(event, ["admin", "manager"]);
