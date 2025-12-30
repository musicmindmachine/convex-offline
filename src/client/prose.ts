/**
 * Prose Field Helpers - Document-level state management for rich text sync
 *
 * Manages Y.XmlFragment observation, debounced sync, and pending state.
 * Uses document-level tracking to prevent race conditions.
 *
 * Also includes the Zod schema helpers for prose fields.
 */

import * as Y from "yjs";
import { z } from "zod";
import type { Collection } from "@tanstack/db";
import { getLogger } from "$/client/logger";
import { serializeYMapValue } from "$/client/merge";
import type { ProseValue } from "$/shared/types";

/** Server origin - changes from server should not trigger local sync */
const SERVER_ORIGIN = "server";

const logger = getLogger(["replicate", "prose"]);

// Default debounce time for prose sync
const DEFAULT_DEBOUNCE_MS = 1000;

// ============================================================================
// Document-Level State (keyed by "collection:document")
// ============================================================================

// Track when applying server data to prevent echo loops - DOCUMENT-LEVEL
const applyingFromServer = new Map<string, boolean>();

// Debounce timers for prose sync
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Last synced state vectors for computing deltas
const lastSyncedVectors = new Map<string, Uint8Array>();

// Pending sync state
const pendingState = new Map<string, boolean>();

// Pending state change listeners
const pendingListeners = new Map<string, Set<(pending: boolean) => void>>();

// Fragment observer cleanup functions
const fragmentObservers = new Map<string, () => void>();

// Failed sync queue for retry
const failedSyncQueue = new Map<string, boolean>();

// ============================================================================
// Applying From Server (Document-Level)
// ============================================================================

/**
 * Check if a document is currently applying server data.
 * Used to prevent echo loops in onUpdate handlers.
 */
export function isApplyingFromServer(collection: string, document: string): boolean {
  const key = `${collection}:${document}`;
  return applyingFromServer.get(key) ?? false;
}

/**
 * Set whether a document is currently applying server data.
 */
export function setApplyingFromServer(
  collection: string,
  document: string,
  value: boolean,
): void {
  const key = `${collection}:${document}`;
  if (value) {
    applyingFromServer.set(key, true);
  }
  else {
    applyingFromServer.delete(key);
  }
}

// ============================================================================
// Pending State Management
// ============================================================================

/**
 * Set pending state and notify listeners.
 */
function setPendingInternal(key: string, value: boolean): void {
  const current = pendingState.get(key) ?? false;

  if (current !== value) {
    pendingState.set(key, value);
    const listeners = pendingListeners.get(key);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(value);
        }
        catch (err) {
          logger.error("Pending listener error", { key, error: String(err) });
        }
      }
    }
  }
}

/**
 * Get current pending state for a document.
 */
export function isPending(collection: string, document: string): boolean {
  return pendingState.get(`${collection}:${document}`) ?? false;
}

/**
 * Subscribe to pending state changes for a document.
 */
export function subscribePending(
  collection: string,
  document: string,
  callback: (pending: boolean) => void,
): () => void {
  const key = `${collection}:${document}`;

  let listeners = pendingListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    pendingListeners.set(key, listeners);
  }

  listeners.add(callback);
  return () => {
    listeners?.delete(callback);
    if (listeners?.size === 0) {
      pendingListeners.delete(key);
    }
  };
}

// ============================================================================
// Cancel Pending Sync
// ============================================================================

/**
 * Cancel any pending debounced sync for a document.
 * Called when receiving remote updates to avoid conflicts.
 */
export function cancelPending(collection: string, document: string): void {
  const key = `${collection}:${document}`;
  const timer = debounceTimers.get(key);

  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(key);
    setPendingInternal(key, false);
    logger.debug("Cancelled pending sync due to remote update", { collection, document });
  }
}

/**
 * Cancel all pending syncs for a collection.
 * Called when receiving a snapshot that replaces all state.
 */
export function cancelAllPending(collection: string): void {
  const prefix = `${collection}:`;
  for (const [key, timer] of debounceTimers) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      debounceTimers.delete(key);
      setPendingInternal(key, false);
    }
  }
  logger.debug("Cancelled all pending syncs", { collection });
}

// ============================================================================
// Fragment Observation
// ============================================================================

/** Configuration for fragment observation */
export interface ProseObserverConfig {
  collection: string;
  document: string;
  field: string;
  fragment: Y.XmlFragment;
  ydoc: Y.Doc;
  ymap: Y.Map<unknown>;
  collectionRef: Collection<any>;
  debounceMs?: number;
}

/**
 * Set up observation for a prose field's Y.XmlFragment.
 * Returns a cleanup function.
 */
export function observeFragment(config: ProseObserverConfig): () => void {
  const {
    collection,
    document,
    field,
    fragment,
    ydoc,
    ymap,
    collectionRef,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  } = config;
  const key = `${collection}:${document}`;

  // Skip if already observing this document
  const existingCleanup = fragmentObservers.get(key);
  if (existingCleanup) {
    logger.debug("Fragment already being observed", { collection, document, field });
    return existingCleanup;
  }

  const observerHandler = (_events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    // Skip server-originated changes (echo prevention via transaction origin)
    if (transaction.origin === SERVER_ORIGIN) {
      return;
    }

    // Clear existing timer
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    // Mark as pending
    setPendingInternal(key, true);

    const timer = setTimeout(async () => {
      debounceTimers.delete(key);

      try {
        const lastVector = lastSyncedVectors.get(key);
        const delta = lastVector
          ? Y.encodeStateAsUpdateV2(ydoc, lastVector)
          : Y.encodeStateAsUpdateV2(ydoc);

        if (delta.length <= 2) {
          logger.debug("No changes to sync", { collection, document });
          setPendingInternal(key, false);
          return;
        }

        const bytes = delta.buffer as ArrayBuffer;
        const currentVector = Y.encodeStateVector(ydoc);

        logger.debug("Syncing prose delta", {
          collection,
          document,
          deltaSize: delta.byteLength,
        });

        const material = serializeYMapValue(ymap);

        const result = collectionRef.update(
          document,
          { metadata: { contentSync: { bytes, material } } },
          (draft: any) => {
            draft.updatedAt = Date.now();
          },
        );
        await result.isPersisted.promise;

        lastSyncedVectors.set(key, currentVector);
        failedSyncQueue.delete(key);
        setPendingInternal(key, false);
        logger.debug("Prose sync completed", { collection, document });
      }
      catch (err) {
        logger.error("Prose sync failed, queued for retry", {
          collection,
          document,
          error: String(err),
        });
        failedSyncQueue.set(key, true);
      }
    }, debounceMs);

    debounceTimers.set(key, timer);

    // Also retry any failed syncs for this document
    if (failedSyncQueue.has(key)) {
      failedSyncQueue.delete(key);
      logger.debug("Retrying failed sync", { collection, document });
    }
  };

  // Set up deep observation on the fragment
  fragment.observeDeep(observerHandler);

  const cleanup = () => {
    fragment.unobserveDeep(observerHandler);
    cancelPending(collection, document);
    fragmentObservers.delete(key);
    lastSyncedVectors.delete(key);
    logger.debug("Fragment observer cleaned up", { collection, document, field });
  };

  fragmentObservers.set(key, cleanup);
  logger.debug("Fragment observer registered", { collection, document, field });

  return cleanup;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up all prose state for a collection.
 * Called when collection is destroyed.
 */
export function cleanup(collection: string): void {
  const prefix = `${collection}:`;

  // Cancel all pending syncs
  for (const [key, timer] of debounceTimers) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      debounceTimers.delete(key);
    }
  }

  // Clear pending state and listeners
  for (const key of pendingState.keys()) {
    if (key.startsWith(prefix)) {
      pendingState.delete(key);
    }
  }
  for (const key of pendingListeners.keys()) {
    if (key.startsWith(prefix)) {
      pendingListeners.delete(key);
    }
  }

  // Clear applying from server flags
  for (const key of applyingFromServer.keys()) {
    if (key.startsWith(prefix)) {
      applyingFromServer.delete(key);
    }
  }

  // Clear last synced vectors
  for (const key of lastSyncedVectors.keys()) {
    if (key.startsWith(prefix)) {
      lastSyncedVectors.delete(key);
    }
  }

  // Clean up fragment observers
  for (const [key, cleanupFn] of fragmentObservers) {
    if (key.startsWith(prefix)) {
      cleanupFn();
      fragmentObservers.delete(key);
    }
  }

  // Clear failed sync queue
  for (const key of failedSyncQueue.keys()) {
    if (key.startsWith(prefix)) {
      failedSyncQueue.delete(key);
    }
  }

  logger.debug("Prose cleanup complete", { collection });
}

const PROSE_MARKER = Symbol.for("replicate:prose");

function createProseSchema(): z.ZodType<ProseValue> {
  const schema = z.custom<ProseValue>(
    (val) => {
      if (val == null) return true;
      if (typeof val !== "object") return false;
      return (val as { type?: string }).type === "doc";
    },
    { message: "Expected prose document with type \"doc\"" },
  );

  Object.defineProperty(schema, PROSE_MARKER, { value: true, writable: false });

  return schema;
}

function emptyProse(): ProseValue {
  return { type: "doc", content: [] } as unknown as ProseValue;
}

export function prose(): z.ZodType<ProseValue> {
  return createProseSchema();
}

prose.empty = emptyProse;

export function isProseSchema(schema: unknown): boolean {
  return (
    schema != null
    && typeof schema === "object"
    && PROSE_MARKER in schema
    && (schema as Record<symbol, unknown>)[PROSE_MARKER] === true
  );
}

export function extractProseFields(schema: z.ZodObject<z.ZodRawShape>): string[] {
  const fields: string[] = [];

  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    let unwrapped = fieldSchema;
    while (unwrapped instanceof z.ZodOptional || unwrapped instanceof z.ZodNullable) {
      unwrapped = unwrapped.unwrap();
    }

    if (isProseSchema(unwrapped)) {
      fields.push(key);
    }
  }

  return fields;
}
