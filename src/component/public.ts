import * as Y from 'yjs';
import { v } from 'convex/values';
import { mutation, query } from '$/component/_generated/server';
import { getLogger } from '$/component/logger';
import { OperationType } from '$/shared/types.js';

export { OperationType };

// Default size threshold for auto-compaction (5MB)
const DEFAULT_SIZE_THRESHOLD = 5_000_000;

/**
 * Auto-compacts a document's deltas into a snapshot when size threshold is exceeded.
 * Returns null if no compaction needed, or the compaction result.
 */
async function _maybeCompactDocument(
  ctx: any,
  collection: string,
  documentId: string,
  threshold: number = DEFAULT_SIZE_THRESHOLD
): Promise<{ deltasCompacted: number; snapshotSize: number } | null> {
  const logger = getLogger(['compaction']);

  // Get all deltas for this specific document
  const deltas = await ctx.db
    .query('documents')
    .withIndex('by_collection_document_version', (q: any) =>
      q.eq('collection', collection).eq('documentId', documentId)
    )
    .collect();

  // Calculate total size
  const totalSize = deltas.reduce((sum: number, d: any) => sum + d.crdtBytes.byteLength, 0);

  // Skip if below size threshold
  if (totalSize < threshold) {
    return null;
  }

  logger.info('Auto-compacting document', {
    collection,
    documentId,
    deltaCount: deltas.length,
    totalSize,
    threshold,
  });

  // Merge deltas into snapshot
  const sorted = deltas.sort((a: any, b: any) => a.timestamp - b.timestamp);
  const updates = sorted.map((d: any) => new Uint8Array(d.crdtBytes));
  const compactedState = Y.mergeUpdatesV2(updates);

  // Validate compacted state
  const testDoc = new Y.Doc({ guid: `${collection}:${documentId}` });
  try {
    Y.applyUpdateV2(testDoc, compactedState);
  } catch (error) {
    logger.error('Compacted state validation failed', {
      collection,
      documentId,
      error: String(error),
    });
    testDoc.destroy();
    return null;
  }
  testDoc.destroy();

  // Delete existing snapshot for this document (keep only 1)
  const existingSnapshot = await ctx.db
    .query('snapshots')
    .withIndex('by_document', (q: any) =>
      q.eq('collection', collection).eq('documentId', documentId)
    )
    .first();
  if (existingSnapshot) {
    await ctx.db.delete('snapshots', existingSnapshot._id);
  }

  // Store new per-document snapshot
  await ctx.db.insert('snapshots', {
    collection,
    documentId,
    snapshotBytes: compactedState.buffer as ArrayBuffer,
    latestCompactionTimestamp: sorted[sorted.length - 1].timestamp,
    createdAt: Date.now(),
    metadata: {
      deltaCount: deltas.length,
      totalSize,
    },
  });

  // Delete old deltas
  for (const delta of sorted) {
    await ctx.db.delete('documents', delta._id);
  }

  logger.info('Auto-compaction completed', {
    collection,
    documentId,
    deltasCompacted: deltas.length,
    snapshotSize: compactedState.length,
  });

  return { deltasCompacted: deltas.length, snapshotSize: compactedState.length };
}

export const insertDocument = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
    threshold: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    compacted: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    await ctx.db.insert('documents', {
      collection: args.collection,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
    });

    // Auto-compact if size threshold exceeded
    const compactionResult = await _maybeCompactDocument(
      ctx,
      args.collection,
      args.documentId,
      args.threshold ?? DEFAULT_SIZE_THRESHOLD
    );

    return {
      success: true,
      compacted: compactionResult !== null,
    };
  },
});

export const updateDocument = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
    threshold: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    compacted: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    await ctx.db.insert('documents', {
      collection: args.collection,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
    });

    // Auto-compact if size threshold exceeded
    const compactionResult = await _maybeCompactDocument(
      ctx,
      args.collection,
      args.documentId,
      args.threshold ?? DEFAULT_SIZE_THRESHOLD
    );

    return {
      success: true,
      compacted: compactionResult !== null,
    };
  },
});

export const deleteDocument = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
    threshold: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    compacted: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    await ctx.db.insert('documents', {
      collection: args.collection,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
    });

    // Auto-compact if size threshold exceeded
    const compactionResult = await _maybeCompactDocument(
      ctx,
      args.collection,
      args.documentId,
      args.threshold ?? DEFAULT_SIZE_THRESHOLD
    );

    return {
      success: true,
      compacted: compactionResult !== null,
    };
  },
});

export const stream = query({
  args: {
    collection: v.string(),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    vector: v.optional(v.bytes()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    changes: v.array(
      v.object({
        documentId: v.optional(v.string()),
        crdtBytes: v.bytes(),
        version: v.number(),
        timestamp: v.number(),
        operationType: v.string(),
      })
    ),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    // Get deltas newer than checkpoint
    const documents = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', (q) =>
        q.eq('collection', args.collection).gt('timestamp', args.checkpoint.lastModified)
      )
      .order('asc')
      .take(limit);

    if (documents.length > 0) {
      const changes = documents.map((doc) => ({
        documentId: doc.documentId,
        crdtBytes: doc.crdtBytes,
        version: doc.version,
        timestamp: doc.timestamp,
        operationType: OperationType.Delta,
      }));

      const newCheckpoint = {
        lastModified: documents[documents.length - 1]?.timestamp ?? args.checkpoint.lastModified,
      };

      return {
        changes,
        checkpoint: newCheckpoint,
        hasMore: documents.length === limit,
      };
    }

    // Check for disparity - client checkpoint older than oldest delta
    const oldestDelta = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', (q) => q.eq('collection', args.collection))
      .order('asc')
      .first();

    if (oldestDelta && args.checkpoint.lastModified < oldestDelta.timestamp) {
      // Disparity detected - need to send all per-document snapshots
      // Get all snapshots for this collection
      const snapshots = await ctx.db
        .query('snapshots')
        .withIndex('by_document', (q) => q.eq('collection', args.collection))
        .collect();

      if (snapshots.length === 0) {
        throw new Error(
          `Disparity detected but no snapshots available for collection: ${args.collection}. ` +
            `Client checkpoint: ${args.checkpoint.lastModified}, ` +
            `Oldest delta: ${oldestDelta.timestamp}`
        );
      }

      // Return all snapshots as changes
      const changes = snapshots.map((snapshot) => ({
        documentId: snapshot.documentId,
        crdtBytes: snapshot.snapshotBytes,
        version: 0,
        timestamp: snapshot.createdAt,
        operationType: OperationType.Snapshot,
      }));

      // Find the latest compaction timestamp to use as checkpoint
      const latestTimestamp = Math.max(...snapshots.map((s) => s.latestCompactionTimestamp));

      return {
        changes,
        checkpoint: {
          lastModified: latestTimestamp,
        },
        hasMore: false,
      };
    }

    return {
      changes: [],
      checkpoint: args.checkpoint,
      hasMore: false,
    };
  },
});

export const getInitialState = query({
  args: {
    collection: v.string(),
  },
  returns: v.union(
    v.object({
      crdtBytes: v.bytes(),
      checkpoint: v.object({
        lastModified: v.number(),
      }),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const logger = getLogger(['ssr']);

    // Get all per-document snapshots for this collection
    const snapshots = await ctx.db
      .query('snapshots')
      .withIndex('by_document', (q) => q.eq('collection', args.collection))
      .collect();

    // Get all deltas for this collection
    const deltas = await ctx.db
      .query('documents')
      .withIndex('by_collection', (q) => q.eq('collection', args.collection))
      .collect();

    if (snapshots.length === 0 && deltas.length === 0) {
      logger.info('No initial state available - collection is empty', {
        collection: args.collection,
      });
      return null;
    }

    // Merge all snapshots and deltas together
    const updates: Uint8Array[] = [];
    let latestTimestamp = 0;

    // Add all per-document snapshots
    for (const snapshot of snapshots) {
      updates.push(new Uint8Array(snapshot.snapshotBytes));
      latestTimestamp = Math.max(latestTimestamp, snapshot.latestCompactionTimestamp);
    }

    // Add all deltas
    const sorted = deltas.sort((a, b) => a.timestamp - b.timestamp);
    for (const delta of sorted) {
      updates.push(new Uint8Array(delta.crdtBytes));
      latestTimestamp = Math.max(latestTimestamp, delta.timestamp);
    }

    logger.info('Reconstructing initial state', {
      collection: args.collection,
      snapshotCount: snapshots.length,
      deltaCount: deltas.length,
    });

    const merged = Y.mergeUpdatesV2(updates);

    logger.info('Initial state reconstructed', {
      collection: args.collection,
      originalSize: updates.reduce((sum, u) => sum + u.byteLength, 0),
      mergedSize: merged.byteLength,
    });

    return {
      crdtBytes: merged.buffer as ArrayBuffer,
      checkpoint: {
        lastModified: latestTimestamp,
      },
    };
  },
});

// ============================================================================
// Version History APIs
// ============================================================================

/**
 * Reconstructs a document's current state from its snapshot and deltas.
 * Returns the merged state bytes that can be applied to a fresh Y.Doc.
 */
async function _reconstructDocumentState(
  ctx: any,
  collection: string,
  documentId: string
): Promise<{ stateBytes: Uint8Array; latestTimestamp: number } | null> {
  // Get per-document snapshot if available
  const snapshot = await ctx.db
    .query('snapshots')
    .withIndex('by_document', (q: any) =>
      q.eq('collection', collection).eq('documentId', documentId)
    )
    .first();

  // Get all deltas for this specific document
  const deltas = await ctx.db
    .query('documents')
    .withIndex('by_collection_document_version', (q: any) =>
      q.eq('collection', collection).eq('documentId', documentId)
    )
    .collect();

  if (deltas.length === 0 && !snapshot) {
    return null;
  }

  const updates: Uint8Array[] = [];
  let latestTimestamp = 0;

  // Start with snapshot if available
  if (snapshot) {
    updates.push(new Uint8Array(snapshot.snapshotBytes));
    latestTimestamp = snapshot.latestCompactionTimestamp;
  }

  // Add all deltas for this document
  const sorted = deltas.sort((a: any, b: any) => a.timestamp - b.timestamp);
  for (const delta of sorted) {
    updates.push(new Uint8Array(delta.crdtBytes));
    latestTimestamp = Math.max(latestTimestamp, delta.timestamp);
  }

  if (updates.length === 0) {
    return null;
  }

  const merged = Y.mergeUpdatesV2(updates);
  return { stateBytes: merged, latestTimestamp };
}

export const createVersion = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    label: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  returns: v.object({
    versionId: v.string(),
    createdAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const logger = getLogger(['versions']);

    logger.info('Creating version', {
      collection: args.collection,
      documentId: args.documentId,
      label: args.label,
    });

    const result = await _reconstructDocumentState(ctx, args.collection, args.documentId);

    if (!result) {
      throw new Error(`Document not found: ${args.documentId} in collection ${args.collection}`);
    }

    // Generate a unique version ID
    const versionId = `v_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const createdAt = Date.now();

    await ctx.db.insert('versions', {
      collection: args.collection,
      documentId: args.documentId,
      versionId,
      stateBytes: result.stateBytes.buffer as ArrayBuffer,
      label: args.label,
      createdAt,
      createdBy: args.createdBy,
    });

    logger.info('Version created', {
      collection: args.collection,
      documentId: args.documentId,
      versionId,
      stateSize: result.stateBytes.byteLength,
    });

    return { versionId, createdAt };
  },
});

export const listVersions = query({
  args: {
    collection: v.string(),
    documentId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      versionId: v.string(),
      label: v.union(v.string(), v.null()),
      createdAt: v.number(),
      createdBy: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const versions = await ctx.db
      .query('versions')
      .withIndex('by_document', (q) =>
        q.eq('collection', args.collection).eq('documentId', args.documentId)
      )
      .order('desc')
      .take(limit);

    return versions.map((v) => ({
      versionId: v.versionId,
      label: v.label ?? null,
      createdAt: v.createdAt,
      createdBy: v.createdBy ?? null,
    }));
  },
});

export const getVersion = query({
  args: {
    versionId: v.string(),
  },
  returns: v.union(
    v.object({
      versionId: v.string(),
      collection: v.string(),
      documentId: v.string(),
      stateBytes: v.bytes(),
      label: v.union(v.string(), v.null()),
      createdAt: v.number(),
      createdBy: v.union(v.string(), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const version = await ctx.db
      .query('versions')
      .withIndex('by_version_id', (q) => q.eq('versionId', args.versionId))
      .first();

    if (!version) {
      return null;
    }

    return {
      versionId: version.versionId,
      collection: version.collection,
      documentId: version.documentId,
      stateBytes: version.stateBytes,
      label: version.label ?? null,
      createdAt: version.createdAt,
      createdBy: version.createdBy ?? null,
    };
  },
});

export const restoreVersion = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    versionId: v.string(),
    createBackup: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    backupVersionId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const logger = getLogger(['versions']);

    logger.info('Restoring version', {
      collection: args.collection,
      documentId: args.documentId,
      versionId: args.versionId,
      createBackup: args.createBackup,
    });

    // Get the version to restore
    const version = await ctx.db
      .query('versions')
      .withIndex('by_version_id', (q) => q.eq('versionId', args.versionId))
      .first();

    if (!version) {
      throw new Error(`Version not found: ${args.versionId}`);
    }

    if (version.collection !== args.collection || version.documentId !== args.documentId) {
      throw new Error(
        `Version ${args.versionId} does not belong to document ${args.documentId} in collection ${args.collection}`
      );
    }

    let backupVersionId: string | null = null;

    // Optionally create a backup of current state before restore
    if (args.createBackup !== false) {
      const currentState = await _reconstructDocumentState(ctx, args.collection, args.documentId);

      if (currentState) {
        backupVersionId = `v_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        await ctx.db.insert('versions', {
          collection: args.collection,
          documentId: args.documentId,
          versionId: backupVersionId,
          stateBytes: currentState.stateBytes.buffer as ArrayBuffer,
          label: `Backup before restore to ${args.versionId}`,
          createdAt: Date.now(),
          createdBy: undefined,
        });

        logger.info('Created backup version', {
          backupVersionId,
          collection: args.collection,
          documentId: args.documentId,
        });
      }
    }

    // To restore, we need to create a delta that brings the document to the version's state.
    // We insert the version's stateBytes as a new delta - Yjs will merge it correctly.
    await ctx.db.insert('documents', {
      collection: args.collection,
      documentId: args.documentId,
      crdtBytes: version.stateBytes,
      version: Date.now(), // Use timestamp as version to ensure uniqueness
      timestamp: Date.now(),
    });

    logger.info('Version restored', {
      collection: args.collection,
      documentId: args.documentId,
      versionId: args.versionId,
      backupVersionId,
    });

    return { success: true, backupVersionId };
  },
});

export const deleteVersion = mutation({
  args: {
    versionId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const logger = getLogger(['versions']);

    const version = await ctx.db
      .query('versions')
      .withIndex('by_version_id', (q) => q.eq('versionId', args.versionId))
      .first();

    if (!version) {
      throw new Error(`Version not found: ${args.versionId}`);
    }

    await ctx.db.delete('versions', version._id);

    logger.info('Version deleted', {
      versionId: args.versionId,
      collection: version.collection,
      documentId: version.documentId,
    });

    return { success: true };
  },
});
