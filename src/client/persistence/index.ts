/**
 * Persistence layer exports.
 *
 * Provides swappable storage backends for Y.Doc and key-value data.
 */
export type { Persistence, PersistenceProvider, KeyValueStore } from './types.js';
export { indexeddbPersistence } from './indexeddb.js';
export { memoryPersistence } from './memory.js';
export { sqlitePersistence, type SqlitePersistenceOptions } from './sqlite.js';

// Re-export adapter interface for custom implementations
export type { SqliteAdapter } from './sqlite-level.js';
