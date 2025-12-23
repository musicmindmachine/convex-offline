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
      ack: FunctionReference<
        "mutation",
        "internal",
        { collection: string; peerId: string; syncedSeq: number },
        null
      >;
      compact: FunctionReference<
        "mutation",
        "internal",
        {
          bytes: ArrayBuffer;
          collection: string;
          documentId: string;
          frontiers: ArrayBuffer;
          peerTimeout: number;
        },
        { reason?: string; removed: number; success: boolean }
      >;
      deleteDocument: FunctionReference<
        "mutation",
        "internal",
        { bytes: ArrayBuffer; collection: string; documentId: string },
        { seq: number; success: boolean }
      >;
      initial: FunctionReference<
        "query",
        "internal",
        { collection: string },
        {
          cursor: number;
          deltas: Array<{
            bytes: ArrayBuffer;
            documentId: string;
            seq: number;
          }>;
          snapshots: Array<{
            bytes: ArrayBuffer;
            documentId: string;
            snapshotSeq: number;
          }>;
        }
      >;
      insertDocument: FunctionReference<
        "mutation",
        "internal",
        { bytes: ArrayBuffer; collection: string; documentId: string },
        { seq: number; success: boolean }
      >;
      recovery: FunctionReference<
        "query",
        "internal",
        { collection: string },
        {
          cursor: number;
          deltas: Array<ArrayBuffer>;
          snapshots: Array<ArrayBuffer>;
        }
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
            bytes: ArrayBuffer;
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
        { bytes: ArrayBuffer; collection: string; documentId: string },
        { seq: number; success: boolean }
      >;
    };
  };
};
