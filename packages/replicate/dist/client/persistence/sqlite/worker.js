import "yjs";

//#region src/client/persistence/sqlite/schema.ts
async function initSchema(executor) {
	await executor.execute(`
    CREATE TABLE IF NOT EXISTS snapshots (
      collection TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      state_vector BLOB,
      seq INTEGER DEFAULT 0
    )
  `);
	await executor.execute(`
    CREATE TABLE IF NOT EXISTS deltas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection TEXT NOT NULL,
      data BLOB NOT NULL
    )
  `);
	await executor.execute(`
    CREATE INDEX IF NOT EXISTS deltas_collection_idx ON deltas (collection)
  `);
	await executor.execute(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

//#endregion
//#region src/client/persistence/sqlite/worker.ts
const CDN_BASE = "https://wa-sqlite.robelest.com/v1.0.0";
const INIT = 0;
const EXECUTE = 1;
const CLOSE = 2;
const FLUSH = 3;
let sqlite3;
let db;
let vfs;
let mutex = Promise.resolve();
async function init(name) {
	const [{ default: SQLiteESMFactory }, { IDBBatchAtomicVFS }, SQLite] = await Promise.all([
		import(
			/* @vite-ignore */
			`${CDN_BASE}/dist/wa-sqlite-async.mjs`
),
		import(
			/* @vite-ignore */
			`${CDN_BASE}/src/examples/IDBBatchAtomicVFS.js`
),
		import(
			/* @vite-ignore */
			`${CDN_BASE}/src/sqlite-api.js`
)
	]);
	const module = await SQLiteESMFactory({ locateFile: (file) => `${CDN_BASE}/dist/${file}` });
	sqlite3 = SQLite.Factory(module);
	vfs = await IDBBatchAtomicVFS.create(name, module);
	sqlite3.vfs_register(vfs, true);
	db = await sqlite3.open_v2(name);
	await sqlite3.exec(db, "PRAGMA cache_size = -8000;");
	await sqlite3.exec(db, "PRAGMA synchronous = NORMAL;");
	await sqlite3.exec(db, "PRAGMA temp_store = MEMORY;");
	await initSchema({
		async execute(sql, params) {
			return execute(sql, params);
		},
		close() {
			sqlite3.close(db);
			vfs.close();
		}
	});
}
function execute(sql, params) {
	const operation = mutex.catch(() => {}).then(async () => {
		const rows = [];
		for await (const stmt of sqlite3.statements(db, sql)) {
			if (params && params.length > 0) sqlite3.bind_collection(stmt, params);
			const columns = sqlite3.column_names(stmt);
			while (await sqlite3.step(stmt) === 100) {
				const row = sqlite3.row(stmt);
				const obj = {};
				columns.forEach((col, i) => {
					obj[col] = row[i];
				});
				rows.push(obj);
			}
		}
		return { rows };
	});
	mutex = operation;
	return operation;
}
self.onmessage = async (e) => {
	const { id, type, name, sql, params } = e.data;
	try {
		switch (type) {
			case INIT:
				await init(name);
				self.postMessage({
					id,
					ok: true
				});
				break;
			case EXECUTE:
				const result = await execute(sql, params);
				self.postMessage({
					id,
					ok: true,
					rows: result.rows
				});
				break;
			case FLUSH:
				self.postMessage({
					id,
					ok: true
				});
				break;
			case CLOSE:
				sqlite3.close(db);
				vfs.close();
				self.postMessage({
					id,
					ok: true
				});
				break;
		}
	} catch (error) {
		self.postMessage({
			id,
			ok: false,
			error: String(error)
		});
	}
};

//#endregion