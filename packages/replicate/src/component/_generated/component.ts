/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    encryption: {
      approveDevice: FunctionReference<
        "mutation",
        "internal",
        {
          collection: string;
          deviceId: string;
          userId: string;
          wrappedUmk: ArrayBuffer;
        },
        any,
        Name
      >;
      getDocKey: FunctionReference<
        "query",
        "internal",
        { collection: string; document: string; userId: string },
        any,
        Name
      >;
      getDocKeysForUser: FunctionReference<
        "query",
        "internal",
        { collection: string; userId: string },
        any,
        Name
      >;
      getPendingDevices: FunctionReference<
        "query",
        "internal",
        { collection: string; userId: string },
        any,
        Name
      >;
      getWrappedUmk: FunctionReference<
        "query",
        "internal",
        { collection: string; deviceId: string; userId: string },
        any,
        Name
      >;
      listDevices: FunctionReference<
        "query",
        "internal",
        { collection: string; userId: string },
        any,
        Name
      >;
      registerDevice: FunctionReference<
        "mutation",
        "internal",
        {
          collection: string;
          deviceId: string;
          name?: string;
          publicKey: ArrayBuffer;
          userId: string;
        },
        any,
        Name
      >;
      storeDocKey: FunctionReference<
        "mutation",
        "internal",
        {
          collection: string;
          document: string;
          userId: string;
          wrappedKey: ArrayBuffer;
        },
        any,
        Name
      >;
    };
    mutations: {
      compact: FunctionReference<
        "mutation",
        "internal",
        { collection: string; document: string },
        { removed: number; retained: number; size: number; success: boolean },
        Name
      >;
      deleteCompactionDeltasBatch: FunctionReference<
        "mutation",
        "internal",
        { collection: string; document: string; ids: Array<string> },
        number,
        Name
      >;
      deleteCompactionSessionsBatch: FunctionReference<
        "mutation",
        "internal",
        { ids: Array<string> },
        number,
        Name
      >;
      deleteDocument: FunctionReference<
        "mutation",
        "internal",
        {
          bytes: ArrayBuffer;
          collection: string;
          document: string;
          exists?: boolean;
          maxDeltas?: number;
          maxPages?: number;
          pageSize?: number;
          retain?: number;
          threshold?: number;
          timeout?: number;
        },
        { seq: number; success: boolean },
        Name
      >;
      disconnect: FunctionReference<
        "mutation",
        "internal",
        { client: string; collection: string; document: string },
        null,
        Name
      >;
      getCompactionBoundarySeq: FunctionReference<
        "query",
        "internal",
        { collection: string },
        number,
        Name
      >;
      getCompactionDeltasPage: FunctionReference<
        "query",
        "internal",
        {
          collection: string;
          cursor?: string;
          document: string;
          numItems?: number;
        },
        {
          continueCursor: string | null;
          isDone: boolean;
          page: Array<{ bytes: ArrayBuffer; id: string; seq: number }>;
        },
        Name
      >;
      getCompactionJob: FunctionReference<
        "query",
        "internal",
        { id: string },
        any,
        Name
      >;
      getCompactionLatestDeltas: FunctionReference<
        "query",
        "internal",
        {
          boundarySeq?: number;
          collection: string;
          document: string;
          numItems?: number;
        },
        Array<{ id: string; seq: number }>,
        Name
      >;
      getCompactionSessions: FunctionReference<
        "query",
        "internal",
        { collection: string; document: string },
        Array<{
          client: string;
          connected: boolean;
          id: string;
          seen: number;
          vector?: ArrayBuffer;
        }>,
        Name
      >;
      getCompactionSnapshot: FunctionReference<
        "query",
        "internal",
        { collection: string; document: string },
        null | { bytes: ArrayBuffer; seq: number; vector: ArrayBuffer },
        Name
      >;
      getDeltaCountsPage: FunctionReference<
        "query",
        "internal",
        { collection: string; cursor?: string; numItems?: number },
        {
          continueCursor: string | null;
          isDone: boolean;
          page: Array<{ count: number; document: string }>;
        },
        Name
      >;
      getDocumentState: FunctionReference<
        "query",
        "internal",
        { collection: string; document: string },
        { bytes: ArrayBuffer; seq: number } | null,
        Name
      >;
      insertDocument: FunctionReference<
        "mutation",
        "internal",
        {
          bytes: ArrayBuffer;
          collection: string;
          document: string;
          exists?: boolean;
          maxDeltas?: number;
          maxPages?: number;
          pageSize?: number;
          retain?: number;
          threshold?: number;
          timeout?: number;
        },
        { seq: number; success: boolean },
        Name
      >;
      mark: FunctionReference<
        "mutation",
        "internal",
        {
          client: string;
          collection: string;
          document: string;
          seq?: number;
          vector?: ArrayBuffer;
        },
        null,
        Name
      >;
      presence: FunctionReference<
        "mutation",
        "internal",
        {
          action: "join" | "leave";
          client: string;
          collection: string;
          cursor?: {
            anchor: {
              assoc?: number | null;
              item?: { client: number; clock: number } | null;
              tname?: string | null;
              type?: { client: number; clock: number } | null;
            };
            field?: string;
            head: {
              assoc?: number | null;
              item?: { client: number; clock: number } | null;
              tname?: string | null;
              type?: { client: number; clock: number } | null;
            };
          };
          document: string;
          interval?: number;
          profile?: { avatar?: string; color?: string; name?: string };
          user?: string;
          vector?: ArrayBuffer;
        },
        null,
        Name
      >;
      recovery: FunctionReference<
        "query",
        "internal",
        { collection: string; document: string; vector: ArrayBuffer },
        { diff?: ArrayBuffer; vector: ArrayBuffer },
        Name
      >;
      runCompaction: FunctionReference<
        "mutation",
        "internal",
        { id: string; retain?: number; timeout?: number },
        null | { removed: number; retained: number },
        Name
      >;
      runCompactionAction: FunctionReference<
        "action",
        "internal",
        { id: string; retain?: number; timeout?: number },
        any,
        Name
      >;
      scheduleCompaction: FunctionReference<
        "mutation",
        "internal",
        {
          collection: string;
          document: string;
          maxDeltas?: number;
          maxPages?: number;
          pageSize?: number;
          retain?: number;
          timeout?: number;
        },
        {
          id?: string;
          status: "scheduled" | "already_running" | "already_pending";
        },
        Name
      >;
      sessions: FunctionReference<
        "query",
        "internal",
        {
          collection: string;
          connected?: boolean;
          document: string;
          exclude?: string;
        },
        Array<{
          client: string;
          cursor?: {
            anchor: {
              assoc?: number | null;
              item?: { client: number; clock: number } | null;
              tname?: string | null;
              type?: { client: number; clock: number } | null;
            };
            field?: string;
            head: {
              assoc?: number | null;
              item?: { client: number; clock: number } | null;
              tname?: string | null;
              type?: { client: number; clock: number } | null;
            };
          };
          document: string;
          profile?: { avatar?: string; color?: string; name?: string };
          seen: number;
          user?: string;
        }>,
        Name
      >;
      stream: FunctionReference<
        "query",
        "internal",
        { collection: string; limit?: number; seq: number; threshold?: number },
        {
          changes: Array<{
            bytes: ArrayBuffer;
            document: string;
            exists?: boolean;
            seq: number;
            type: "delta" | "snapshot";
          }>;
          compact?: { documents: Array<string> };
          more: boolean;
          seq: number;
        },
        Name
      >;
      sweepCompactions: FunctionReference<
        "action",
        "internal",
        {
          collection: string;
          compactionMaxDeltas?: number;
          compactionMaxPages?: number;
          compactionPageSize?: number;
          cursor?: string;
          intervalMs?: number;
          pageSize?: number;
          retain?: number;
          threshold?: number;
          timeout?: number;
        },
        { nextCursor: string | null; processed: number; scheduled: number },
        Name
      >;
      updateCompactionJob: FunctionReference<
        "mutation",
        "internal",
        {
          id: string;
          patch: {
            boundarySeq?: number;
            completed?: number;
            cursor?: string;
            error?: string;
            phase?: "merge" | "finalize";
            processed?: number;
            retries?: number;
            scratch?: ArrayBuffer;
            status?: "pending" | "running" | "done" | "failed";
          };
        },
        null,
        Name
      >;
      updateDocument: FunctionReference<
        "mutation",
        "internal",
        {
          bytes: ArrayBuffer;
          collection: string;
          document: string;
          exists?: boolean;
          maxDeltas?: number;
          maxPages?: number;
          pageSize?: number;
          retain?: number;
          threshold?: number;
          timeout?: number;
        },
        { seq: number; success: boolean },
        Name
      >;
      upsertCompactionSnapshot: FunctionReference<
        "mutation",
        "internal",
        {
          bytes: ArrayBuffer;
          collection: string;
          created: number;
          document: string;
          seq: number;
          vector: ArrayBuffer;
        },
        null,
        Name
      >;
    };
  };
