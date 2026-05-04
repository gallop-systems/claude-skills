# Auth Patterns (nuxt-auth-utils)

> **Examples:** [auth-utils.ts](./examples/auth-utils.ts), [auth-middleware.ts](./examples/auth-middleware.ts)

nuxt-auth-utils supports 40+ OAuth providers and includes WebAuthn (passkey) support.

## Server-side Functions (auto-imported)

| Function | Purpose |
|----------|---------|
| `getUserSession(event)` | Get session (null if not logged in) |
| `setUserSession(event, data)` | Create/update session (merges) |
| `replaceUserSession(event, data)` | Replace entire session (no merge) |
| `clearUserSession(event)` | Clear session (logout) |
| `requireUserSession(event)` | Get session or throw 401 |

### Password Utilities

| Function | Purpose |
|----------|---------|
| `hashPassword(password)` | Hash with scrypt |
| `verifyPassword(hash, password)` | Verify password |
| `passwordNeedsRehash(hash)` | Check if rehash needed |

## Client-side Composable

```typescript
const {
  ready,         // Computed<boolean> - session loaded?
  loggedIn,      // Computed<boolean> - is logged in?
  user,          // Computed<User | null> - user data
  session,       // Ref<Session> - full session
  fetch,         // () => Promise<void> - refresh
  clear,         // () => Promise<void> - logout
  openInPopup,   // (url: string) => void - OAuth popup
} = useUserSession();
```

## OAuth Handler Pattern

```typescript
// server/api/auth/google.get.ts
export default defineOAuthGoogleEventHandler({
  config: {
    clientId: config.oauth.google.clientId,
    clientSecret: config.oauth.google.clientSecret,
  },
  async onSuccess(event, { user, tokens }) {
    const dbUser = await findOrCreateUser(user.email, user);

    await setUserSession(event, {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
      },
    });

    return sendRedirect(event, dbUser.role === "admin" ? "/dashboard" : "/home");
  },
  onError(event, error) {
    console.error("OAuth error:", error);
    return sendRedirect(event, "/login?error=oauth");
  },
});
```

Client trigger:
```typescript
const { openInPopup } = useUserSession();
const loginWithGoogle = () => openInPopup("/api/auth/google");
```

## WebAuthn (Passkeys)

```typescript
// Server: Register credential
export default defineWebAuthnRegisterEventHandler({
  async onSuccess(event, { credential, user }) {
    await db.insertInto("webauthn_credentials").values({
      user_id: user.id,
      credential_id: credential.id,
      public_key: credential.publicKey,
    }).execute();
  },
});

// Server: Authenticate
export default defineWebAuthnAuthenticateEventHandler({
  async getCredential(event, credentialId) {
    return await db.selectFrom("webauthn_credentials")
      .where("credential_id", "=", credentialId)
      .executeTakeFirst();
  },
  async onSuccess(event, { credential, user }) {
    await setUserSession(event, { user });
  },
});
```

```typescript
// Client
const { register, authenticate } = useWebAuthn();
await register({ userName: user.email });
await authenticate();
```

## Server Middleware

```typescript
// server/middleware/auth.ts
export default defineEventHandler(async (event) => {
  // Skip auth routes
  if (event.path.startsWith("/api/auth")) return;

  if (event.path.startsWith("/api")) {
    const session = await getUserSession(event);
    if (!session?.user) {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    }

    // Role-based restrictions
    if (event.path.startsWith("/api/admin") && session.user.role !== "admin") {
      throw createError({ statusCode: 403, statusMessage: "Forbidden" });
    }
  }
});
```

## Client Middleware

```typescript
// middleware/auth.global.ts
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession();
  const publicRoutes = ["/login", "/signup"];

  if (!loggedIn.value && !publicRoutes.includes(to.path)) {
    return navigateTo("/login");
  }

  if (loggedIn.value && to.path === "/login") {
    return navigateTo("/");
  }
});
```

Named middleware:
```typescript
// middleware/admin.ts
export default defineNuxtRouteMiddleware(() => {
  const { loggedIn, user } = useUserSession();
  if (!loggedIn.value || user.value?.role !== "admin") {
    return navigateTo("/");
  }
});

// pages/admin/dashboard.vue
definePageMeta({ middleware: "admin" });
```

## Reusable Auth Helpers

```typescript
// server/utils/auth.ts
export async function getAuthenticatedUser(event: H3Event) {
  const session = await getUserSession(event);
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return session.user;
}

export async function requireRole(event: H3Event, roles: string[]) {
  const user = await getAuthenticatedUser(event);
  if (!roles.includes(user.role)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }
  return user;
}

export async function requireAdmin(event: H3Event) {
  return requireRole(event, ["admin", "superadmin"]);
}
```

## Type Extension

```typescript
// types/auth.d.ts
declare module "#auth-utils" {
  interface User {
    id: number;
    email: string;
    name: string;
    role: "admin" | "user";
  }

  interface UserSession {
    loggedInAt: string;
  }

  interface SecureSessionData {
    internalToken?: string;  // Server-only
  }
}
```

## Configuration

```bash
# Required (32+ chars, auto-generated in dev)
NUXT_SESSION_PASSWORD=your-super-secret-password-at-least-32-chars

# OAuth (per-provider)
NUXT_OAUTH_GOOGLE_CLIENT_ID=...
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=...
```

## Key Gotchas

1. **Skip auth routes in middleware** - `/api/auth/*` and `/api/_auth/*`
2. **Use `openInPopup` for OAuth** - Better UX than redirect
3. **Cookie size limit is 4096 bytes** - Store only essential data
4. **setUserSession merges** - Use `replaceUserSession` to replace
5. **requireUserSession throws** - Use getUserSession for null
6. **Cannot use with `nuxt generate`** - Requires running server
