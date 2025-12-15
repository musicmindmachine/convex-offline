/**
 * op-sqlite adapter for React Native SQLite.
 *
 * Uses op-sqlite (native SQLite) for React Native environments.
 */
import type { SqliteAdapter } from '../sqlite-level.js';

// op-sqlite types
interface OPSQLiteDB {
  execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): void;
}

type OpenFn = (options: { name: string }) => OPSQLiteDB;

/**
 * op-sqlite adapter for React Native SQLite.
 */
export class OPSqliteAdapter implements SqliteAdapter {
  private db: OPSQLiteDB;

  constructor(db: OPSQLiteDB) {
    this.db = db;
  }

  async execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    const result = await this.db.execute(sql, params);
    return { rows: result.rows || [] };
  }

  close(): void {
    this.db.close();
  }
}

interface OPSqliteAdapterOptions {
  /** Database name */
  dbName?: string;
}

/**
 * Create an op-sqlite adapter for React Native.
 *
 * @example
 * ```typescript
 * const adapter = await createOPSqliteAdapter({ dbName: 'myapp' });
 * const db = new SqliteLevel('myapp');
 * db.setAdapterFactory(() => Promise.resolve(adapter));
 * await db.open();
 * ```
 */
export async function createOPSqliteAdapter(
  options: OPSqliteAdapterOptions = {}
): Promise<SqliteAdapter> {
  const { dbName = 'replicate' } = options;

  // Validate database name (security: prevent path traversal)
  if (!/^[\w-]+$/.test(dbName)) {
    throw new Error('Invalid database name: must be alphanumeric with hyphens/underscores');
  }

  // Dynamically import op-sqlite
  const { open } = (await import('@op-engineering/op-sqlite')) as { open: OpenFn };

  const db = open({ name: `${dbName}.db` });

  return new OPSqliteAdapter(db);
}
