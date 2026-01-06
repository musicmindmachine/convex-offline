# Authentication & Authorization

This guide explains how to secure your Replicate collections.

## Overview

Replicate uses a layered auth model:

```
view     = read access gate (documents, sync, presence)
hooks    = write access gate + lifecycle events
```

The `view` function controls **all read access**. If a user can't see a document via `view`, they also can't:
- Fetch it via `material`
- Sync it via `delta`
- See who's editing it via `session`
- Join presence for it via `presence`

```typescript
collection.create<Task>(components.replicate, "tasks", {
  // Read access: controls what documents user can see + join
  view: async (ctx, q) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    return q
      .withIndex("by_owner", q => q.eq("ownerId", identity.subject))
      .order("desc");
  },
  
  // Write access: additional validation for mutations
  hooks: {
    evalWrite: async (ctx, doc) => { /* validate writes */ },
    evalRemove: async (ctx, docId) => { /* validate deletes */ },
  },
});
```

## API Auth Matrix

| API | Type | Auth | Purpose |
|-----|------|------|---------|
| `material` | query | `view` | SSR hydration, paginated docs |
| `delta` | query | `view` | Real-time sync stream |
| `session` | query | `view` | Who's online (user-level) |
| `presence` | mutation | `view` | Join/leave/heartbeat |
| `replicate` | mutation | `evalWrite` / `evalRemove` | Insert/update/delete |

**Key insight**: `view` gates everything. If you can't read a document, you can't interact with it at all.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CONFIGURATION                                  │
└─────────────────────────────────────────────────────────────────────────────┘

  collection.create<Task>(components.replicate, "tasks", {
    
    ┌─────────────────────────────────────────────────────────────────────┐
    │  view: async (ctx, q) => { ... }           ◄── READ ACCESS GATE     │
    │                                                                     │
    │  - Throw to deny ALL access (read + presence)                       │
    │  - Return filtered query to limit visible documents                 │
    │  - Applied to: material, delta, session, presence                   │
    └─────────────────────────────────────────────────────────────────────┘
    
    ┌─────────────────────────────────────────────────────────────────────┐
    │  hooks: {                                  ◄── WRITE ACCESS + EVENTS│
    │    evalWrite:   (ctx, doc) => { ... }      // validate writes       │
    │    evalRemove:  (ctx, docId) => { ... }    // validate deletes      │
    │    evalSession: (ctx, client) => { ... }   // additional presence   │
    │    transform:   (docs) => { ... }          // field filtering       │
    │    onInsert/onUpdate/onRemove              // lifecycle events      │
    │  }                                                                  │
    └─────────────────────────────────────────────────────────────────────┘
  })

┌─────────────────────────────────────────────────────────────────────────────┐
│                                 API LAYER                                   │
└─────────────────────────────────────────────────────────────────────────────┘

         QUERIES (read)                           MUTATIONS (write)
         
  ┌──────────────────────┐                 ┌──────────────────────┐
  │      material        │                 │      replicate       │
  │  └─► view ✓          │                 │  └─► evalWrite ✓     │
  │  └─► transform ✓     │                 │  └─► evalRemove ✓    │
  └──────────────────────┘                 └──────────────────────┘
  
  ┌──────────────────────┐                 ┌──────────────────────┐
  │       delta          │                 │      presence        │
  │  └─► view ✓          │                 │  └─► view ✓          │
  └──────────────────────┘                 │  └─► evalSession ✓   │
                                           └──────────────────────┘
  ┌──────────────────────┐
  │      session         │
  │  └─► view ✓          │
  │  └─► groups by user  │
  └──────────────────────┘
```

## View Function

The `view` function is the single entry point for read authorization:

```typescript
type ViewFunction = (
  ctx: QueryCtx,
  query: Query<TableInfo>
) => OrderedQuery<TableInfo> | Promise<OrderedQuery<TableInfo>>;
```

It does three things:
1. **Auth check** - Throw to deny access entirely
2. **Filtering** - Use `.withIndex()` to limit visible documents  
3. **Ordering** - Chain `.order("asc" | "desc")`

### How View Applies to Each API

**`material` query:**
```
view() → filtered query → paginate → transform → return docs
```

**`delta` query:**
```
view() → for each delta, check if doc is in view → return visible deltas
```

**`session` query:**
```
view() → verify user can access document → return presence (grouped by user)
```

**`presence` mutation:**
```
view() → verify user can access document → allow join/leave
```

## Hooks

Hooks provide write-side authorization and lifecycle events:

```typescript
hooks: {
  // Write authorization (throw to deny)
  evalWrite?: (ctx: MutationCtx, doc: T) => void | Promise<void>;
  evalRemove?: (ctx: MutationCtx, docId: string) => void | Promise<void>;
  evalSession?: (ctx: MutationCtx, client: string) => void | Promise<void>;
  
  // Lifecycle events (run after operation)
  onInsert?: (ctx: MutationCtx, doc: T) => void | Promise<void>;
  onUpdate?: (ctx: MutationCtx, doc: T) => void | Promise<void>;
  onRemove?: (ctx: MutationCtx, docId: string) => void | Promise<void>;
  
  // Field-level transform (runs on query results)
  transform?: (docs: T[]) => T[] | Promise<T[]>;
}
```

### View vs Hooks

| Concern | Use `view` | Use `hooks` |
|---------|-----------|-------------|
| "Can user read this?" | ✅ | |
| "Can user see who's editing?" | ✅ | |
| "Can user join presence?" | ✅ | |
| "Can user write this?" | | ✅ `evalWrite` |
| "Can user delete this?" | | ✅ `evalRemove` |
| "Hide sensitive fields" | | ✅ `transform` |
| "Log after write" | | ✅ `onInsert` etc |

## Client-Side Setup

Replicate uses a **pre-authenticated ConvexClient** for server-side authorization. Your auth provider (Better Auth, Clerk, etc.) configures the client, and Replicate reuses it.

### Setting Up the Authenticated Client

Create a shared ConvexClient and configure auth via your provider's integration:

```typescript
// src/lib/convex.ts
import { ConvexClient } from "convex/browser";

export const convexClient = new ConvexClient(process.env.PUBLIC_CONVEX_URL);
```

Then pass it to your auth provider's setup (this configures `setAuth()` internally):

**Better Auth (SvelteKit):**
```typescript
// +layout.svelte
import { createSvelteAuthClient } from "@mmailaender/convex-better-auth-svelte/svelte";
import { authClient } from "$lib/auth-client";
import { convexClient } from "$lib/convex";

createSvelteAuthClient({ authClient, convexClient });
```

**Clerk (React):**
```typescript
// App.tsx
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { convexClient } from "./lib/convex";

<ClerkProvider>
  <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
    <App />
  </ConvexProviderWithClerk>
</ClerkProvider>
```

**Custom Auth:**
```typescript
// Manual setAuth configuration
convexClient.setAuth(
  async ({ forceRefreshToken }) => {
    const token = await yourAuthProvider.getToken({ skipCache: forceRefreshToken });
    return token ?? null;
  },
  (isAuthenticated) => console.log("Auth state:", isAuthenticated)
);
```

### Using the Authenticated Client in Collections

Pass the shared client to your collection config:

```typescript
// src/collections/tasks.ts
import { collection, persistence } from "@trestleinc/replicate/client";
import { convexClient } from "$lib/convex";

export const tasks = collection.create(schema, "tasks", {
  persistence: () => persistence.sqlite(db, "tasks"),
  config: () => ({
    convexClient,  // Pre-authenticated client
    api: api.tasks,
    getKey: (t) => t.id,
  }),
});
```

Now `ctx.auth.getUserIdentity()` will work in your server-side `view` and `hooks`.

## Presence Identity (Auth-Agnostic)

Replicate's presence system (cursors, avatars) uses a separate **client-side identity** that works with any auth provider.

### UserIdentity Interface

```typescript
interface UserIdentity {
  id?: string;      // User ID (for session grouping across devices)
  name?: string;    // Display name (shown in cursors)
  color?: string;   // Cursor/selection color (hex, e.g., "#6366f1")
  avatar?: string;  // Avatar URL (for presence indicators)
}
```

### Passing Identity to Collections

Provide a `user` getter in your collection config. This function is called when establishing presence:

```typescript
import { collection, persistence } from "@trestleinc/replicate/client";

export const tasks = collection.create(schema, "tasks", {
  persistence: async () => persistence.pglite(db, "tasks"),
  config: () => ({
    convexClient,
    api: api.tasks,
    getKey: (t) => t.id,
    
    user: () => {
      const session = getAuthSession(); // Your auth provider
      if (!session?.user) return undefined;
      
      return {
        id: session.user.id,
        name: session.user.name,
        avatar: session.user.image,
      };
    },
  }),
});
```

### Provider Examples

**Better Auth:**
```typescript
import { authClient } from "$lib/auth-client";

user: () => {
  const session = authClient.useSession();
  if (!session.data?.user) return undefined;
  
  return {
    id: session.data.user.id,
    name: session.data.user.name,
    avatar: session.data.user.image,
  };
},
```

**Clerk:**
```typescript
import { useUser } from "@clerk/clerk-react";

user: () => {
  const { user } = useUser();
  if (!user) return undefined;
  
  return {
    id: user.id,
    name: user.fullName ?? user.username,
    avatar: user.imageUrl,
  };
},
```

**WorkOS AuthKit:**
```typescript
import { useAuth } from "@workos-inc/authkit-react";

user: () => {
  const { user } = useAuth();
  if (!user) return undefined;
  
  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    avatar: user.profilePictureUrl,
  };
},
```

**Convex Auth (ctx.auth):**
```typescript
// For SSR scenarios where you have the identity from server
user: () => {
  const identity = getServerIdentity(); // From your SSR loader
  if (!identity) return undefined;
  
  return {
    id: identity.subject,
    name: identity.name,
    avatar: identity.pictureUrl,
  };
},
```

**Custom/JWT:**
```typescript
import { jwtDecode } from "jwt-decode";

user: () => {
  const token = localStorage.getItem("auth_token");
  if (!token) return undefined;
  
  const decoded = jwtDecode<{ sub: string; name: string }>(token);
  return {
    id: decoded.sub,
    name: decoded.name,
  };
},
```

### How Identity Flows Through the System

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Auth Provider │      │     Client      │      │     Server      │
│                 │      │                 │      │                 │
│  Better Auth    │      │  collection     │      │  sessions table │
│  Clerk          │ ───► │  config.user()  │ ───► │                 │
│  WorkOS         │      │                 │      │  ┌───────────┐  │
│  Custom JWT     │      │  UserIdentity   │      │  │ client    │  │
│                 │      │  {              │      │  │ user      │  │
└─────────────────┘      │    id,          │      │  │ profile   │  │
                         │    name,        │      │  │ cursor    │  │
                         │    avatar       │      │  └───────────┘  │
                         │  }              │      │                 │
                         └─────────────────┘      └─────────────────┘
```

1. **Auth provider** authenticates user (any provider)
2. **Client** extracts identity via `config.user()` getter
3. **Presence system** sends identity with heartbeats
4. **Server** stores in sessions table, groups by `user.id`
5. **Other clients** see user presence via `session` query

### Per-Document Identity Override

You can also pass identity per-document when binding to prose fields:

```typescript
const binding = await collection.utils.prose(docId, "content", {
  user: {
    id: currentUser.id,
    name: currentUser.displayName,
    color: "#6366f1",
    avatar: currentUser.avatarUrl,
  },
});
```

This is useful when you need different identity per document or want to override the collection-level default.

### Anonymous Users

If `user()` returns `undefined`, presence still works with anonymous identity:

```typescript
user: () => {
  const session = getAuthSession();
  if (!session) return undefined; // Anonymous - auto-generated name/color
  
  return {
    id: session.user.id,
    name: session.user.name,
  };
},
```

Anonymous users get:
- Stable random name (e.g., "Swift Fox", "Calm Bear")
- Stable random color (seeded from client ID)
- No cross-device grouping (each device is separate)

## Session + Presence

### Session Query (Who's Online)

The `session` query returns user-level presence, grouped from device-level sessions:

```
Sessions Table (device-level)              session query output (user-level)

┌─────────────────────────────┐           ┌─────────────────────────────┐
│ client: "device-aaa"        │──┐        │                             │
│ user: "alice"               │  │        │  user: "alice"              │
│ cursor: { pos: 10 }         │  ├──────► │  cursor: { pos: 42 }        │
│ seen: 1000                  │  │        │  profile: { name: "Alice" } │
├─────────────────────────────┤  │        │                             │
│ client: "device-bbb"        │──┘        └─────────────────────────────┘
│ user: "alice"               │ (grouped, most recent cursor wins)
│ cursor: { pos: 42 }         │
│ seen: 2000 ◄─── latest      │           ┌─────────────────────────────┐
├─────────────────────────────┤           │                             │
│ client: "device-ccc"        │──────────►│  user: "bob"                │
│ user: "bob"                 │           │  cursor: { pos: 5 }         │
│ cursor: { pos: 5 }          │           │  profile: { name: "Bob" }   │
└─────────────────────────────┘           │                             │
                                          └─────────────────────────────┘
```

**Auth flow:**
1. `view()` runs - checks if user can access the document
2. If authorized, query sessions for that document
3. Group by user, return most recent session per user

### Presence Mutation (Join/Leave)

The `presence` mutation lets users join/leave a document's presence:

```typescript
// Client calls presence to join
await convex.mutation(api.tasks.presence, {
  action: "join",
  document: "doc123",
  client: deviceId,           // Unique per device/tab
  user: identity.subject,     // From auth provider
  profile: { name: "Alice", color: "#6366f1" },
  cursor: { anchor: 0, head: 0 },
});
```

**Auth flow:**
1. `view()` runs - checks if user can access the document
2. If authorized, `evalSession()` runs for additional validation
3. Session record created/updated in sessions table

### Identity Flow

```
Auth Provider          Client                  presence mutation       sessions table
     │                   │                           │                      │
     │  JWT              │                           │                      │
     ├──────────────────►│                           │                      │
     │                   │                           │                      │
     │            identity.subject                   │                      │
     │            = "user:alice"                     │                      │
     │                   │                           │                      │
     │                   │  presence({               │                      │
     │                   │    action: "join",        │                      │
     │                   │    document: "doc123",    │                      │
     │                   │    client: "device-uuid", │                      │
     │                   │    user: identity.subject,│ ◄── USER ID FROM AUTH│
     │                   │    profile: {...},        │                      │
     │                   │  })                       │                      │
     │                   │─────────────────────────► │                      │
     │                   │                           │                      │
     │                   │                    view() │ ◄── CAN USER SEE DOC?│
     │                   │                           │                      │
     │                   │               evalSession │ ◄── EXTRA VALIDATION │
     │                   │                           │                      │
     │                   │                           │  INSERT/UPDATE ─────►│
```

## Usage Patterns

### Pattern 1: User-Owned Data

```typescript
collection.create<Task>(components.replicate, "tasks", {
  view: async (ctx, q) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    return q
      .withIndex("by_owner", q => q.eq("ownerId", identity.subject))
      .order("desc");
  },
  
  hooks: {
    evalWrite: async (ctx, doc) => {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) throw new Error("Unauthorized");
      if (doc.ownerId !== identity.subject) {
        throw new Error("Forbidden: cannot modify other users' data");
      }
    },
  },
});
```

### Pattern 2: Multi-Tenant (Organization)

```typescript
collection.create<Project>(components.replicate, "projects", {
  view: async (ctx, q) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.org_id) {
      throw new Error("Unauthorized: must belong to organization");
    }
    
    return q
      .withIndex("by_tenant", q => q.eq("tenantId", identity.org_id))
      .order("desc");
  },
});
```

### Pattern 3: Role-Based Access

```typescript
collection.create<Document>(components.replicate, "documents", {
  view: async (ctx, q) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q => q.eq("tokenIdentifier", identity.subject))
      .unique();
    
    // Admins see all, others see only their own
    if (user?.role === "admin") {
      return q.withIndex("by_timestamp").order("desc");
    }
    
    return q
      .withIndex("by_owner", q => q.eq("ownerId", identity.subject))
      .order("desc");
  },
});
```

### Pattern 4: Public Collection (No Auth)

```typescript
collection.create<Post>(components.replicate, "publicPosts", {
  // No view = all documents visible, anyone can read + see presence
  
  hooks: {
    // But still protect writes
    evalWrite: async (ctx, doc) => {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) throw new Error("Unauthorized");
    },
  },
});
```

### Pattern 5: Field-Level Security

```typescript
collection.create<User>(components.replicate, "users", {
  view: async (ctx, q) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    return q
      .withIndex("by_tenant", q => q.eq("tenantId", identity.org_id))
      .order("desc");
  },
  
  hooks: {
    // Remove sensitive fields before sending to client
    transform: (docs) => docs.map(doc => ({
      ...doc,
      passwordHash: undefined,
      internalNotes: undefined,
    })),
  },
});
```

## Schema Requirements

Your schema must include indexes that match your `view` queries:

```typescript
// convex/schema.ts
import { defineSchema } from "convex/server";
import { v } from "convex/values";
import { schema } from "@trestleinc/replicate/server";

export default defineSchema({
  tasks: schema.table({
    ownerId: v.string(),
    tenantId: v.optional(v.string()),
    title: v.string(),
    status: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_tenant", ["tenantId"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_doc_id", ["id"])
    .index("by_timestamp", ["timestamp"]),
});
```

## Security Best Practices

### 1. Always Use Indexes in View

```typescript
// GOOD - Uses index, efficient O(log n)
view: async (ctx, q) => {
  const identity = await ctx.auth.getUserIdentity();
  return q
    .withIndex("by_owner", q => q.eq("ownerId", identity?.subject))
    .order("desc");
},

// BAD - Full table scan, then filter O(n)
hooks: {
  transform: (docs) => docs.filter(d => d.ownerId === userId),
},
```

### 2. Validate Writes Separately

`view` controls reads, but writes need explicit validation:

```typescript
hooks: {
  evalWrite: async (ctx, doc) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    // Verify ownership
    if (doc.ownerId !== identity.subject) {
      throw new Error("Forbidden");
    }
  },
},
```

### 3. Don't Trust Client Data

```typescript
hooks: {
  evalWrite: async (ctx, doc) => {
    const identity = await ctx.auth.getUserIdentity();
    // Override ownerId with authenticated user
    doc.ownerId = identity!.subject;
  },
},
```

### 4. Use View for Presence Auth

If a user shouldn't see a document, they shouldn't see who's editing it:

```typescript
// With view set, these are automatically protected:
session({ document: "doc123" })   // Only works if user can see doc
presence({ document: "doc123" })  // Only works if user can see doc
```
