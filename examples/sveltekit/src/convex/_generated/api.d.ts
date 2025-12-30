/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as comments from "../comments.js";
import type * as intervals from "../intervals.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  comments: typeof comments;
  intervals: typeof intervals;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  replicate: {
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
        { removed: number; retained: number; success: boolean }
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
        }>
      >;
      deleteDocument: FunctionReference<
        "mutation",
        "internal",
        { collection: string; crdtBytes: ArrayBuffer; documentId: string },
        { seq: number; success: boolean }
      >;
      getInitialState: FunctionReference<
        "query",
        "internal",
        { collection: string },
        { crdtBytes: ArrayBuffer; cursor: number } | null
      >;
      insertDocument: FunctionReference<
        "mutation",
        "internal",
        { collection: string; crdtBytes: ArrayBuffer; documentId: string },
        { seq: number; success: boolean }
      >;
      leave: FunctionReference<
        "mutation",
        "internal",
        { client: string; collection: string; document: string },
        null
      >;
      mark: FunctionReference<
        "mutation",
        "internal",
        {
          client: string;
          collection: string;
          cursor?: { anchor: number; field?: string; head: number };
          document: string;
          interval?: number;
          profile?: { avatar?: string; color?: string; name?: string };
          seq?: number;
          user?: string;
        },
        null
      >;
      recovery: FunctionReference<
        "query",
        "internal",
        { clientStateVector: ArrayBuffer; collection: string },
        { cursor: number; diff?: ArrayBuffer; serverStateVector: ArrayBuffer }
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
        }>
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
        }
      >;
      updateDocument: FunctionReference<
        "mutation",
        "internal",
        { collection: string; crdtBytes: ArrayBuffer; documentId: string },
        { seq: number; success: boolean }
      >;
    };
  };
};
