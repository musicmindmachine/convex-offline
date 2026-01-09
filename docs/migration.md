# Replicate Migration System

Schema migrations for local-first apps with Convex and Drizzle.

## Overview

In local-first apps, clients can be offline for days and reconnect with outdated schemas. This system enables:

- **Per-document versioning** - Documents migrate independently
- **Non-blocking background migration** - Users work while migration runs  
- **Dual execution** - Server uses Convex migrations, client uses Drizzle
- **Operations as common language** - Declarative ops stored in DB, sent to clients

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MIGRATION DEFINITION                                  │
│                                                                              │
│  collection.create(components.replicate, "users", {                          │
│    schema: {                                                                 │
│      version: 2,                                                             │
│      migrations: [                                                           │
│        {                                                                     │
│          version: 2,                                                         │
│          operations: [                                                       │
│            { op: "add", path: "email", type: "string", default: "" }         │
│          ],                                                                  │
│          // Optional: complex server logic when ops aren't enough            │
│          migrateOne: async (ctx, doc) => {                                   │
│            const profile = await ctx.db.get(doc.profileId);                  │
│            return { email: profile?.email ?? "" };                           │
│          },                                                                  │
│        }                                                                     │
│      ],                                                                      │
│    },                                                                        │
│  })                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                 ┌──────────────────┴──────────────────┐
                 ▼                                     ▼
┌────────────────────────────────┐    ┌────────────────────────────────┐
│       SERVER (Convex)          │    │       CLIENT (Drizzle)         │
│                                │    │                                │
│  • Stores ops in schemaVersion │    │  • Fetches ops from server     │
│  • Runs migrateOne if provided │    │  • Converts to Drizzle SQL     │
│  • Falls back to auto-gen      │    │  • Applies via browser migrator│
│  • Uses @convex-dev/migrations │    │  • Also updates Yjs docs       │
└────────────────────────────────┘    └────────────────────────────────┘
```

## Why Two Systems?

**Server (Convex)** can do complex migrations:
- Query other tables
- Delete orphaned documents  
- Insert related documents
- Conditional logic based on data

**Client (Drizzle/SQLite)** can only do declarative operations:
- Add/remove columns
- Rename columns
- Set defaults
- Type conversions

**Operations are the common language.** Server can do more via `migrateOne`, but operations are what gets stored and sent to outdated clients.

---

## API Design

Following the patterns from `auth.md`:

```typescript
// convex/users.ts
import { collection } from "@trestleinc/replicate/server";
import { components } from "./_generated/api";

export const {
  material,
  delta,
  replicate,
  presence,
  session,
} = collection.create(components.replicate, "users", {
  // Schema versioning (NEW)
  schema: {
    version: 2,
    migrations: [
      {
        version: 2,
        operations: [
          { op: "add", path: "email", type: "string", default: "" },
        ],
      },
    ],
  },
  
  // Existing patterns
  view: async (ctx, q) => { /* ... */ },
  hooks: { /* ... */ },
});
```

### What Happens on Deploy

1. `collection.create()` reads `schema.migrations`
2. Stores operations in `schemaVersions` table (if not already)
3. Auto-generates `migrateOne` from operations (unless provided)
4. Registers with `@convex-dev/migrations` component

### What Happens on Client Connect

```
Client (v1) ─────────────────────────────> Server (v2)
                                                │
            "schemaVersion: 1"                  │
            ◄──────────────────────────────────┤
                                                │
            { schema: { version: 2,            │
              migrations: [{ ops... }] } }     │
            ◄──────────────────────────────────┘
                   │
                   ▼
            ┌──────────────────┐
            │ Client migrates  │
            │ local SQLite via │
            │ Drizzle          │
            └──────────────────┘
                   │
                   ▼
            ┌──────────────────┐
            │ Client migrates  │
            │ Yjs documents    │
            └──────────────────┘
                   │
                   ▼
            Resume normal sync (both at v2)
```

---

## Migration Operations

Finite set of declarative operations. Serializable, deterministic, no arbitrary code.

### Structural

```typescript
// Add field with default
{ op: "add", path: "email", type: "string", default: "" }

// Remove field
{ op: "remove", path: "oldField" }

// Rename field
{ op: "move", from: "userName", to: "displayName" }
```

### Type Conversions

```typescript
{ op: "convert", path: "count", to: "string", using: "toString" }
```

| From | To | Function |
|------|-----|----------|
| string | number | `parseFloat`, `parseInt` |
| number | string | `toString` |
| string | boolean | `parseBool` |
| string | array | `split` (needs delimiter) |
| array | string | `join` (needs delimiter) |
| any | array | `wrap` |
| array | any | `first` |

### Value Transformations

```typescript
// Map enum values
{ op: "mapValues", path: "status", mapping: { "open": "todo", "closed": "done" } }

// Set default for null/undefined
{ op: "setDefault", path: "priority", value: "none", when: "undefined" }
```

### Complete Types

```typescript
type MigrationOp =
  | { op: "add"; path: string; type: FieldType; default: unknown }
  | { op: "remove"; path: string }
  | { op: "move"; from: string; to: string }
  | { op: "convert"; path: string; to: FieldType; using: ConversionFn }
  | { op: "mapValues"; path: string; mapping: Record<string, unknown> }
  | { op: "setDefault"; path: string; value: unknown; when: "null" | "undefined" }

type FieldType = "string" | "number" | "boolean" | "null" | "array" | "object" | "prose"

type ConversionFn =
  | "toString" | "parseFloat" | "parseInt" | "parseBool" | "wrap" | "first"
  | { fn: "split"; delimiter: string }
  | { fn: "join"; delimiter: string }
```

---

## Server-Side Execution

Uses `@convex-dev/migrations` under the hood. The `migrateOne` function is auto-generated from operations unless you provide one.

### Simple Migration (ops only)

```typescript
schema: {
  version: 2,
  migrations: [
    {
      version: 2,
      operations: [
        { op: "add", path: "email", type: "string", default: "" },
      ],
      // migrateOne auto-generated:
      // (ctx, doc) => ({ email: doc.email ?? "" })
    },
  ],
}
```

### Complex Migration (custom migrateOne)

When operations aren't expressive enough:

```typescript
schema: {
  version: 3,
  migrations: [
    {
      version: 3,
      operations: [
        // Still required - sent to clients
        { op: "add", path: "ownerName", type: "string", default: "" },
      ],
      // Custom logic for server
      migrateOne: async (ctx, doc) => {
        // Query another table - can't express this as ops
        const owner = await ctx.db.get(doc.ownerId);
        return { ownerName: owner?.name ?? "Unknown" };
      },
    },
  ],
}
```

### Running Server Migrations

```bash
# Run specific migration
npx convex run users:migrate '{"version": 2}'

# Run all pending migrations
npx convex run users:migrate
```

---

## Client-Side Execution

### Drizzle Integration

Client migrations use `@proj-airi/drizzle-orm-browser` for SQLite:

```typescript
// Internal - handled by replicate
import { migrate } from "@proj-airi/drizzle-orm-browser-migrator/sqlite"

// Operations converted to Drizzle SQL
const sql = operationsToSQL(migrations);
await migrate(db, sql);
```

### Operations → SQL Conversion

```typescript
function operationsToSQL(ops: MigrationOp[], table: string): string[] {
  return ops.flatMap(op => {
    switch (op.op) {
      case "add":
        const sqlType = typeToSQL(op.type);
        const def = op.default !== undefined ? ` DEFAULT ${literal(op.default)}` : "";
        return [`ALTER TABLE ${table} ADD COLUMN ${op.path} ${sqlType}${def}`];
        
      case "remove":
        return [`ALTER TABLE ${table} DROP COLUMN ${op.path}`];
        
      case "move":
        return [`ALTER TABLE ${table} RENAME COLUMN ${op.from} TO ${op.to}`];
        
      // ... etc
    }
  });
}

function typeToSQL(type: FieldType): string {
  switch (type) {
    case "string": return "TEXT";
    case "number": return "REAL";
    case "boolean": return "INTEGER";
    case "object": 
    case "array": return "TEXT";  // JSON
    case "prose": return "BLOB";  // Yjs
    default: return "TEXT";
  }
}
```

### Yjs Document Migration

After SQLite, also update Yjs documents:

```typescript
function migrateYjsDoc(ydoc: Y.Doc, ops: MigrationOp[]): void {
  const fields = ydoc.getMap("fields");
  const meta = ydoc.getMap("_meta");
  
  ydoc.transact(() => {
    for (const op of ops) {
      switch (op.op) {
        case "add":
          if (fields.get(op.path) === undefined) {
            fields.set(op.path, op.default);
          }
          break;
        case "remove":
          fields.delete(op.path);
          break;
        case "move":
          const value = fields.get(op.from);
          fields.set(op.to, value);
          fields.delete(op.from);
          break;
        // ... etc
      }
    }
    
    meta.set("_schemaVersion", targetVersion);
  }, "migration");
}
```

### Background Migration

Runs on main thread with chunking to avoid blocking UI:

```typescript
async function migrateCollection(collection: string, migrations: Migration[]) {
  const docIds = await persistence.listDocuments(collection);
  
  for (let i = 0; i < docIds.length; i++) {
    // Migrate one doc
    await migrateDocument(docIds[i], migrations);
    
    // Yield to UI every 10 docs
    if (i % 10 === 0) {
      await scheduler.yield?.() ?? new Promise(r => setTimeout(r, 0));
      emitProgress({ completed: i, total: docIds.length });
    }
  }
}
```

---

## Schema Version Table

Stored in Convex component:

```typescript
schemaVersions: defineTable({
  collection: v.string(),
  version: v.number(),
  seq: v.number(),  // For ordering
  operations: v.array(v.any()),
  hash: v.string(),  // Integrity check
})
.index("by_collection", ["collection"])
.index("by_collection_version", ["collection", "version"])
```

Client tracks applied versions in SQLite:

```sql
CREATE TABLE __drizzle_migrations (
  id INTEGER PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

---

## Sync Protocol Extension

The `delta` query response includes schema info when client is behind:

```typescript
interface DeltaResponse {
  mode: "stream" | "recovery";
  changes: Change[];
  seq: number;
  more: boolean;
  
  // NEW: Included when schemaVersion mismatch
  schema?: {
    version: number;
    migrations: {
      version: number;
      operations: MigrationOp[];
    }[];
  };
}
```

---

## Per-Document Versioning

Each Yjs document tracks its schema version:

```typescript
// In _meta map
{
  _schemaVersion: 2,
  _deleted: false
}
```

This enables:
- **Partial migration** - Some docs at v1, others at v2
- **Non-blocking** - Migrate in background batches
- **Resumable** - Track progress, resume after crash

---

## Field Identity (Optional)

For rename detection without ambiguity, use stable field IDs:

```typescript
// Schema-level field IDs (not per-document)
schema: {
  version: 2,
  fieldIds: {
    "email": "f_abc123",
    "displayName": "f_def456",  // Renamed from userName
  },
  migrations: [
    {
      version: 2,
      operations: [
        { op: "move", from: "userName", to: "displayName" },
      ],
    },
  ],
}
```

The diff algorithm uses field IDs to detect renames vs add+delete.

---

## Limitations

### Operations Can't Express Everything

These require custom `migrateOne`:
- Querying other tables
- Aggregations (sum, average, count)
- Conditional logic based on data values
- Inserting/deleting related documents

### SQLite Constraints

- `ALTER TABLE` has limits in SQLite
- Can't change column types easily
- Some operations require table recreation

### Client Always Gets Operations

Even if you use custom `migrateOne` on server, you must provide equivalent `operations` for clients. The operations are the "least common denominator."

---

## Examples

### Adding a Required Field

```typescript
{
  version: 2,
  operations: [
    { op: "add", path: "priority", type: "string", default: "medium" },
  ],
}
```

### Renaming a Field

```typescript
{
  version: 3,
  operations: [
    { op: "move", from: "dueDate", to: "deadline" },
  ],
}
```

### Changing an Enum

```typescript
{
  version: 4,
  operations: [
    { 
      op: "mapValues", 
      path: "status", 
      mapping: { 
        "open": "todo", 
        "in-progress": "doing", 
        "closed": "done" 
      } 
    },
  ],
}
```

### Converting Types

```typescript
{
  version: 5,
  operations: [
    { op: "convert", path: "count", to: "string", using: "toString" },
  ],
}
```

### Denormalizing Data (Complex)

```typescript
{
  version: 6,
  operations: [
    // Client gets simple default
    { op: "add", path: "ownerEmail", type: "string", default: "" },
  ],
  // Server does the lookup
  migrateOne: async (ctx, doc) => {
    const owner = await ctx.db.get(doc.ownerId);
    return { ownerEmail: owner?.email ?? "" };
  },
}
```

---

## Migration Checklist

1. **Define operations** - Declarative ops that work on both server and client
2. **Add migrateOne if needed** - For complex server-side logic
3. **Test locally** - Run migration in development
4. **Deploy** - Schema and migration registered automatically
5. **Run server migration** - `npx convex run collection:migrate`
6. **Monitor clients** - They migrate on next connect

---

## Design Decisions

### Why Operations + Optional migrateOne?

- **Operations** are the common language (server + client)
- **migrateOne** handles edge cases server can do but client can't
- **No duplication** - If ops suffice, migrateOne is auto-generated

### Why Drizzle for Client?

- **Type-safe** - Drizzle schemas provide TypeScript types
- **Browser-ready** - `@proj-airi/drizzle-orm-browser` handles bundling
- **SQLite native** - Direct SQL execution, no abstraction overhead

### Why Main Thread Migration?

- **Yjs docs live on main thread** - No serialization overhead
- **SQLite I/O is async** - Worker handles blocking operations
- **Chunked processing** - `scheduler.yield()` prevents UI blocking

### Why Per-Document Versioning?

- **Non-blocking UX** - Users work while migration runs
- **Offline resilient** - Each doc independent
- **Observable** - Progress tracking per document
