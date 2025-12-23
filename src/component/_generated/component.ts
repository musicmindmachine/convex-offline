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
    public: {
      compact: FunctionReference<
        "mutation",
        "internal",
        {
          collection: string;
          documentId: string;
          peerTimeout?: number;
          snapshotBytes: ArrayBuffer;
          stateVector: ArrayBuffer;
        },
        { removed: number; retained: number; success: boolean },
        Name
      >;
      deleteDocument: FunctionReference<
        "mutation",
        "internal",
        { collection: string; crdtBytes: ArrayBuffer; documentId: string },
        { seq: number; success: boolean },
        Name
      >;
      getInitialState: FunctionReference<
        "query",
        "internal",
        { collection: string },
        { crdtBytes: ArrayBuffer; cursor: number } | null,
        Name
      >;
      insertDocument: FunctionReference<
        "mutation",
        "internal",
        { collection: string; crdtBytes: ArrayBuffer; documentId: string },
        { seq: number; success: boolean },
        Name
      >;
      mark: FunctionReference<
        "mutation",
        "internal",
        { collection: string; peerId: string; syncedSeq: number },
        null,
        Name
      >;
      recovery: FunctionReference<
        "query",
        "internal",
        { clientStateVector: ArrayBuffer; collection: string },
        { cursor: number; diff?: ArrayBuffer; serverStateVector: ArrayBuffer },
        Name
      >;
      stream: FunctionReference<
        "query",
        "internal",
        {
          collection: string;
          cursor: number;
          limit?: number;
          sizeThreshold?: number;
        },
        {
          changes: Array<{
            crdtBytes: ArrayBuffer;
            documentId: string;
            operationType: string;
            seq: number;
          }>;
          compact?: string;
          cursor: number;
          hasMore: boolean;
        },
        Name
      >;
      updateDocument: FunctionReference<
        "mutation",
        "internal",
        { collection: string; crdtBytes: ArrayBuffer; documentId: string },
        { seq: number; success: boolean },
        Name
      >;
    };
  };
