import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from 'convex/server';
import { Replicate } from '$/server/storage.js';

/**
 * Configuration for replicate handlers (without component - used with factory pattern).
 */
export interface ReplicateConfig<T extends object> {
  collection: string;
  compaction?: { retention: number };
  pruning?: { retention: number };
  versioning?: { keepCount?: number; retentionDays?: number };
  hooks?: {
    evalRead?: (ctx: GenericQueryCtx<GenericDataModel>, collection: string) => void | Promise<void>;
    evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    evalRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    onStream?: (ctx: GenericQueryCtx<GenericDataModel>, result: any) => void | Promise<void>;
    onInsert?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onUpdate?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    transform?: (docs: T[]) => T[] | Promise<T[]>;
    evalCompact?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    evalPrune?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    onCompact?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
    onPrune?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
    evalVersion?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string,
      documentId: string
    ) => void | Promise<void>;
    onVersion?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
    evalRestore?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string,
      documentId: string,
      versionId: string
    ) => void | Promise<void>;
    onRestore?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
  };
}

/**
 * Create a replicate function bound to your component. Call this once in your
 * convex/replicate.ts file, then use the returned function for all collections.
 *
 * @example
 * ```typescript
 * // convex/replicate.ts (create once)
 * import { replicate } from '@trestleinc/replicate/server';
 * import { components } from './_generated/api';
 *
 * export const tasks = replicate(components.replicate)<Task>({ collection: 'tasks' });
 *
 * // Or bind once and reuse:
 * const r = replicate(components.replicate);
 * export const tasks = r<Task>({ collection: 'tasks' });
 * export const notebooks = r<Notebook>({ collection: 'notebooks' });
 * ```
 */
export function replicate(component: any) {
  return function boundReplicate<T extends object>(config: ReplicateConfig<T>) {
    return replicateInternal<T>(component, config);
  };
}

/**
 * Internal implementation for replicate.
 */
function replicateInternal<T extends object>(component: any, config: ReplicateConfig<T>) {
  const storage = new Replicate<T>(component, config.collection);

  return {
    stream: storage.createStreamQuery({
      evalRead: config.hooks?.evalRead,
      onStream: config.hooks?.onStream,
    }),

    material: storage.createSSRQuery({
      evalRead: config.hooks?.evalRead,
      transform: config.hooks?.transform,
    }),

    insert: storage.createInsertMutation({
      evalWrite: config.hooks?.evalWrite,
      onInsert: config.hooks?.onInsert,
    }),

    update: storage.createUpdateMutation({
      evalWrite: config.hooks?.evalWrite,
      onUpdate: config.hooks?.onUpdate,
    }),

    remove: storage.createRemoveMutation({
      evalRemove: config.hooks?.evalRemove,
      onRemove: config.hooks?.onRemove,
    }),

    compact: storage.createCompactMutation({
      retention: config.compaction?.retention,
      evalCompact: config.hooks?.evalCompact,
      onCompact: config.hooks?.onCompact,
    }),

    prune: storage.createPruneMutation({
      retention: config.pruning?.retention,
      evalPrune: config.hooks?.evalPrune,
      onPrune: config.hooks?.onPrune,
    }),

    snapshot: {
      create: storage.createVersionMutation({
        evalVersion: config.hooks?.evalVersion,
        onVersion: config.hooks?.onVersion,
      }),

      list: storage.createListVersionsQuery({
        evalRead: config.hooks?.evalRead,
      }),

      get: storage.createGetVersionQuery({
        evalRead: config.hooks?.evalRead,
      }),

      restore: storage.createRestoreVersionMutation({
        evalRestore: config.hooks?.evalRestore,
        onRestore: config.hooks?.onRestore,
      }),

      remove: storage.createDeleteVersionMutation(),

      prune: storage.createPruneVersionsMutation({
        keepCount: config.versioning?.keepCount,
        retentionDays: config.versioning?.retentionDays,
      }),
    },
  };
}
