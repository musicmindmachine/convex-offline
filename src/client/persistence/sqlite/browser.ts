import { initSchema, createPersistenceFromExecutor, type Executor } from "./schema.js";
import type { Persistence } from "../types.js";

interface ExecResult {
  type: string;
  dbId?: string;
  result?: {
    filename?: string;
    resultRows?: Record<string, unknown>[];
  };
}

type PromiserFn = (cmd: string, args?: Record<string, unknown>) => Promise<ExecResult>;

class SqliteWasmExecutor implements Executor {
  constructor(
    private promiser: PromiserFn,
    private dbId: string,
  ) {}

  async execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const response = await this.promiser("exec", {
      dbId: this.dbId,
      sql,
      bind: params,
      returnValue: "resultRows",
      rowMode: "object",
    });

    const rows = response.result?.resultRows ?? [];
    return { rows };
  }

  close(): void {
    void this.promiser("close", { dbId: this.dbId });
  }
}

async function initPromiser(module: unknown): Promise<PromiserFn> {
  const m = module as { sqlite3Worker1Promiser: (config: { onready: () => void }) => PromiserFn };
  return new Promise((resolve) => {
    const promiser = m.sqlite3Worker1Promiser({
      onready: () => resolve(promiser),
    });
  });
}

async function openDatabase(promiser: PromiserFn, dbName: string): Promise<string> {
  try {
    const response = await promiser("open", {
      filename: `file:${dbName}.sqlite3?vfs=opfs`,
    });
    if (response.dbId) {
      return response.dbId;
    }
  }
  catch (_) {
    void _;
  }

  const response = await promiser("open", { filename: `:memory:` });
  if (!response.dbId) {
    throw new Error("Failed to open SQLite database");
  }
  return response.dbId;
}

export async function createBrowserSqlitePersistence(
  module: unknown,
  dbName: string,
): Promise<Persistence> {
  const promiser = await initPromiser(module);
  const dbId = await openDatabase(promiser, dbName);
  const executor = new SqliteWasmExecutor(promiser, dbId);

  await initSchema(executor);

  return createPersistenceFromExecutor(executor);
}
