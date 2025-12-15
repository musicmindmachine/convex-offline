/**
 * Unit tests for SQLite-level implementation
 *
 * Tests the abstract-level compatible SQLite backend.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SqliteLevel, type SqliteAdapter } from '$/client/persistence/sqlite-level.js';

/**
 * In-memory SQLite adapter for testing.
 * Uses a simple Map to simulate SQLite storage.
 */
class InMemorySqliteAdapter implements SqliteAdapter {
  private data = new Map<string, Uint8Array>();

  async execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    const sqlUpper = sql.trim().toUpperCase();

    // CREATE TABLE - no-op for in-memory
    if (sqlUpper.startsWith('CREATE')) {
      return { rows: [] };
    }

    // INSERT OR REPLACE
    if (sqlUpper.startsWith('INSERT')) {
      const key = params?.[0] as Uint8Array;
      const value = params?.[1] as Uint8Array;
      if (key && value) {
        this.data.set(this.keyToString(key), value);
      }
      return { rows: [] };
    }

    // SELECT
    if (sqlUpper.startsWith('SELECT')) {
      // Single key lookup
      if (sql.includes('WHERE key = ?')) {
        const key = params?.[0] as Uint8Array;
        const value = this.data.get(this.keyToString(key));
        if (value) {
          return { rows: [{ key, value }] };
        }
        return { rows: [] };
      }

      // Full scan for iterators
      const rows: Record<string, unknown>[] = [];
      for (const [keyStr, value] of this.data.entries()) {
        rows.push({
          key: new TextEncoder().encode(keyStr),
          value,
        });
      }

      // Sort by key
      rows.sort((a, b) => {
        const keyA = new TextDecoder().decode(a.key as Uint8Array);
        const keyB = new TextDecoder().decode(b.key as Uint8Array);
        return keyA.localeCompare(keyB);
      });

      return { rows };
    }

    // DELETE
    if (sqlUpper.startsWith('DELETE')) {
      if (sql.includes('WHERE key = ?')) {
        const key = params?.[0] as Uint8Array;
        this.data.delete(this.keyToString(key));
      } else {
        // DELETE all
        this.data.clear();
      }
      return { rows: [] };
    }

    // BEGIN/COMMIT/ROLLBACK - no-op for in-memory
    if (
      sqlUpper.startsWith('BEGIN') ||
      sqlUpper.startsWith('COMMIT') ||
      sqlUpper.startsWith('ROLLBACK')
    ) {
      return { rows: [] };
    }

    return { rows: [] };
  }

  close(): void {
    this.data.clear();
  }

  private keyToString(key: Uint8Array): string {
    return new TextDecoder().decode(key);
  }
}

describe('SqliteLevel', () => {
  let db: SqliteLevel<string, string>;
  let adapter: InMemorySqliteAdapter;

  beforeEach(async () => {
    adapter = new InMemorySqliteAdapter();
    db = new SqliteLevel('test');
    db.setAdapterFactory(() => Promise.resolve(adapter));
    await db.open();
  });

  afterEach(async () => {
    if (db.status === 'open') {
      await db.close();
    }
  });

  describe('basic operations', () => {
    it('puts and gets a value', async () => {
      await db.put('key1', 'value1');
      const value = await db.get('key1');
      expect(value).toBe('value1');
    });

    it('returns undefined for missing key', async () => {
      const value = await db.get('nonexistent');
      expect(value).toBeUndefined();
    });

    it('deletes a value', async () => {
      await db.put('key1', 'value1');
      await db.del('key1');
      const value = await db.get('key1');
      expect(value).toBeUndefined();
    });

    it('overwrites existing value', async () => {
      await db.put('key1', 'value1');
      await db.put('key1', 'value2');
      const value = await db.get('key1');
      expect(value).toBe('value2');
    });
  });

  describe('batch operations', () => {
    it('executes multiple puts in batch', async () => {
      await db.batch([
        { type: 'put', key: 'a', value: '1' },
        { type: 'put', key: 'b', value: '2' },
        { type: 'put', key: 'c', value: '3' },
      ]);

      expect(await db.get('a')).toBe('1');
      expect(await db.get('b')).toBe('2');
      expect(await db.get('c')).toBe('3');
    });

    it('executes mixed put and del in batch', async () => {
      await db.put('key1', 'value1');
      await db.put('key2', 'value2');

      await db.batch([
        { type: 'put', key: 'key3', value: 'value3' },
        { type: 'del', key: 'key1' },
      ]);

      expect(await db.get('key1')).toBeUndefined();
      expect(await db.get('key2')).toBe('value2');
      expect(await db.get('key3')).toBe('value3');
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      await db.put('a', '1');
      await db.put('b', '2');
      await db.clear();

      expect(await db.get('a')).toBeUndefined();
      expect(await db.get('b')).toBeUndefined();
    });
  });

  describe('iteration', () => {
    it('iterates over all entries', async () => {
      await db.put('c', '3');
      await db.put('a', '1');
      await db.put('b', '2');

      const entries: [string, string][] = [];
      for await (const [key, value] of db.iterator()) {
        entries.push([key, value]);
      }

      // Should be sorted by key
      expect(entries).toEqual([
        ['a', '1'],
        ['b', '2'],
        ['c', '3'],
      ]);
    });

    it('iterates over keys only', async () => {
      await db.put('c', '3');
      await db.put('a', '1');

      const keys: string[] = [];
      for await (const key of db.keys()) {
        keys.push(key);
      }

      expect(keys).toEqual(['a', 'c']);
    });

    it('iterates over values only', async () => {
      await db.put('a', '1');
      await db.put('b', '2');

      const values: string[] = [];
      for await (const value of db.values()) {
        values.push(value);
      }

      expect(values).toEqual(['1', '2']);
    });
  });

  describe('lifecycle', () => {
    it('throws when operating on closed database', async () => {
      await db.close();

      await expect(db.get('key')).rejects.toThrow();
    });

    it('throws when no adapter is configured', async () => {
      const newDb = new SqliteLevel('test2');
      await expect(newDb.open()).rejects.toThrow();
    });
  });
});
