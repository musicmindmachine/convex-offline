export {
  convexCollectionOptions,
  type ConvexCollection,
  type EditorBinding,
} from '$/client/collection.js';

export {
  NetworkError,
  IDBError,
  IDBWriteError,
  ReconciliationError,
  ProseError,
  CollectionNotReadyError,
  NonRetriableError,
} from '$/client/errors.js';

export { extract } from '$/client/merge.js';

// Persistence exports
export {
  indexeddbPersistence,
  memoryPersistence,
  sqlitePersistence,
  type Persistence,
  type PersistenceProvider,
  type KeyValueStore,
  type SqlitePersistenceOptions,
  type SqliteAdapter,
} from '$/client/persistence/index.js';

// SQLite adapter exports (wrapper classes and types)
export {
  SqlJsAdapter,
  OPSqliteAdapter,
  type SqlJsDatabase,
  type SqlJsAdapterOptions,
  type OPSQLiteDatabase,
} from '$/client/persistence/adapters/index.js';
