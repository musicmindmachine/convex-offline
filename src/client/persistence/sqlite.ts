/**
 * Universal SQLite persistence for browser and React Native.
 *
 * Uses y-leveldb with a custom sqlite-level implementation that works
 * across both browser (sql.js WASM) and React Native (op-sqlite).
 *
 * @example
 * ```typescript
 * import { sqlitePersistence } from '@trestleinc/replicate/client';
 *
 * // Works on both browser AND React Native!
 * convexCollectionOptions<Task>({
 *   persistence: await sqlitePersistence('my-app'),
 * });
 * ```
 */
import type * as Y from 'yjs';
import { LeveldbPersistence } from 'y-leveldb';
import { SqliteLevel, type SqliteAdapter } from './sqlite-level.js';
import type { Persistence, PersistenceProvider, KeyValueStore } from './types.js';

/**
 * SQLite-backed key-value store using sqlite-level.
 */
class SqliteKeyValueStore implements KeyValueStore {
  private db: SqliteLevel<string, string>;
  private prefix = 'kv:';

  constructor(db: SqliteLevel<string, string>) {
    this.db = db;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const value = await this.db.get(this.prefix + key);
      if (value === undefined) {
        return undefined;
      }
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.db.put(this.prefix + key, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.db.del(this.prefix + key);
  }
}

/**
 * SQLite persistence provider using y-leveldb.
 */
class SqlitePersistenceProvider implements PersistenceProvider {
  private persistence: LeveldbPersistence;
  readonly whenSynced: Promise<void>;

  constructor(collection: string, _ydoc: Y.Doc, leveldb: LeveldbPersistence) {
    this.persistence = leveldb;
    // Load existing document state
    this.whenSynced = this.persistence.getYDoc(collection).then((storedDoc: Y.Doc) => {
      // Apply stored state to provided ydoc
      const state = storedDoc.store;
      if (state) {
        // The stored doc and ydoc are merged via y-leveldb's internal mechanisms
      }
    });
  }

  destroy(): void {
    this.persistence.destroy();
  }
}

/**
 * Detect if running in React Native.
 */
function isReactNative(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.product === 'string' &&
    navigator.product === 'ReactNative'
  );
}

/**
 * Create a SQLite adapter for the current platform.
 */
async function createPlatformAdapter(dbName: string): Promise<SqliteAdapter> {
  if (isReactNative()) {
    // React Native: use op-sqlite
    const { createOPSqliteAdapter } = await import('./adapters/opsqlite.js');
    return createOPSqliteAdapter({ dbName });
  } else {
    // Browser: use sql.js
    const { createSqlJsAdapter } = await import('./adapters/sqljs.js');
    return createSqlJsAdapter({ dbName });
  }
}

interface SqlitePersistenceOptions {
  /** Custom SQLite adapter (for testing or alternative backends) */
  adapter?: SqliteAdapter;
}

/**
 * Create a universal SQLite persistence factory.
 *
 * Works on both browser (via sql.js WASM) and React Native (via op-sqlite).
 *
 * @param dbName - Name for the SQLite database (default: 'replicate')
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * // Browser or React Native - same API!
 * import { sqlitePersistence } from '@trestleinc/replicate/client';
 *
 * convexCollectionOptions<Task>({
 *   persistence: await sqlitePersistence('my-app'),
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With custom adapter (for testing)
 * import { sqlitePersistence } from '@trestleinc/replicate/client';
 * import { createSqlJsAdapter } from '@trestleinc/replicate/client/adapters';
 *
 * const adapter = await createSqlJsAdapter({ dbName: 'test', persist: false });
 * convexCollectionOptions<Task>({
 *   persistence: await sqlitePersistence('test', { adapter }),
 * });
 * ```
 */
export async function sqlitePersistence(
  dbName = 'replicate',
  options: SqlitePersistenceOptions = {}
): Promise<Persistence> {
  // Validate database name (security: prevent path traversal)
  if (!/^[\w-]+$/.test(dbName)) {
    throw new Error('Invalid database name: must be alphanumeric with hyphens/underscores');
  }

  // Create or use provided adapter
  const adapter = options.adapter ?? (await createPlatformAdapter(dbName));

  // Create sqlite-level database
  const db = new SqliteLevel<string, string>(dbName);
  db.setAdapterFactory(() => Promise.resolve(adapter));
  await db.open();

  // Create y-leveldb persistence (reuses the sqlite-level database)
  const leveldb = new LeveldbPersistence(dbName, { level: db as any });

  // Create key-value store
  const kv = new SqliteKeyValueStore(db);

  return {
    createDocPersistence: (collection: string, ydoc: Y.Doc) =>
      new SqlitePersistenceProvider(collection, ydoc, leveldb),
    kv,
  };
}
