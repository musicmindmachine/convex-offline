import * as Y from "yjs";
import * as convex_server0 from "convex/server";
import { DataModelFromSchemaDefinition, DocumentByName, FunctionReference, GenericDataModel, GenericMutationCtx, SchemaDefinition, TableNamesInDataModel, WithOptionalSystemFields } from "convex/server";
import { Collection, NonSingleResult } from "@tanstack/db";
import { Logger } from "@logtape/logtape";
import { Awareness } from "y-protocols/awareness";
import * as convex_browser0 from "convex/browser";
import { ConvexClient } from "convex/browser";
import * as convex_values0 from "convex/values";
import { GenericValidator, Infer } from "convex/values";

//#region src/client/persistence/types.d.ts

/**
 * Low-level storage adapter for custom backends (Chrome extension, localStorage, cloud).
 * For SQLite, use `persistence.web.sqlite.create()` or `persistence.native.sqlite.create()` directly.
 *
 * @example
 * ```typescript
 * class ChromeStorageAdapter implements StorageAdapter {
 *   async get(key: string) {
 *     const result = await chrome.storage.local.get(key);
 *     return result[key] ? new Uint8Array(result[key]) : undefined;
 *   }
 *   async set(key: string, value: Uint8Array) {
 *     await chrome.storage.local.set({ [key]: Array.from(value) });
 *   }
 *   async delete(key: string) {
 *     await chrome.storage.local.remove(key);
 *   }
 *   async keys(prefix: string) {
 *     const all = await chrome.storage.local.get(null);
 *     return Object.keys(all).filter(k => k.startsWith(prefix));
 *   }
 * }
 * ```
 */
interface StorageAdapter {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  close?(): void;
}
interface PersistenceProvider {
  readonly whenSynced: Promise<void>;
  destroy(): void;
  flush?(): Promise<void>;
}
/**
 * SQLite database interface for migrations.
 * Provides direct SQL access for schema migrations.
 */
interface MigrationDatabase {
  run(sql: string, params?: unknown[]): Promise<void>;
  exec(sql: string): Promise<void>;
  get<T$1>(sql: string, params?: unknown[]): Promise<T$1 | undefined>;
  all<T$1>(sql: string, params?: unknown[]): Promise<T$1[]>;
}
/**
 * High-level persistence interface for collections.
 * Create via `persistence.web.sqlite.create()`, `persistence.memory.create()`, or `persistence.custom.create()`.
 */
interface Persistence {
  createDocPersistence(collection: string, ydoc: Y.Doc): PersistenceProvider;
  listDocuments(prefix: string): Promise<string[]>;
  readonly kv: KeyValueStore;
  /** Direct SQL access for migrations (only available with SQLite persistence) */
  readonly db?: MigrationDatabase;
}
interface KeyValueStore {
  get<T$1>(key: string): Promise<T$1 | undefined>;
  set<T$1>(key: string, value: T$1): Promise<void>;
  del(key: string): Promise<void>;
}
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
interface MigrationDefinition<T$1 = unknown> {
  name: string;
  batchSize?: number;
  parallelize?: boolean;
  migrate: (ctx: MigrationContext, doc: T$1) => Promise<void>;
}
/** Map of version numbers to migration definitions */
type MigrationMap<T$1 = unknown> = Record<number, MigrationDefinition<T$1>>;
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
//#endregion
//#region src/client/identity.d.ts
/**
 * User identity for presence and collaborative features.
 */
interface UserIdentity {
  id?: string;
  name?: string;
  color?: string;
  avatar?: string;
}
/**
 * Configuration for anonymous presence names and colors.
 * Allows applications to customize the adjectives, nouns, and colors
 * used when generating anonymous user identities.
 */
interface AnonymousPresenceConfig {
  /** List of adjectives for anonymous names (e.g., ["Swift", "Bright", "Calm"]) */
  adjectives?: string[];
  /** List of nouns for anonymous names (e.g., ["Fox", "Owl", "Bear"]) */
  nouns?: string[];
  /** List of hex colors for anonymous users (e.g., ["#9F5944", "#A9704D"]) */
  colors?: string[];
}
/**
 * Identity namespace for creating user identities and generating stable anonymous identifiers.
 *
 * @example
 * ```typescript
 * import { identity } from "@trestleinc/replicate/client";
 *
 * // Create from your auth provider
 * const user = identity.from({
 *   id: authSession.user.id,
 *   name: authSession.user.name,
 *   avatar: authSession.user.image,
 *   color: identity.color.generate(authSession.user.id),
 * });
 *
 * // Generate stable anonymous identifiers
 * identity.color.generate("seed-123")    // Deterministic color
 * identity.name.anonymous("seed-123")    // "Swift Fox", "Calm Bear", etc.
 * ```
 */
declare const identity: {
  /**
   * Create a user identity from auth provider data.
   * Pass-through helper that ensures type safety.
   */
  readonly from: (user: UserIdentity) => UserIdentity;
  /**
   * Color utilities for generating stable, deterministic colors.
   */
  readonly color: {
    /**
     * Generate a deterministic color from any seed string.
     * Same seed always produces the same color.
     *
     * @param seed - Any string (user ID, client ID, etc.)
     * @param config - Optional custom colors configuration
     * @returns Hex color string (e.g., "#9F5944")
     */
    readonly generate: (seed: string, config?: AnonymousPresenceConfig) => string;
  };
  /**
   * Name utilities for generating stable anonymous names.
   */
  readonly name: {
    /**
     * Generate a stable anonymous name from any seed string.
     * Same seed always produces the same name.
     *
     * @param seed - Any string (user ID, client ID, etc.)
     * @param config - Optional custom adjectives/nouns configuration
     * @returns Anonymous name (e.g., "Swift Fox", "Calm Bear")
     */
    readonly anonymous: (seed: string, config?: AnonymousPresenceConfig) => string;
  };
};
//#endregion
//#region src/client/migration.d.ts
/** Error codes for migration failures */
type MigrationErrorCode = "SCHEMA_MISMATCH" | "SQLITE_ERROR" | "YJS_ERROR" | "NETWORK_ERROR";
/** Error details for migration failures */
interface MigrationError {
  code: MigrationErrorCode;
  message: string;
  fromVersion: number;
  toVersion: number;
  operation?: SchemaDiffOperation;
}
/** Context for migration error recovery */
interface RecoveryContext {
  error: MigrationError;
  /** True if no unsynced local changes exist */
  canResetSafely: boolean;
  /** Count of unsynced local changes */
  pendingChanges: number;
  /** Timestamp of last successful sync */
  lastSyncedAt: Date | null;
}
/** Available recovery actions */
type RecoveryAction = {
  action: "reset";
} | {
  action: "keep-old-schema";
} | {
  action: "retry";
} | {
  action: "custom";
  handler: () => Promise<void>;
};
/** Handler for migration errors */
type MigrationErrorHandler = (error: MigrationError, context: RecoveryContext) => Promise<RecoveryAction>;
/** Yjs document info for migrations */
interface MigrationDoc {
  id: string;
  fields: Map<string, unknown>;
}
/** Context for custom client migrations */
interface ClientMigrationContext {
  /** Documents that need migration */
  dirtyDocs: MigrationDoc[];
  /** Get Yjs document for a specific ID */
  getYDoc(id: string): Y.Doc | null;
  /** Schema diff being applied */
  diff: SchemaDiff;
}
/** Custom client migration function */
type ClientMigrationFn = (db: MigrationDatabase, ctx: ClientMigrationContext) => Promise<void>;
/** Map of version numbers to custom client migrations */
type ClientMigrationMap = Record<number, ClientMigrationFn>;
/** Options for collection.create() with versioned schema */
interface VersionedCollectionOptions<T$1 extends object> {
  /** Versioned schema definition */
  schema: VersionedSchema<GenericValidator>;
  /** Persistence provider factory */
  persistence: () => Promise<Persistence>;
  /** Collection configuration */
  config: () => VersionedCollectionConfig<T$1>;
  /** Custom client migrations (override auto-generated) */
  clientMigrations?: ClientMigrationMap;
  /** Handler for migration errors */
  onMigrationError?: MigrationErrorHandler;
}
/** Configuration for versioned collection */
interface VersionedCollectionConfig<T$1 extends object> {
  /** Convex client instance */
  convexClient: convex_browser0.ConvexClient;
  /** Collection API endpoints */
  api: {
    material: convex_server0.FunctionReference<"query">;
    delta: convex_server0.FunctionReference<"query">;
    replicate: convex_server0.FunctionReference<"mutation">;
    presence: convex_server0.FunctionReference<"mutation">;
    session: convex_server0.FunctionReference<"query">;
  };
  /** Get document key */
  getKey: (doc: T$1) => string | number;
  /** User identity provider */
  user?: () => UserIdentity | undefined;
}
/** Metadata stored in SQLite for schema versioning */
interface SchemaMetadata {
  collection: string;
  version: number;
  migratedAt: number;
}
/**
 * Get the current schema version from SQLite.
 */
declare function getStoredSchemaVersion(db: MigrationDatabase, collection: string): Promise<number | null>;
/**
 * Store the current schema version in SQLite.
 */
declare function setStoredSchemaVersion(db: MigrationDatabase, collection: string, version: number): Promise<void>;
/**
 * Run auto-generated SQL migration.
 */
declare function runAutoMigration(db: MigrationDatabase, tableName: string, diff: SchemaDiff): Promise<void>;
/**
 * Create a migration error.
 */
declare function createMigrationError(code: MigrationErrorCode, message: string, fromVersion: number, toVersion: number, operation?: SchemaDiffOperation): MigrationError;
/** Options for running migrations */
interface RunMigrationsOptions<_T extends object = object> {
  /** Collection name */
  collection: string;
  /** Versioned schema */
  schema: VersionedSchema<GenericValidator>;
  /** SQLite database interface */
  db: MigrationDatabase;
  /** Custom client migrations (override auto-generated) */
  clientMigrations?: ClientMigrationMap;
  /** Handler for migration errors */
  onError?: MigrationErrorHandler;
  /** Get Yjs document for a specific ID (for custom migrations) */
  getYDoc?: (id: string) => Y.Doc | null;
  /** List all document IDs in the collection */
  listDocuments?: () => Promise<string[]>;
}
/** Result of running migrations */
interface MigrationResult {
  /** Whether migration was needed and ran */
  migrated: boolean;
  /** Previous schema version (null if first run) */
  fromVersion: number | null;
  /** Current schema version */
  toVersion: number;
  /** Schema diff that was applied (null if no migration needed) */
  diff: SchemaDiff | null;
  /** Error if migration failed */
  error?: MigrationError;
}
/**
 * Run migrations for a collection if needed.
 *
 * @example
 * ```typescript
 * const result = await runMigrations({
 *   collection: "tasks",
 *   schema: taskSchema,
 *   db: persistence.db!,
 * });
 *
 * if (result.migrated) {
 *   console.log(`Migrated from v${result.fromVersion} to v${result.toVersion}`);
 * }
 * ```
 */
declare function runMigrations(options: RunMigrationsOptions): Promise<MigrationResult>;
//#endregion
//#region src/client/services/seq.d.ts
type Seq = number;
//#endregion
//#region src/client/services/presence.d.ts
interface PresenceState {
  local: UserIdentity | null;
  remote: UserIdentity[];
}
interface Presence {
  join(options?: {
    cursor?: unknown;
  }): void;
  leave(): void;
  update(options: {
    cursor?: unknown;
  }): void;
  get(): PresenceState;
  subscribe(callback: (state: PresenceState) => void): () => void;
}
//#endregion
//#region src/shared/logger.d.ts
declare function getLogger(category: string[]): Logger;
//#endregion
//#region src/shared/index.d.ts
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
/** ProseMirror-compatible JSON structure. */
type ProseValue = Infer<typeof proseValidator>;
/**
 * Extract prose field names from T (fields typed as ProseValue).
 * Used internally for type-safe prose field operations.
 */
type ProseFields<T$1> = { [K in keyof T$1]: T$1[K] extends ProseValue ? K : never }[keyof T$1];
//#endregion
//#region src/client/collection.d.ts
/** Server-rendered material data for SSR hydration */
interface Materialized<T$1> {
  documents: readonly T$1[];
  cursor?: Seq;
  count?: number;
  crdt?: Record<string, {
    bytes: ArrayBuffer;
    seq: number;
  }>;
}
interface PaginatedPage<T$1> {
  page: readonly T$1[];
  isDone: boolean;
  continueCursor: string;
}
interface PaginatedMaterial<T$1> {
  pages: readonly PaginatedPage<T$1>[];
  cursor: string;
  isDone: boolean;
}
interface PaginationConfig {
  pageSize?: number;
}
type PaginationStatus = "idle" | "busy" | "done" | "error";
interface PaginationState {
  status: PaginationStatus;
  count: number;
  cursor: string | null;
  error?: Error;
}
interface ConvexCollectionApi {
  material: FunctionReference<"query">;
  delta: FunctionReference<"query">;
  replicate: FunctionReference<"mutation">;
  presence: FunctionReference<"mutation">;
  session: FunctionReference<"query">;
}
/**
 * Binding returned by collection.utils.prose() for collaborative editing.
 *
 * Compatible with TipTap's Collaboration/CollaborationCursor and BlockNote's
 * collaboration config. The editor handles undo/redo internally via y-prosemirror.
 */
interface EditorBinding {
  /** Yjs XmlFragment for content sync */
  readonly fragment: Y.XmlFragment;
  /**
   * Provider with Yjs Awareness for cursor/presence sync.
   * Pass to CollaborationCursor.configure({ provider: binding.provider })
   * or BlockNote's collaboration.provider
   */
  readonly provider: {
    readonly awareness: Awareness;
    readonly document: Y.Doc;
  };
  /** Whether there are unsaved local changes */
  readonly pending: boolean;
  /** Subscribe to pending state changes */
  onPendingChange(callback: (pending: boolean) => void): () => void;
  /** Cleanup - call when unmounting editor */
  destroy(): void;
}
interface ProseOptions {
  /** User identity getter for collaborative presence */
  user?: () => UserIdentity | undefined;
  /**
   * Debounce delay in milliseconds before syncing changes to server.
   * Local changes are batched during this window for efficiency.
   * @default 50
   */
  debounceMs?: number;
  /**
   * Throttle delay in milliseconds for presence/cursor position updates.
   * Lower values mean faster cursor sync but more network traffic.
   * @default 50
   */
  throttleMs?: number;
}
interface ConvexCollectionUtils<T$1 extends object> {
  prose(document: string, field: ProseFields<T$1>, options?: ProseOptions): Promise<EditorBinding>;
}
interface SessionInfo {
  client: string;
  document: string;
  user?: string;
  profile?: {
    name?: string;
    color?: string;
    avatar?: string;
  };
  cursor?: unknown;
  connected: boolean;
}
interface SessionAPI {
  get(docId?: string): SessionInfo[];
  subscribe(callback: (sessions: SessionInfo[]) => void): () => void;
}
interface DocumentHandle<T$1 extends object> {
  readonly id: string;
  readonly presence: Presence;
  readonly awareness: Awareness;
  prose(field: ProseFields<T$1>, options?: ProseOptions): Promise<EditorBinding>;
}
interface ConvexCollectionExtensions<T$1 extends object> {
  doc(id: string): DocumentHandle<T$1>;
  readonly session: SessionAPI;
}
interface LazyCollection<T$1 extends object> {
  init(material?: Materialized<T$1> | PaginatedMaterial<T$1>): Promise<void>;
  get(): Collection<T$1, string, ConvexCollectionUtils<T$1>, never, T$1> & NonSingleResult & ConvexCollectionExtensions<T$1>;
  readonly $docType?: T$1;
  readonly pagination: {
    load(): Promise<PaginatedPage<T$1> | null>;
    readonly status: PaginationStatus;
    readonly canLoadMore: boolean;
    readonly count: number;
    subscribe(callback: (state: PaginationState) => void): () => void;
  };
}
type ConvexCollection<T$1 extends object> = Collection<T$1, any, ConvexCollectionUtils<T$1>, never, T$1> & NonSingleResult & ConvexCollectionExtensions<T$1>;
/** Options for collection.create() */
interface CreateCollectionOptions<T$1 extends object> {
  schema: VersionedSchema<GenericValidator>;
  persistence: () => Promise<Persistence>;
  config: () => {
    convexClient: ConvexClient;
    api: ConvexCollectionApi;
    getKey: (doc: T$1) => string;
    user?: () => UserIdentity | undefined;
  };
  clientMigrations?: ClientMigrationMap;
  onMigrationError?: MigrationErrorHandler;
  pagination?: PaginationConfig;
}
/**
 * Create a collection with versioned schema support.
 * Handles automatic client-side migrations when schema version changes.
 */
declare function createVersionedCollection<T$1 extends object>(options: CreateCollectionOptions<T$1>): LazyCollection<T$1>;
declare namespace collection {
  type Infer<C> = C extends {
    $docType?: infer T;
  } ? NonNullable<T> : never;
}
/**
 * Create a collection with versioned schema (new API).
 *
 * @example
 * ```typescript
 * const tasks = collection.create({
 *   schema: taskSchema,
 *   persistence: () => persistence.web.sqlite.create(),
 *   config: () => ({
 *     convexClient: new ConvexClient(url),
 *     api: api.tasks,
 *     getKey: (t) => t.id,
 *   }),
 *   onMigrationError: async (error, ctx) => {
 *     if (ctx.canResetSafely) return { action: "reset" };
 *     return { action: "keep-old-schema" };
 *   },
 * });
 * ```
 */
declare const collection: {
  create: typeof createVersionedCollection;
};
//#endregion
//#region src/client/types.d.ts
type TableNamesFromSchema<Schema extends SchemaDefinition<any, any>> = TableNamesInDataModel<DataModelFromSchemaDefinition<Schema>>;
type DocFromSchema<Schema extends SchemaDefinition<any, any>, TableName extends TableNamesFromSchema<Schema>> = WithOptionalSystemFields<DocumentByName<DataModelFromSchemaDefinition<Schema>, TableName>>;
/** Extract document type from a LazyCollection instance. */
type InferDoc<C> = C extends {
  $docType?: infer T;
} ? T : never;
//#endregion
//#region src/client/errors.d.ts
declare class NetworkError extends Error {
  readonly _tag: "NetworkError";
  readonly retryable: true;
  readonly cause: unknown;
  readonly operation: string;
  constructor(props: {
    operation: string;
    cause: unknown;
  });
}
declare class IDBError extends Error {
  readonly _tag: "IDBError";
  readonly operation: "get" | "set" | "delete" | "clear";
  readonly cause: unknown;
  readonly store?: string;
  readonly key?: string;
  constructor(props: {
    operation: "get" | "set" | "delete" | "clear";
    cause: unknown;
    store?: string;
    key?: string;
  });
}
declare class IDBWriteError extends Error {
  readonly _tag: "IDBWriteError";
  readonly key: string;
  readonly value: unknown;
  readonly cause: unknown;
  constructor(props: {
    key: string;
    value: unknown;
    cause: unknown;
  });
}
declare class ReconciliationError extends Error {
  readonly _tag: "ReconciliationError";
  readonly collection: string;
  readonly reason: string;
  readonly cause?: unknown;
  constructor(props: {
    collection: string;
    reason: string;
    cause?: unknown;
  });
}
declare class ProseError extends Error {
  readonly _tag: "ProseError";
  readonly document: string;
  readonly field: string;
  readonly collection: string;
  constructor(props: {
    document: string;
    field: string;
    collection: string;
  });
}
declare class CollectionNotReadyError extends Error {
  readonly _tag: "CollectionNotReadyError";
  readonly collection: string;
  readonly reason: string;
  constructor(props: {
    collection: string;
    reason: string;
  });
}
/** Error that should not be retried (auth failures, validation errors) */
declare class NonRetriableError extends Error {
  constructor(message: string);
}
//#endregion
//#region src/client/merge.d.ts
/**
 * Extract plain text from ProseMirror/BlockNote JSON content.
 * Handles various content structures defensively for search and display.
 */
declare function extract(content: unknown): string;
//#endregion
//#region src/client/validators.d.ts
declare function emptyProse(): {
  type: "doc";
  content: never[];
};
//#endregion
//#region src/client/persistence/memory.d.ts
/**
 * Create an in-memory persistence factory.
 *
 * Useful for testing where you don't want IndexedDB side effects.
 *
 * @example
 * ```typescript
 * // In tests
 * convexCollectionOptions<Task>({
 *   // ... other options
 *   persistence: memoryPersistence(),
 * });
 * ```
 */
declare function memoryPersistence(): Persistence;
//#endregion
//#region src/client/persistence/sqlite/native.d.ts
interface OPSQLiteDatabase {
  execute(sql: string, params?: unknown[]): Promise<{
    rows: Record<string, unknown>[];
  }>;
  close(): void;
}
declare function createNativeSqlitePersistence(db: OPSQLiteDatabase, _dbName: string): Promise<Persistence>;
//#endregion
//#region src/client/persistence/sqlite/web.d.ts
interface WebSqliteOptions {
  name: string;
  worker: Worker | (() => Worker | Promise<Worker>);
}
declare function createWebSqlitePersistence(options: WebSqliteOptions): Promise<Persistence>;
declare function onceWebSqlitePersistence(options: WebSqliteOptions): () => Promise<Persistence>;
//#endregion
//#region src/client/persistence/custom.d.ts
declare function createCustomPersistence(adapter: StorageAdapter): Persistence;
//#endregion
//#region src/client/persistence/encrypted/types.d.ts
interface PassphraseConfig {
  get: () => Promise<string>;
  setup: (recoveryKey: string) => Promise<string>;
}
interface RecoveryConfig {
  onSetup: (key: string) => Promise<void>;
  onRecover: () => Promise<string>;
}
interface LockConfig {
  idle: number;
}
interface WebUnlockConfig {
  webauthn?: true;
  passphrase?: PassphraseConfig;
}
interface NativeUnlockConfig {
  biometric?: true;
  passphrase?: PassphraseConfig;
}
interface WebEncryptionConfig {
  storage: Persistence;
  user: string;
  mode?: "local" | "e2e";
  unlock: WebUnlockConfig;
  recovery?: RecoveryConfig;
  lock?: LockConfig;
  onLock?: () => void;
  onUnlock?: () => void;
}
interface NativeEncryptionConfig {
  storage: Persistence;
  user: string;
  mode?: "local" | "e2e";
  unlock: NativeUnlockConfig;
  recovery?: RecoveryConfig;
  lock?: LockConfig;
  onLock?: () => void;
  onUnlock?: () => void;
}
type EncryptionState = "locked" | "unlocked" | "setup";
interface EncryptionPersistence extends Persistence {
  readonly state: EncryptionState;
  lock(): Promise<void>;
  unlock(): Promise<void>;
  isSupported(): Promise<boolean>;
}
//#endregion
//#region src/client/persistence/encrypted/web.d.ts
declare function createWebEncryptionPersistence(config: WebEncryptionConfig): Promise<EncryptionPersistence>;
//#endregion
//#region src/client/persistence/encrypted/webauthn.d.ts
declare function isPRFSupported(): Promise<boolean>;
//#endregion
//#region src/client/persistence/encrypted/manager.d.ts
type EncryptionPreference = "webauthn" | "passphrase" | "none";
interface EncryptionManagerHooks {
  change?: (state: EncryptionManagerState) => void;
  passphrase?: () => Promise<string>;
  recovery?: (key: string) => void;
}
interface EncryptionManagerConfig {
  storage: Persistence;
  user: string;
  preference?: EncryptionPreference;
  hooks?: EncryptionManagerHooks;
}
interface EncryptionManagerState {
  state: EncryptionState | "disabled";
  error?: Error;
  persistence: Persistence;
}
interface EncryptionManager {
  get(): EncryptionManagerState;
  enable(): Promise<void>;
  disable(): Promise<void>;
  unlock(): Promise<void>;
  lock(): Promise<void>;
  subscribe(callback: (state: EncryptionManagerState) => void): () => void;
  destroy(): void;
}
declare function createEncryptionManager(config: EncryptionManagerConfig): Promise<EncryptionManager>;
//#endregion
//#region src/client/persistence/index.d.ts
declare const persistence: {
  readonly web: {
    readonly sqlite: {
      readonly create: typeof createWebSqlitePersistence;
      readonly once: typeof onceWebSqlitePersistence;
    };
    readonly encryption: {
      readonly create: typeof createWebEncryptionPersistence;
      readonly manager: typeof createEncryptionManager;
      readonly webauthn: {
        readonly supported: typeof isPRFSupported;
      };
    };
  };
  readonly native: {
    readonly sqlite: {
      readonly create: typeof createNativeSqlitePersistence;
    };
    readonly encryption: {
      readonly create: () => never;
      readonly biometric: {
        readonly supported: () => Promise<boolean>;
      };
    };
  };
  readonly memory: {
    readonly create: typeof memoryPersistence;
  };
  readonly custom: {
    readonly create: typeof createCustomPersistence;
  };
};
//#endregion
//#region src/client/index.d.ts
declare const errors: {
  readonly Network: typeof NetworkError;
  readonly IDB: typeof IDBError;
  readonly IDBWrite: typeof IDBWriteError;
  readonly Reconciliation: typeof ReconciliationError;
  readonly Prose: typeof ProseError;
  readonly CollectionNotReady: typeof CollectionNotReadyError;
  readonly NonRetriable: typeof NonRetriableError;
};
declare const schema: {
  readonly prose: {
    readonly extract: typeof extract;
    readonly empty: typeof emptyProse;
  };
};
//#endregion
export { type AnonymousPresenceConfig, type ClientMigrationContext, type ClientMigrationFn, type ClientMigrationMap, type ConvexCollection, type DocFromSchema, type DocumentHandle, type Presence as DocumentPresence, type EditorBinding, type EncryptionManager, type EncryptionManagerConfig, type EncryptionManagerHooks, type EncryptionManagerState, type EncryptionPersistence, type EncryptionPreference, type EncryptionState, type InferDoc, type LazyCollection, type Logger, type Materialized, type MigrationDatabase, type MigrationDoc, type MigrationError, type MigrationErrorCode, type MigrationErrorHandler, type MigrationResult, type NativeEncryptionConfig, type PaginatedMaterial, type PaginatedPage, type PaginationConfig, type PaginationStatus, type Persistence, type PresenceState, type ProseOptions, type RecoveryAction, type RecoveryContext, type RunMigrationsOptions, type SchemaMetadata, type Seq, type SessionAPI, type SessionInfo, type StorageAdapter, type TableNamesFromSchema, type UserIdentity, type VersionedCollectionConfig, type VersionedCollectionOptions, type WebEncryptionConfig, collection, createMigrationError, errors, getLogger, getStoredSchemaVersion, identity, persistence, runAutoMigration, runMigrations, schema, setStoredSchemaVersion };
//# sourceMappingURL=index.d.ts.map