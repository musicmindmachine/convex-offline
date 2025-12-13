# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Always Use Context7 for Library Documentation

**CRITICAL**: When looking up documentation for any library (Yjs, Convex, TanStack, Effect, etc.), ALWAYS use the Context7 MCP tool. NEVER use WebSearch for library documentation.

**Usage pattern:**
1. First resolve the library ID: `mcp__context7__resolve-library-id` with library name
2. Then fetch docs: `mcp__context7__get-library-docs` with the resolved ID and topic

## Project Overview

**Replicate** (`@trestleinc/replicate`) - Offline-first data replication using Yjs CRDTs and Convex for automatic conflict resolution and real-time synchronization.

Single package with exports:
- `@trestleinc/replicate/client` → Client utilities (browser/React/Svelte)
- `@trestleinc/replicate/server` → Server helpers (Convex functions)
- `@trestleinc/replicate/convex.config` → Component configuration

## Development Commands

### Build & Type Check
```bash
bun run build       # Build with Rslib (outputs to dist/)
bun run clean       # Remove dist/
```

### Code Quality (Biome v2)
```bash
bun run check       # Lint + format check (dry run)
bun run check:fix   # Auto-fix all issues (ALWAYS run before committing)
```

### Publishing
```bash
bun run prepublish  # Build + check:fix (runs before npm publish)
```

## Architecture

### Package Structure
```
src/
├── client/              # Client-side (browser)
│   ├── index.ts         # Public exports (slim API surface)
│   ├── collection.ts    # TanStack DB + Yjs integration, utils.prose
│   ├── replicate.ts     # Replicate helpers for TanStack DB
│   ├── merge.ts         # Yjs CRDT merge operations, extract(), isDoc()
│   ├── history.ts       # Undo/redo history management
│   ├── logger.ts        # LogTape logger
│   ├── errors.ts        # Effect TaggedErrors (NetworkError, ProseError, etc.)
│   └── services/        # Core services (Effect-based)
│       ├── checkpoint.ts     # Sync checkpoints
│       ├── snapshot.ts       # Snapshot recovery
│       └── reconciliation.ts # Phantom document cleanup
├── server/              # Server-side (Convex functions)
│   ├── index.ts         # Public exports
│   ├── builder.ts       # define() builder
│   ├── schema.ts        # table(), prose() helpers
│   └── storage.ts       # ReplicateStorage class
├── component/           # Internal Convex component
│   ├── convex.config.ts # Component config
│   ├── schema.ts        # Event log schema
│   ├── public.ts        # Component API
│   └── logger.ts        # Component logging
└── env.d.ts             # Environment type declarations
```

### Core Concepts

**Event-Sourced Dual Storage:**
- Component storage: Append-only Yjs CRDT deltas (event log)
- Main table: Materialized documents (read model)
- Similar to CQRS pattern

**Client Services (Effect-based):**
- Services in `src/client/services/` use Effect for dependency injection
- `Checkpoint` manages sync checkpoints in IndexedDB
- `Snapshot` recovers from server snapshots
- `Reconciliation` removes phantom documents

**Data Flow:**
```
Client edit → merge.ts (encode delta) → collection.ts → Offline queue
    → Convex mutation → Component (append delta) + Main table (upsert)
    → Subscription → Other clients
```

## Key Patterns

### Server: define() Builder
```typescript
// convex/tasks.ts
import { define } from '@trestleinc/replicate/server';

export const { stream, material, insert, update, remove, compact, prune } =
  define<Task>({
    component: components.replicate,
    collection: 'tasks',
  });
```

### Client: Collection Setup
```typescript
import { convexCollectionOptions } from '@trestleinc/replicate/client';

const collection = createCollection(
  convexCollectionOptions<Task>({
    convexClient,
    api: api.tasks,
    collection: 'tasks',
    prose: ['content'],  // optional: prose fields for rich text
    getKey: (task) => task.id,
  })
);

// Access utils methods
const binding = await collection.utils.prose(id, 'content');  // Editor binding
```

### Schema: table() Helper
```typescript
import { table, prose } from '@trestleinc/replicate/server';

// Automatically injects version and timestamp fields
tasks: table({
  id: v.string(),
  text: v.string(),
  content: prose(),  // optional: ProseMirror-compatible rich text
}, (t) => t.index('by_id', ['id']))
```

### Text Extraction
```typescript
import { extract } from '@trestleinc/replicate/client';

// Extract plain text from ProseMirror JSON
const plainText = extract(task.content);
```

## Public API Surface

The API follows TanStack DB patterns with single-word naming conventions.

### Client (`@trestleinc/replicate/client`)
```typescript
// Main entry point
convexCollectionOptions()

// Text extraction
extract()                    // Extract plain text from ProseMirror JSON

// Effect TaggedErrors
NetworkError
IDBError
IDBWriteError
ReconciliationError
ProseError                   // Thrown when prose field not found
CollectionNotReadyError

// Collection utils (accessed via collection.utils.*)
collection.utils.prose(id, field)   // Returns EditorBinding
```

### Server (`@trestleinc/replicate/server`)
```typescript
define()    // Define replicate handlers (stream, insert, update, remove, etc.)
table()     // Define replicated table schema (adds version/timestamp fields)
prose()     // Validator for ProseMirror-compatible JSON
```

## Technology Stack

- **TypeScript** (strict mode)
- **Effect** for service architecture and dependency injection
- **Yjs** for CRDTs (conflict-free replicated data types)
- **Convex** for backend (cloud database + functions)
- **TanStack DB** for reactive state
- **TanStack offline-transactions** for outbox pattern
- **Rslib** for building
- **Biome** for linting/formatting
- **LogTape** for logging (avoid console.*)

## Naming Conventions

- **Public API**: Single-word function names (e.g., `define()`, `table()`, `extract()`)
- **Service files**: lowercase, no suffix (e.g., `checkpoint.ts`, not `CheckpointService.ts`)
- **Service exports**: PascalCase, no "Service" suffix (e.g., `Checkpoint`, `CheckpointLive`)
- **Error classes**: Short names with "Error" suffix (e.g., `ProseError`, not `ProseFieldNotFoundError`)
- **Use "replicate"**: not "sync" throughout the codebase
- **Internal functions**: Keep verbose names internally (e.g., `isDoc()` used internally)

## Important Notes

- **Effect-based services** - Client services use Effect for DI; understand Effect basics
- **Hard deletes** - Documents physically removed from main table, history kept in component
- **Biome config** - `noExplicitAny` OFF, `noConsole` warns (except in test files and component logger)
- **LogTape logging** - Use LogTape, not console.* (Biome warns on console)
- **Import types** - Use `import type` for type-only imports (Biome enforces this)
