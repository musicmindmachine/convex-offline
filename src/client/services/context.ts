import { createMutex } from "lib0/mutex";
import type { ConvexClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import type { Persistence } from "$/client/persistence/types";
import type { SubdocManager } from "$/client/subdocs";

interface ConvexCollectionApi {
  stream: FunctionReference<"query">;
  insert: FunctionReference<"mutation">;
  update: FunctionReference<"mutation">;
  remove: FunctionReference<"mutation">;
  recovery: FunctionReference<"query">;
  mark: FunctionReference<"mutation">;
  compact: FunctionReference<"mutation">;
  material?: FunctionReference<"query">;
  sessions?: FunctionReference<"query">;
  cursors?: FunctionReference<"query">;
  leave?: FunctionReference<"mutation">;
}

export interface CollectionContext {
  collection: string;
  subdocManager: SubdocManager;
  convexClient: ConvexClient;
  api: ConvexCollectionApi;
  peerId: string;
  persistence: Persistence;
  proseFields: Set<string>;
  mutex: ReturnType<typeof createMutex>;
}

const contexts = new Map<string, CollectionContext>();

export function getContext(collection: string): CollectionContext {
  const ctx = contexts.get(collection);
  if (!ctx) throw new Error(`Collection ${collection} not initialized`);
  return ctx;
}

export function hasContext(collection: string): boolean {
  return contexts.has(collection);
}

export function initContext(config: Omit<CollectionContext, "mutex">): CollectionContext {
  const ctx: CollectionContext = {
    ...config,
    mutex: createMutex(),
  };
  contexts.set(config.collection, ctx);
  return ctx;
}

export function deleteContext(collection: string): void {
  contexts.delete(collection);
}

export function updateContext(
  collection: string,
  updates: Partial<Omit<CollectionContext, "collection" | "mutex">>,
): CollectionContext {
  const ctx = getContext(collection);
  Object.assign(ctx, updates);
  return ctx;
}
