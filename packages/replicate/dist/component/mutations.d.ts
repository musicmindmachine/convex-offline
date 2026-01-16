import { OperationType } from "./shared/index.js";
import * as convex_server17 from "convex/server";
import * as convex_values75 from "convex/values";

//#region src/component/mutations.d.ts
declare namespace mutations_d_exports {
  export { OperationType, compact, deleteDocument, disconnect, getDocumentState, insertDocument, mark, presence, recovery, runCompaction, scheduleCompaction, sessions, stream, updateDocument };
}
declare const insertDocument: convex_server17.RegisteredMutation<"public", {
  timeout?: number | undefined;
  threshold?: number | undefined;
  retain?: number | undefined;
  bytes: ArrayBuffer;
  collection: string;
  document: string;
}, Promise<{
  success: boolean;
  seq: number;
}>>;
declare const updateDocument: convex_server17.RegisteredMutation<"public", {
  timeout?: number | undefined;
  threshold?: number | undefined;
  retain?: number | undefined;
  bytes: ArrayBuffer;
  collection: string;
  document: string;
}, Promise<{
  success: boolean;
  seq: number;
}>>;
declare const deleteDocument: convex_server17.RegisteredMutation<"public", {
  timeout?: number | undefined;
  threshold?: number | undefined;
  retain?: number | undefined;
  bytes: ArrayBuffer;
  collection: string;
  document: string;
}, Promise<{
  success: boolean;
  seq: number;
}>>;
declare const mark: convex_server17.RegisteredMutation<"public", {
  seq?: number | undefined;
  vector?: ArrayBuffer | undefined;
  collection: string;
  document: string;
  client: string;
}, Promise<null>>;
declare const compact: convex_server17.RegisteredMutation<"public", {
  collection: string;
  document: string;
}, Promise<{
  success: boolean;
  removed: number;
  retained: number;
  size: number;
}>>;
declare const scheduleCompaction: convex_server17.RegisteredMutation<"public", {
  timeout?: number | undefined;
  retain?: number | undefined;
  collection: string;
  document: string;
}, Promise<{
  id: convex_values75.GenericId<"compaction">;
  status: "already_running";
} | {
  id: convex_values75.GenericId<"compaction">;
  status: "already_pending";
} | {
  id: convex_values75.GenericId<"compaction">;
  status: "scheduled";
}>>;
declare const runCompaction: convex_server17.RegisteredMutation<"public", {
  timeout?: number | undefined;
  retain?: number | undefined;
  id: convex_values75.GenericId<"compaction">;
}, Promise<{
  removed: number;
  retained: number;
} | null>>;
declare const stream: convex_server17.RegisteredQuery<"public", {
  threshold?: number | undefined;
  limit?: number | undefined;
  collection: string;
  seq: number;
}, Promise<{
  changes: {
    document: any;
    bytes: any;
    seq: any;
    type: OperationType;
  }[];
  seq: number;
  more: boolean;
  compact: undefined;
}>>;
declare const recovery: convex_server17.RegisteredQuery<"public", {
  collection: string;
  document: string;
  vector: ArrayBuffer;
}, Promise<{
  vector: ArrayBuffer;
  diff?: undefined;
} | {
  diff: ArrayBuffer | undefined;
  vector: ArrayBuffer;
}>>;
declare const getDocumentState: convex_server17.RegisteredQuery<"public", {
  collection: string;
  document: string;
}, Promise<{
  bytes: ArrayBuffer;
  seq: number;
} | null>>;
declare const sessions: convex_server17.RegisteredQuery<"public", {
  connected?: boolean | undefined;
  exclude?: string | undefined;
  collection: string;
  document: string;
}, Promise<{
  client: any;
  document: any;
  user: any;
  profile: any;
  cursor: any;
  seen: any;
}[]>>;
declare const disconnect: convex_server17.RegisteredMutation<"public", {
  collection: string;
  document: string;
  client: string;
}, Promise<null>>;
declare const presence: convex_server17.RegisteredMutation<"public", {
  vector?: ArrayBuffer | undefined;
  user?: string | undefined;
  profile?: {
    name?: string | undefined;
    color?: string | undefined;
    avatar?: string | undefined;
  } | undefined;
  cursor?: {
    field?: string | undefined;
    anchor: any;
    head: any;
  } | undefined;
  interval?: number | undefined;
  collection: string;
  document: string;
  client: string;
  action: "join" | "leave";
}, Promise<null>>;
//#endregion
export { OperationType, compact, deleteDocument, disconnect, getDocumentState, insertDocument, mark, mutations_d_exports, presence, recovery, runCompaction, scheduleCompaction, sessions, stream, updateDocument };
//# sourceMappingURL=mutations.d.ts.map