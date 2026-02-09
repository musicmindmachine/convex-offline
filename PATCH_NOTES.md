# Patch Notes (Local)

## 2026-02-06
- Added a durable, background compaction workflow using a new `runCompactionAction` that chunks work across runs and stores progress (boundary seq, cursor, scratch snapshot) in the `compaction` table.
- Switched compaction scheduling to enqueue the background action instead of the 1s mutation to avoid timeouts on large documents.
- Added compaction helpers for paginated delta reads, snapshot upsert, and batch deletion of deltas/sessions.
- Extended the `compaction` table schema with optional progress fields (`phase`, `cursor`, `boundarySeq`, `scratch`, `processed`).
- Added client-side fallback to fetch `material` from the server on init when no SSR material is provided, with paginated loading and a cursor reset to avoid stale seq gaps after replicate data resets.
- Fixed background compaction in Convex components by replacing `paginate()` usage with seq-based scanning and improving handling of sparse document deltas.
- Expanded sync-queue error logging with error name and stack to diagnose failing presence tasks.

Notes:
- Existing `runCompaction` mutation is still present for compatibility, but scheduled compactions now run through the action.
- The action builds a snapshot incrementally (scratch bytes) and only deletes deltas after a full merge within the boundary seq.

## 2026-02-09
- Defaulted delta stream limit to 50 to reduce payload size on large documents (configurable via `deltaLimit`).
- Added delta stream fallback to material snapshots when delta/view checks exceed Convex byte limits.
- Stored an optional `exists` flag alongside deltas to avoid live-table existence reads in delta queries.
- Added paginated compaction cleanup and a fast “retain latest N deltas” query to keep finalize runs bounded.
- Added a `sweepCompactions` action with paged `deltaCounts` scanning to schedule compactions across large collections.
