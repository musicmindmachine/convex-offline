import * as convex_values0 from "convex/values";
import { Infer } from "convex/values";
import { Logger } from "@logtape/logtape";

//#region src/shared/logger.d.ts
declare function getLogger(category: string[]): Logger;
//#endregion
//#region src/shared/index.d.ts

/**
 * Profile validator for user presence/identity.
 * Used in sessions and presence tracking.
 */
declare const profileValidator: convex_values0.VObject<{
  name?: string | undefined;
  color?: string | undefined;
  avatar?: string | undefined;
}, {
  name: convex_values0.VString<string | undefined, "optional">;
  color: convex_values0.VString<string | undefined, "optional">;
  avatar: convex_values0.VString<string | undefined, "optional">;
}, "required", "name" | "color" | "avatar">;
/**
 * Cursor validator for collaborative editing positions.
 * Tracks anchor/head selection positions and optional field context.
 */
declare const cursorValidator: convex_values0.VObject<{
  field?: string | undefined;
  anchor: any;
  head: any;
}, {
  anchor: convex_values0.VAny<any, "required", string>;
  head: convex_values0.VAny<any, "required", string>;
  field: convex_values0.VString<string | undefined, "optional">;
}, "required", "anchor" | "head" | "field" | `anchor.${string}` | `head.${string}`>;
/**
 * Prose validator for ProseMirror-compatible rich text JSON.
 * Used for collaborative rich text editing fields.
 */
declare const proseValidator: convex_values0.VObject<{
  content?: any[] | undefined;
  type: "doc";
}, {
  type: convex_values0.VLiteral<"doc", "required">;
  content: convex_values0.VArray<any[] | undefined, convex_values0.VAny<any, "required", string>, "optional">;
}, "required", "type" | "content">;
/**
 * Individual change in a stream response.
 */
declare const streamChangeValidator: convex_values0.VObject<{
  bytes: ArrayBuffer;
  type: string;
  document: string;
  seq: number;
}, {
  document: convex_values0.VString<string, "required">;
  bytes: convex_values0.VBytes<ArrayBuffer, "required">;
  seq: convex_values0.VFloat64<number, "required">;
  type: convex_values0.VString<string, "required">;
}, "required", "bytes" | "type" | "document" | "seq">;
/**
 * Extended stream change with existence flag (used in server responses).
 */
declare const streamChangeWithExistsValidator: convex_values0.VObject<{
  bytes: ArrayBuffer;
  type: string;
  document: string;
  seq: number;
  exists: boolean;
}, {
  document: convex_values0.VString<string, "required">;
  bytes: convex_values0.VBytes<ArrayBuffer, "required">;
  seq: convex_values0.VFloat64<number, "required">;
  type: convex_values0.VString<string, "required">;
  exists: convex_values0.VBoolean<boolean, "required">;
}, "required", "bytes" | "type" | "document" | "seq" | "exists">;
/**
 * Stream query result with changes, cursor, and compaction hints.
 */
declare const streamResultValidator: convex_values0.VObject<{
  compact?: {
    documents: string[];
  } | undefined;
  seq: number;
  changes: {
    bytes: ArrayBuffer;
    type: string;
    document: string;
    seq: number;
  }[];
  more: boolean;
}, {
  changes: convex_values0.VArray<{
    bytes: ArrayBuffer;
    type: string;
    document: string;
    seq: number;
  }[], convex_values0.VObject<{
    bytes: ArrayBuffer;
    type: string;
    document: string;
    seq: number;
  }, {
    document: convex_values0.VString<string, "required">;
    bytes: convex_values0.VBytes<ArrayBuffer, "required">;
    seq: convex_values0.VFloat64<number, "required">;
    type: convex_values0.VString<string, "required">;
  }, "required", "bytes" | "type" | "document" | "seq">, "required">;
  seq: convex_values0.VFloat64<number, "required">;
  more: convex_values0.VBoolean<boolean, "required">;
  compact: convex_values0.VObject<{
    documents: string[];
  } | undefined, {
    documents: convex_values0.VArray<string[], convex_values0.VString<string, "required">, "required">;
  }, "optional", "documents">;
}, "required", "seq" | "changes" | "more" | "compact" | "compact.documents">;
/**
 * Stream result with exists flag on changes (server-enriched response).
 */
declare const streamResultWithExistsValidator: convex_values0.VObject<{
  compact?: {
    documents: string[];
  } | undefined;
  seq: number;
  changes: {
    bytes: ArrayBuffer;
    type: string;
    document: string;
    seq: number;
    exists: boolean;
  }[];
  more: boolean;
}, {
  changes: convex_values0.VArray<{
    bytes: ArrayBuffer;
    type: string;
    document: string;
    seq: number;
    exists: boolean;
  }[], convex_values0.VObject<{
    bytes: ArrayBuffer;
    type: string;
    document: string;
    seq: number;
    exists: boolean;
  }, {
    document: convex_values0.VString<string, "required">;
    bytes: convex_values0.VBytes<ArrayBuffer, "required">;
    seq: convex_values0.VFloat64<number, "required">;
    type: convex_values0.VString<string, "required">;
    exists: convex_values0.VBoolean<boolean, "required">;
  }, "required", "bytes" | "type" | "document" | "seq" | "exists">, "required">;
  seq: convex_values0.VFloat64<number, "required">;
  more: convex_values0.VBoolean<boolean, "required">;
  compact: convex_values0.VObject<{
    documents: string[];
  } | undefined, {
    documents: convex_values0.VArray<string[], convex_values0.VString<string, "required">, "required">;
  }, "optional", "documents">;
}, "required", "seq" | "changes" | "more" | "compact" | "compact.documents">;
/**
 * Session record for presence tracking.
 * Returned by sessions query.
 */
declare const sessionValidator: convex_values0.VObject<{
  user?: string | undefined;
  profile?: any;
  cursor?: {
    field?: string | undefined;
    anchor: any;
    head: any;
  } | undefined;
  document: string;
  client: string;
  seen: number;
}, {
  client: convex_values0.VString<string, "required">;
  document: convex_values0.VString<string, "required">;
  user: convex_values0.VString<string | undefined, "optional">;
  profile: convex_values0.VAny<any, "optional", string>;
  cursor: convex_values0.VObject<{
    field?: string | undefined;
    anchor: any;
    head: any;
  } | undefined, {
    anchor: convex_values0.VAny<any, "required", string>;
    head: convex_values0.VAny<any, "required", string>;
    field: convex_values0.VString<string | undefined, "optional">;
  }, "optional", "anchor" | "head" | "field" | `anchor.${string}` | `head.${string}`>;
  seen: convex_values0.VFloat64<number, "required">;
}, "required", "document" | "client" | "user" | "profile" | "cursor" | "seen" | `profile.${string}` | "cursor.anchor" | "cursor.head" | "cursor.field" | `cursor.anchor.${string}` | `cursor.head.${string}`>;
/**
 * Presence action (join or leave).
 * @deprecated Use sessionActionValidator instead
 */
declare const presenceActionValidator: convex_values0.VUnion<"join" | "leave", [convex_values0.VLiteral<"join", "required">, convex_values0.VLiteral<"leave", "required">], "required", never>;
/**
 * Replicate mutation type - combines insert/update/delete.
 */
declare const replicateTypeValidator: convex_values0.VUnion<"insert" | "update" | "delete", [convex_values0.VLiteral<"insert", "required">, convex_values0.VLiteral<"update", "required">, convex_values0.VLiteral<"delete", "required">], "required", never>;
/**
 * Session action - combines presence (join/leave) and mark (mark/signal).
 */
declare const sessionActionValidator: convex_values0.VUnion<"join" | "leave" | "mark" | "signal", [convex_values0.VLiteral<"join", "required">, convex_values0.VLiteral<"leave", "required">, convex_values0.VLiteral<"mark", "required">, convex_values0.VLiteral<"signal", "required">], "required", never>;
/**
 * Standard success/seq result for insert/update/delete mutations.
 */
declare const successSeqValidator: convex_values0.VObject<{
  seq: number;
  success: boolean;
}, {
  success: convex_values0.VBoolean<boolean, "required">;
  seq: convex_values0.VFloat64<number, "required">;
}, "required", "seq" | "success">;
/**
 * Compaction result with statistics.
 */
declare const compactResultValidator: convex_values0.VObject<{
  success: boolean;
  removed: number;
  retained: number;
  size: number;
}, {
  success: convex_values0.VBoolean<boolean, "required">;
  removed: convex_values0.VFloat64<number, "required">;
  retained: convex_values0.VFloat64<number, "required">;
  size: convex_values0.VFloat64<number, "required">;
}, "required", "success" | "removed" | "retained" | "size">;
/**
 * Recovery query result with optional diff and state vector.
 */
declare const recoveryResultValidator: convex_values0.VObject<{
  diff?: ArrayBuffer | undefined;
  vector: ArrayBuffer;
}, {
  diff: convex_values0.VBytes<ArrayBuffer | undefined, "optional">;
  vector: convex_values0.VBytes<ArrayBuffer, "required">;
}, "required", "diff" | "vector">;
/**
 * Document state result (for SSR/hydration).
 */
declare const documentStateValidator: convex_values0.VUnion<{
  bytes: ArrayBuffer;
  seq: number;
} | null, [convex_values0.VObject<{
  bytes: ArrayBuffer;
  seq: number;
}, {
  bytes: convex_values0.VBytes<ArrayBuffer, "required">;
  seq: convex_values0.VFloat64<number, "required">;
}, "required", "bytes" | "seq">, convex_values0.VNull<null, "required">], "required", "bytes" | "seq">;
/**
 * SSR material query result (non-paginated, backward compatible).
 */
declare const materialResultValidator: convex_values0.VObject<{
  cursor?: number | undefined;
  crdt?: Record<string, {
    bytes: ArrayBuffer;
    seq: number;
  }> | undefined;
  documents: any;
  count: number;
}, {
  documents: convex_values0.VAny<any, "required", string>;
  count: convex_values0.VFloat64<number, "required">;
  crdt: convex_values0.VRecord<Record<string, {
    bytes: ArrayBuffer;
    seq: number;
  }> | undefined, convex_values0.VString<string, "required">, convex_values0.VObject<{
    bytes: ArrayBuffer;
    seq: number;
  }, {
    bytes: convex_values0.VBytes<ArrayBuffer, "required">;
    seq: convex_values0.VFloat64<number, "required">;
  }, "required", "bytes" | "seq">, "optional", string>;
  cursor: convex_values0.VFloat64<number | undefined, "optional">;
}, "required", "documents" | "cursor" | "count" | "crdt" | `documents.${string}` | `crdt.${string}`>;
/** User profile for presence/identity. */
type Profile = Infer<typeof profileValidator>;
/** Cursor position for collaborative editing. */
type Cursor = Infer<typeof cursorValidator>;
/** ProseMirror-compatible JSON structure. */
type ProseValue = Infer<typeof proseValidator>;
/** Individual stream change. */
type StreamChange = Infer<typeof streamChangeValidator>;
/** Stream change with exists flag. */
type StreamChangeWithExists = Infer<typeof streamChangeWithExistsValidator>;
/** Stream query result. */
type StreamResult = Infer<typeof streamResultValidator>;
/** Stream result with exists flags. */
type StreamResultWithExists = Infer<typeof streamResultWithExistsValidator>;
/** Session record for presence. */
type Session = Infer<typeof sessionValidator>;
/** Presence action type. */
type PresenceAction = Infer<typeof presenceActionValidator>;
/** Replicate mutation type. */
type ReplicateType = Infer<typeof replicateTypeValidator>;
/** Session action type. */
type SessionAction = Infer<typeof sessionActionValidator>;
/** Success/seq mutation result. */
type SuccessSeq = Infer<typeof successSeqValidator>;
/** Compaction result with stats. */
type CompactResult = Infer<typeof compactResultValidator>;
/** Recovery query result. */
type RecoveryResult = Infer<typeof recoveryResultValidator>;
/** Document state for SSR. */
type DocumentState = Infer<typeof documentStateValidator>;
/** SSR material result. */
type MaterialResult = Infer<typeof materialResultValidator>;
interface FragmentValue {
  __xmlFragment: true;
  content?: XmlFragmentJSON;
}
interface XmlFragmentJSON {
  type: "doc";
  content?: XmlNodeJSON[];
}
interface XmlNodeJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: XmlNodeJSON[];
  text?: string;
  marks?: {
    type: string;
    attrs?: Record<string, unknown>;
  }[];
}
/** Operation type for streaming changes */
declare enum OperationType {
  Delta = "delta",
  Snapshot = "snapshot",
}
/**
 * Extract prose field names from T (fields typed as ProseValue).
 * Used internally for type-safe prose field operations.
 */
type ProseFields<T> = { [K in keyof T]: T[K] extends ProseValue ? K : never }[keyof T];
type DurationUnit = "m" | "h" | "d";
type Duration = `${number}${DurationUnit}`;
interface CompactionConfig {
  threshold?: number;
  timeout?: Duration;
  retain?: number;
}
declare function parseDuration(s: Duration): number;
//#endregion
export { CompactResult, CompactionConfig, Cursor, DocumentState, Duration, FragmentValue, type Logger, MaterialResult, OperationType, PresenceAction, Profile, ProseFields, ProseValue, RecoveryResult, ReplicateType, Session, SessionAction, StreamChange, StreamChangeWithExists, StreamResult, StreamResultWithExists, SuccessSeq, XmlFragmentJSON, XmlNodeJSON, compactResultValidator, cursorValidator, documentStateValidator, getLogger, materialResultValidator, parseDuration, presenceActionValidator, profileValidator, proseValidator, recoveryResultValidator, replicateTypeValidator, sessionActionValidator, sessionValidator, streamChangeValidator, streamChangeWithExistsValidator, streamResultValidator, streamResultWithExistsValidator, successSeqValidator };
//# sourceMappingURL=index.d.ts.map