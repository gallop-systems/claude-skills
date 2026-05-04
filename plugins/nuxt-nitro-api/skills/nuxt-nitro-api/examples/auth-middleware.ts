// server/middleware/auth.ts
// Server middleware for protecting API routes

export default defineEventHandler(async (event) => {
  // Skip auth for public routes
  const publicPaths = ["/api/auth", "/api/_auth", "/api/public"];
  if (publicPaths.some((path) => event.path.startsWith(path))) {
    return;
  }

  // Require auth for all /api/* routes
  if (event.path.startsWith("/api")) {
    const session = await getUserSession(event);

    if (!session?.user) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
    }

    // Role-based restrictions
    if (event.path.startsWith("/api/admin")) {
      if (session.user.role !== "admin") {
        throw createError({
          statusCode: 403,
          statusMessage: "Forbidden - Admin access required",
        });
      }
    }
  }
});
