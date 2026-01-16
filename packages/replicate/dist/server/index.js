import { v } from "convex/values";
import { defineTable, mutationGeneric, queryGeneric } from "convex/server";
import "@logtape/logtape";

//#region src/shared/index.ts
/**
* @trestleinc/replicate - Shared Module
*
* Single source of truth for all validators, types, and utilities.
*
* Following the val.md pattern:
* 1. All validators defined here
* 2. Types derived from validators using Infer<>
* 3. No duplicate interfaces - types come from validators
*/
/**
* Profile validator for user presence/identity.
* Used in sessions and presence tracking.
*/
const profileValidator = v.object({
	name: v.optional(v.string()),
	color: v.optional(v.string()),
	avatar: v.optional(v.string())
});
/**
* Cursor validator for collaborative editing positions.
* Tracks anchor/head selection positions and optional field context.
*/
const cursorValidator = v.object({
	anchor: v.any(),
	head: v.any(),
	field: v.optional(v.string())
});
/**
* Prose validator for ProseMirror-compatible rich text JSON.
* Used for collaborative rich text editing fields.
*/
const proseValidator = v.object({
	type: v.literal("doc"),
	content: v.optional(v.array(v.any()))
});
/**
* Individual change in a stream response.
*/
const streamChangeValidator = v.object({
	document: v.string(),
	bytes: v.bytes(),
	seq: v.number(),
	type: v.string()
});
/**
* Extended stream change with existence flag (used in server responses).
*/
const streamChangeWithExistsValidator = v.object({
	document: v.string(),
	bytes: v.bytes(),
	seq: v.number(),
	type: v.string(),
	exists: v.boolean()
});
/**
* Stream query result with changes, cursor, and compaction hints.
*/
const streamResultValidator = v.object({
	changes: v.array(streamChangeValidator),
	seq: v.number(),
	more: v.boolean(),
	compact: v.optional(v.object({ documents: v.array(v.string()) }))
});
/**
* Stream result with exists flag on changes (server-enriched response).
*/
const streamResultWithExistsValidator = v.object({
	changes: v.array(streamChangeWithExistsValidator),
	seq: v.number(),
	more: v.boolean(),
	compact: v.optional(v.object({ documents: v.array(v.string()) }))
});
/**
* Session record for presence tracking.
* Returned by sessions query.
*/
const sessionValidator = v.object({
	client: v.string(),
	document: v.string(),
	user: v.optional(v.string()),
	profile: v.optional(v.any()),
	cursor: v.optional(cursorValidator),
	seen: v.number()
});
/**
* Presence action (join or leave).
* @deprecated Use sessionActionValidator instead
*/
const presenceActionValidator = v.union(v.literal("join"), v.literal("leave"));
/**
* Replicate mutation type - combines insert/update/delete.
*/
const replicateTypeValidator = v.union(v.literal("insert"), v.literal("update"), v.literal("delete"));
/**
* Session action - combines presence (join/leave) and mark (mark/signal).
*/
const sessionActionValidator = v.union(v.literal("join"), v.literal("leave"), v.literal("mark"), v.literal("signal"));
/**
* Standard success/seq result for insert/update/delete mutations.
*/
const successSeqValidator = v.object({
	success: v.boolean(),
	seq: v.number()
});
/**
* Compaction result with statistics.
*/
const compactResultValidator = v.object({
	success: v.boolean(),
	removed: v.number(),
	retained: v.number(),
	size: v.number()
});
/**
* Recovery query result with optional diff and state vector.
*/
const recoveryResultValidator = v.object({
	diff: v.optional(v.bytes()),
	vector: v.bytes()
});
/**
* Document state result (for SSR/hydration).
*/
const documentStateValidator = v.union(v.object({
	bytes: v.bytes(),
	seq: v.number()
}), v.null());
/**
* SSR material query result (non-paginated, backward compatible).
*/
const materialResultValidator = v.object({
	documents: v.any(),
	count: v.number(),
	crdt: v.optional(v.record(v.string(), v.object({
		bytes: v.bytes(),
		seq: v.number()
	}))),
	cursor: v.optional(v.number())
});
const DURATION_MULTIPLIERS = {
	m: 6e4,
	h: 36e5,
	d: 864e5
};
function parseDuration(s) {
	const match = /^(\d+)(m|h|d)$/i.exec(s);
	if (!match) throw new Error(`Invalid duration: ${s}`);
	const [, num, unit] = match;
	return parseInt(num) * DURATION_MULTIPLIERS[unit.toLowerCase()];
}

//#endregion
//#region src/server/collection.ts
function createCollection(component, name, options) {
	return createCollectionInternal(component, name, options);
}
const collection = { create: createCollection };
function createCollectionInternal(component, name, options) {
	const storage = new Replicate(component, name, options?.compaction);
	const hooks = options?.hooks;
	const view = options?.view;
	return {
		__collection: name,
		material: storage.createMaterialQuery({
			view,
			transform: hooks?.transform
		}),
		delta: storage.createDeltaQuery({
			view,
			onDelta: hooks?.onDelta
		}),
		replicate: storage.createReplicateMutation({
			evalWrite: hooks?.evalWrite,
			evalRemove: hooks?.evalRemove,
			onInsert: hooks?.onInsert,
			onUpdate: hooks?.onUpdate,
			onRemove: hooks?.onRemove
		}),
		presence: storage.createSessionMutation({
			view,
			evalSession: hooks?.evalSession
		}),
		session: storage.createSessionQuery({ view })
	};
}

//#endregion
//#region src/server/schema.ts
const prose = () => proseValidator;
/**
* Define a table with automatic timestamp field for replication.
* All replicated tables must have an `id` field and define a `by_doc_id` index.
*
* @example
* ```typescript
* // convex/schema.ts
* export default defineSchema({
*   tasks: table(
*     { id: v.string(), text: v.string(), isCompleted: v.boolean() },
*     (t) => t.index('by_doc_id', ['id']).index('by_completed', ['isCompleted'])
*   ),
* });
* ```
*/
function table(userFields, applyIndexes) {
	const tbl = defineTable({
		...userFields,
		timestamp: v.number()
	});
	if (applyIndexes) return applyIndexes(tbl);
	return tbl;
}

//#endregion
//#region src/server/migration.ts
/**
* Detect field type from a Convex validator.
* This uses the validator's internal structure to determine the type.
*/
function detectFieldType(validator) {
	const v$1 = validator;
	if (v$1.kind === "object") {
		const inner = validator.fields;
		if (inner && "type" in inner && "content" in inner) return "prose";
		return "object";
	}
	switch (v$1.kind) {
		case "string": return "string";
		case "number":
		case "float64":
		case "int64": return "number";
		case "boolean": return "boolean";
		case "null": return "null";
		case "array": return "array";
		case "object": return "object";
		default: return "object";
	}
}
/**
* Extract field names from a Convex object validator.
*/
function extractFields(validator) {
	const fields = /* @__PURE__ */ new Map();
	const v$1 = validator;
	if (v$1.kind === "object" && v$1.fields) for (const [name, fieldValidator] of Object.entries(v$1.fields)) fields.set(name, fieldValidator);
	return fields;
}
/**
* Map field type to SQLite type.
*/
function fieldTypeToSQL(fieldType) {
	switch (fieldType) {
		case "string":
		case "prose": return "TEXT";
		case "number": return "REAL";
		case "boolean": return "INTEGER";
		case "null": return "TEXT";
		case "array":
		case "object": return "TEXT";
		default: return "TEXT";
	}
}
/**
* Escape SQL literal value.
*/
function sqlLiteral(value) {
	if (value === null || value === void 0) return "NULL";
	if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "1" : "0";
	return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}
/**
* Validate SQL identifier to prevent injection.
*/
function validateIdentifier(name) {
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Invalid SQL identifier: "${name}"`);
	return `"${name}"`;
}
/**
* Compute the diff between two schema versions.
*/
function computeSchemaDiff(fromValidator, toValidator, fromVersion, toVersion, defaults) {
	const operations = [];
	const generatedSQL = [];
	const fromFields = extractFields(fromValidator);
	const toFields = extractFields(toValidator);
	for (const [name, validator] of toFields) if (!fromFields.has(name)) {
		const fieldType = detectFieldType(validator);
		const defaultValue = defaults[name];
		operations.push({
			type: "add_column",
			column: name,
			fieldType,
			defaultValue
		});
		const sqlType = fieldTypeToSQL(fieldType);
		const colName = validateIdentifier(name);
		const def = defaultValue !== void 0 ? ` DEFAULT ${sqlLiteral(defaultValue)}` : "";
		generatedSQL.push(`ALTER TABLE %TABLE% ADD COLUMN ${colName} ${sqlType}${def}`);
	}
	for (const [name] of fromFields) if (!toFields.has(name)) {
		operations.push({
			type: "remove_column",
			column: name
		});
		const colName = validateIdentifier(name);
		generatedSQL.push(`ALTER TABLE %TABLE% DROP COLUMN ${colName}`);
	}
	for (const [name, toFieldValidator] of toFields) {
		const fromFieldValidator = fromFields.get(name);
		if (fromFieldValidator) {
			const fromType = detectFieldType(fromFieldValidator);
			const toType = detectFieldType(toFieldValidator);
			if (fromType !== toType) operations.push({
				type: "change_type",
				column: name,
				from: fromType,
				to: toType
			});
		}
	}
	return {
		fromVersion,
		toVersion,
		operations,
		isBackwardsCompatible: operations.every((op) => {
			if (op.type === "add_column") return op.defaultValue !== void 0;
			return false;
		}),
		generatedSQL
	};
}
/**
* Define a versioned schema with migration capabilities.
*
* @example
* ```typescript
* import { schema } from "@trestleinc/replicate/server";
* import { v } from "convex/values";
*
* export const taskSchema = schema.define({
*   version: 2,
*   shape: v.object({
*     id: v.string(),
*     title: v.string(),
*     priority: v.optional(v.string()),
*     content: schema.prose(),
*   }),
*   defaults: {
*     priority: "medium",
*   },
*   history: {
*     1: v.object({
*       id: v.string(),
*       title: v.string(),
*       content: schema.prose(),
*     }),
*   },
* });
* ```
*/
function define(options) {
	const { version, shape, defaults = {}, history = {} } = options;
	const allVersions = {
		...history,
		[version]: shape
	};
	const versionedSchema = {
		version,
		shape,
		defaults,
		history: allVersions,
		getVersion(v$1) {
			const validator = allVersions[v$1];
			if (!validator) throw new Error(`Schema version ${v$1} not found. Available: ${Object.keys(allVersions).join(", ")}`);
			return validator;
		},
		diff(fromVersion, toVersion) {
			return computeSchemaDiff(this.getVersion(fromVersion), this.getVersion(toVersion), fromVersion, toVersion, defaults);
		},
		migrations(definitions) {
			return {
				schema: versionedSchema,
				definitions
			};
		}
	};
	return versionedSchema;
}

//#endregion
//#region src/server/index.ts
/**
* @trestleinc/replicate - Server exports
*
* Import from '@trestleinc/replicate/server' to use in Convex functions.
*/
const schema = {
	table,
	prose,
	define
};
const DEFAULT_THRESHOLD = 500;
const DEFAULT_TIMEOUT_MS = 1440 * 60 * 1e3;
var Replicate = class {
	constructor(component, collectionName, compaction) {
		this.component = component;
		this.collectionName = collectionName;
		this.threshold = compaction?.threshold ?? DEFAULT_THRESHOLD;
		this.timeout = compaction?.timeout ? parseDuration(compaction.timeout) : DEFAULT_TIMEOUT_MS;
		this.retain = compaction?.retain ?? 0;
	}
	createStreamQuery(opts) {
		const component = this.component;
		const collection$1 = this.collectionName;
		return queryGeneric({
			args: {
				seq: v.number(),
				limit: v.optional(v.number()),
				threshold: v.optional(v.number())
			},
			returns: streamResultWithExistsValidator,
			handler: async (ctx, args) => {
				const result = await ctx.runQuery(component.mutations.stream, {
					collection: collection$1,
					seq: args.seq,
					limit: args.limit,
					threshold: args.threshold
				});
				const docIdSet = /* @__PURE__ */ new Set();
				for (const change of result.changes) docIdSet.add(change.document);
				const existingDocs = /* @__PURE__ */ new Set();
				for (const docId of docIdSet) {
					if (!await ctx.db.query(collection$1).withIndex("by_doc_id", (q) => q.eq("id", docId)).first()) continue;
					if (opts?.view) {
						if (await (await opts.view(ctx, ctx.db.query(collection$1))).filter((q) => q.eq(q.field("id"), docId)).first()) existingDocs.add(docId);
					} else existingDocs.add(docId);
				}
				const enrichedChanges = result.changes.map((c) => ({
					...c,
					exists: existingDocs.has(c.document)
				}));
				const enrichedResult = {
					...result,
					changes: enrichedChanges
				};
				if (opts?.onStream) await opts.onStream(ctx, enrichedResult);
				return enrichedResult;
			}
		});
	}
	createMaterialQuery(opts) {
		const collection$1 = this.collectionName;
		return queryGeneric({
			args: {
				numItems: v.optional(v.number()),
				cursor: v.optional(v.string())
			},
			returns: v.any(),
			handler: async (ctx, args) => {
				const query = opts?.view ? await opts.view(ctx, ctx.db.query(collection$1)) : ctx.db.query(collection$1).withIndex("by_timestamp").order("desc");
				if (args.numItems !== void 0) {
					const result = await query.paginate({
						numItems: args.numItems,
						cursor: args.cursor ?? null
					});
					let docs$1 = result.page;
					if (opts?.transform) docs$1 = await opts.transform(docs$1);
					return {
						page: docs$1,
						isDone: result.isDone,
						continueCursor: result.continueCursor
					};
				}
				let docs = await query.collect();
				if (opts?.transform) docs = await opts.transform(docs);
				return {
					documents: docs,
					count: docs.length
				};
			}
		});
	}
	createInsertMutation(opts) {
		const component = this.component;
		const collection$1 = this.collectionName;
		const { threshold, timeout, retain } = this;
		return mutationGeneric({
			args: {
				document: v.string(),
				bytes: v.bytes(),
				material: v.any()
			},
			returns: successSeqValidator,
			handler: async (ctx, args) => {
				const doc = args.material;
				if (opts?.evalWrite) await opts.evalWrite(ctx, doc);
				await ctx.db.insert(collection$1, {
					id: args.document,
					...args.material,
					timestamp: Date.now()
				});
				const result = await ctx.runMutation(component.mutations.insertDocument, {
					collection: collection$1,
					document: args.document,
					bytes: args.bytes,
					threshold,
					timeout,
					retain
				});
				if (opts?.onInsert) await opts.onInsert(ctx, doc);
				return {
					success: true,
					seq: result.seq
				};
			}
		});
	}
	createUpdateMutation(opts) {
		const component = this.component;
		const collection$1 = this.collectionName;
		const { threshold, timeout, retain } = this;
		return mutationGeneric({
			args: {
				document: v.string(),
				bytes: v.bytes(),
				material: v.any()
			},
			returns: successSeqValidator,
			handler: async (ctx, args) => {
				const doc = args.material;
				if (opts?.evalWrite) await opts.evalWrite(ctx, doc);
				const existing = await ctx.db.query(collection$1).withIndex("by_doc_id", (q) => q.eq("id", args.document)).first();
				if (existing) await ctx.db.patch(existing._id, {
					...args.material,
					timestamp: Date.now()
				});
				const result = await ctx.runMutation(component.mutations.updateDocument, {
					collection: collection$1,
					document: args.document,
					bytes: args.bytes,
					threshold,
					timeout,
					retain
				});
				if (opts?.onUpdate) await opts.onUpdate(ctx, doc);
				return {
					success: true,
					seq: result.seq
				};
			}
		});
	}
	createRemoveMutation(opts) {
		const component = this.component;
		const collection$1 = this.collectionName;
		const { threshold, timeout, retain } = this;
		return mutationGeneric({
			args: {
				document: v.string(),
				bytes: v.bytes()
			},
			returns: successSeqValidator,
			handler: async (ctx, args) => {
				if (opts?.evalRemove) await opts.evalRemove(ctx, args.document);
				const existing = await ctx.db.query(collection$1).withIndex("by_doc_id", (q) => q.eq("id", args.document)).first();
				if (existing) await ctx.db.delete(existing._id);
				const result = await ctx.runMutation(component.mutations.deleteDocument, {
					collection: collection$1,
					document: args.document,
					bytes: args.bytes,
					threshold,
					timeout,
					retain
				});
				if (opts?.onRemove) await opts.onRemove(ctx, args.document);
				return {
					success: true,
					seq: result.seq
				};
			}
		});
	}
	createMarkMutation(opts) {
		const component = this.component;
		const collection$1 = this.collectionName;
		return mutationGeneric({
			args: {
				document: v.string(),
				client: v.string(),
				seq: v.optional(v.number()),
				vector: v.optional(v.bytes())
			},
			returns: v.null(),
			handler: async (ctx, args) => {
				if (opts?.evalWrite) await opts.evalWrite(ctx, args.client);
				await ctx.runMutation(component.mutations.mark, {
					collection: collection$1,
					document: args.document,
					client: args.client,
					seq: args.seq,
					vector: args.vector
				});
				return null;
			}
		});
	}
	createReplicateMutation(opts) {
		const component = this.component;
		const collection$1 = this.collectionName;
		const { threshold, timeout, retain } = this;
		return mutationGeneric({
			args: {
				document: v.string(),
				bytes: v.bytes(),
				material: v.optional(v.any()),
				type: replicateTypeValidator
			},
			returns: successSeqValidator,
			handler: async (ctx, args) => {
				const { document, bytes, material, type } = args;
				if (type === "delete") {
					if (opts?.evalRemove) await opts.evalRemove(ctx, document);
					const existing$1 = await ctx.db.query(collection$1).withIndex("by_doc_id", (q) => q.eq("id", document)).first();
					if (existing$1) await ctx.db.delete(existing$1._id);
					const result$1 = await ctx.runMutation(component.mutations.deleteDocument, {
						collection: collection$1,
						document,
						bytes,
						threshold,
						timeout,
						retain
					});
					if (opts?.onRemove) await opts.onRemove(ctx, document);
					return {
						success: true,
						seq: result$1.seq
					};
				}
				const doc = material;
				if (opts?.evalWrite) await opts.evalWrite(ctx, doc);
				if (type === "insert") {
					await ctx.db.insert(collection$1, {
						id: document,
						...material,
						timestamp: Date.now()
					});
					const result$1 = await ctx.runMutation(component.mutations.insertDocument, {
						collection: collection$1,
						document,
						bytes,
						threshold,
						timeout,
						retain
					});
					if (opts?.onInsert) await opts.onInsert(ctx, doc);
					return {
						success: true,
						seq: result$1.seq
					};
				}
				const existing = await ctx.db.query(collection$1).withIndex("by_doc_id", (q) => q.eq("id", document)).first();
				if (existing) await ctx.db.patch(existing._id, {
					...material,
					timestamp: Date.now()
				});
				const result = await ctx.runMutation(component.mutations.updateDocument, {
					collection: collection$1,
					document,
					bytes,
					threshold,
					timeout,
					retain
				});
				if (opts?.onUpdate) await opts.onUpdate(ctx, doc);
				return {
					success: true,
					seq: result.seq
				};
			}
		});
	}
	createSessionMutation(opts) {
		const component = this.component;
		const collection$1 = this.collectionName;
		return mutationGeneric({
			args: {
				document: v.string(),
				client: v.string(),
				action: sessionActionValidator,
				user: v.optional(v.string()),
				profile: v.optional(profileValidator),
				cursor: v.optional(cursorValidator),
				interval: v.optional(v.number()),
				vector: v.optional(v.bytes()),
				seq: v.optional(v.number())
			},
			returns: v.null(),
			handler: async (ctx, args) => {
				if (opts?.view) {
					if (!await (await opts.view(ctx, ctx.db.query(collection$1))).filter((q) => q.eq(q.field("id"), args.document)).first()) return null;
				}
				if (opts?.evalSession) await opts.evalSession(ctx, args.client);
				const { action, document, client, user, profile, cursor, interval, vector, seq } = args;
				if (action === "mark") {
					await ctx.runMutation(component.mutations.mark, {
						collection: collection$1,
						document,
						client,
						seq,
						vector
					});
					return null;
				}
				if (action === "signal") {
					if (seq !== void 0 || vector !== void 0) await ctx.runMutation(component.mutations.mark, {
						collection: collection$1,
						document,
						client,
						seq,
						vector
					});
					await ctx.runMutation(component.mutations.presence, {
						collection: collection$1,
						document,
						client,
						action: "join",
						user,
						profile,
						cursor,
						interval,
						vector
					});
					return null;
				}
				const presenceAction = action === "join" || action === "leave" ? action : "join";
				await ctx.runMutation(component.mutations.presence, {
					collection: collection$1,
					document,
					client,
					action: presenceAction,
					user,
					profile,
					cursor,
					interval,
					vector
				});
				return null;
			}
		});
	}
	createDeltaQuery(opts) {
		const component = this.component;
		const collection$1 = this.collectionName;
		return queryGeneric({
			args: {
				seq: v.optional(v.number()),
				limit: v.optional(v.number()),
				threshold: v.optional(v.number()),
				document: v.optional(v.string()),
				vector: v.optional(v.bytes())
			},
			returns: v.any(),
			handler: async (ctx, args) => {
				if (args.vector !== void 0 && args.document === void 0) throw new Error("'document' is required when 'vector' is provided");
				if (args.vector !== void 0 && args.document !== void 0) return {
					mode: "recovery",
					...await ctx.runQuery(component.mutations.recovery, {
						collection: collection$1,
						document: args.document,
						vector: args.vector
					})
				};
				const result = await ctx.runQuery(component.mutations.stream, {
					collection: collection$1,
					seq: args.seq ?? 0,
					limit: args.limit,
					threshold: args.threshold
				});
				const docIdSet = /* @__PURE__ */ new Set();
				for (const change of result.changes) docIdSet.add(change.document);
				const existingDocs = /* @__PURE__ */ new Set();
				for (const docId of docIdSet) {
					if (!await ctx.db.query(collection$1).withIndex("by_doc_id", (q) => q.eq("id", docId)).first()) continue;
					if (opts?.view) {
						if (await (await opts.view(ctx, ctx.db.query(collection$1))).filter((q) => q.eq(q.field("id"), docId)).first()) existingDocs.add(docId);
					} else existingDocs.add(docId);
				}
				const enrichedChanges = result.changes.map((c) => ({
					...c,
					exists: existingDocs.has(c.document)
				}));
				const enrichedResult = {
					mode: "stream",
					...result,
					changes: enrichedChanges
				};
				if (opts?.onDelta) await opts.onDelta(ctx, enrichedResult);
				return enrichedResult;
			}
		});
	}
	createSessionQuery(opts) {
		const component = this.component;
		const collection$1 = this.collectionName;
		return queryGeneric({
			args: {
				document: v.string(),
				connected: v.optional(v.boolean()),
				exclude: v.optional(v.string())
			},
			returns: v.array(sessionValidator),
			handler: async (ctx, args) => {
				if (opts?.view) {
					if (!await (await opts.view(ctx, ctx.db.query(collection$1))).filter((q) => q.eq(q.field("id"), args.document)).first()) return [];
				}
				return await ctx.runQuery(component.mutations.sessions, {
					collection: collection$1,
					document: args.document,
					connected: args.connected,
					exclude: args.exclude
				});
			}
		});
	}
};

//#endregion
export { Replicate, collection, schema };
//# sourceMappingURL=index.js.map