# Replicate Sync System Design

A complete specification for the session-driven compaction system with snapshot-based recovery.

## Table of Contents

1. [Yjs Fundamentals](#1-yjs-fundamentals)
2. [The Snapshot Breakthrough](#2-the-snapshot-breakthrough)
3. [System Overview](#3-system-overview)
4. [Data Model](#4-data-model)
5. [Session Identity](#5-session-identity)
6. [Data Flows](#6-data-flows)
7. [Server API](#7-server-api)
8. [Invariants & Guarantees](#8-invariants--guarantees)
9. [Optimizations](#9-optimizations)

---

## 1. Yjs Fundamentals

Understanding Yjs internals is critical for this system's design.

### ClientID

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Y.Doc.clientID                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  What it is:                                                             │
│  - Unique 53-bit integer per Y.Doc instance                             │
│  - Generated randomly by default                                        │
│  - Identifies WHO created an operation                                  │
│                                                                          │
│  Critical rule from Yjs docs:                                            │
│  ────────────────────────────────────────────────────────────────────   │
│  "It's imperative to ensure that no other Y.Doc instance is currently   │
│   using the same ClientID, as having multiple Y.Doc instances with      │
│   identical ClientIDs can lead to document corruption without a         │
│   recovery mechanism."                                                  │
│  ────────────────────────────────────────────────────────────────────   │
│                                                                          │
│  Can be persisted IF:                                                    │
│  - All instances sharing the clientID also share the same Y.Doc state  │
│  - This is true when tabs share localStorage/SQLite                     │
│  - Shared storage = same client = same clientID is CORRECT              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### State Vector

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STATE VECTOR                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Structure: Map<clientID → clock>                                        │
│                                                                          │
│  Example:                                                                │
│  {                                                                       │
│    client_123: 50,   // Has operations 0-49 from client 123             │
│    client_456: 30,   // Has operations 0-29 from client 456             │
│    client_789: 100,  // Has operations 0-99 from client 789             │
│  }                                                                       │
│                                                                          │
│  What it represents:                                                     │
│  - "I have seen operations 0..clock-1 from each client"                 │
│  - Complete description of what a Y.Doc contains                        │
│  - Used to compute diffs: "what do I have that you don't?"              │
│                                                                          │
│  Key insight:                                                            │
│  - Two Y.Docs with same state vector have the same content              │
│  - State vector comparison tells us if one is "caught up" to another    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Sync Protocol

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    YJS SYNC PROTOCOL                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Client A wants to sync with Server:                                     │
│                                                                          │
│  1. Client sends: stateVector_A                                          │
│     "Here's what I have"                                                │
│                                                                          │
│  2. Server computes: diff = Y.diffUpdate(serverState, stateVector_A)    │
│     "Here's what you're missing"                                        │
│                                                                          │
│  3. Server sends: diff                                                   │
│                                                                          │
│  4. Client applies: Y.applyUpdate(doc, diff)                            │
│     Now client has everything server has                                │
│                                                                          │
│  Key properties of updates:                                              │
│  - Commutative: order doesn't matter                                    │
│  - Associative: grouping doesn't matter                                 │
│  - Idempotent: applying twice is same as once                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Server-Side Operations (No Y.Doc Required)

```typescript
// Yjs provides functions that work directly on binary updates
// No need to instantiate Y.Doc on server

// Merge multiple updates into one
const merged = Y.mergeUpdatesV2([update1, update2, update3]);

// Extract state vector from an update
const vector = Y.encodeStateVectorFromUpdateV2(merged);

// Compute diff between update and state vector
const diff = Y.diffUpdateV2(merged, clientVector);

// diff.byteLength <= 2 means "nothing missing" (empty diff)
```

---

## 2. The Snapshot Breakthrough

### The Problem Without Snapshots

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    THE PROBLEM (WITHOUT SNAPSHOTS)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Must keep ALL deltas forever:                                           │
│  - Any client might reconnect after arbitrary time                       │
│  - That client needs all deltas since their last sync                    │
│  - We don't know when they'll reconnect                                  │
│  - Storage grows unbounded                                               │
│                                                                          │
│  Must keep ALL sessions forever:                                         │
│  - Need to track what state vector each client has                      │
│  - Can't delete session = can't know what they need                      │
│  - Sessions accumulate forever                                           │
│  - One stale client blocks compaction for everyone                       │
│                                                                          │
│  Result: System accumulates garbage indefinitely                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Breakthrough: Snapshots Enable Safe Deletion

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    THE BREAKTHROUGH                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Snapshot = Merged state with its own state vector                       │
│                                                                          │
│  snapshot.bytes = Y.mergeUpdatesV2(all_deltas)                          │
│  snapshot.vector = Y.encodeStateVectorFromUpdateV2(snapshot.bytes)      │
│                                                                          │
│  This enables:                                                           │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 1. SAFE SESSION DELETION                                        │    │
│  │                                                                 │    │
│  │    If snapshot.vector >= session.vector (for all clientIDs):   │    │
│  │    - Snapshot has all operations the session had               │    │
│  │    - Client can recover from snapshot                          │    │
│  │    - Safe to delete session                                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 2. SAFE DELTA DELETION                                          │    │
│  │                                                                 │    │
│  │    If all remaining sessions have the operations:              │    │
│  │    - No client needs these deltas anymore                      │    │
│  │    - Safe to delete deltas                                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 3. BOUNDED STORAGE                                              │    │
│  │                                                                 │    │
│  │    Storage = snapshot + recent_deltas + active_sessions         │    │
│  │    Independent of document history length                       │    │
│  │    Independent of total clients ever connected                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Recovery Guarantee

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STATELESS RECOVERY                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Client offline for 1 year? No problem:                                  │
│                                                                          │
│  1. Client has local Y.Doc with their state vector                      │
│  2. Client sends: Y.encodeStateVector(localDoc)                         │
│  3. Server computes: diff = Y.diffUpdateV2(                             │
│       mergedServerState,                                                │
│       clientVector                                                      │
│     )                                                                   │
│  4. Server sends: diff (exactly what client is missing)                 │
│  5. Client applies: Y.applyUpdateV2(localDoc, diff)                     │
│  6. Client now has complete current state                               │
│                                                                          │
│  ════════════════════════════════════════════════════════════════════   │
│  THE SERVER DOESN'T NEED THE CLIENT'S SESSION RECORD FOR RECOVERY       │
│  THE CLIENT'S LOCAL STATE VECTOR TELLS US EXACTLY WHAT THEY NEED        │
│  ════════════════════════════════════════════════════════════════════   │
│                                                                          │
│  Sessions are for COMPACTION DECISIONS, not for recovery.               │
│  Recovery works regardless of whether session exists.                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. System Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐         ┌─────────────────────────────────────────┐    │
│  │   CLIENT    │         │              SERVER (Convex)             │    │
│  ├─────────────┤         ├─────────────────────────────────────────┤    │
│  │             │         │                                         │    │
│  │  Y.Doc      │◄───────►│  ┌─────────┐  ┌──────────┐  ┌────────┐ │    │
│  │  clientID   │  sync   │  │documents│  │ snapshots│  │sessions│ │    │
│  │             │   WS    │  │ (deltas)│  │          │  │        │ │    │
│  │  State      │         │  └────┬────┘  └────┬─────┘  └───┬────┘ │    │
│  │  Vector     │────────►│       │            │            │      │    │
│  │             │ heartbeat       │            │            │      │    │
│  │  localStorage│        │       └────────────┼────────────┘      │    │
│  │  (clientID) │         │                    │                   │    │
│  │             │         │              ┌─────┴─────┐             │    │
│  └─────────────┘         │              │COMPACTION │             │    │
│                          │              │  LOGIC    │             │    │
│                          │              └───────────┘             │    │
│                          └─────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Complete Relationship Graph

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HOW EVERYTHING CONNECTS                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         SERVER                                   │    │
│  │                                                                  │    │
│  │   DOCUMENTS (deltas)         SNAPSHOTS           SESSIONS       │    │
│  │   ┌─────────────────┐       ┌───────────┐       ┌───────────┐   │    │
│  │   │ Individual Yjs  │       │ Merged    │       │ Client    │   │    │
│  │   │ updates         │──────►│ state     │       │ vectors   │   │    │
│  │   │                 │ merge │ checkpoint│       │           │   │    │
│  │   └────────┬────────┘       └─────┬─────┘       └─────┬─────┘   │    │
│  │            │                      │                   │         │    │
│  │            │    ┌─────────────────┴───────────────────┘         │    │
│  │            │    │                                               │    │
│  │            ▼    ▼                                               │    │
│  │   ┌─────────────────────────────────────────────────────────┐   │    │
│  │   │                    COMPACTION                            │   │    │
│  │   │  1. Merge deltas into snapshot                          │   │    │
│  │   │  2. Check sessions: which deltas are safe to delete?    │   │    │
│  │   │  3. Delete deltas all sessions have                     │   │    │
│  │   │  4. Delete sessions caught up to snapshot               │   │    │
│  │   └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  └──────────────────────────────┬───────────────────────────────────┘    │
│                                 │                                        │
│         ┌───────────────────────┼───────────────────────┐                │
│         │                       │                       │                │
│         ▼                       ▼                       ▼                │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐        │
│  │ MATERIALIZED│         │   STREAM    │         │  RECOVERY   │        │
│  │   (SSR)     │         │             │         │             │        │
│  └──────┬──────┘         └──────┬──────┘         └──────┬──────┘        │
│         │                       │                       │                │
│         │                       │                       │                │
│  ┌──────┴───────────────────────┴───────────────────────┴──────┐        │
│  │                         CLIENT                               │        │
│  │                                                              │        │
│  │  ┌──────────────────────────────────────────────────────┐   │        │
│  │  │                    Y.Doc (local)                      │   │        │
│  │  │                                                       │   │        │
│  │  │  SQLite/IndexedDB ◄─── persist ───► State Vector     │   │        │
│  │  │        │                                   │          │   │        │
│  │  │        │                                   │          │   │        │
│  │  │        ▼                                   ▼          │   │        │
│  │  │  localStorage ◄─────────────────────► clientID       │   │        │
│  │  └──────────────────────────────────────────────────────┘   │        │
│  │                                                              │        │
│  └──────────────────────────────────────────────────────────────┘        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    DATA FLOW BY SCENARIO                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SSR (First Load):                                                       │
│  ─────────────────                                                       │
│    Server: materialized query                                           │
│      → Returns documents + CRDT bytes per document                      │
│      → CRDT bytes = snapshot + deltas (merged)                          │
│    Client: hydrate Y.Doc from CRDT bytes                                │
│      → No recovery needed, already has full state                       │
│                                                                          │
│  STREAMING (Normal Sync):                                                │
│  ────────────────────────                                                │
│    Client: subscribe to stream(cursor)                                  │
│      → Receives deltas since cursor                                     │
│      → Applies to local Y.Doc                                           │
│      → Updates cursor                                                   │
│    Sessions: track client's vector via heartbeat                        │
│      → Enables safe delta deletion                                      │
│                                                                          │
│  RECOVERY (Reconnect/Catch-up):                                          │
│  ──────────────────────────────                                          │
│    Client: sends local state vector                                     │
│    Server: diff(snapshot + deltas, clientVector)                        │
│      → Returns exactly what client is missing                           │
│    Client: applies diff, fully synced                                   │
│      → Works regardless of whether session exists                       │
│                                                                          │
│  COMPACTION (Optimization):                                              │
│  ──────────────────────────                                              │
│    Trigger: delta count >= 500 per document                             │
│    Server:                                                              │
│      1. Merge deltas into snapshot                                      │
│      2. Check each session's vector                                     │
│      3. Delete deltas that ALL sessions have                            │
│      4. Delete disconnected sessions caught up to snapshot              │
│    Result: bounded storage, streaming still works for slow clients      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    RELATIONSHIP SUMMARY                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DOCUMENTS (deltas)                                                      │
│    └── merged into → SNAPSHOTS                                          │
│    └── streamed to → CLIENT (via stream query)                          │
│    └── deleted when → all SESSIONS have them                            │
│                                                                          │
│  SNAPSHOTS                                                               │
│    └── enables → RECOVERY (diff against client vector)                  │
│    └── enables → SSR/MATERIALIZED (initial state)                       │
│    └── enables → safe SESSION deletion (when caught up)                 │
│    └── enables → safe DELTA deletion (data preserved)                   │
│                                                                          │
│  SESSIONS                                                                │
│    └── track → client state vectors (what they have)                    │
│    └── enable → safe DELTA deletion (protect slow clients)              │
│    └── provide → PRESENCE (cursors, online status)                      │
│    └── deleted when → caught up to SNAPSHOT                             │
│                                                                          │
│  MATERIALIZED (SSR query)                                                │
│    └── returns → documents + CRDT state                                 │
│    └── CRDT state = SNAPSHOT + DELTAS merged                            │
│    └── client hydrates → Y.Doc                                          │
│                                                                          │
│  RECOVERY (catch-up query)                                               │
│    └── uses → client's LOCAL vector (not session)                       │
│    └── computes → diff(SNAPSHOT + DELTAS, clientVector)                 │
│    └── always works → even without session                              │
│                                                                          │
│  STREAM (real-time sync)                                                 │
│    └── returns → DELTAS since cursor                                    │
│    └── protected by → SESSIONS (deltas not deleted while needed)        │
│    └── triggers → COMPACTION (when count >= 500)                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Three Tables, Three Purposes

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         THREE TABLES                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ DOCUMENTS (deltas)                                              │    │
│  │ Purpose: Store individual updates                               │    │
│  │ Content: Yjs binary updates (operations from clients)           │    │
│  │ Lifecycle: Created on edit → Merged into snapshot → Deleted     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                               │
│                          │ compaction merges into                        │
│                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ SNAPSHOTS                                                       │    │
│  │ Purpose: Checkpoint of complete document state                  │    │
│  │ Content: Merged Yjs update + state vector                       │    │
│  │ Lifecycle: Created/updated during compaction, never deleted     │    │
│  │ Key: snapshot.vector enables safe session + delta deletion      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                               │
│                          │ enables safe deletion of                      │
│                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ SESSIONS                                                        │    │
│  │ Purpose: Track what state vector each client has                │    │
│  │ Content: Client's last known state vector + presence info       │    │
│  │ Lifecycle: Created on connect → Deleted when caught up          │    │
│  │ Key: Deleted ONLY when snapshot.vector >= session.vector        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why Sessions Matter

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SESSIONS: NOT REQUIRED, BUT ESSENTIAL                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DATA SAFETY WITHOUT SESSIONS:                                           │
│  ─────────────────────────────                                           │
│  Recovery ALWAYS works via: diff(snapshot, client's LOCAL vector)       │
│  The snapshot has all the data. Clients can always recover.             │
│  Sessions are NOT strictly required for the data guarantee.             │
│                                                                          │
│  BUT WITHOUT SESSIONS, YOU MUST CHOOSE:                                  │
│  ──────────────────────────────────────                                  │
│                                                                          │
│  Option A: Never delete deltas                                          │
│    → Storage grows unbounded forever                                    │
│    → Database bloat, slow queries, $$$                                  │
│                                                                          │
│  Option B: Delete ALL deltas after snapshot                             │
│    → Active streaming clients lose deltas mid-stream                    │
│    → Every client must call recovery constantly                         │
│    → More server load, worse latency                                    │
│                                                                          │
│  THE PRIMARY EDGE CASE (why sessions exist):                             │
│  ───────────────────────────────────────────                             │
│                                                                          │
│  Sessions track the "oldest known state" in the system:                 │
│                                                                          │
│    Session A: vector [1-8]  ← has everything                            │
│    Session B: vector [1-5]  ← SLOW CLIENT, still syncing                │
│    Session C: vector [1-8]  ← has everything                            │
│                                                                          │
│  Without sessions, we'd delete deltas 1-8 (all in snapshot).            │
│  Session B's stream would break - deltas 6-8 are gone!                  │
│                                                                          │
│  With sessions:                                                          │
│    Safe to delete: deltas 1-5 (all sessions have them)                  │
│    Must keep: deltas 6-8 (Session B still needs them)                   │
│                                                                          │
│  Session B continues streaming normally. No recovery needed.            │
│                                                                          │
│  ════════════════════════════════════════════════════════════════════   │
│  THIS IS THE PRIMARY DESIGN CONSTRAINT:                                  │
│  Protect slow/behind clients from losing deltas mid-stream              │
│  ════════════════════════════════════════════════════════════════════   │
│                                                                          │
│  SESSIONS OPTIMIZE THE DATABASE:                                         │
│  ────────────────────────────────                                        │
│  ✓ Delete old deltas as soon as safe (not "never" or "always")          │
│  ✓ Keep deltas that active clients need (streaming works)               │
│  ✓ Minimize recovery calls (only when truly needed)                     │
│  ✓ Bounded storage growth (deltas cleaned up continuously)              │
│  ✓ Presence/cursors for free (we're tracking sessions anyway)           │
│                                                                          │
│  ════════════════════════════════════════════════════════════════════   │
│  SESSIONS = Massive database optimization + presence UI                  │
│  Without them: unbounded storage OR constant recovery calls              │
│  ════════════════════════════════════════════════════════════════════   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Cascading Delete

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CASCADING DELETE LOGIC                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  During compaction:                                                      │
│                                                                          │
│  STEP 1: Create/Update Snapshot                                          │
│  ─────────────────────────────────                                       │
│    merged = Y.mergeUpdatesV2(snapshot.bytes, ...deltas.bytes)           │
│    snapshot.vector = Y.encodeStateVectorFromUpdateV2(merged)            │
│                                                                          │
│  STEP 2: Delete Caught-Up Sessions                                       │
│  ──────────────────────────────────                                      │
│    for each session where connected = false:                            │
│      diff = Y.diffUpdateV2(snapshot.bytes, session.vector)              │
│      if diff.byteLength <= 2:  // Empty diff = caught up                │
│        DELETE session                                                   │
│      // Session with no vector can also be deleted (full recovery)      │
│                                                                          │
│  STEP 3: Delete Deltas (if safe)                                         │
│  ────────────────────────────────                                        │
│    canDelete = true                                                     │
│    for each remaining session:  // Connected AND not-caught-up          │
│      diff = Y.diffUpdateV2(merged, session.vector)                      │
│      if diff.byteLength > 2:                                            │
│        canDelete = false  // This session still needs deltas            │
│        break                                                            │
│                                                                          │
│    if canDelete:                                                        │
│      DELETE all deltas                                                  │
│                                                                          │
│  ════════════════════════════════════════════════════════════════════   │
│  NEVER delete based on time. ALWAYS delete based on state vectors.      │
│  ════════════════════════════════════════════════════════════════════   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Model

### Current Schema

```typescript
// src/component/schema.ts

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ═══════════════════════════════════════════════════════════════════════
  // DOCUMENTS: Individual Yjs updates (deltas)
  // ═══════════════════════════════════════════════════════════════════════
  documents: defineTable({
    collection: v.string(),           // Which collection
    document: v.string(),             // Which document
    bytes: v.bytes(),                 // Yjs update binary
    seq: v.number(),                  // Global sequence number for ordering
  })
    .index("by_collection", ["collection"])
    .index("by_document", ["collection", "document"])
    .index("by_seq", ["collection", "seq"]),

  // ═══════════════════════════════════════════════════════════════════════
  // SNAPSHOTS: Merged state checkpoints
  // ═══════════════════════════════════════════════════════════════════════
  snapshots: defineTable({
    collection: v.string(),           // Which collection
    document: v.string(),             // Which document
    bytes: v.bytes(),                 // Merged Yjs update (Y.mergeUpdatesV2)
    vector: v.bytes(),                // State vector (Y.encodeStateVectorFromUpdateV2)
    seq: v.number(),                  // Highest seq included in snapshot
    created: v.number(),              // Timestamp
  })
    .index("by_document", ["collection", "document"]),

  // ═══════════════════════════════════════════════════════════════════════
  // SESSIONS: Client state tracking for compaction
  // ═══════════════════════════════════════════════════════════════════════
  sessions: defineTable({
    // Identity
    collection: v.string(),           // Which collection
    document: v.string(),             // Which document
    client: v.string(),               // Y.Doc.clientID (persisted)

    // Sync state (for compaction decisions)
    vector: v.optional(v.bytes()),    // Client's state vector
    connected: v.boolean(),           // Currently heartbeating?
    seq: v.number(),                  // Last known seq

    // Liveness
    seen: v.number(),                 // Last heartbeat timestamp

    // Presence (for UI)
    user: v.optional(v.string()),     // User ID for grouping
    profile: v.optional(v.object({
      name: v.optional(v.string()),
      color: v.optional(v.string()),
      avatar: v.optional(v.string()),
    })),
    cursor: v.optional(v.object({
      anchor: v.any(),                // Yjs RelativePosition
      head: v.any(),                  // Yjs RelativePosition
      field: v.optional(v.string()),
    })),

    // Watchdog
    timeout: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_collection", ["collection"])
    .index("by_document", ["collection", "document"])
    .index("by_client", ["collection", "document", "client"])
    .index("by_connected", ["collection", "document", "connected"]),
});
```

---

## 5. Session Identity

### Persisting Y.Doc.clientID

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CLIENT IDENTITY MODEL                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Browser with shared storage (SQLite/IndexedDB):                        │
│  ─────────────────────────────────────────────────                       │
│                                                                          │
│   Tab 1          Tab 2          Tab 3                                   │
│     │              │              │                                     │
│     └──────────────┼──────────────┘                                     │
│                    │                                                     │
│                    ▼                                                     │
│           ┌───────────────┐                                              │
│           │    SQLite     │  ← Shared Y.Doc state                        │
│           │  localStorage │  ← Shared clientID                           │
│           └───────────────┘                                              │
│                    │                                                     │
│                    ▼                                                     │
│              Same client!                                                │
│              Same clientID!                                              │
│              Same session!                                               │
│                                                                          │
│  Why this is correct:                                                    │
│  ────────────────────                                                    │
│  - All tabs share the same Y.Doc state (from shared storage)            │
│  - They ARE the same logical client                                     │
│  - Yjs warning about duplicate clientIDs applies to DIFFERENT Y.Docs   │
│  - Shared storage means same Y.Doc = same clientID is SAFE              │
│                                                                          │
│  Benefits:                                                               │
│  ─────────                                                               │
│  - Same session across page refresh                                     │
│  - Same session across tabs                                             │
│  - No duplicate sessions                                                │
│  - Accurate user count                                                  │
│  - No race conditions (localStorage is synchronous)                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
// Client-side: Load or create clientID
const getClientID = (collection: string): number => {
  const key = `replicate:clientId:${collection}`;
  
  // localStorage is synchronous - no race condition
  let stored = localStorage.getItem(key);
  
  if (stored) {
    return Number(stored);
  }
  
  // Generate new clientID (same algorithm as Yjs)
  const clientID = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  localStorage.setItem(key, String(clientID));
  
  return clientID;
};

// Use when creating Y.Doc
const clientID = getClientID(collection);
const doc = new Y.Doc({ clientID });

// Heartbeat sends string version
convexClient.mutation(api.mark, {
  client: String(clientID),  // Convex doesn't support bigint, use string
  vector: Y.encodeStateVector(doc).buffer,
  // ...
});
```

---

## 6. Data Flows

### Flow 1: Write Path

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    WRITE PATH                                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  CLIENT                              SERVER                              │
│                                                                          │
│  1. User edits Y.Doc                                                     │
│     │                                                                    │
│     ▼                                                                    │
│  2. Y.Doc fires 'update' event                                          │
│     update = Uint8Array (Yjs binary)                                    │
│     │                                                                    │
│     ▼                                                                    │
│  3. Send to server ─────────────────►  4. Insert into documents table   │
│     mutation(update, {                    INSERT INTO documents          │
│       document,                           (collection, document,         │
│       bytes: update,                       bytes, seq)                   │
│     })                                                                   │
│                                                                          │
│                                        5. Return { seq }                │
│     │                                       │                            │
│     ▼                                       │                            │
│  6. Update local cursor ◄────────────────────┘                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Flow 2: Read Path (Streaming)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    READ PATH                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  CLIENT                              SERVER                              │
│                                                                          │
│  1. Subscribe (WebSocket)                                                │
│     onUpdate(stream, { cursor })                                        │
│     │                                                                    │
│     │                               2. Query: SELECT * FROM documents   │
│     │                                  WHERE seq > cursor                │
│     │                                                                    │
│     │                               3. Check delta count per document   │
│     │                                  Collect all with count >= 500    │
│     │                                       │                            │
│  4. Receive ◄────────────────────────────────┘                           │
│     { changes, cursor, compaction?: { documents: string[] } }           │
│     │                                                                    │
│     ▼                                                                    │
│  5. Apply each update                                                    │
│     Y.applyUpdateV2(doc, change.bytes)                                  │
│     │                                                                    │
│     ▼                                                                    │
│  6. If compact hint → trigger compaction                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Flow 3: Compaction

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    COMPACTION FLOW                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  STEP 1: Gather Data                                                     │
│  ───────────────────                                                     │
│    deltas = SELECT * FROM documents WHERE document = ?                  │
│    snapshot = SELECT * FROM snapshots WHERE document = ?                │
│    sessions = SELECT * FROM sessions WHERE document = ?                 │
│                                                                          │
│  STEP 2: Merge Into Snapshot                                             │
│  ───────────────────────────                                             │
│    updates = [snapshot?.bytes, ...deltas.map(d => d.bytes)]             │
│    merged = Y.mergeUpdatesV2(updates.filter(Boolean))                   │
│    vector = Y.encodeStateVectorFromUpdateV2(merged)                     │
│                                                                          │
│    UPSERT snapshots SET bytes=merged, vector=vector, seq=max            │
│                                                                          │
│  STEP 3: Cascading Session Cleanup                                       │
│  ─────────────────────────────────                                       │
│    for each session WHERE connected = false:                            │
│      if !session.vector:                                                │
│        DELETE session  // No vector = full recovery from snapshot       │
│        continue                                                         │
│                                                                          │
│      diff = Y.diffUpdateV2(merged, session.vector)                      │
│      if diff.byteLength <= 2:                                           │
│        DELETE session  // Caught up = can recover from snapshot         │
│                                                                          │
│  STEP 4: Check Delta Deletion Safety                                     │
│  ────────────────────────────────────                                    │
│    canDelete = true                                                     │
│    for each remaining session:                                          │
│      if !session.vector:                                                │
│        canDelete = false; break                                         │
│                                                                          │
│      diff = Y.diffUpdateV2(merged, session.vector)                      │
│      if diff.byteLength > 2:                                            │
│        canDelete = false; break                                         │
│                                                                          │
│  STEP 5: Delete Deltas (if safe)                                         │
│  ────────────────────────────────                                        │
│    if canDelete:                                                        │
│      DELETE FROM documents WHERE document = ?                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Compaction Trigger

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    COMPACTION TRIGGER                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Threshold: 500 deltas per document (matches y-indexeddb)               │
│                                                                          │
│  Why delta COUNT, not size:                                              │
│  ──────────────────────────                                              │
│  - Each delta has fixed CRDT overhead (metadata, clock, clientID)       │
│  - 10,000 tiny deltas is worse than 100 large deltas                   │
│  - Count measures CRDT complexity, size measures content                │
│  - y-indexeddb uses PREFERRED_TRIM_SIZE = 500                          │
│                                                                          │
│  Trigger flow:                                                           │
│  ─────────────                                                           │
│  1. Stream query counts deltas per document                             │
│  2. Collect all documents with count >= 500                             │
│  3. Return compaction: { documents: [...] }                             │
│  4. Client compacts each document (can parallelize)                     │
│  5. Compact merges deltas → cleans up sessions/deltas                   │
│                                                                          │
│  Configuration:                                                          │
│  ──────────────                                                          │
│  const DELTA_COUNT_THRESHOLD = 500;  // Configurable per-collection     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Flow 4: Recovery

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    RECOVERY FLOW                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  CLIENT                              SERVER                              │
│                                                                          │
│  1. Client has local Y.Doc                                               │
│     (persisted in SQLite/IndexedDB)                                     │
│     │                                                                    │
│     ▼                                                                    │
│  2. Encode state vector                                                  │
│     vector = Y.encodeStateVector(doc)                                   │
│     │                                                                    │
│     ▼                                                                    │
│  3. Request recovery ───────────────►  4. Load server state             │
│     query(recovery, {                     snapshot + deltas             │
│       document,                           │                             │
│       vector                              ▼                             │
│     })                                 5. Merge                         │
│                                           merged = Y.mergeUpdatesV2(...)│
│                                           │                             │
│                                           ▼                             │
│                                        6. Compute diff                  │
│                                           diff = Y.diffUpdateV2(        │
│                                             merged,                     │
│                                             clientVector                │
│                                           )                             │
│                                           │                             │
│  7. Receive diff ◄─────────────────────────┘                            │
│     │                                                                    │
│     ▼                                                                    │
│  8. Apply diff                                                           │
│     Y.applyUpdateV2(doc, diff)                                          │
│     │                                                                    │
│     ▼                                                                    │
│  9. Resume streaming                                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Flow 5: Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SESSION LIFECYCLE                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ CONNECT                                                         │    │
│  │                                                                 │    │
│  │   clientID loaded from localStorage (or generated)              │    │
│  │   Client calls mark() with state vector                         │    │
│  │   → Session created/updated, connected: true                    │    │
│  │   → Watchdog scheduled (heartbeat × 2.5)                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                               │
│                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ HEARTBEAT (every 10s)                                           │    │
│  │                                                                 │    │
│  │   Client sends: mark({                                          │    │
│  │     client: clientID,                                           │    │
│  │     vector: Y.encodeStateVector(doc),                           │    │
│  │     cursor: position,                                           │    │
│  │   })                                                            │    │
│  │                                                                 │    │
│  │   Server: updates session.vector, reschedules watchdog          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                               │
│          ┌───────────────┼───────────────┐                              │
│          ▼               ▼               ▼                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                     │
│  │  LEAVE       │ │   CRASH      │ │  TIMEOUT     │                     │
│  │  (pagehide)  │ │              │ │  (watchdog)  │                     │
│  ├──────────────┤ ├──────────────┤ ├──────────────┤                     │
│  │ connected:   │ │ Watchdog     │ │ Watchdog     │                     │
│  │   false      │ │ fires →      │ │ fires →      │                     │
│  │ cursor:      │ │ connected:   │ │ connected:   │                     │
│  │   cleared    │ │   false      │ │   false      │                     │
│  └──────────────┘ └──────────────┘ └──────────────┘                     │
│          │               │               │                              │
│          └───────────────┼───────────────┘                              │
│                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ DISCONNECTED                                                    │    │
│  │                                                                 │    │
│  │   Session preserved with vector (for compaction decisions)      │    │
│  │   Deleted during compaction when caught up to snapshot          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Server API

### Mutations

```typescript
// mark - Heartbeat with state vector
export const mark = mutation({
  args: {
    collection: v.string(),
    document: v.string(),
    client: v.string(),               // Y.Doc.clientID as string
    vector: v.optional(v.bytes()),    // Y.encodeStateVector(doc)
    seq: v.optional(v.number()),
    cursor: v.optional(v.object({...})),
    user: v.optional(v.string()),
    profile: v.optional(v.object({...})),
    interval: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Upsert session with latest vector
    // Reschedule watchdog
  },
});

// disconnect - Called by watchdog
export const disconnect = mutation({
  args: { collection, document, client },
  handler: async (ctx, args) => {
    // Set connected: false, clear cursor
    // Keep vector for compaction decisions
  },
});

// leave - Called by client on pagehide
export const leave = mutation({
  args: { collection, document, client },
  handler: async (ctx, args) => {
    // Same as disconnect but triggered by client
  },
});

// compact - Merge deltas, cleanup sessions and deltas
export const compact = mutation({
  args: { collection, document },
  handler: async (ctx, args) => {
    // 1. Merge into snapshot
    // 2. Delete caught-up disconnected sessions
    // 3. Delete deltas if all remaining sessions have them
  },
});
```

### Queries

```typescript
// recovery - Get diff for reconnecting client
export const recovery = query({
  args: {
    collection: v.string(),
    document: v.string(),
    vector: v.bytes(),
  },
  handler: async (ctx, args) => {
    // Merge snapshot + deltas
    // Return diff against client's vector
  },
});

// sessions - Get active sessions for presence UI
export const sessions = query({
  args: {
    collection: v.string(),
    document: v.string(),
    connected: v.optional(v.boolean()),
    exclude: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Return sessions with presence info
  },
});
```

---

## 8. Invariants & Guarantees

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SYSTEM INVARIANTS                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  INVARIANT 1: Snapshot Completeness                                      │
│  ─────────────────────────────────────                                   │
│  snapshot.bytes contains all operations up to snapshot.seq              │
│  snapshot.vector accurately describes what's in snapshot.bytes          │
│                                                                          │
│  INVARIANT 2: Safe Session Deletion                                      │
│  ─────────────────────────────────────                                   │
│  A session is deleted ONLY when:                                        │
│    connected = false AND                                                │
│    diff(snapshot, session.vector).byteLength <= 2                       │
│  This guarantees client can recover from snapshot.                      │
│                                                                          │
│  INVARIANT 3: Safe Delta Deletion                                        │
│  ─────────────────────────────────────                                   │
│  Deltas are deleted ONLY when ALL remaining sessions have them.         │
│  "Have them" = diff(merged, session.vector).byteLength <= 2             │
│                                                                          │
│  INVARIANT 4: Recovery Always Works                                      │
│  ─────────────────────────────────────                                   │
│  For any client with local Y.Doc:                                       │
│    diff(serverState, clientVector) gives exactly what they need         │
│  This works regardless of whether session exists.                       │
│                                                                          │
│  INVARIANT 5: No Data Loss                                               │
│  ─────────────────────────────────────                                   │
│  Every operation that reached the server is either:                     │
│    - In a delta (not yet compacted)                                     │
│    - In the snapshot (compacted)                                        │
│  Clients can always recover full state.                                 │
│                                                                          │
│  ════════════════════════════════════════════════════════════════════   │
│  NEVER delete based on time. ALWAYS delete based on state vectors.      │
│  ════════════════════════════════════════════════════════════════════   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Optimizations

### Implemented

| Optimization | Description |
|--------------|-------------|
| **Session-based delta management** | Track oldest state → delete only safe deltas → bounded storage |
| **Persisted clientID** | localStorage (sync), same across refresh/tabs |
| **Demand-driven compaction** | Triggered by delta count (500), matching y-indexeddb |
| **Server-side merging** | Y.mergeUpdatesV2 without Y.Doc instantiation |
| **State vector tracking** | Sessions report vector for safe deletion decisions |
| **Cascading delete** | Sessions deleted when caught up to snapshot |
| **Watchdog disconnect** | Scheduled function marks sessions disconnected |
| **Graceful leave** | pagehide handler clears cursor immediately |
| **WebSocket streaming** | Real-time sync via Convex subscriptions |

### To Consider

| Optimization | Description |
|--------------|-------------|
| **Visibility-based cursor** | Clear cursor on tab hidden |
| **Cursor throttling** | Debounce rapid cursor updates |
| **User-level grouping** | Group sessions by user field |

### Anti-Patterns (AVOID)

| Anti-Pattern | Why It's Wrong |
|--------------|----------------|
| **Time-based deletion** | Time is not a measure of data safety |
| **Delete sessions by age** | Might have unsynced state |
| **Delete deltas by age** | Clients might still need them |
| **Skip vector checks** | Only vectors tell us what's safe |

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    KEY INSIGHTS                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. State vectors are the source of truth                                │
│     - They tell us exactly what each client has                         │
│     - Comparison determines what's safe to delete                       │
│                                                                          │
│  2. Snapshots guarantee recovery                                         │
│     - Recovery = diff(snapshot, client's LOCAL vector)                  │
│     - Always works, regardless of sessions                              │
│                                                                          │
│  3. Sessions enable efficient delta management                           │
│     - Track "oldest known state" in the system                          │
│     - Delete deltas that ALL sessions have (safe)                       │
│     - Keep deltas that some sessions need (streaming)                   │
│     - Without sessions: unbounded storage OR constant recovery          │
│                                                                          │
│  4. Sessions deleted when snapshot covers them                           │
│     - snapshot.vector >= session.vector → safe to delete                │
│     - Client can recover from snapshot if they reconnect                │
│                                                                          │
│  5. ClientID persisted when storage is shared                            │
│     - Shared SQLite/localStorage = same logical client                  │
│     - Same client = same clientID = same session                        │
│                                                                          │
│  6. NEVER use time for deletion decisions                                │
│     - Only state vectors determine data safety                          │
│     - Disconnected for 1 year? Still safe if caught up to snapshot      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```
