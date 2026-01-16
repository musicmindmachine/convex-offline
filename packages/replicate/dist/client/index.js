import * as Y from "yjs";
import { getFunctionName } from "convex/server";
import { createCollection } from "@tanstack/db";
import { getLogger as getLogger$1 } from "@logtape/logtape";
import { Awareness } from "y-protocols/awareness";

//#region src/client/migration.ts
/**
* Get the current schema version from SQLite.
*/
async function getStoredSchemaVersion(db, collection$1) {
	try {
		return (await db.get(`SELECT version FROM __replicate_schema WHERE collection = ?`, [collection$1]))?.version ?? null;
	} catch {
		return null;
	}
}
/**
* Store the current schema version in SQLite.
*/
async function setStoredSchemaVersion(db, collection$1, version) {
	await db.exec(`
		CREATE TABLE IF NOT EXISTS __replicate_schema (
			collection TEXT PRIMARY KEY,
			version INTEGER NOT NULL,
			migratedAt INTEGER NOT NULL
		)
	`);
	await db.run(`INSERT OR REPLACE INTO __replicate_schema (collection, version, migratedAt) VALUES (?, ?, ?)`, [
		collection$1,
		version,
		Date.now()
	]);
}
/**
* Run auto-generated SQL migration.
*/
async function runAutoMigration(db, tableName, diff) {
	for (const sql of diff.generatedSQL) {
		const resolvedSql = sql.replace(/%TABLE%/g, `"${tableName}"`);
		await db.exec(resolvedSql);
	}
}
/**
* Create a migration error.
*/
function createMigrationError(code, message, fromVersion, toVersion, operation) {
	return {
		code,
		message,
		fromVersion,
		toVersion,
		operation
	};
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
async function runMigrations(options) {
	const { collection: collection$1, schema: schema$1, db, clientMigrations, onError, getYDoc, listDocuments } = options;
	const targetVersion = schema$1.version;
	const storedVersion = await getStoredSchemaVersion(db, collection$1);
	if (storedVersion === null) {
		await setStoredSchemaVersion(db, collection$1, targetVersion);
		return {
			migrated: false,
			fromVersion: null,
			toVersion: targetVersion,
			diff: null
		};
	}
	if (storedVersion === targetVersion) return {
		migrated: false,
		fromVersion: storedVersion,
		toVersion: targetVersion,
		diff: null
	};
	let diff;
	try {
		diff = schema$1.diff(storedVersion, targetVersion);
	} catch (err) {
		const error = createMigrationError("SCHEMA_MISMATCH", `Failed to compute schema diff: ${err instanceof Error ? err.message : String(err)}`, storedVersion, targetVersion);
		if (onError) {
			if ((await handleMigrationError(error, db, collection$1, onError)).action === "keep-old-schema") return {
				migrated: false,
				fromVersion: storedVersion,
				toVersion: storedVersion,
				diff: null,
				error
			};
		}
		throw err;
	}
	try {
		const customMigration = clientMigrations?.[targetVersion];
		if (customMigration) await customMigration(db, {
			dirtyDocs: (listDocuments ? await listDocuments() : []).map((id) => ({
				id,
				fields: /* @__PURE__ */ new Map()
			})),
			getYDoc: getYDoc ?? (() => null),
			diff
		});
		else await runAutoMigration(db, collection$1, diff);
		await setStoredSchemaVersion(db, collection$1, targetVersion);
		return {
			migrated: true,
			fromVersion: storedVersion,
			toVersion: targetVersion,
			diff
		};
	} catch (err) {
		const error = createMigrationError("SQLITE_ERROR", `Migration failed: ${err instanceof Error ? err.message : String(err)}`, storedVersion, targetVersion);
		if (onError) {
			const recovery = await handleMigrationError(error, db, collection$1, onError);
			if (recovery.action === "keep-old-schema") return {
				migrated: false,
				fromVersion: storedVersion,
				toVersion: storedVersion,
				diff: null,
				error
			};
			if (recovery.action === "reset") {
				await clearCollectionData(db, collection$1);
				await setStoredSchemaVersion(db, collection$1, targetVersion);
				return {
					migrated: true,
					fromVersion: storedVersion,
					toVersion: targetVersion,
					diff,
					error
				};
			}
			if (recovery.action === "custom" && recovery.handler) {
				await recovery.handler();
				return {
					migrated: true,
					fromVersion: storedVersion,
					toVersion: targetVersion,
					diff
				};
			}
		}
		throw err;
	}
}
/**
* Handle migration error by calling user's error handler.
*/
async function handleMigrationError(error, db, collection$1, onError) {
	let pendingChanges = 0;
	try {
		pendingChanges = (await db.get(`SELECT COUNT(*) as count FROM deltas WHERE collection LIKE ?`, [`${collection$1}:%`]))?.count ?? 0;
	} catch {}
	let lastSyncedAt = null;
	try {
		const result = await db.get(`SELECT value FROM kv WHERE key = ?`, [`lastSync:${collection$1}`]);
		if (result?.value) {
			const timestamp = JSON.parse(result.value);
			lastSyncedAt = new Date(timestamp);
		}
	} catch {}
	return onError(error, {
		error,
		canResetSafely: pendingChanges === 0,
		pendingChanges,
		lastSyncedAt
	});
}
/**
* Clear all data for a collection (used by reset recovery action).
*/
async function clearCollectionData(db, collection$1) {
	await db.run(`DELETE FROM snapshots WHERE collection LIKE ?`, [`${collection$1}:%`]);
	await db.run(`DELETE FROM deltas WHERE collection LIKE ?`, [`${collection$1}:%`]);
	await db.run(`DELETE FROM kv WHERE key LIKE ?`, [`cursor:${collection$1}%`]);
}

//#endregion
//#region src/client/validators.ts
function isProseValidator(validator) {
	const v = validator;
	if (v.kind !== "object" || !v.fields) return false;
	const { type, content } = v.fields;
	if (!type || type.kind !== "literal" || type.value !== "doc") return false;
	if (!content) return false;
	return (content.isOptional === "optional" ? content : content).kind === "array" || content.kind === "object" && !!content.fields;
}
function findProseFields(validator) {
	const v = validator;
	if (v.kind !== "object" || !v.fields) return [];
	const proseFields = [];
	for (const [fieldName, fieldValidator] of Object.entries(v.fields)) if (isProseValidator(fieldValidator)) proseFields.push(fieldName);
	return proseFields;
}
function emptyProse() {
	return {
		type: "doc",
		content: []
	};
}

//#endregion
//#region src/client/errors.ts
var NetworkError = class extends Error {
	constructor(props) {
		super(`Network error during ${props.operation}`);
		this._tag = "NetworkError";
		this.retryable = true;
		this.name = "NetworkError";
		this.operation = props.operation;
		this.cause = props.cause;
	}
};
var IDBError = class extends Error {
	constructor(props) {
		super(`IDB ${props.operation} error${props.key ? ` for key ${props.key}` : ""}`);
		this._tag = "IDBError";
		this.name = "IDBError";
		this.operation = props.operation;
		this.cause = props.cause;
		this.store = props.store;
		this.key = props.key;
	}
};
var IDBWriteError = class extends Error {
	constructor(props) {
		super(`IDB write error for key ${props.key}`);
		this._tag = "IDBWriteError";
		this.name = "IDBWriteError";
		this.key = props.key;
		this.value = props.value;
		this.cause = props.cause;
	}
};
var ReconciliationError = class extends Error {
	constructor(props) {
		super(`Reconciliation error in ${props.collection}: ${props.reason}`);
		this._tag = "ReconciliationError";
		this.name = "ReconciliationError";
		this.collection = props.collection;
		this.reason = props.reason;
		this.cause = props.cause;
	}
};
var ProseError = class extends Error {
	constructor(props) {
		super(`Prose error for ${props.collection}/${props.document}/${props.field}`);
		this._tag = "ProseError";
		this.name = "ProseError";
		this.document = props.document;
		this.field = props.field;
		this.collection = props.collection;
	}
};
var CollectionNotReadyError = class extends Error {
	constructor(props) {
		super(`Collection ${props.collection} not ready: ${props.reason}`);
		this._tag = "CollectionNotReadyError";
		this.name = "CollectionNotReadyError";
		this.collection = props.collection;
		this.reason = props.reason;
	}
};
/** Error that should not be retried (auth failures, validation errors) */
var NonRetriableError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "NonRetriableError";
	}
};

//#endregion
//#region src/client/services/seq.ts
function createSeqService(kv) {
	return {
		async load(collection$1) {
			const key = `cursor:${collection$1}`;
			return await kv.get(key) ?? 0;
		},
		async save(collection$1, seq) {
			const key = `cursor:${collection$1}`;
			await kv.set(key, seq);
		},
		async clear(collection$1) {
			const key = `cursor:${collection$1}`;
			await kv.del(key);
		}
	};
}

//#endregion
//#region src/client/services/session.ts
const SESSION_CLIENT_ID_KEY = "replicate:sessionClientId";
let cachedSessionClientId = null;
function generateSessionClientId() {
	if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
	return String(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
}
async function getClientId(kv) {
	if (cachedSessionClientId) return cachedSessionClientId;
	const stored = await kv.get(SESSION_CLIENT_ID_KEY);
	if (stored) {
		cachedSessionClientId = stored;
		return stored;
	}
	const newId = generateSessionClientId();
	cachedSessionClientId = newId;
	await kv.set(SESSION_CLIENT_ID_KEY, newId);
	return newId;
}

//#endregion
//#region src/client/ops.ts
/**
* Create bound replicate operations for a collection.
* Returns functions that are already tied to the collection's params.
* This is the proper way to handle multiple concurrent collections.
*
* @example
* ```typescript
* const ops = createReplicateOps<Task>(params);
* ops.replace(items);  // Always targets THIS collection's TanStack DB
* ops.upsert([item]);
* ops.delete([item]);
* ```
*/
function createReplicateOps(params) {
	return {
		insert(items) {
			params.begin();
			for (const item of items) params.write({
				type: "insert",
				value: item
			});
			params.commit();
		},
		delete(items) {
			params.begin();
			for (const item of items) params.write({
				type: "delete",
				value: item
			});
			params.commit();
		},
		upsert(items) {
			params.begin();
			for (const item of items) params.write({
				type: "update",
				value: item
			});
			params.commit();
		},
		replace(items) {
			params.begin();
			params.truncate();
			for (const item of items) params.write({
				type: "insert",
				value: item
			});
			params.commit();
		}
	};
}

//#endregion
//#region src/client/merge.ts
/**
* Merge Helpers - Plain functions for Yjs CRDT operations
*
* Provides state encoding and merge operations.
*/
/**
* Check if a value is a Yjs AbstractType by checking internal properties.
* All Yjs types (Y.Map, Y.Array, Y.Text, Y.XmlFragment, etc.) extend AbstractType
* and have these properties regardless of which module instance created them.
*/
function isYjsAbstractType(value) {
	if (value === null || typeof value !== "object") return false;
	const v = value;
	return "_map" in v && "_eH" in v && "doc" in v;
}
/**
* Check if a value is a Y.Map.
* Y.Map has keys() method which Y.XmlFragment does not.
*/
function isYMap(value) {
	if (!isYjsAbstractType(value)) return false;
	const v = value;
	return typeof v.keys === "function" && typeof v.get === "function";
}
/**
* Check if a value is a Y.Array (has toArray but not get - distinguishes from Y.Map).
*/
function isYArray(value) {
	if (!isYjsAbstractType(value)) return false;
	const v = value;
	return typeof v.toArray === "function" && typeof v.get !== "function";
}
/**
* Check if a value is a Y.XmlFragment or Y.XmlElement.
* XmlFragment has toArray() and get(index), but NOT keys() like Y.Map.
*/
function isYXmlFragment(value) {
	if (!isYjsAbstractType(value)) return false;
	const v = value;
	return typeof v.toArray === "function" && typeof v.keys !== "function";
}
/**
* Recursively serialize a Yjs value to plain JavaScript.
* Handles Y.Map, Y.Array, Y.XmlFragment without using instanceof.
*/
function serialize(value) {
	if (value === null || value === void 0) return value;
	if (typeof value !== "object") return value;
	if (isYXmlFragment(value)) return fragmentToJSON(value);
	if (isYMap(value)) {
		const result = {};
		value.forEach((v, k) => {
			result[k] = serialize(v);
		});
		return result;
	}
	if (isYArray(value)) return value.toArray().map(serialize);
	return value;
}
/**
* Check if a value looks like ProseMirror/BlockNote JSON document.
* Used internally to auto-detect prose fields during insert/update.
*/
function isDoc(value) {
	return typeof value === "object" && value !== null && "type" in value && value.type === "doc";
}
/**
* Convert a Y.XmlFragment to ProseMirror-compatible JSON.
*/
function fragmentToJSON(fragment) {
	const content = [];
	for (const child of fragment.toArray()) if (child instanceof Y.XmlElement) content.push(xmlElementToJSON(child));
	else if (child instanceof Y.XmlText) {
		const textContent = xmlTextToJSON(child);
		if (textContent.length > 0) content.push({
			type: "paragraph",
			content: textContent
		});
	}
	return {
		type: "doc",
		content: content.length > 0 ? content : [{ type: "paragraph" }]
	};
}
function xmlElementToJSON(element) {
	const result = { type: element.nodeName };
	const attrs = element.getAttributes();
	if (Object.keys(attrs).length > 0) result.attrs = attrs;
	const content = [];
	for (const child of element.toArray()) if (child instanceof Y.XmlElement) content.push(xmlElementToJSON(child));
	else if (child instanceof Y.XmlText) content.push(...xmlTextToJSON(child));
	if (content.length > 0) result.content = content;
	return result;
}
function xmlTextToJSON(text) {
	const result = [];
	const delta = text.toDelta();
	for (const op of delta) if (typeof op.insert === "string") {
		const node = {
			type: "text",
			text: op.insert
		};
		if (op.attributes && Object.keys(op.attributes).length > 0) node.marks = Object.entries(op.attributes).map(([type, attrs]) => ({
			type,
			attrs: typeof attrs === "object" ? attrs : void 0
		}));
		result.push(node);
	}
	return result;
}
/**
* Initialize a Y.XmlFragment from ProseMirror-compatible JSON.
*/
function fragmentFromJSON(fragment, json) {
	if (!json.content) return;
	for (const node of json.content) appendNodeToFragment(fragment, node);
}
/**
* Extract plain text from ProseMirror/BlockNote JSON content.
* Handles various content structures defensively for search and display.
*/
function extract(content) {
	if (!content || typeof content !== "object") return "";
	const doc = content;
	if (!doc.content || !Array.isArray(doc.content)) return "";
	return doc.content.map((block) => {
		if (!block.content || !Array.isArray(block.content)) return "";
		return block.content.map((node) => node.text || "").join("");
	}).join(" ");
}
function appendNodeToFragment(parent, node) {
	if (node.type === "text") {
		const text = new Y.XmlText();
		if (node.text) {
			const attrs = {};
			if (node.marks) for (const mark of node.marks) attrs[mark.type] = mark.attrs ?? true;
			text.insert(0, node.text, Object.keys(attrs).length > 0 ? attrs : void 0);
		}
		parent.insert(parent.length, [text]);
	} else {
		const element = new Y.XmlElement(node.type);
		if (node.attrs) for (const [key, value] of Object.entries(node.attrs)) element.setAttribute(key, value);
		if (node.content) for (const child of node.content) appendNodeToFragment(element, child);
		parent.insert(parent.length, [element]);
	}
}
/**
* Serialize any value, handling Yjs types specially.
* Uses our custom serialization system that works across module instances.
*/
function serializeYMapValue(value) {
	return serialize(value);
}

//#endregion
//#region src/client/documents.ts
function createDocumentManager(collection$1) {
	const docs = /* @__PURE__ */ new Map();
	const persistence$1 = /* @__PURE__ */ new Map();
	let persistenceFactory = null;
	const makeGuid = (id) => `${collection$1}:${id}`;
	return {
		collection: collection$1,
		get(id) {
			return docs.get(id);
		},
		getOrCreate(id) {
			let doc = docs.get(id);
			if (!doc) {
				doc = new Y.Doc({ guid: makeGuid(id) });
				docs.set(id, doc);
				if (persistenceFactory && !persistence$1.has(id)) {
					const provider = persistenceFactory(id, doc);
					persistence$1.set(id, provider);
				}
			}
			return doc;
		},
		has(id) {
			return docs.has(id);
		},
		delete(id) {
			const doc = docs.get(id);
			if (doc) {
				doc.destroy();
				docs.delete(id);
			}
			const provider = persistence$1.get(id);
			if (provider) {
				provider.destroy();
				persistence$1.delete(id);
			}
		},
		getFields(id) {
			const doc = docs.get(id);
			return doc ? doc.getMap("fields") : null;
		},
		getFragment(id, field) {
			const fields = this.getFields(id);
			if (!fields) return null;
			const value = fields.get(field);
			if (value instanceof Y.XmlFragment) return value;
			return null;
		},
		applyUpdate(id, update, origin) {
			const doc = this.getOrCreate(id);
			Y.applyUpdateV2(doc, update, origin);
		},
		encodeState(id) {
			const doc = docs.get(id);
			return doc ? Y.encodeStateAsUpdateV2(doc) : new Uint8Array();
		},
		encodeStateVector(id) {
			const doc = docs.get(id);
			if (!doc) {
				const emptyDoc = new Y.Doc();
				const vector = Y.encodeStateVector(emptyDoc);
				emptyDoc.destroy();
				return vector;
			}
			return Y.encodeStateVector(doc);
		},
		transactWithDelta(id, fn, origin) {
			const doc = this.getOrCreate(id);
			const fields = doc.getMap("fields");
			const beforeVector = Y.encodeStateVector(doc);
			doc.transact(() => fn(fields), origin);
			return Y.encodeStateAsUpdateV2(doc, beforeVector);
		},
		documents() {
			return Array.from(docs.keys());
		},
		enablePersistence(factory) {
			const promises = [];
			for (const [id, doc] of docs.entries()) if (!persistence$1.has(id)) {
				const provider = factory(id, doc);
				persistence$1.set(id, provider);
				promises.push(provider.whenSynced);
			}
			persistenceFactory = factory;
			return promises;
		},
		destroy() {
			for (const provider of persistence$1.values()) provider.destroy();
			persistence$1.clear();
			for (const doc of docs.values()) doc.destroy();
			docs.clear();
		}
	};
}
function serializeDocument(manager, id) {
	const fields = manager.getFields(id);
	if (!fields) return null;
	const result = { id };
	fields.forEach((value, key) => {
		if (value instanceof Y.XmlFragment) result[key] = fragmentToJSON(value);
		else if (value instanceof Y.Map) result[key] = value.toJSON();
		else if (value instanceof Y.Array) result[key] = value.toJSON();
		else result[key] = value;
	});
	return result;
}
function isDocumentDeleted(manager, id) {
	const doc = manager.get(id);
	if (!doc) return false;
	return doc.getMap("_meta").get("_deleted") === true;
}
function extractAllDocuments(manager) {
	const documents = [];
	for (const id of manager.documents()) {
		if (isDocumentDeleted(manager, id)) continue;
		const doc = serializeDocument(manager, id);
		if (doc) documents.push(doc);
	}
	return documents;
}

//#endregion
//#region src/client/deltas.ts
function createDeleteDelta() {
	const doc = new Y.Doc();
	const meta = doc.getMap("_meta");
	doc.transact(() => {
		meta.set("_deleted", true);
		meta.set("_deletedAt", Date.now());
	});
	const update = Y.encodeStateAsUpdateV2(doc);
	doc.destroy();
	return update;
}
/**
* Apply delete marker to an EXISTING Y.Doc.
* This triggers the persistence provider's update handler,
* ensuring the delete is saved to local storage.
*/
function applyDeleteMarkerToDoc(ydoc) {
	const meta = ydoc.getMap("_meta");
	const beforeVector = Y.encodeStateVector(ydoc);
	ydoc.transact(() => {
		meta.set("_deleted", true);
		meta.set("_deletedAt", Date.now());
	});
	return Y.encodeStateAsUpdateV2(ydoc, beforeVector);
}

//#endregion
//#region src/shared/logger.ts
const PROJECT_NAME = "replicate";
function getLogger(category) {
	return getLogger$1([PROJECT_NAME, ...category]);
}

//#endregion
//#region src/client/services/context.ts
const contexts = /* @__PURE__ */ new Map();
function getContext(collection$1) {
	const ctx = contexts.get(collection$1);
	if (!ctx) throw new Error(`Collection ${collection$1} not initialized`);
	return ctx;
}
function hasContext(collection$1) {
	return contexts.has(collection$1);
}
function initContext(config) {
	let resolver;
	const synced = new Promise((r) => {
		resolver = r;
	});
	let actorResolver;
	const actorReady = new Promise((r) => {
		actorResolver = r;
	});
	const ctx = {
		...config,
		fragmentObservers: /* @__PURE__ */ new Map(),
		synced,
		resolve: resolver,
		actorReady,
		resolveActorReady: actorResolver
	};
	contexts.set(config.collection, ctx);
	return ctx;
}
function deleteContext(collection$1) {
	const ctx = contexts.get(collection$1);
	if (ctx) {
		for (const [, cleanupFn] of ctx.fragmentObservers) try {
			cleanupFn();
		} catch {}
		ctx.fragmentObservers.clear();
		if (ctx.cleanup) try {
			ctx.cleanup();
		} catch {}
	}
	contexts.delete(collection$1);
}
function updateContext(collection$1, updates) {
	const ctx = getContext(collection$1);
	Object.assign(ctx, updates);
	return ctx;
}

//#endregion
//#region src/client/services/sync.ts
const logger$2 = getLogger(["replicate", "sync"]);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1e3;
function createDocumentSync(documentId, ydoc, syncFn, debounceMs = 50) {
	let timeoutId = null;
	let retryTimeoutId = null;
	let pending = false;
	let destroyed = false;
	let retryCount = 0;
	const pendingListeners = /* @__PURE__ */ new Set();
	const setPending = (value) => {
		if (pending !== value) {
			pending = value;
			pendingListeners.forEach((cb) => cb(value));
		}
	};
	const performSync = async () => {
		if (destroyed) return;
		if (!ydoc || ydoc.destroyed) {
			logger$2.error("Cannot sync - Y.Doc is destroyed", { documentId });
			setPending(false);
			return;
		}
		try {
			await syncFn();
			retryCount = 0;
			setPending(false);
		} catch (error) {
			logger$2.error("Sync failed", {
				documentId,
				error: error instanceof Error ? error.message : String(error),
				retryCount
			});
			if (retryCount < MAX_RETRIES) {
				retryCount++;
				const delay = RETRY_DELAY_MS * retryCount;
				logger$2.debug("Scheduling retry", {
					documentId,
					retryCount,
					delayMs: delay
				});
				retryTimeoutId = setTimeout(performSync, delay);
			} else {
				logger$2.warn("Sync retries exhausted, will retry on next change", { documentId });
				setPending(false);
				retryCount = 0;
			}
		}
	};
	return {
		onLocalChange() {
			if (destroyed) return;
			if (timeoutId) clearTimeout(timeoutId);
			if (retryTimeoutId) clearTimeout(retryTimeoutId);
			retryCount = 0;
			setPending(true);
			timeoutId = setTimeout(performSync, debounceMs);
		},
		onServerUpdate() {},
		isPending() {
			return pending;
		},
		onPendingChange(callback) {
			pendingListeners.add(callback);
			return () => pendingListeners.delete(callback);
		},
		destroy() {
			destroyed = true;
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			if (retryTimeoutId) {
				clearTimeout(retryTimeoutId);
				retryTimeoutId = null;
			}
			pendingListeners.clear();
		}
	};
}
const collectionSyncs = /* @__PURE__ */ new Map();
function getSyncsForCollection(collection$1) {
	let syncs = collectionSyncs.get(collection$1);
	if (!syncs) {
		syncs = /* @__PURE__ */ new Map();
		collectionSyncs.set(collection$1, syncs);
	}
	return syncs;
}
function createSyncManager(collection$1) {
	const syncs = getSyncsForCollection(collection$1);
	return {
		register(documentId, ydoc, syncFn, debounceMs) {
			const existing = syncs.get(documentId);
			if (existing) return existing;
			const sync = createDocumentSync(documentId, ydoc, syncFn, debounceMs);
			syncs.set(documentId, sync);
			logger$2.debug("Sync registered", {
				collection: collection$1,
				documentId
			});
			return sync;
		},
		get(documentId) {
			return syncs.get(documentId) ?? null;
		},
		unregister(documentId) {
			const sync = syncs.get(documentId);
			if (sync) {
				sync.destroy();
				syncs.delete(documentId);
				logger$2.debug("Sync unregistered", {
					collection: collection$1,
					documentId
				});
			}
		},
		destroy() {
			for (const [, sync] of syncs) sync.destroy();
			syncs.clear();
			collectionSyncs.delete(collection$1);
			logger$2.debug("Sync manager destroyed", { collection: collection$1 });
		}
	};
}

//#endregion
//#region src/client/prose.ts
const SERVER_ORIGIN = "server";
const noop = () => void 0;
const logger$1 = getLogger(["replicate", "prose"]);
const syncManagers = /* @__PURE__ */ new Map();
function getSyncManager(collection$1) {
	let manager = syncManagers.get(collection$1);
	if (!manager) {
		manager = createSyncManager(collection$1);
		syncManagers.set(collection$1, manager);
	}
	return manager;
}
function createSyncFn(document, ydoc, ymap, collectionRef) {
	return async () => {
		const material = serializeYMapValue(ymap);
		const bytes = Y.encodeStateAsUpdateV2(ydoc).buffer;
		collectionRef.update(document, { metadata: { contentSync: {
			bytes,
			material
		} } }, (draft) => {
			draft.timestamp = Date.now();
		});
	};
}
function observeFragment(config) {
	const { collection: collection$1, document, field, fragment, ydoc, ymap, collectionRef, debounceMs } = config;
	if (!hasContext(collection$1)) {
		logger$1.warn("Cannot observe fragment - collection not initialized", {
			collection: collection$1,
			document
		});
		return noop;
	}
	const ctx = getContext(collection$1);
	const existingCleanup = ctx.fragmentObservers.get(document);
	if (existingCleanup) {
		logger$1.debug("Fragment already being observed", {
			collection: collection$1,
			document,
			field
		});
		return existingCleanup;
	}
	const syncFn = createSyncFn(document, ydoc, ymap, collectionRef);
	const syncManager = getSyncManager(collection$1);
	const sync = syncManager.register(document, ydoc, syncFn, debounceMs);
	logger$1.debug("Fragment observer registered", {
		collection: collection$1,
		document,
		field
	});
	const observerHandler = (_events, transaction) => {
		if (transaction.origin === SERVER_ORIGIN) return;
		sync.onLocalChange();
	};
	fragment.observeDeep(observerHandler);
	const cleanup$1 = () => {
		fragment.unobserveDeep(observerHandler);
		syncManager.unregister(document);
		ctx.fragmentObservers.delete(document);
		logger$1.debug("Fragment observer cleaned up", {
			collection: collection$1,
			document,
			field
		});
	};
	ctx.fragmentObservers.set(document, cleanup$1);
	return cleanup$1;
}
function isPending(collection$1, document) {
	const syncManager = syncManagers.get(collection$1);
	if (!syncManager) return false;
	return syncManager.get(document)?.isPending() ?? false;
}
function subscribePending(collection$1, document, callback) {
	const syncManager = syncManagers.get(collection$1);
	if (!syncManager) return noop;
	const sync = syncManager.get(document);
	if (!sync) return noop;
	return sync.onPendingChange(callback);
}
function cleanup(collection$1) {
	const syncManager = syncManagers.get(collection$1);
	if (syncManager) {
		syncManager.destroy();
		syncManagers.delete(collection$1);
	}
	if (!hasContext(collection$1)) return;
	const ctx = getContext(collection$1);
	for (const [, cleanupFn] of ctx.fragmentObservers) cleanupFn();
	ctx.fragmentObservers.clear();
	logger$1.debug("Prose cleanup complete", { collection: collection$1 });
}

//#endregion
//#region src/client/services/presence.ts
const DEFAULT_HEARTBEAT_MS = 1e4;
const DEFAULT_THROTTLE_MS = 50;
const DEFAULT_ADJECTIVES = [
	"Swift",
	"Bright",
	"Calm",
	"Bold",
	"Keen",
	"Quick",
	"Warm",
	"Cool",
	"Sharp",
	"Gentle"
];
const DEFAULT_NOUNS = [
	"Fox",
	"Owl",
	"Bear",
	"Wolf",
	"Hawk",
	"Deer",
	"Lynx",
	"Crow",
	"Hare",
	"Seal"
];
const DEFAULT_COLORS = [
	"#9F5944",
	"#A9704D",
	"#B08650",
	"#8A7D3F",
	"#6E7644",
	"#8C4A42",
	"#9E7656",
	"#9A5240",
	"#987C4A",
	"#7A8B6E"
];
function hashStringToNumber(str) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return Math.abs(hash);
}
function getStableAnonName(clientId, config) {
	const adjectives = config?.adjectives ?? DEFAULT_ADJECTIVES;
	const nouns = config?.nouns ?? DEFAULT_NOUNS;
	const hash = hashStringToNumber(clientId);
	return `${adjectives[hash % adjectives.length]} ${nouns[(hash >> 4) % nouns.length]}`;
}
function getStableAnonColor(clientId, config) {
	const colors = config?.colors ?? DEFAULT_COLORS;
	return colors[(hashStringToNumber(clientId) >> 8) % colors.length];
}
function createPresence(config) {
	const { convexClient, api, document, client, ydoc, heartbeatMs = DEFAULT_HEARTBEAT_MS, throttleMs = DEFAULT_THROTTLE_MS, syncReady, user: userGetter, anonymousPresence } = config;
	const awareness = new Awareness(ydoc);
	const resolvedUser = userGetter?.();
	if (resolvedUser) awareness.setLocalStateField("user", resolvedUser);
	let state = "idle";
	let visible = true;
	let heartbeatTimer = null;
	let throttleTimer = null;
	let startTimeout = null;
	let unsubscribeCursors;
	let unsubscribeVisibility;
	let unsubscribePageHide;
	const flightStatus = {
		inFlight: false,
		pending: null
	};
	const remoteClientIds = /* @__PURE__ */ new Map();
	const subscribers = /* @__PURE__ */ new Set();
	const getVector = () => {
		return Y.encodeStateVector(ydoc).buffer;
	};
	const extractCursorFromState = (awarenessState) => {
		if (!awarenessState) return void 0;
		const cursor = awarenessState.cursor;
		if (cursor?.anchor === void 0 || cursor.head === void 0) return;
		try {
			return {
				anchor: JSON.parse(JSON.stringify(cursor.anchor)),
				head: JSON.parse(JSON.stringify(cursor.head))
			};
		} catch {
			return;
		}
	};
	const extractUserFromState = (awarenessState) => {
		if (!awarenessState) return {};
		const userState = awarenessState.user;
		if (userState) {
			const result = {};
			if (typeof userState.id === "string") result.user = userState.id;
			const profile = {};
			if (typeof userState.name === "string") profile.name = userState.name;
			if (typeof userState.color === "string") profile.color = userState.color;
			if (typeof userState.avatar === "string") profile.avatar = userState.avatar;
			if (Object.keys(profile).length > 0) result.profile = profile;
			return result;
		}
		return {};
	};
	const buildJoinPayload = (cursorOverride) => {
		const localState = awareness.getLocalState();
		const cursor = cursorOverride ?? extractCursorFromState(localState);
		const { user: userId, profile } = extractUserFromState(localState);
		return {
			action: "join",
			cursor,
			user: userId,
			profile,
			vector: getVector()
		};
	};
	const executePresence = async (payload) => {
		await convexClient.mutation(api.presence, {
			document,
			client,
			action: payload.action,
			cursor: payload.cursor,
			user: payload.user,
			profile: payload.profile,
			interval: payload.action === "join" ? heartbeatMs : void 0,
			vector: payload.vector
		});
	};
	const isDestroyed = () => state === "destroyed";
	const sendWithSingleFlight = async (payload) => {
		if (isDestroyed()) return;
		if (flightStatus.inFlight) {
			flightStatus.pending = payload;
			return;
		}
		flightStatus.inFlight = true;
		try {
			await executePresence(payload);
		} finally {
			while (flightStatus.pending && !isDestroyed()) {
				const next = flightStatus.pending;
				flightStatus.pending = null;
				try {
					await executePresence(next);
				} catch {
					break;
				}
			}
			flightStatus.inFlight = false;
		}
	};
	const transitionTo = (newState) => {
		if (!{
			idle: ["joining", "destroyed"],
			joining: [
				"active",
				"leaving",
				"destroyed"
			],
			active: ["leaving", "destroyed"],
			leaving: [
				"idle",
				"joining",
				"destroyed"
			],
			destroyed: []
		}[state].includes(newState)) return false;
		state = newState;
		return true;
	};
	const notifySubscribers = () => {
		const presenceState = getPresenceState();
		subscribers.forEach((cb) => cb(presenceState));
	};
	const getPresenceState = () => {
		const localUser = awareness.getLocalState()?.user;
		const remote = [];
		for (const [clientStr] of remoteClientIds) {
			const clientId = remoteClientIds.get(clientStr);
			if (clientId !== void 0) {
				const remoteState = awareness.states.get(clientId);
				if (remoteState?.user) remote.push(remoteState.user);
			}
		}
		return {
			local: localUser ?? null,
			remote
		};
	};
	const joinPresence = (cursorOverride) => {
		if (state === "destroyed" || !visible) return;
		if (state === "idle" || state === "leaving") transitionTo("joining");
		sendWithSingleFlight(buildJoinPayload(cursorOverride)).then(() => {
			if (state === "joining") transitionTo("active");
		});
	};
	const leavePresence = () => {
		if (state === "destroyed") return;
		if (state === "idle") return;
		transitionTo("leaving");
		sendWithSingleFlight({ action: "leave" }).then(() => {
			if (state === "leaving") transitionTo("idle");
		});
	};
	const throttledJoin = () => {
		if (throttleTimer) return;
		if (state === "destroyed") return;
		throttleTimer = setTimeout(() => {
			throttleTimer = null;
			if (visible) joinPresence();
		}, throttleMs);
	};
	const onLocalAwarenessUpdate = (changes, origin) => {
		if (origin === "remote") return;
		if (state === "destroyed") return;
		const localClientId = awareness.clientID;
		if (changes.added.includes(localClientId) || changes.updated.includes(localClientId)) throttledJoin();
	};
	const subscribeToPresence = () => {
		unsubscribeCursors = convexClient.onUpdate(api.session, {
			document,
			connected: true,
			exclude: client
		}, (remotes) => {
			if (state === "destroyed") return;
			const validRemotes = remotes.filter((r) => r.document === document);
			const currentRemotes = /* @__PURE__ */ new Set();
			for (const remote of validRemotes) {
				currentRemotes.add(remote.client);
				let remoteClientId = remoteClientIds.get(remote.client);
				if (!remoteClientId) {
					remoteClientId = hashStringToNumber(remote.client);
					remoteClientIds.set(remote.client, remoteClientId);
				}
				const remoteState = { user: {
					id: remote.user,
					name: remote.profile?.name ?? remote.user ?? getStableAnonName(remote.client, anonymousPresence),
					color: remote.profile?.color ?? getStableAnonColor(remote.client, anonymousPresence),
					avatar: remote.profile?.avatar,
					clientId: remote.client
				} };
				if (remote.cursor) remoteState.cursor = remote.cursor;
				awareness.states.set(remoteClientId, remoteState);
			}
			for (const [clientStr, clientId] of remoteClientIds) if (!currentRemotes.has(clientStr)) {
				awareness.states.delete(clientId);
				remoteClientIds.delete(clientStr);
			}
			awareness.emit("update", [{
				added: [],
				updated: Array.from(remoteClientIds.values()),
				removed: []
			}, "remote"]);
			notifySubscribers();
		});
	};
	const setupVisibilityHandler = () => {
		if (typeof globalThis.document === "undefined") return;
		const handler = () => {
			if (state === "destroyed") return;
			const wasVisible = visible;
			visible = globalThis.document.visibilityState === "visible";
			if (wasVisible && !visible) leavePresence();
			else if (!wasVisible && visible && state === "active") joinPresence();
		};
		globalThis.document.addEventListener("visibilitychange", handler);
		unsubscribeVisibility = () => {
			globalThis.document.removeEventListener("visibilitychange", handler);
		};
	};
	const setupPageHideHandler = () => {
		if (typeof globalThis.window === "undefined") return;
		const handler = (e) => {
			if (e.persisted) return;
			if (state === "destroyed") return;
			convexClient.mutation(api.presence, {
				document,
				client,
				action: "leave"
			});
		};
		globalThis.window.addEventListener("pagehide", handler);
		unsubscribePageHide = () => {
			globalThis.window.removeEventListener("pagehide", handler);
		};
	};
	const startHeartbeat = () => {
		if (state === "destroyed") return;
		heartbeatTimer = setInterval(() => {
			if (state !== "destroyed" && visible && state === "active") joinPresence();
		}, heartbeatMs);
	};
	const stopHeartbeat = () => {
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
	};
	awareness.on("update", onLocalAwarenessUpdate);
	subscribeToPresence();
	setupVisibilityHandler();
	setupPageHideHandler();
	const initHeartbeat = async () => {
		if (syncReady) await syncReady;
		if (state !== "destroyed") startHeartbeat();
	};
	startTimeout = setTimeout(() => {
		initHeartbeat();
	}, 0);
	return {
		awareness,
		join(options) {
			joinPresence(options?.cursor);
		},
		leave() {
			leavePresence();
		},
		update(options) {
			if (state === "destroyed") return;
			awareness.setLocalStateField("cursor", options.cursor);
		},
		get() {
			return getPresenceState();
		},
		subscribe(callback) {
			subscribers.add(callback);
			callback(getPresenceState());
			return () => subscribers.delete(callback);
		},
		destroy() {
			if (state === "destroyed") return;
			transitionTo("destroyed");
			if (startTimeout) {
				clearTimeout(startTimeout);
				startTimeout = null;
			}
			if (throttleTimer) {
				clearTimeout(throttleTimer);
				throttleTimer = null;
			}
			flightStatus.pending = null;
			subscribers.clear();
			stopHeartbeat();
			awareness.off("update", onLocalAwarenessUpdate);
			unsubscribeCursors?.();
			unsubscribeVisibility?.();
			unsubscribePageHide?.();
			for (const clientId of remoteClientIds.values()) awareness.states.delete(clientId);
			remoteClientIds.clear();
			awareness.emit("update", [{
				added: [],
				updated: [],
				removed: []
			}, "remote"]);
			convexClient.mutation(api.presence, {
				document,
				client,
				action: "leave"
			});
			awareness.destroy();
		}
	};
}

//#endregion
//#region src/client/collection.ts
var YjsOrigin = /* @__PURE__ */ function(YjsOrigin$1) {
	YjsOrigin$1["Local"] = "local";
	YjsOrigin$1["Fragment"] = "fragment";
	YjsOrigin$1["Server"] = "server";
	return YjsOrigin$1;
}(YjsOrigin || {});
const logger = getLogger(["replicate", "collection"]);
function handleMutationError(error) {
	const httpError = error;
	if (httpError?.status === 401 || httpError?.status === 403) throw new NonRetriableError("Authentication failed");
	if (httpError?.status === 422) throw new NonRetriableError("Validation error");
	throw error;
}
function convexCollectionOptions(config) {
	const { validator, getKey, material, convexClient, api, persistence: persistence$1, user: userGetter, anonymousPresence } = config;
	const collection$1 = getFunctionName(api.delta).split(":")[0];
	if (!collection$1) throw new Error("Could not extract collection name from api.delta function reference");
	const proseFields = validator ? findProseFields(validator) : [];
	const proseFieldSet = new Set(proseFields);
	const utils = { async prose(document, field, options) {
		const fieldStr = field;
		if (!proseFieldSet.has(fieldStr)) throw new ProseError({
			document,
			field: fieldStr,
			collection: collection$1
		});
		let ctx = hasContext(collection$1) ? getContext(collection$1) : null;
		if (!ctx) {
			await new Promise((resolve, reject) => {
				const maxWait = 1e4;
				const startTime = Date.now();
				const check = setInterval(() => {
					if (hasContext(collection$1)) {
						clearInterval(check);
						resolve();
					} else if (Date.now() - startTime > maxWait) {
						clearInterval(check);
						reject(new ProseError({
							document,
							field: fieldStr,
							collection: collection$1
						}));
					}
				}, 10);
			});
			ctx = hasContext(collection$1) ? getContext(collection$1) : null;
		}
		if (!ctx) throw new ProseError({
			document,
			field: fieldStr,
			collection: collection$1
		});
		const fragment = ctx.docManager.getFragment(document, fieldStr);
		if (!fragment) throw new ProseError({
			document,
			field: fieldStr,
			collection: collection$1
		});
		const subdoc = ctx.docManager.get(document);
		if (!subdoc) throw new ProseError({
			document,
			field: fieldStr,
			collection: collection$1
		});
		const collectionRef = ctx.ref;
		if (collectionRef) observeFragment({
			collection: collection$1,
			document,
			field: fieldStr,
			fragment,
			ydoc: subdoc,
			ymap: ctx.docManager.getFields(document),
			collectionRef,
			debounceMs: options?.debounceMs
		});
		const storedConvexClient = ctx.client;
		const storedApi = ctx.api;
		const storedClientId = ctx.clientId;
		let presenceProvider = null;
		const hasPresenceApi = storedApi?.session && storedApi?.presence;
		if (storedConvexClient && hasPresenceApi && storedClientId) presenceProvider = createPresence({
			convexClient: storedConvexClient,
			api: {
				presence: storedApi.presence,
				session: storedApi.session
			},
			document,
			client: storedClientId,
			ydoc: subdoc,
			syncReady: ctx.synced,
			user: options?.user ?? ctx.userGetter,
			throttleMs: options?.throttleMs,
			anonymousPresence: ctx.anonymousPresence
		});
		return {
			fragment,
			provider: presenceProvider ? {
				awareness: presenceProvider.awareness,
				document: subdoc
			} : {
				awareness: new Awareness(subdoc),
				document: subdoc
			},
			get pending() {
				return isPending(collection$1, document);
			},
			onPendingChange(callback) {
				return subscribePending(collection$1, document, callback);
			},
			destroy() {
				presenceProvider?.destroy();
			}
		};
	} };
	const documentHandles = /* @__PURE__ */ new Map();
	const presenceProviders = /* @__PURE__ */ new Map();
	const getOrCreateDocumentHandle = (documentId) => {
		let handle = documentHandles.get(documentId);
		if (handle) return handle;
		const ctx = hasContext(collection$1) ? getContext(collection$1) : null;
		if (!ctx) throw new Error(`Collection ${collection$1} not initialized. Call init() first.`);
		const subdoc = ctx.docManager.getOrCreate(documentId);
		let presenceProvider = presenceProviders.get(documentId);
		if (!presenceProvider) {
			const hasPresenceApi = ctx.api?.session && ctx.api?.presence;
			if (ctx.client && hasPresenceApi && ctx.clientId) {
				presenceProvider = createPresence({
					convexClient: ctx.client,
					api: {
						presence: ctx.api.presence,
						session: ctx.api.session
					},
					document: documentId,
					client: ctx.clientId,
					ydoc: subdoc,
					syncReady: ctx.synced,
					user: ctx.userGetter,
					anonymousPresence: ctx.anonymousPresence
				});
				presenceProviders.set(documentId, presenceProvider);
			}
		}
		handle = {
			id: documentId,
			presence: presenceProvider ?? {
				join: () => {},
				leave: () => {},
				update: () => {},
				get: () => ({
					local: null,
					remote: []
				}),
				subscribe: () => () => {}
			},
			awareness: presenceProvider?.awareness ?? new Awareness(subdoc),
			async prose(field, options) {
				return utils.prose(documentId, field, options);
			}
		};
		documentHandles.set(documentId, handle);
		return handle;
	};
	let sessionCache = [];
	const sessionSubscribers = /* @__PURE__ */ new Set();
	let sessionUnsubscribe = null;
	const initSessionSubscription = () => {
		if (sessionUnsubscribe) return;
		const ctx = hasContext(collection$1) ? getContext(collection$1) : null;
		if (!ctx?.client || !ctx?.api?.session) return;
		sessionUnsubscribe = ctx.client.onUpdate(ctx.api.session, { connected: true }, (sessions) => {
			sessionCache = sessions;
			sessionSubscribers.forEach((cb) => cb(sessions));
		});
	};
	const extensions = {
		doc(id) {
			return getOrCreateDocumentHandle(id);
		},
		session: {
			get(docId) {
				if (docId) return sessionCache.filter((s) => s.document === docId);
				return sessionCache;
			},
			subscribe(callback) {
				initSessionSubscription();
				sessionSubscribers.add(callback);
				callback(sessionCache);
				return () => {
					sessionSubscribers.delete(callback);
					if (sessionSubscribers.size === 0 && sessionUnsubscribe) {
						sessionUnsubscribe();
						sessionUnsubscribe = null;
					}
				};
			}
		}
	};
	const docManager = createDocumentManager(collection$1);
	const docPersistence = null;
	initContext({
		collection: collection$1,
		docManager,
		client: convexClient,
		api,
		persistence: persistence$1,
		fields: proseFieldSet,
		userGetter,
		anonymousPresence
	});
	let ops = null;
	const seqService = createSeqService(persistence$1.kv);
	let resolvePersistenceReady;
	const persistenceReadyPromise = new Promise((resolve) => {
		resolvePersistenceReady = resolve;
	});
	let resolveOptimisticReady;
	const optimisticReadyPromise = new Promise((resolve) => {
		resolveOptimisticReady = resolve;
	});
	const recover = async (pushLocal = false) => {
		const docIds = docManager.documents();
		if (docIds.length === 0) return;
		logger.debug("Starting recovery for documents", {
			collection: collection$1,
			count: docIds.length
		});
		const recoveryPromises = docIds.map(async (docId) => {
			try {
				const vector = docManager.encodeStateVector(docId);
				const result = await convexClient.query(api.delta, {
					document: docId,
					vector: vector.buffer
				});
				if (result.mode === "recovery" && result.diff) {
					const update = new Uint8Array(result.diff);
					docManager.applyUpdate(docId, update, YjsOrigin.Server);
					logger.debug("Applied server diff during recovery", {
						document: docId,
						collection: collection$1
					});
				}
				if (pushLocal) {
					const ydoc = docManager.get(docId);
					if (ydoc) {
						const localState = Y.encodeStateAsUpdateV2(ydoc);
						const material$1 = serializeDocument(docManager, docId);
						if (material$1 && localState.length > 0) {
							await convexClient.mutation(api.replicate, {
								document: docId,
								bytes: localState.buffer,
								material: material$1,
								type: "update"
							});
							logger.debug("Pushed local changes during recovery", {
								document: docId,
								collection: collection$1
							});
						}
					}
				}
			} catch (error) {
				logger.warn("Recovery failed for document", {
					document: docId,
					collection: collection$1,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		});
		await Promise.all(recoveryPromises);
		logger.debug("Recovery completed", {
			collection: collection$1,
			count: docIds.length
		});
	};
	const applyYjsInsert = (mutations) => {
		const deltas = [];
		for (const mut of mutations) {
			const document = String(mut.key);
			const delta = docManager.transactWithDelta(document, (fieldsMap) => {
				Object.entries(mut.modified).forEach(([k, v]) => {
					if (proseFieldSet.has(k) && isDoc(v)) {
						const fragment = new Y.XmlFragment();
						fieldsMap.set(k, fragment);
						fragmentFromJSON(fragment, v);
					} else fieldsMap.set(k, v);
				});
			}, YjsOrigin.Local);
			deltas.push(delta);
		}
		return deltas;
	};
	const applyYjsUpdate = (mutations) => {
		const deltas = [];
		for (const mut of mutations) {
			const document = String(mut.key);
			if (!docManager.getFields(document)) continue;
			const modifiedFields = mut.modified;
			if (!modifiedFields) continue;
			const delta = docManager.transactWithDelta(document, (fields) => {
				Object.entries(modifiedFields).forEach(([k, v]) => {
					if (proseFieldSet.has(k)) return;
					if (fields.get(k) instanceof Y.XmlFragment) return;
					fields.set(k, v);
				});
			}, YjsOrigin.Local);
			deltas.push(delta);
		}
		return deltas;
	};
	const applyYjsDelete = (mutations) => {
		const deltas = [];
		for (const mut of mutations) {
			const document = String(mut.key);
			const ydoc = docManager.get(document);
			if (ydoc) {
				const delta = applyDeleteMarkerToDoc(ydoc);
				deltas.push(delta);
			} else {
				const delta = createDeleteDelta();
				deltas.push(delta);
			}
		}
		return deltas;
	};
	return {
		id: collection$1,
		getKey,
		utils,
		extensions,
		onInsert: async ({ transaction }) => {
			const deltas = applyYjsInsert(transaction.mutations);
			try {
				await Promise.all([persistenceReadyPromise, optimisticReadyPromise]);
				await Promise.all(transaction.mutations.map(async (mut, i) => {
					const delta = deltas[i];
					if (!delta || delta.length === 0) return;
					const document = String(mut.key);
					const materializedDoc = serializeDocument(docManager, document) ?? mut.modified;
					await convexClient.mutation(api.replicate, {
						document,
						bytes: delta.buffer,
						material: materializedDoc,
						type: "insert"
					});
				}));
			} catch (error) {
				handleMutationError(error);
			}
		},
		onUpdate: async ({ transaction }) => {
			const mutation = transaction.mutations[0];
			const documentKey = String(mutation.key);
			const metadata = mutation.metadata;
			const isContentSync = !!metadata?.contentSync;
			const deltas = isContentSync ? null : applyYjsUpdate(transaction.mutations);
			try {
				await Promise.all([persistenceReadyPromise, optimisticReadyPromise]);
				if (isContentSync && metadata?.contentSync) {
					const { bytes, material: material$1 } = metadata.contentSync;
					await convexClient.mutation(api.replicate, {
						document: documentKey,
						bytes,
						material: material$1,
						type: "update"
					});
					return;
				}
				if (deltas) await Promise.all(transaction.mutations.map(async (mut, i) => {
					const delta = deltas[i];
					if (!delta || delta.length === 0) return;
					const docId = String(mut.key);
					const fullDoc = serializeDocument(docManager, docId) ?? mut.modified;
					await convexClient.mutation(api.replicate, {
						document: docId,
						bytes: delta.buffer,
						material: fullDoc,
						type: "update"
					});
				}));
			} catch (error) {
				handleMutationError(error);
			}
		},
		onDelete: async ({ transaction }) => {
			const deltas = applyYjsDelete(transaction.mutations);
			try {
				await Promise.all([persistenceReadyPromise, optimisticReadyPromise]);
				const itemsToDelete = transaction.mutations.map((mut) => mut.original).filter((item) => item !== void 0 && Object.keys(item).length > 0);
				ops.delete(itemsToDelete);
				await Promise.all(transaction.mutations.map(async (mut, i) => {
					const delta = deltas[i];
					if (!delta || delta.length === 0) return;
					await convexClient.mutation(api.replicate, {
						document: String(mut.key),
						bytes: delta.buffer,
						type: "delete"
					});
				}));
			} catch (error) {
				handleMutationError(error);
			}
		},
		sync: {
			rowUpdateMode: "partial",
			sync: (params) => {
				const { markReady, collection: collectionInstance } = params;
				updateContext(collection$1, { ref: collectionInstance });
				const ctx = getContext(collection$1);
				if (ctx.cleanup) {
					ctx.cleanup();
					ctx.cleanup = void 0;
				}
				let subscription = null;
				const ssrDocuments = material?.documents;
				const ssrCrdt = material?.crdt;
				const ssrCursor = material?.cursor;
				const docs = ssrDocuments ? [...ssrDocuments] : [];
				(async () => {
					try {
						const existingDocIds = await persistence$1.listDocuments(collection$1);
						for (const docId of existingDocIds) docManager.getOrCreate(docId);
						const docPromises = docManager.enablePersistence((document, ydoc) => {
							return persistence$1.createDocPersistence(`${collection$1}:${document}`, ydoc);
						});
						await Promise.all(docPromises);
						resolvePersistenceReady?.();
						const clientId = await getClientId(persistence$1.kv);
						updateContext(collection$1, { clientId });
						ops = createReplicateOps(params);
						resolveOptimisticReady?.();
						if (ssrCrdt) for (const [docId, state] of Object.entries(ssrCrdt)) {
							const update = new Uint8Array(state.bytes);
							docManager.applyUpdate(docId, update, YjsOrigin.Server);
						}
						await recover();
						if (docManager.documents().length > 0) {
							const items = extractAllDocuments(docManager);
							ops.replace(items);
						} else ops.replace([]);
						markReady();
						getContext(collection$1).resolve?.();
						const persistedCursor = await seqService.load(collection$1);
						let cursor = ssrCursor ?? persistedCursor;
						if (cursor > 0 && docManager.documents().length === 0) {
							cursor = 0;
							persistence$1.kv.set(`cursor:${collection$1}`, 0);
						}
						getContext(collection$1).resolveActorReady?.();
						const handleSnapshotChange = (bytes, document, exists) => {
							const hadLocally = docManager.has(document);
							if (!exists && hadLocally) {
								const itemBefore = serializeDocument(docManager, document);
								docManager.delete(document);
								if (itemBefore) return {
									item: itemBefore,
									isNew: false,
									isDelete: true
								};
								return null;
							}
							if (!exists && !hadLocally) return null;
							const update = new Uint8Array(bytes);
							docManager.applyUpdate(document, update, YjsOrigin.Server);
							const itemAfter = serializeDocument(docManager, document);
							if (itemAfter) return {
								item: itemAfter,
								isNew: !hadLocally,
								isDelete: false
							};
							else if (hadLocally) logger.warn("Document serialization returned null after snapshot update", {
								document,
								collection: collection$1,
								hadFieldsAfter: !!docManager.getFields(document)
							});
							return null;
						};
						const handleDeltaChange = (bytes, document, exists) => {
							if (!document) return null;
							const hadLocally = docManager.has(document);
							if (!exists && hadLocally) {
								const itemBefore = serializeDocument(docManager, document);
								docManager.delete(document);
								if (itemBefore) return {
									item: itemBefore,
									isNew: false,
									isDelete: true
								};
								return null;
							}
							if (!exists && !hadLocally) return null;
							const update = new Uint8Array(bytes);
							docManager.applyUpdate(document, update, YjsOrigin.Server);
							const itemAfter = serializeDocument(docManager, document);
							if (itemAfter) return {
								item: itemAfter,
								isNew: !hadLocally,
								isDelete: false
							};
							else if (hadLocally) logger.warn("Document serialization returned null after delta update", {
								document,
								collection: collection$1,
								hadFieldsAfter: !!docManager.getFields(document)
							});
							return null;
						};
						const handleSubscriptionUpdate = async (response) => {
							if (!response || !Array.isArray(response.changes)) return;
							const { changes, seq: newSeq } = response;
							const syncedDocuments = /* @__PURE__ */ new Set();
							const toInsert = [];
							const toUpsert = [];
							const toDelete = [];
							for (const change of changes) {
								const { type, bytes, document, exists } = change;
								if (!bytes || !document) continue;
								syncedDocuments.add(document);
								const result = type === "snapshot" ? handleSnapshotChange(bytes, document, exists ?? true) : handleDeltaChange(bytes, document, exists ?? true);
								if (result) if (result.isDelete) toDelete.push(result.item);
								else if (result.isNew) toInsert.push(result.item);
								else toUpsert.push(result.item);
							}
							if (toDelete.length > 0) ops.delete(toDelete);
							if (toInsert.length > 0) ops.insert(toInsert);
							if (toUpsert.length > 0) ops.upsert(toUpsert);
							if (newSeq !== void 0) {
								persistence$1.kv.set(`cursor:${collection$1}`, newSeq);
								const markPromises = Array.from(syncedDocuments).map((document) => {
									const vector = docManager.encodeStateVector(document);
									return convexClient.mutation(api.presence, {
										document,
										client: clientId,
										action: "mark",
										seq: newSeq,
										vector: vector.buffer
									}).catch((error) => {
										logger.warn("Failed to mark presence", {
											document,
											collection: collection$1,
											error: error.message
										});
									});
								});
								Promise.all(markPromises);
							}
						};
						subscription = convexClient.onUpdate(api.delta, {
							seq: cursor,
							limit: 1e3
						}, (response) => {
							handleSubscriptionUpdate(response);
						});
						if (typeof globalThis.window !== "undefined") {
							let wasOffline = false;
							const handleOffline = () => {
								wasOffline = true;
								logger.debug("Network offline detected", { collection: collection$1 });
							};
							const handleOnline = () => {
								if (wasOffline) {
									logger.info("Network online restored, running recovery sync", { collection: collection$1 });
									wasOffline = false;
									recover(true).catch((error) => {
										logger.warn("Recovery sync failed after reconnection", {
											collection: collection$1,
											error: error.message
										});
									});
								}
							};
							globalThis.window.addEventListener("offline", handleOffline);
							globalThis.window.addEventListener("online", handleOnline);
							const ctx$1 = getContext(collection$1);
							ctx$1.cleanupReconnection = () => {
								globalThis.window.removeEventListener("offline", handleOffline);
								globalThis.window.removeEventListener("online", handleOnline);
							};
						}
					} catch (error) {
						logger.error("Sync initialization failed", {
							collection: collection$1,
							error: error instanceof Error ? error.message : String(error),
							stack: error instanceof Error ? error.stack : void 0
						});
						markReady();
					}
				})();
				return {
					material: docs,
					cleanup: () => {
						if (hasContext(collection$1)) getContext(collection$1).cleanupReconnection?.();
						subscription?.();
						cleanup(collection$1);
						deleteContext(collection$1);
						docPersistence?.destroy();
						docManager?.destroy();
					}
				};
			}
		}
	};
}
/**
* Create a collection with versioned schema support.
* Handles automatic client-side migrations when schema version changes.
*/
function createVersionedCollection(options) {
	const { schema: versionedSchema, clientMigrations, onMigrationError } = options;
	let persistence$1 = null;
	let resolvedConfig = null;
	let material;
	let instance = null;
	let collectionName = null;
	let paginationState = {
		status: "idle",
		count: 0,
		cursor: null
	};
	const listeners = /* @__PURE__ */ new Set();
	const isPaginatedMaterial = (mat) => {
		return mat !== void 0 && "pages" in mat && Array.isArray(mat.pages);
	};
	const convertPaginatedToMaterial = (paginated) => {
		const allDocs = paginated.pages.flatMap((p) => p.page);
		return {
			documents: allDocs,
			count: allDocs.length
		};
	};
	return {
		async init(mat) {
			if (!persistence$1) {
				persistence$1 = await options.persistence();
				const userConfig = options.config();
				collectionName = getFunctionName(userConfig.api.delta).split(":")[0] ?? "unknown";
				resolvedConfig = {
					convexClient: userConfig.convexClient,
					api: userConfig.api,
					getKey: userConfig.getKey,
					user: userConfig.user
				};
				if (isPaginatedMaterial(mat)) {
					material = convertPaginatedToMaterial(mat);
					paginationState = {
						status: mat.isDone ? "done" : "idle",
						count: mat.pages.reduce((sum, p) => sum + p.page.length, 0),
						cursor: mat.cursor
					};
				} else material = mat;
				if (persistence$1.db && collectionName) await runMigrations({
					collection: collectionName,
					schema: versionedSchema,
					db: persistence$1.db,
					clientMigrations,
					onError: onMigrationError,
					listDocuments: async () => persistence$1.listDocuments(collectionName)
				});
			}
		},
		get() {
			if (!persistence$1 || !resolvedConfig) throw new Error("Call init() before get()");
			if (!instance) {
				const opts = convexCollectionOptions({
					...resolvedConfig,
					validator: versionedSchema.shape,
					persistence: persistence$1,
					material
				});
				const baseCollection = createCollection(opts);
				instance = Object.assign(baseCollection, opts.extensions);
			}
			return instance;
		},
		pagination: {
			async load() {
				if (!persistence$1 || !resolvedConfig) throw new Error("Call init() before pagination.load()");
				if (paginationState.status === "done") return null;
				return null;
			},
			get status() {
				return paginationState.status;
			},
			get canLoadMore() {
				return paginationState.status !== "done" && paginationState.status !== "busy";
			},
			get count() {
				return paginationState.count;
			},
			subscribe(callback) {
				listeners.add(callback);
				return () => listeners.delete(callback);
			}
		}
	};
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
const collection = { create: createVersionedCollection };

//#endregion
//#region src/client/identity.ts
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
const identity = {
	from(user) {
		return { ...user };
	},
	color: { generate(seed, config) {
		return getStableAnonColor(seed, config);
	} },
	name: { anonymous(seed, config) {
		return getStableAnonName(seed, config);
	} }
};

//#endregion
//#region src/client/persistence/memory.ts
/**
* In-memory key-value store.
*/
var MemoryKeyValueStore = class {
	constructor() {
		this.store = /* @__PURE__ */ new Map();
	}
	async get(key) {
		return this.store.get(key);
	}
	async set(key, value) {
		this.store.set(key, value);
	}
	async del(key) {
		this.store.delete(key);
	}
};
/**
* No-op persistence provider for in-memory usage.
*
* The Y.Doc is kept in memory without persistence.
*/
var MemoryPersistenceProvider = class {
	constructor() {
		this.whenSynced = Promise.resolve();
	}
	destroy() {}
};
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
function memoryPersistence() {
	return {
		createDocPersistence: (_, __) => new MemoryPersistenceProvider(),
		async listDocuments(_prefix) {
			return [];
		},
		kv: new MemoryKeyValueStore()
	};
}

//#endregion
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
var SqliteKeyValueStore = class {
	constructor(executor) {
		this.executor = executor;
	}
	async get(key) {
		const result = await this.executor.execute("SELECT value FROM kv WHERE key = ?", [key]);
		if (result.rows.length === 0) return void 0;
		return JSON.parse(result.rows[0].value);
	}
	async set(key, value) {
		await this.executor.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", [key, JSON.stringify(value)]);
	}
	async del(key) {
		await this.executor.execute("DELETE FROM kv WHERE key = ?", [key]);
	}
};
/**
* Adapter that wraps Executor to provide MigrationDatabase interface.
*/
var SqliteMigrationDatabase = class {
	constructor(executor) {
		this.executor = executor;
	}
	async run(sql, params) {
		await this.executor.execute(sql, params);
	}
	async exec(sql) {
		await this.executor.execute(sql);
	}
	async get(sql, params) {
		const result = await this.executor.execute(sql, params);
		if (result.rows.length === 0) return void 0;
		return result.rows[0];
	}
	async all(sql, params) {
		return (await this.executor.execute(sql, params)).rows;
	}
};
var SqlitePersistenceProvider = class {
	constructor(executor, collection$1, ydoc, onError) {
		this.executor = executor;
		this.collection = collection$1;
		this.ydoc = ydoc;
		this.onError = onError;
		this.pendingWrites = [];
		this.lastError = null;
		this.whenSynced = this.loadState();
		this.updateHandler = (update, origin) => {
			if (origin !== "sqlite") {
				const writePromise = this.saveUpdate(update).catch((error) => {
					this.lastError = error;
					this.onError?.(error);
				});
				this.pendingWrites.push(writePromise);
				writePromise.finally(() => {
					this.pendingWrites = this.pendingWrites.filter((p) => p !== writePromise);
				});
			}
		};
		this.ydoc.on("update", this.updateHandler);
	}
	async flush() {
		await Promise.all(this.pendingWrites);
		if (this.lastError) {
			const error = this.lastError;
			this.lastError = null;
			throw error;
		}
	}
	async loadState() {
		const snapshotResult = await this.executor.execute("SELECT data FROM snapshots WHERE collection = ?", [this.collection]);
		if (snapshotResult.rows.length > 0) {
			const raw = snapshotResult.rows[0].data;
			const snapshotData = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
			Y.applyUpdate(this.ydoc, snapshotData, "sqlite");
		}
		const deltasResult = await this.executor.execute("SELECT data FROM deltas WHERE collection = ? ORDER BY id ASC", [this.collection]);
		for (const row of deltasResult.rows) {
			const raw = row.data;
			const updateData = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
			Y.applyUpdate(this.ydoc, updateData, "sqlite");
		}
	}
	async saveUpdate(update) {
		await this.executor.execute("INSERT INTO deltas (collection, data) VALUES (?, ?)", [this.collection, update]);
	}
	destroy() {
		this.ydoc.off("update", this.updateHandler);
	}
};
function createPersistenceFromExecutor(executor) {
	return {
		createDocPersistence: (collection$1, ydoc) => new SqlitePersistenceProvider(executor, collection$1, ydoc),
		async listDocuments(prefix) {
			return (await executor.execute(`SELECT DISTINCT collection FROM (
          SELECT collection FROM snapshots WHERE collection LIKE ?
          UNION
          SELECT collection FROM deltas WHERE collection LIKE ?
        )`, [`${prefix}:%`, `${prefix}:%`])).rows.map((row) => {
				return row.collection.split(":").slice(1).join(":");
			});
		},
		kv: new SqliteKeyValueStore(executor),
		db: new SqliteMigrationDatabase(executor)
	};
}

//#endregion
//#region src/client/persistence/sqlite/native.ts
var OPSqliteExecutor = class {
	constructor(db) {
		this.db = db;
	}
	async execute(sql, params) {
		return { rows: (await this.db.execute(sql, params)).rows || [] };
	}
	close() {
		this.db.close();
	}
};
async function createNativeSqlitePersistence(db, _dbName) {
	const executor = new OPSqliteExecutor(db);
	await initSchema(executor);
	return createPersistenceFromExecutor(executor);
}

//#endregion
//#region src/client/persistence/sqlite/web.ts
const INIT = 0;
const EXECUTE = 1;
const CLOSE = 2;
var WorkerExecutor = class {
	constructor(worker) {
		this.nextId = 0;
		this.pending = /* @__PURE__ */ new Map();
		this.terminated = false;
		this.worker = worker;
		this.worker.onmessage = (e) => {
			const { id, ok, rows, error } = e.data;
			const handler = this.pending.get(id);
			if (!handler) return;
			this.pending.delete(id);
			if (ok) handler.resolve(rows ?? []);
			else handler.reject(new Error(error ?? "Unknown worker error"));
		};
		this.worker.onerror = (event) => {
			const error = /* @__PURE__ */ new Error(`Worker error: ${event.message || "Unknown error"}`);
			this.rejectAllPending(error);
		};
		this.worker.onmessageerror = () => {
			const error = /* @__PURE__ */ new Error("Worker message deserialization failed");
			this.rejectAllPending(error);
		};
	}
	rejectAllPending(error) {
		this.terminated = true;
		for (const [, handler] of this.pending) handler.reject(error);
		this.pending.clear();
	}
	send(type, payload = {}) {
		return new Promise((resolve, reject) => {
			if (this.terminated) {
				reject(/* @__PURE__ */ new Error("Worker has been terminated"));
				return;
			}
			const id = this.nextId++;
			this.pending.set(id, {
				resolve,
				reject
			});
			this.worker.postMessage({
				id,
				type,
				...payload
			});
		});
	}
	async init(name) {
		await this.send(INIT, { name });
	}
	async execute(sql, params) {
		return { rows: await this.send(EXECUTE, {
			sql,
			params
		}) };
	}
	close() {
		for (const [, handler] of this.pending) handler.reject(/* @__PURE__ */ new Error("Worker terminated"));
		this.pending.clear();
		this.send(CLOSE).catch(() => {});
		this.worker.terminate();
	}
};
async function createWebSqlitePersistence(options) {
	const { name, worker } = options;
	const resolvedWorker = typeof worker === "function" ? await worker() : worker;
	const executor = new WorkerExecutor(resolvedWorker);
	try {
		await executor.init(name);
	} catch (error) {
		resolvedWorker.terminate();
		throw new Error(`Failed to initialize: ${error}`);
	}
	return createPersistenceFromExecutor(executor);
}
function onceWebSqlitePersistence(options) {
	let instance = null;
	return () => instance ??= createWebSqlitePersistence(options);
}

//#endregion
//#region src/client/persistence/custom.ts
const SNAPSHOT_PREFIX = "snapshot:";
const UPDATE_PREFIX = "update:";
const META_PREFIX = "meta:";
var AdapterKeyValueStore = class {
	constructor(adapter) {
		this.adapter = adapter;
	}
	async get(key) {
		const data = await this.adapter.get(`${META_PREFIX}${key}`);
		if (!data) return void 0;
		return JSON.parse(new TextDecoder().decode(data));
	}
	async set(key, value) {
		await this.adapter.set(`${META_PREFIX}${key}`, new TextEncoder().encode(JSON.stringify(value)));
	}
	async del(key) {
		await this.adapter.delete(`${META_PREFIX}${key}`);
	}
};
var AdapterPersistenceProvider = class {
	constructor(adapter, collection$1, ydoc) {
		this.adapter = adapter;
		this.collection = collection$1;
		this.ydoc = ydoc;
		this.updateCounter = 0;
		this.whenSynced = this.loadState();
		this.updateHandler = (update, origin) => {
			if (origin !== "custom") this.saveUpdate(update);
		};
		this.ydoc.on("update", this.updateHandler);
	}
	async loadState() {
		const snapshotData = await this.adapter.get(`${SNAPSHOT_PREFIX}${this.collection}`);
		if (snapshotData) Y.applyUpdate(this.ydoc, snapshotData, "custom");
		const sortedKeys = (await this.adapter.keys(`${UPDATE_PREFIX}${this.collection}:`)).sort();
		for (const key of sortedKeys) {
			const updateData = await this.adapter.get(key);
			if (updateData) {
				Y.applyUpdate(this.ydoc, updateData, "custom");
				const seq = parseInt(key.split(":").pop() || "0", 10);
				if (seq > this.updateCounter) this.updateCounter = seq;
			}
		}
	}
	async saveUpdate(update) {
		this.updateCounter++;
		const paddedCounter = String(this.updateCounter).padStart(10, "0");
		await this.adapter.set(`${UPDATE_PREFIX}${this.collection}:${paddedCounter}`, update);
	}
	destroy() {
		this.ydoc.off("update", this.updateHandler);
	}
};
function createCustomPersistence(adapter) {
	return {
		createDocPersistence: (collection$1, ydoc) => new AdapterPersistenceProvider(adapter, collection$1, ydoc),
		async listDocuments(prefix) {
			const snapshotKeys = await adapter.keys(`${SNAPSHOT_PREFIX}${prefix}:`);
			const updateKeys = await adapter.keys(`${UPDATE_PREFIX}${prefix}:`);
			const docIds = /* @__PURE__ */ new Set();
			for (const key of snapshotKeys) {
				const parts = key.slice(9).split(":");
				docIds.add(parts.slice(1).join(":"));
			}
			for (const key of updateKeys) {
				const parts = key.slice(7).split(":");
				docIds.add(parts.slice(1, -1).join(":"));
			}
			return Array.from(docIds);
		},
		kv: new AdapterKeyValueStore(adapter)
	};
}

//#endregion
//#region src/client/persistence/encrypted/webauthn.ts
const REPLICATE_RP_NAME = "Replicate Encryption";
function getRpId() {
	if (typeof window === "undefined") return "localhost";
	return window.location.hostname;
}
function generateSalt$1() {
	return crypto.getRandomValues(new Uint8Array(32));
}
function generateUserId() {
	return crypto.getRandomValues(new Uint8Array(32));
}
async function isPRFSupported() {
	if (typeof window === "undefined") return false;
	if (typeof PublicKeyCredential === "undefined") return false;
	if (typeof PublicKeyCredential.getClientCapabilities === "function") try {
		return (await PublicKeyCredential.getClientCapabilities())["extension:prf"] === true;
	} catch {
		return false;
	}
	return true;
}
async function createPRFCredential(userName) {
	if (!await isPRFSupported()) throw new Error("WebAuthn PRF not supported");
	let credential;
	try {
		credential = await navigator.credentials.create({ publicKey: {
			rp: {
				name: REPLICATE_RP_NAME,
				id: getRpId()
			},
			user: {
				id: generateUserId().buffer,
				name: userName,
				displayName: userName
			},
			challenge: crypto.getRandomValues(new Uint8Array(32)).buffer,
			pubKeyCredParams: [{
				alg: -7,
				type: "public-key"
			}, {
				alg: -257,
				type: "public-key"
			}],
			authenticatorSelection: {
				residentKey: "required",
				userVerification: "required"
			},
			extensions: { prf: {} }
		} });
	} catch (err) {
		if (err instanceof DOMException) switch (err.name) {
			case "NotAllowedError": throw new Error("Setup cancelled or denied");
			case "SecurityError": throw new Error("Security error: ensure you're using HTTPS");
			case "AbortError": throw new Error("Setup timed out");
			case "InvalidStateError": throw new Error("Credential already exists for this account");
			default: throw new Error(`WebAuthn error: ${err.message}`);
		}
		throw err;
	}
	if (!credential) throw new Error("Credential creation cancelled");
	if (!credential.getClientExtensionResults().prf?.enabled) throw new Error("PRF extension not enabled - authenticator may not support PRF");
	return {
		id: credential.id,
		rawId: new Uint8Array(credential.rawId),
		salt: generateSalt$1()
	};
}
async function getPRFKey(credential) {
	let assertion;
	try {
		assertion = await navigator.credentials.get({ publicKey: {
			challenge: crypto.getRandomValues(new Uint8Array(32)).buffer,
			allowCredentials: [{
				id: credential.rawId.buffer,
				type: "public-key"
			}],
			extensions: { prf: { eval: { first: credential.salt.buffer } } },
			userVerification: "required"
		} });
	} catch (err) {
		if (err instanceof DOMException) switch (err.name) {
			case "NotAllowedError": throw new Error("Authentication cancelled or denied");
			case "SecurityError": throw new Error("Security error: ensure you're using HTTPS");
			case "AbortError": throw new Error("Authentication timed out");
			case "InvalidStateError": throw new Error("Authenticator not available");
			default: throw new Error(`WebAuthn error: ${err.message}`);
		}
		throw err;
	}
	if (!assertion) throw new Error("Authentication cancelled");
	const prfResults = assertion.getClientExtensionResults().prf?.results?.first;
	if (!prfResults) throw new Error("PRF output not available - authenticator may not support PRF");
	return new Uint8Array(prfResults);
}
async function deriveEncryptionKey(prfOutput, info) {
	const keyMaterial = await crypto.subtle.importKey("raw", prfOutput.buffer, "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey({
		name: "HKDF",
		hash: "SHA-256",
		salt: new Uint8Array(32),
		info: new TextEncoder().encode(info)
	}, keyMaterial, {
		name: "AES-GCM",
		length: 256
	}, false, ["encrypt", "decrypt"]);
}

//#endregion
//#region src/client/persistence/encrypted/crypto.ts
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
async function deriveKeyFromPassphrase(passphrase, salt) {
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
	return crypto.subtle.deriveKey({
		name: "PBKDF2",
		salt: salt.buffer,
		iterations: 1e5,
		hash: "SHA-256"
	}, keyMaterial, {
		name: "AES-GCM",
		length: 256
	}, false, ["encrypt", "decrypt"]);
}
async function encrypt(key, data) {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encrypted = await crypto.subtle.encrypt({
		name: "AES-GCM",
		iv
	}, key, data.buffer);
	const result = new Uint8Array(IV_LENGTH + encrypted.byteLength);
	result.set(iv, 0);
	result.set(new Uint8Array(encrypted), IV_LENGTH);
	return result;
}
async function decrypt(key, data) {
	const iv = data.slice(0, IV_LENGTH);
	const encrypted = data.slice(IV_LENGTH);
	const decrypted = await crypto.subtle.decrypt({
		name: "AES-GCM",
		iv
	}, key, encrypted.buffer);
	return new Uint8Array(decrypted);
}
function generateSalt() {
	return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}
function generateRecoveryKey() {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let result = "";
	for (let i = 0; i < bytes.length; i++) {
		if (i > 0 && i % 4 === 0) result += "-";
		result += chars[bytes[i] % 32];
	}
	return result;
}

//#endregion
//#region src/client/persistence/encrypted/web.ts
const CREDENTIAL_KEY = "webauthn:credential";
const SALT_KEY = "encryption:salt";
const SETUP_KEY = "encryption:setup";
const DOC_PREFIX = "enc:doc:";
function serializeCredential(cred) {
	return {
		id: cred.id,
		rawId: Array.from(cred.rawId),
		salt: Array.from(cred.salt)
	};
}
function deserializeCredential(stored) {
	return {
		id: stored.id,
		rawId: new Uint8Array(stored.rawId),
		salt: new Uint8Array(stored.salt)
	};
}
var EncryptedKeyValueStore = class {
	constructor(inner, getKey) {
		this.inner = inner;
		this.getKey = getKey;
	}
	async get(key) {
		const encryptionKey = this.getKey();
		if (!encryptionKey) return void 0;
		const encrypted = await this.inner.get(key);
		if (!encrypted) return void 0;
		try {
			const decrypted = await decrypt(encryptionKey, new Uint8Array(encrypted));
			return JSON.parse(new TextDecoder().decode(decrypted));
		} catch {
			return;
		}
	}
	async set(key, value) {
		const encryptionKey = this.getKey();
		if (!encryptionKey) throw new Error("Encryption locked");
		const encrypted = await encrypt(encryptionKey, new TextEncoder().encode(JSON.stringify(value)));
		await this.inner.set(key, Array.from(encrypted));
	}
	async del(key) {
		await this.inner.del(key);
	}
};
var EncryptedPersistenceProvider = class {
	constructor(innerStorage, collection$1, ydoc, encryptionKey) {
		this.innerStorage = innerStorage;
		this.collection = collection$1;
		this.ydoc = ydoc;
		this.encryptionKey = encryptionKey;
		this.pendingWrites = [];
		this.whenSynced = this.loadState();
		this.updateHandler = (update, origin) => {
			if (origin !== "encrypted-load") {
				const writePromise = this.saveUpdate(update).catch((err) => {
					console.error("[EncryptedPersistence] Save failed:", err);
				});
				this.pendingWrites.push(writePromise);
				writePromise.finally(() => {
					this.pendingWrites = this.pendingWrites.filter((p) => p !== writePromise);
				});
			}
		};
		this.ydoc.on("update", this.updateHandler);
	}
	async loadState() {
		const snapshotKey = `${DOC_PREFIX}${this.collection}:snapshot`;
		const deltasKey = `${DOC_PREFIX}${this.collection}:deltas`;
		const encryptedSnapshot = await this.innerStorage.kv.get(snapshotKey);
		if (encryptedSnapshot) {
			const decrypted = await decrypt(this.encryptionKey, new Uint8Array(encryptedSnapshot));
			Y.applyUpdate(this.ydoc, decrypted, "encrypted-load");
		}
		const encryptedDeltas = await this.innerStorage.kv.get(deltasKey);
		if (encryptedDeltas) for (const encDelta of encryptedDeltas) {
			const decrypted = await decrypt(this.encryptionKey, new Uint8Array(encDelta));
			Y.applyUpdate(this.ydoc, decrypted, "encrypted-load");
		}
	}
	async saveUpdate(update) {
		const deltasKey = `${DOC_PREFIX}${this.collection}:deltas`;
		const encrypted = await encrypt(this.encryptionKey, update);
		const existingDeltas = await this.innerStorage.kv.get(deltasKey) ?? [];
		existingDeltas.push(Array.from(encrypted));
		await this.innerStorage.kv.set(deltasKey, existingDeltas);
		if (existingDeltas.length >= 50) await this.compact();
	}
	async compact() {
		const snapshotKey = `${DOC_PREFIX}${this.collection}:snapshot`;
		const deltasKey = `${DOC_PREFIX}${this.collection}:deltas`;
		const snapshot = Y.encodeStateAsUpdate(this.ydoc);
		const encrypted = await encrypt(this.encryptionKey, snapshot);
		await this.innerStorage.kv.set(snapshotKey, Array.from(encrypted));
		await this.innerStorage.kv.del(deltasKey);
	}
	async flush() {
		await Promise.all(this.pendingWrites);
	}
	destroy() {
		this.ydoc.off("update", this.updateHandler);
	}
};
async function createWebEncryptionPersistence(config) {
	const { storage, user, unlock, recovery, lock: lockConfig, onLock, onUnlock } = config;
	let encryptionKey = null;
	let idleTimer = null;
	let state = await storage.kv.get(SETUP_KEY) ? "locked" : "setup";
	const resetIdleTimer = () => {
		if (!lockConfig?.idle) return;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			doLock();
		}, lockConfig.idle * 60 * 1e3);
	};
	const doLock = async () => {
		encryptionKey = null;
		state = "locked";
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
		onLock?.();
	};
	const doUnlock = async () => {
		if (!await storage.kv.get(SETUP_KEY)) {
			state = "setup";
			if (unlock.webauthn) {
				if (await isPRFSupported()) try {
					const credential = await createPRFCredential(user);
					encryptionKey = await deriveEncryptionKey(await getPRFKey(credential), `replicate:${user}`);
					await storage.kv.set(CREDENTIAL_KEY, serializeCredential(credential));
					await storage.kv.set(SETUP_KEY, true);
					if (recovery) {
						const recoveryKey = generateRecoveryKey();
						await recovery.onSetup(recoveryKey);
					}
					state = "unlocked";
					resetIdleTimer();
					onUnlock?.();
					return;
				} catch (err) {
					if (!unlock.passphrase) throw err;
				}
			}
			if (unlock.passphrase) {
				const salt = generateSalt();
				encryptionKey = await deriveKeyFromPassphrase(await unlock.passphrase.setup(recovery ? generateRecoveryKey() : ""), salt);
				await storage.kv.set(SALT_KEY, Array.from(salt));
				await storage.kv.set(SETUP_KEY, true);
				state = "unlocked";
				resetIdleTimer();
				onUnlock?.();
				return;
			}
			throw new Error("No unlock method available");
		}
		if (unlock.webauthn) {
			const storedCred = await storage.kv.get(CREDENTIAL_KEY);
			if (storedCred) try {
				encryptionKey = await deriveEncryptionKey(await getPRFKey(deserializeCredential(storedCred)), `replicate:${user}`);
				state = "unlocked";
				resetIdleTimer();
				onUnlock?.();
				return;
			} catch (err) {
				if (!unlock.passphrase) throw err;
			}
			else if (!unlock.passphrase) throw new Error("WebAuthn credential not found. Set up encryption again.");
		}
		if (unlock.passphrase) {
			const saltArray = await storage.kv.get(SALT_KEY);
			if (!saltArray) throw new Error("Encryption data not found. Set up encryption again.");
			const salt = new Uint8Array(saltArray);
			encryptionKey = await deriveKeyFromPassphrase(await unlock.passphrase.get(), salt);
			state = "unlocked";
			resetIdleTimer();
			onUnlock?.();
			return;
		}
		throw new Error("No unlock method configured");
	};
	return {
		get state() {
			return state;
		},
		async lock() {
			await doLock();
		},
		async unlock() {
			await doUnlock();
		},
		async isSupported() {
			if (unlock.webauthn) return isPRFSupported();
			return true;
		},
		createDocPersistence(collection$1, ydoc) {
			if (!encryptionKey) throw new Error("Encryption locked - call unlock() first");
			return new EncryptedPersistenceProvider(storage, collection$1, ydoc, encryptionKey);
		},
		async listDocuments(prefix) {
			return await storage.listDocuments(prefix);
		},
		kv: new EncryptedKeyValueStore(storage.kv, () => encryptionKey)
	};
}

//#endregion
//#region src/client/persistence/encrypted/manager.ts
const ENABLED_KEY = "encryption:manager:enabled";
async function createEncryptionManager(config) {
	const { storage, user, preference = "webauthn", hooks } = config;
	let encryptedPersistence = null;
	let currentState = {
		state: "disabled",
		persistence: storage
	};
	const subscribers = /* @__PURE__ */ new Set();
	const notify = () => {
		subscribers.forEach((cb) => cb(currentState));
		hooks?.change?.(currentState);
	};
	const updateState = (updates) => {
		currentState = {
			...currentState,
			...updates
		};
		notify();
	};
	if (await storage.kv.get(ENABLED_KEY) && preference !== "none") try {
		encryptedPersistence = await createWebEncryptionPersistence(await buildEncryptionConfig(storage, user, preference, hooks));
		updateState({
			state: encryptedPersistence.state,
			persistence: encryptedPersistence
		});
	} catch (err) {
		updateState({
			state: "disabled",
			error: err instanceof Error ? err : new Error(String(err)),
			persistence: storage
		});
	}
	return {
		get() {
			return currentState;
		},
		async enable() {
			if (encryptedPersistence) return;
			try {
				encryptedPersistence = await createWebEncryptionPersistence(await buildEncryptionConfig(storage, user, preference, hooks));
				await storage.kv.set(ENABLED_KEY, true);
				await encryptedPersistence.unlock();
				updateState({
					state: encryptedPersistence.state,
					error: void 0,
					persistence: encryptedPersistence
				});
			} catch (err) {
				updateState({
					state: "disabled",
					error: err instanceof Error ? err : new Error(String(err)),
					persistence: storage
				});
				throw err;
			}
		},
		async disable() {
			if (encryptedPersistence) {
				await encryptedPersistence.lock();
				encryptedPersistence = null;
			}
			await storage.kv.del(ENABLED_KEY);
			updateState({
				state: "disabled",
				error: void 0,
				persistence: storage
			});
		},
		async unlock() {
			if (!encryptedPersistence) throw new Error("Encryption not enabled. Call enable() first.");
			await encryptedPersistence.unlock();
			updateState({
				state: encryptedPersistence.state,
				error: void 0,
				persistence: encryptedPersistence
			});
		},
		async lock() {
			if (!encryptedPersistence) return;
			await encryptedPersistence.lock();
			updateState({
				state: encryptedPersistence.state,
				persistence: encryptedPersistence
			});
		},
		subscribe(callback) {
			subscribers.add(callback);
			callback(currentState);
			return () => subscribers.delete(callback);
		},
		destroy() {
			subscribers.clear();
		}
	};
}
async function buildEncryptionConfig(storage, user, preference, hooks) {
	const webauthnSupported = preference === "webauthn" && await isPRFSupported();
	const config = {
		storage,
		user,
		mode: "local",
		unlock: {}
	};
	if (webauthnSupported) config.unlock.webauthn = true;
	if (hooks?.passphrase || !webauthnSupported) config.unlock.passphrase = {
		get: async () => {
			if (hooks?.passphrase) return hooks.passphrase();
			throw new Error("Passphrase hook not configured");
		},
		setup: async (recoveryKey) => {
			if (hooks?.recovery) hooks.recovery(recoveryKey);
			if (hooks?.passphrase) return hooks.passphrase();
			throw new Error("Passphrase hook not configured");
		}
	};
	if (hooks?.recovery) config.recovery = {
		onSetup: async (key) => {
			hooks.recovery(key);
		},
		onRecover: async () => {
			if (hooks?.passphrase) return hooks.passphrase();
			throw new Error("Recovery requires passphrase hook");
		}
	};
	return config;
}

//#endregion
//#region src/client/persistence/index.ts
const persistence = {
	web: {
		sqlite: {
			create: createWebSqlitePersistence,
			once: onceWebSqlitePersistence
		},
		encryption: {
			create: createWebEncryptionPersistence,
			manager: createEncryptionManager,
			webauthn: { supported: isPRFSupported }
		}
	},
	native: {
		sqlite: { create: createNativeSqlitePersistence },
		encryption: {
			create: () => {
				throw new Error("persistence.native.encryption.create() not yet implemented");
			},
			biometric: { supported: () => Promise.resolve(false) }
		}
	},
	memory: { create: memoryPersistence },
	custom: { create: createCustomPersistence }
};

//#endregion
//#region src/client/index.ts
const errors = {
	Network: NetworkError,
	IDB: IDBError,
	IDBWrite: IDBWriteError,
	Reconciliation: ReconciliationError,
	Prose: ProseError,
	CollectionNotReady: CollectionNotReadyError,
	NonRetriable: NonRetriableError
};
const schema = { prose: {
	extract,
	empty: emptyProse
} };

//#endregion
export { collection, createMigrationError, errors, getLogger, getStoredSchemaVersion, identity, persistence, runAutoMigration, runMigrations, schema, setStoredSchemaVersion };
//# sourceMappingURL=index.js.map