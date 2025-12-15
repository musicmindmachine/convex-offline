/**
 * sql.js adapter for browser SQLite.
 *
 * Uses sql.js (SQLite compiled to WebAssembly) for browser environments.
 * Optionally supports OPFS for persistent storage in modern browsers.
 */
import type { SqliteAdapter } from '../sqlite-level.js';
import type { Database as SqlJsDatabase, SqlJsStatic, BindParams } from 'sql.js';

/**
 * sql.js adapter for browser SQLite.
 */
export class SqlJsAdapter implements SqliteAdapter {
  private db: SqlJsDatabase;
  private persistPath: string | null;

  constructor(db: SqlJsDatabase, persistPath: string | null = null) {
    this.db = db;
    this.persistPath = persistPath;
  }

  async execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    const rows: Record<string, unknown>[] = [];

    // Handle statements that don't return data
    if (
      sql.trim().toUpperCase().startsWith('CREATE') ||
      sql.trim().toUpperCase().startsWith('INSERT') ||
      sql.trim().toUpperCase().startsWith('UPDATE') ||
      sql.trim().toUpperCase().startsWith('DELETE') ||
      sql.trim().toUpperCase().startsWith('BEGIN') ||
      sql.trim().toUpperCase().startsWith('COMMIT') ||
      sql.trim().toUpperCase().startsWith('ROLLBACK')
    ) {
      this.db.run(sql, params as BindParams);
      await this.persist();
      return { rows };
    }

    // Handle SELECT statements
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params as BindParams);
    }

    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();

    return { rows };
  }

  close(): void {
    this.db.close();
  }

  /**
   * Persist database to OPFS if available.
   */
  private async persist(): Promise<void> {
    if (!this.persistPath) return;

    try {
      // Check if OPFS is available
      if (typeof navigator !== 'undefined' && 'storage' in navigator) {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle(this.persistPath, { create: true });
        const writable = await fileHandle.createWritable();
        const data = this.db.export();
        // Write the raw ArrayBuffer (copy to ensure ownership)
        const buffer = new Uint8Array(data).buffer as ArrayBuffer;
        await writable.write(buffer);
        await writable.close();
      }
    } catch {
      // OPFS not available, skip persistence
    }
  }
}

interface SqlJsAdapterOptions {
  /** Database name for OPFS persistence */
  dbName?: string;
  /** Enable OPFS persistence (default: true if available) */
  persist?: boolean;
  /** Custom WASM file URL */
  wasmUrl?: string;
}

/**
 * Create a sql.js adapter for browser SQLite.
 *
 * @example
 * ```typescript
 * const adapter = await createSqlJsAdapter({ dbName: 'myapp' });
 * const db = new SqliteLevel('myapp');
 * db.setAdapterFactory(() => Promise.resolve(adapter));
 * await db.open();
 * ```
 */
export async function createSqlJsAdapter(
  options: SqlJsAdapterOptions = {}
): Promise<SqliteAdapter> {
  const { dbName = 'replicate', persist = true, wasmUrl } = options;
  const persistPath = persist ? `${dbName}.sqlite` : null;

  // Dynamically import sql.js
  const initSqlJs = (await import('sql.js')).default as (options?: {
    locateFile?: (file: string) => string;
  }) => Promise<SqlJsStatic>;

  // Initialize sql.js
  const SQL = await initSqlJs({
    locateFile: wasmUrl ? () => wasmUrl : undefined,
  });

  // Try to load existing database from OPFS
  let existingData: Uint8Array | null = null;
  if (persist && typeof navigator !== 'undefined' && 'storage' in navigator) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(`${dbName}.sqlite`);
      const file = await fileHandle.getFile();
      existingData = new Uint8Array(await file.arrayBuffer());
    } catch {
      // No existing database, start fresh
    }
  }

  // Create database (with existing data if available)
  const db = existingData ? new SQL.Database(existingData) : new SQL.Database();

  return new SqlJsAdapter(db, persistPath);
}
