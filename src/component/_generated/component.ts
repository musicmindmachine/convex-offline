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
      cursors: FunctionReference<
        "query",
        "internal",
        { collection: string; document: string; exclude?: string },
        Array<{
          client: string;
          cursor: { anchor: number; field?: string; head: number };
          profile?: any;
          user?: string;
        }>,
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
      leave: FunctionReference<
        "mutation",
        "internal",
        { client: string; collection: string; document: string },
        null,
        Name
      >;
      mark: FunctionReference<
        "mutation",
        "internal",
        {
          client: string;
          collection: string;
          cursor?: { anchor: number; field?: string; head: number };
          document: string;
          profile?: { avatar?: string; color?: string; name?: string };
          seq?: number;
          user?: string;
        },
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
      sessions: FunctionReference<
        "query",
        "internal",
        { collection: string; document: string; group?: boolean },
        Array<{
          client: string;
          document: string;
          profile?: any;
          seen: number;
          user?: string;
        }>,
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
