import * as convex_server0 from "convex/server";
import * as convex_values0 from "convex/values";

//#region src/component/schema.d.ts
declare const _default: convex_server0.SchemaDefinition<{
  devices: convex_server0.TableDefinition<convex_values0.VObject<{
    name?: string | undefined;
    collection: string;
    userId: string;
    deviceId: string;
    publicKey: ArrayBuffer;
    created: number;
    lastSeen: number;
    approved: boolean;
  }, {
    collection: convex_values0.VString<string, "required">;
    userId: convex_values0.VString<string, "required">;
    deviceId: convex_values0.VString<string, "required">;
    publicKey: convex_values0.VBytes<ArrayBuffer, "required">;
    name: convex_values0.VString<string | undefined, "optional">;
    created: convex_values0.VFloat64<number, "required">;
    lastSeen: convex_values0.VFloat64<number, "required">;
    approved: convex_values0.VBoolean<boolean, "required">;
  }, "required", "collection" | "userId" | "deviceId" | "publicKey" | "name" | "created" | "lastSeen" | "approved">, {
    by_user: ["collection", "userId", "_creationTime"];
    by_device: ["collection", "userId", "deviceId", "_creationTime"];
  }, {}, {}>;
  wrappedKeys: convex_server0.TableDefinition<convex_values0.VObject<{
    collection: string;
    userId: string;
    deviceId: string;
    created: number;
    wrappedUmk: ArrayBuffer;
  }, {
    collection: convex_values0.VString<string, "required">;
    userId: convex_values0.VString<string, "required">;
    deviceId: convex_values0.VString<string, "required">;
    wrappedUmk: convex_values0.VBytes<ArrayBuffer, "required">;
    created: convex_values0.VFloat64<number, "required">;
  }, "required", "collection" | "userId" | "deviceId" | "created" | "wrappedUmk">, {
    by_user: ["collection", "userId", "_creationTime"];
    by_device: ["collection", "userId", "deviceId", "_creationTime"];
  }, {}, {}>;
  docKeys: convex_server0.TableDefinition<convex_values0.VObject<{
    collection: string;
    userId: string;
    created: number;
    document: string;
    wrappedKey: ArrayBuffer;
  }, {
    collection: convex_values0.VString<string, "required">;
    document: convex_values0.VString<string, "required">;
    userId: convex_values0.VString<string, "required">;
    wrappedKey: convex_values0.VBytes<ArrayBuffer, "required">;
    created: convex_values0.VFloat64<number, "required">;
  }, "required", "collection" | "userId" | "created" | "document" | "wrappedKey">, {
    by_document: ["collection", "document", "_creationTime"];
    by_user_doc: ["collection", "userId", "document", "_creationTime"];
  }, {}, {}>;
  deltas: convex_server0.TableDefinition<convex_values0.VObject<{
    bytes: ArrayBuffer;
    collection: string;
    document: string;
    seq: number;
  }, {
    collection: convex_values0.VString<string, "required">;
    document: convex_values0.VString<string, "required">;
    bytes: convex_values0.VBytes<ArrayBuffer, "required">;
    seq: convex_values0.VFloat64<number, "required">;
  }, "required", "bytes" | "collection" | "document" | "seq">, {
    by_collection: ["collection", "_creationTime"];
    by_document: ["collection", "document", "_creationTime"];
    by_seq: ["collection", "seq", "_creationTime"];
  }, {}, {}>;
  deltaCounts: convex_server0.TableDefinition<convex_values0.VObject<{
    collection: string;
    document: string;
    count: number;
  }, {
    collection: convex_values0.VString<string, "required">;
    document: convex_values0.VString<string, "required">;
    count: convex_values0.VFloat64<number, "required">;
  }, "required", "collection" | "document" | "count">, {
    by_document: ["collection", "document", "_creationTime"];
  }, {}, {}>;
  snapshots: convex_server0.TableDefinition<convex_values0.VObject<{
    bytes: ArrayBuffer;
    collection: string;
    created: number;
    document: string;
    seq: number;
    vector: ArrayBuffer;
  }, {
    collection: convex_values0.VString<string, "required">;
    document: convex_values0.VString<string, "required">;
    bytes: convex_values0.VBytes<ArrayBuffer, "required">;
    vector: convex_values0.VBytes<ArrayBuffer, "required">;
    seq: convex_values0.VFloat64<number, "required">;
    created: convex_values0.VFloat64<number, "required">;
  }, "required", "bytes" | "collection" | "created" | "document" | "seq" | "vector">, {
    by_document: ["collection", "document", "_creationTime"];
  }, {}, {}>;
  sessions: convex_server0.TableDefinition<convex_values0.VObject<{
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
    timeout?: convex_values0.GenericId<"_scheduled_functions"> | undefined;
    collection: string;
    document: string;
    seq: number;
    client: string;
    connected: boolean;
    seen: number;
  }, {
    collection: convex_values0.VString<string, "required">;
    document: convex_values0.VString<string, "required">;
    client: convex_values0.VString<string, "required">;
    vector: convex_values0.VBytes<ArrayBuffer | undefined, "optional">;
    connected: convex_values0.VBoolean<boolean, "required">;
    seq: convex_values0.VFloat64<number, "required">;
    seen: convex_values0.VFloat64<number, "required">;
    user: convex_values0.VString<string | undefined, "optional">;
    profile: convex_values0.VObject<{
      name?: string | undefined;
      color?: string | undefined;
      avatar?: string | undefined;
    } | undefined, {
      name: convex_values0.VString<string | undefined, "optional">;
      color: convex_values0.VString<string | undefined, "optional">;
      avatar: convex_values0.VString<string | undefined, "optional">;
    }, "optional", "name" | "color" | "avatar">;
    cursor: convex_values0.VObject<{
      field?: string | undefined;
      anchor: any;
      head: any;
    } | undefined, {
      anchor: convex_values0.VAny<any, "required", string>;
      head: convex_values0.VAny<any, "required", string>;
      field: convex_values0.VString<string | undefined, "optional">;
    }, "optional", "anchor" | "head" | "field" | `anchor.${string}` | `head.${string}`>;
    timeout: convex_values0.VId<convex_values0.GenericId<"_scheduled_functions"> | undefined, "optional">;
  }, "required", "collection" | "document" | "seq" | "vector" | "client" | "connected" | "seen" | "user" | "profile" | "cursor" | "timeout" | "profile.name" | "profile.color" | "profile.avatar" | "cursor.anchor" | "cursor.head" | "cursor.field" | `cursor.anchor.${string}` | `cursor.head.${string}`>, {
    by_collection: ["collection", "_creationTime"];
    by_document: ["collection", "document", "_creationTime"];
    by_client: ["collection", "document", "client", "_creationTime"];
    by_connected: ["collection", "document", "connected", "_creationTime"];
  }, {}, {}>;
  compaction: convex_server0.TableDefinition<convex_values0.VObject<{
    timeout?: number | undefined;
    completed?: number | undefined;
    error?: string | undefined;
    collection: string;
    document: string;
    status: "pending" | "running" | "done" | "failed";
    started: number;
    retries: number;
  }, {
    collection: convex_values0.VString<string, "required">;
    document: convex_values0.VString<string, "required">;
    status: convex_values0.VUnion<"pending" | "running" | "done" | "failed", [convex_values0.VLiteral<"pending", "required">, convex_values0.VLiteral<"running", "required">, convex_values0.VLiteral<"done", "required">, convex_values0.VLiteral<"failed", "required">], "required", never>;
    started: convex_values0.VFloat64<number, "required">;
    completed: convex_values0.VFloat64<number | undefined, "optional">;
    retries: convex_values0.VFloat64<number, "required">;
    timeout: convex_values0.VFloat64<number | undefined, "optional">;
    error: convex_values0.VString<string | undefined, "optional">;
  }, "required", "collection" | "document" | "timeout" | "status" | "started" | "completed" | "retries" | "error">, {
    by_document: ["collection", "document", "status", "_creationTime"];
    by_status: ["status", "started", "_creationTime"];
  }, {}, {}>;
}, true>;
//#endregion
export { _default as default };
//# sourceMappingURL=schema.d.ts.map