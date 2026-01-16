import * as convex_values0 from "convex/values";
import { GenericValidator, Infer } from "convex/values";
import * as convex_server9 from "convex/server";
import { GenericDataModel, GenericMutationCtx, GenericQueryCtx, GenericTableInfo, OrderedQuery, Query, QueryInitializer } from "convex/server";
import "@logtape/logtape";

//#region src/shared/index.d.ts

type DurationUnit = "m" | "h" | "d";
type Duration = `${number}${DurationUnit}`;
interface CompactionConfig {
  threshold?: number;
  timeout?: Duration;
  retain?: number;
}
//#endregion
//#region src/server/collection.d.ts
interface CollectionOptions<T extends object> {
  compaction?: Partial<CompactionConfig>;
  view?: ViewFunction;
  hooks?: {
    evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    evalRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    evalSession?: (ctx: GenericMutationCtx<GenericDataModel>, client: string) => void | Promise<void>;
    onDelta?: (ctx: GenericQueryCtx<GenericDataModel>, result: any) => void | Promise<void>;
    onInsert?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onUpdate?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    transform?: (docs: T[]) => T[] | Promise<T[]>;
  };
}
declare function createCollection<T extends object>(component: any, name: string, options?: CollectionOptions<T>): {
  __collection: string;
  material: convex_server9.RegisteredQuery<"public", {
    numItems?: number | undefined;
    cursor?: string | undefined;
  }, Promise<{
    page: T[];
    isDone: boolean;
    continueCursor: string;
    documents?: undefined;
    count?: undefined;
  } | {
    documents: T[];
    count: number;
    page?: undefined;
    isDone?: undefined;
    continueCursor?: undefined;
  }>>;
  delta: convex_server9.RegisteredQuery<"public", {
    seq?: number | undefined;
    limit?: number | undefined;
    threshold?: number | undefined;
    document?: string | undefined;
    vector?: ArrayBuffer | undefined;
  }, Promise<any>>;
  replicate: convex_server9.RegisteredMutation<"public", {
    material?: any;
    type: "insert" | "update" | "delete";
    bytes: ArrayBuffer;
    document: string;
  }, Promise<{
    success: boolean;
    seq: any;
  }>>;
  presence: convex_server9.RegisteredMutation<"public", {
    seq?: number | undefined;
    cursor?: {
      field?: string | undefined;
      anchor: any;
      head: any;
    } | undefined;
    vector?: ArrayBuffer | undefined;
    user?: string | undefined;
    profile?: {
      name?: string | undefined;
      color?: string | undefined;
      avatar?: string | undefined;
    } | undefined;
    interval?: number | undefined;
    document: string;
    client: string;
    action: "join" | "leave" | "mark" | "signal";
  }, Promise<null>>;
  session: convex_server9.RegisteredQuery<"public", {
    connected?: boolean | undefined;
    exclude?: string | undefined;
    document: string;
  }, Promise<any>>;
};
declare const collection: {
  readonly create: typeof createCollection;
};
//#endregion
//#region src/server/migration.d.ts
/** Field type for schema operations */
type FieldType = "string" | "number" | "boolean" | "null" | "array" | "object" | "prose";
/** Individual diff operation detected between schema versions */
type SchemaDiffOperation = {
  type: "add_column";
  column: string;
  fieldType: FieldType;
  defaultValue: unknown;
} | {
  type: "remove_column";
  column: string;
} | {
  type: "rename_column";
  from: string;
  to: string;
} | {
  type: "change_type";
  column: string;
  from: FieldType;
  to: FieldType;
};
/** Result of diffing two schema versions */
interface SchemaDiff {
  fromVersion: number;
  toVersion: number;
  operations: SchemaDiffOperation[];
  isBackwardsCompatible: boolean;
  generatedSQL: string[];
}
/** Context passed to server migration functions */
interface MigrationContext<DataModel extends GenericDataModel = GenericDataModel> {
  db: GenericMutationCtx<DataModel>["db"];
}
/** Single migration definition */
interface MigrationDefinition<T = unknown> {
  name: string;
  batchSize?: number;
  parallelize?: boolean;
  migrate: (ctx: MigrationContext, doc: T) => Promise<void>;
}
/** Map of version numbers to migration definitions */
type MigrationMap<T = unknown> = Record<number, MigrationDefinition<T>>;
/** Options for schema.define() */
interface SchemaDefinitionOptions<TShape extends GenericValidator> {
  /** Current schema version (increment when schema changes) */
  version: number;
  /** Convex validator for the document shape */
  shape: TShape;
  /** Default values for optional fields (applied during migrations) */
  defaults?: Partial<Infer<TShape>>;
  /** Previous schema versions for diffing */
  history?: Record<number, GenericValidator>;
}
/** Versioned schema with migration capabilities */
interface VersionedSchema<TShape extends GenericValidator> {
  /** Current schema version */
  readonly version: number;
  /** Convex validator for the document shape */
  readonly shape: TShape;
  /** Default values for optional fields */
  readonly defaults: Partial<Infer<TShape>>;
  /** Previous schema versions */
  readonly history: Record<number, GenericValidator>;
  /** Get validator for a specific version */
  getVersion(version: number): GenericValidator;
  /** Compute diff between two versions */
  diff(fromVersion: number, toVersion: number): SchemaDiff;
  /** Define server migrations for this schema */
  migrations(definitions: MigrationMap<Infer<TShape>>): SchemaMigrations<TShape>;
}
/** Schema migrations wrapper */
interface SchemaMigrations<TShape extends GenericValidator> {
  /** The versioned schema */
  readonly schema: VersionedSchema<TShape>;
  /** Migration definitions by version */
  readonly definitions: MigrationMap<Infer<TShape>>;
}
/**
 * Define a versioned schema with migration capabilities.
 *
 * @example
 * ```typescript
 * import { schema } from "@trestleinc/replicate/server";
 * import { v } from "convex/values";
 *
 * export const taskSchema = schema.define({
 *   version: 2,
 *   shape: v.object({
 *     id: v.string(),
 *     title: v.string(),
 *     priority: v.optional(v.string()),
 *     content: schema.prose(),
 *   }),
 *   defaults: {
 *     priority: "medium",
 *   },
 *   history: {
 *     1: v.object({
 *       id: v.string(),
 *       title: v.string(),
 *       content: schema.prose(),
 *     }),
 *   },
 * });
 * ```
 */
declare function define<TShape extends GenericValidator>(options: SchemaDefinitionOptions<TShape>): VersionedSchema<TShape>;
//#endregion
//#region src/server/schema.d.ts
/**
 * Define a table with automatic timestamp field for replication.
 * All replicated tables must have an `id` field and define a `by_doc_id` index.
 *
 * @example
 * ```typescript
 * // convex/schema.ts
 * export default defineSchema({
 *   tasks: table(
 *     { id: v.string(), text: v.string(), isCompleted: v.boolean() },
 *     (t) => t.index('by_doc_id', ['id']).index('by_completed', ['isCompleted'])
 *   ),
 * });
 * ```
 */
declare function table(userFields: Record<string, any>, applyIndexes?: (table: any) => any): any;
//#endregion
//#region src/server/index.d.ts
declare const schema: {
  readonly table: typeof table;
  readonly prose: () => convex_values0.VObject<{
    content?: any[] | undefined;
    type: "doc";
  }, {
    type: convex_values0.VLiteral<"doc", "required">;
    content: convex_values0.VArray<any[] | undefined, convex_values0.VAny<any, "required", string>, "optional">;
  }, "required", "type" | "content">;
  readonly define: typeof define;
};
/** Query type returned by view functions - supports filter, order, collect, paginate */
type ViewQuery<TableInfo extends GenericTableInfo = GenericTableInfo> = OrderedQuery<TableInfo> | Query<TableInfo>;
/**
 * View function for filtering/ordering collection queries.
 * Receives a QueryInitializer and returns an OrderedQuery or Query.
 *
 * @example
 * ```typescript
 * view: async (ctx, q) => {
 *   const userId = await getAuthUserId(ctx);
 *   return q.filter(f => f.eq(f.field("ownerId"), userId)).order("desc");
 * }
 * ```
 */
type ViewFunction<TableInfo extends GenericTableInfo = GenericTableInfo> = (ctx: GenericQueryCtx<GenericDataModel>, query: QueryInitializer<TableInfo>) => ViewQuery<TableInfo> | Promise<ViewQuery<TableInfo>>;
declare class Replicate<T extends object> {
  component: any;
  collectionName: string;
  private threshold;
  private timeout;
  private retain;
  constructor(component: any, collectionName: string, compaction?: Partial<CompactionConfig>);
  createStreamQuery(opts?: {
    view?: ViewFunction;
    onStream?: (ctx: GenericQueryCtx<GenericDataModel>, result: any) => void | Promise<void>;
  }): convex_server9.RegisteredQuery<"public", {
    limit?: number | undefined;
    threshold?: number | undefined;
    seq: number;
  }, Promise<any>>;
  createMaterialQuery(opts?: {
    view?: ViewFunction;
    transform?: (docs: T[]) => T[] | Promise<T[]>;
  }): convex_server9.RegisteredQuery<"public", {
    numItems?: number | undefined;
    cursor?: string | undefined;
  }, Promise<{
    page: T[];
    isDone: boolean;
    continueCursor: string;
    documents?: undefined;
    count?: undefined;
  } | {
    documents: T[];
    count: number;
    page?: undefined;
    isDone?: undefined;
    continueCursor?: undefined;
  }>>;
  createInsertMutation(opts?: {
    evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onInsert?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
  }): convex_server9.RegisteredMutation<"public", {
    bytes: ArrayBuffer;
    document: string;
    material: any;
  }, Promise<{
    success: boolean;
    seq: any;
  }>>;
  createUpdateMutation(opts?: {
    evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onUpdate?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
  }): convex_server9.RegisteredMutation<"public", {
    bytes: ArrayBuffer;
    document: string;
    material: any;
  }, Promise<{
    success: boolean;
    seq: any;
  }>>;
  createRemoveMutation(opts?: {
    evalRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    onRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
  }): convex_server9.RegisteredMutation<"public", {
    bytes: ArrayBuffer;
    document: string;
  }, Promise<{
    success: boolean;
    seq: any;
  }>>;
  createMarkMutation(opts?: {
    evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, client: string) => void | Promise<void>;
  }): convex_server9.RegisteredMutation<"public", {
    seq?: number | undefined;
    vector?: ArrayBuffer | undefined;
    document: string;
    client: string;
  }, Promise<null>>;
  createReplicateMutation(opts?: {
    evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    evalRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    onInsert?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onUpdate?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
  }): convex_server9.RegisteredMutation<"public", {
    material?: any;
    type: "insert" | "update" | "delete";
    bytes: ArrayBuffer;
    document: string;
  }, Promise<{
    success: boolean;
    seq: any;
  }>>;
  createSessionMutation(opts?: {
    view?: ViewFunction;
    evalSession?: (ctx: GenericMutationCtx<GenericDataModel>, client: string) => void | Promise<void>;
  }): convex_server9.RegisteredMutation<"public", {
    seq?: number | undefined;
    cursor?: {
      field?: string | undefined;
      anchor: any;
      head: any;
    } | undefined;
    vector?: ArrayBuffer | undefined;
    user?: string | undefined;
    profile?: {
      name?: string | undefined;
      color?: string | undefined;
      avatar?: string | undefined;
    } | undefined;
    interval?: number | undefined;
    document: string;
    client: string;
    action: "join" | "leave" | "mark" | "signal";
  }, Promise<null>>;
  createDeltaQuery(opts?: {
    view?: ViewFunction;
    onDelta?: (ctx: GenericQueryCtx<GenericDataModel>, result: any) => void | Promise<void>;
  }): convex_server9.RegisteredQuery<"public", {
    seq?: number | undefined;
    limit?: number | undefined;
    threshold?: number | undefined;
    document?: string | undefined;
    vector?: ArrayBuffer | undefined;
  }, Promise<any>>;
  createSessionQuery(opts?: {
    view?: ViewFunction;
  }): convex_server9.RegisteredQuery<"public", {
    connected?: boolean | undefined;
    exclude?: string | undefined;
    document: string;
  }, Promise<any>>;
}
//#endregion
export { type CollectionOptions, type FieldType, type MigrationContext, type MigrationDefinition, type MigrationMap, Replicate, type SchemaDefinitionOptions, type SchemaDiff, type SchemaDiffOperation, type SchemaMigrations, type VersionedSchema, ViewFunction, collection, schema };
//# sourceMappingURL=index.d.ts.map