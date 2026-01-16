import { mutation, query } from "./_generated/server.js";
import { api } from "./_generated/api.js";
import { getLogger } from "./shared/logger.js";
import { OperationType, compactResultValidator, cursorValidator, documentStateValidator, presenceActionValidator, profileValidator, recoveryResultValidator, sessionValidator, streamResultValidator, successSeqValidator } from "./shared/index.js";
import { v } from "convex/values";
import * as Y from "yjs";

//#region src/component/mutations.ts
const DEFAULT_THRESHOLD = 500;
const DEFAULT_TIMEOUT = 1440 * 60 * 1e3;
const MAX_RETRIES = 3;
async function getNextSeq(ctx, collection) {
	return ((await ctx.db.query("deltas").withIndex("by_seq", (q) => q.eq("collection", collection)).order("desc").first())?.seq ?? 0) + 1;
}
async function incrementDeltaCount(ctx, collection, document) {
	const existing = await ctx.db.query("deltaCounts").withIndex("by_document", (q) => q.eq("collection", collection).eq("document", document)).first();
	if (existing) {
		const newCount = existing.count + 1;
		await ctx.db.patch(existing._id, { count: newCount });
		return newCount;
	}
	await ctx.db.insert("deltaCounts", {
		collection,
		document,
		count: 1
	});
	return 1;
}
async function decrementDeltaCount(ctx, collection, document, amount) {
	const existing = await ctx.db.query("deltaCounts").withIndex("by_document", (q) => q.eq("collection", collection).eq("document", document)).first();
	if (existing) {
		const newCount = Math.max(0, existing.count - amount);
		await ctx.db.patch(existing._id, { count: newCount });
	}
}
async function scheduleCompactionIfNeeded(ctx, collection, document, currentCount, threshold = DEFAULT_THRESHOLD, timeout = DEFAULT_TIMEOUT, retain = 0) {
	if (currentCount >= threshold) await ctx.runMutation(api.mutations.scheduleCompaction, {
		collection,
		document,
		timeout,
		retain
	});
}
const insertDocument = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		bytes: v.bytes(),
		threshold: v.optional(v.number()),
		timeout: v.optional(v.number()),
		retain: v.optional(v.number())
	},
	returns: successSeqValidator,
	handler: async (ctx, args) => {
		const seq = await getNextSeq(ctx, args.collection);
		await ctx.db.insert("deltas", {
			collection: args.collection,
			document: args.document,
			bytes: args.bytes,
			seq
		});
		const count = await incrementDeltaCount(ctx, args.collection, args.document);
		await scheduleCompactionIfNeeded(ctx, args.collection, args.document, count, args.threshold ?? DEFAULT_THRESHOLD, args.timeout ?? DEFAULT_TIMEOUT, args.retain ?? 0);
		return {
			success: true,
			seq
		};
	}
});
const updateDocument = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		bytes: v.bytes(),
		threshold: v.optional(v.number()),
		timeout: v.optional(v.number()),
		retain: v.optional(v.number())
	},
	returns: successSeqValidator,
	handler: async (ctx, args) => {
		const seq = await getNextSeq(ctx, args.collection);
		await ctx.db.insert("deltas", {
			collection: args.collection,
			document: args.document,
			bytes: args.bytes,
			seq
		});
		const count = await incrementDeltaCount(ctx, args.collection, args.document);
		await scheduleCompactionIfNeeded(ctx, args.collection, args.document, count, args.threshold ?? DEFAULT_THRESHOLD, args.timeout ?? DEFAULT_TIMEOUT, args.retain ?? 0);
		return {
			success: true,
			seq
		};
	}
});
const deleteDocument = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		bytes: v.bytes(),
		threshold: v.optional(v.number()),
		timeout: v.optional(v.number()),
		retain: v.optional(v.number())
	},
	returns: successSeqValidator,
	handler: async (ctx, args) => {
		const seq = await getNextSeq(ctx, args.collection);
		await ctx.db.insert("deltas", {
			collection: args.collection,
			document: args.document,
			bytes: args.bytes,
			seq
		});
		const count = await incrementDeltaCount(ctx, args.collection, args.document);
		await scheduleCompactionIfNeeded(ctx, args.collection, args.document, count, args.threshold ?? DEFAULT_THRESHOLD, args.timeout ?? DEFAULT_TIMEOUT, args.retain ?? 0);
		return {
			success: true,
			seq
		};
	}
});
const DEFAULT_HEARTBEAT_INTERVAL = 1e4;
const mark = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		client: v.string(),
		vector: v.optional(v.bytes()),
		seq: v.optional(v.number())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const now = Date.now();
		const existing = await ctx.db.query("sessions").withIndex("by_client", (q) => q.eq("collection", args.collection).eq("document", args.document).eq("client", args.client)).first();
		const updates = { seen: now };
		if (args.vector !== void 0) updates.vector = args.vector;
		if (args.seq !== void 0) updates.seq = existing ? Math.max(existing.seq, args.seq) : args.seq;
		if (existing) await ctx.db.patch(existing._id, updates);
		else await ctx.db.insert("sessions", {
			collection: args.collection,
			document: args.document,
			client: args.client,
			vector: args.vector,
			connected: false,
			seq: args.seq ?? 0,
			seen: now
		});
		return null;
	}
});
const compact = mutation({
	args: {
		collection: v.string(),
		document: v.string()
	},
	returns: compactResultValidator,
	handler: async (ctx, args) => {
		const logger = getLogger(["compaction"]);
		const now = Date.now();
		const deltas = await ctx.db.query("deltas").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document)).collect();
		if (deltas.length === 0) return {
			success: true,
			removed: 0,
			retained: 0,
			size: 0
		};
		const existing = await ctx.db.query("snapshots").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document)).first();
		const updates = [];
		if (existing) updates.push(new Uint8Array(existing.bytes));
		updates.push(...deltas.map((d) => new Uint8Array(d.bytes)));
		const merged = Y.mergeUpdatesV2(updates);
		const vector = Y.encodeStateVectorFromUpdateV2(merged);
		const sessions$1 = await ctx.db.query("sessions").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document)).filter((q) => q.eq(q.field("connected"), true)).collect();
		let canDeleteAll = true;
		for (const session of sessions$1) {
			if (!session.vector) {
				canDeleteAll = false;
				logger.warn("Session without vector, skipping full compaction", { client: session.client });
				break;
			}
			const sessionVector = new Uint8Array(session.vector);
			const missing = Y.diffUpdateV2(merged, sessionVector);
			if (missing.byteLength > 2) {
				canDeleteAll = false;
				logger.debug("Session still needs data", {
					client: session.client,
					missingSize: missing.byteLength
				});
				break;
			}
		}
		const seq = Math.max(...deltas.map((d) => d.seq));
		if (existing) await ctx.db.patch(existing._id, {
			bytes: merged.buffer,
			vector: vector.buffer,
			seq,
			created: now
		});
		else await ctx.db.insert("snapshots", {
			collection: args.collection,
			document: args.document,
			bytes: merged.buffer,
			vector: vector.buffer,
			seq,
			created: now
		});
		let removed = 0;
		if (canDeleteAll) {
			for (const delta of deltas) {
				await ctx.db.delete(delta._id);
				removed++;
			}
			if (removed > 0) await decrementDeltaCount(ctx, args.collection, args.document, removed);
			logger.info("Full compaction completed", {
				document: args.document,
				removed,
				size: merged.byteLength
			});
		} else logger.info("Snapshot created, deltas retained (clients still syncing)", {
			document: args.document,
			deltaCount: deltas.length,
			activeCount: sessions$1.length
		});
		const disconnected = await ctx.db.query("sessions").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document)).filter((q) => q.eq(q.field("connected"), false)).collect();
		let cleaned = 0;
		for (const session of disconnected) {
			if (!session.vector) {
				await ctx.db.delete(session._id);
				cleaned++;
				continue;
			}
			const sessionVector = new Uint8Array(session.vector);
			if (Y.diffUpdateV2(merged, sessionVector).byteLength <= 2) {
				await ctx.db.delete(session._id);
				cleaned++;
			}
		}
		if (cleaned > 0) logger.info("Cleaned up disconnected sessions", {
			document: args.document,
			cleaned
		});
		return {
			success: true,
			removed,
			retained: deltas.length - removed,
			size: merged.byteLength
		};
	}
});
const scheduleCompaction = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		timeout: v.optional(v.number()),
		retain: v.optional(v.number())
	},
	returns: v.object({
		id: v.optional(v.id("compaction")),
		status: v.union(v.literal("scheduled"), v.literal("already_running"), v.literal("already_pending"))
	}),
	handler: async (ctx, args) => {
		const existing = await ctx.db.query("compaction").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document).eq("status", "running")).first();
		if (existing) return {
			id: existing._id,
			status: "already_running"
		};
		const pending = await ctx.db.query("compaction").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document).eq("status", "pending")).first();
		if (pending) return {
			id: pending._id,
			status: "already_pending"
		};
		const id = await ctx.db.insert("compaction", {
			collection: args.collection,
			document: args.document,
			status: "pending",
			started: Date.now(),
			retries: 0
		});
		await ctx.scheduler.runAfter(0, api.mutations.runCompaction, {
			id,
			timeout: args.timeout,
			retain: args.retain
		});
		return {
			id,
			status: "scheduled"
		};
	}
});
const runCompaction = mutation({
	args: {
		id: v.id("compaction"),
		timeout: v.optional(v.number()),
		retain: v.optional(v.number())
	},
	returns: v.union(v.null(), v.object({
		removed: v.number(),
		retained: v.number()
	})),
	handler: async (ctx, args) => {
		const logger = getLogger(["compaction"]);
		const job = await ctx.db.get(args.id);
		if (!job || job.status === "done") return null;
		await ctx.db.patch(args.id, { status: "running" });
		const now = Date.now();
		const timeout = args.timeout ?? DEFAULT_TIMEOUT;
		const retain = args.retain ?? 0;
		try {
			const deltas = await ctx.db.query("deltas").withIndex("by_document", (q) => q.eq("collection", job.collection).eq("document", job.document)).collect();
			if (deltas.length === 0) {
				await ctx.db.patch(args.id, {
					status: "done",
					completed: now
				});
				return {
					removed: 0,
					retained: 0
				};
			}
			const snapshot = await ctx.db.query("snapshots").withIndex("by_document", (q) => q.eq("collection", job.collection).eq("document", job.document)).first();
			const updates = [];
			if (snapshot) updates.push(new Uint8Array(snapshot.bytes));
			updates.push(...deltas.map((d) => new Uint8Array(d.bytes)));
			const merged = Y.mergeUpdatesV2(updates);
			const vector = Y.encodeStateVectorFromUpdateV2(merged);
			const sessions$1 = await ctx.db.query("sessions").withIndex("by_document", (q) => q.eq("collection", job.collection).eq("document", job.document)).collect();
			let canDeleteAll = true;
			for (const session of sessions$1) {
				if (!(session.connected || now - session.seen < timeout)) continue;
				if (!session.vector) {
					canDeleteAll = false;
					logger.warn("Active session without vector, skipping full compaction", { client: session.client });
					break;
				}
				const sessionVector = new Uint8Array(session.vector);
				const missing = Y.diffUpdateV2(merged, sessionVector);
				if (missing.byteLength > 2) {
					canDeleteAll = false;
					logger.debug("Active session still needs data", {
						client: session.client,
						missingSize: missing.byteLength
					});
					break;
				}
			}
			const seq = Math.max(...deltas.map((d) => d.seq));
			if (snapshot) await ctx.db.patch(snapshot._id, {
				bytes: merged.buffer,
				vector: vector.buffer,
				seq,
				created: now
			});
			else await ctx.db.insert("snapshots", {
				collection: job.collection,
				document: job.document,
				bytes: merged.buffer,
				vector: vector.buffer,
				seq,
				created: now
			});
			let removed = 0;
			if (canDeleteAll) {
				const sortedDeltas = [...deltas].sort((a, b) => b.seq - a.seq);
				const deltasToRetain = sortedDeltas.slice(0, retain);
				const deltasToDelete = sortedDeltas.slice(retain);
				const retainIds = new Set(deltasToRetain.map((d) => d._id));
				for (const delta of deltasToDelete) if (!retainIds.has(delta._id)) {
					await ctx.db.delete(delta._id);
					removed++;
				}
				if (removed > 0) await decrementDeltaCount(ctx, job.collection, job.document, removed);
				logger.info("Compaction completed", {
					document: job.document,
					removed,
					retained: deltasToRetain.length,
					size: merged.byteLength
				});
			} else logger.info("Snapshot created, deltas retained (clients still syncing)", {
				document: job.document,
				deltaCount: deltas.length,
				activeCount: sessions$1.filter((s) => s.connected || now - s.seen < timeout).length
			});
			for (const session of sessions$1) {
				if (session.connected) continue;
				if (now - session.seen > timeout) {
					await ctx.db.delete(session._id);
					logger.debug("Cleaned up stale session", { client: session.client });
				}
			}
			await ctx.db.patch(args.id, {
				status: "done",
				completed: now
			});
			return {
				removed,
				retained: deltas.length - removed
			};
		} catch (error) {
			const retries = (job.retries ?? 0) + 1;
			if (retries < MAX_RETRIES) {
				await ctx.db.patch(args.id, {
					status: "pending",
					retries
				});
				const backoff = Math.pow(2, retries) * 1e3;
				await ctx.scheduler.runAfter(backoff, api.mutations.runCompaction, {
					id: args.id,
					timeout: args.timeout,
					retain: args.retain
				});
				logger.warn("Compaction failed, scheduling retry", {
					document: job.document,
					retries,
					backoff
				});
			} else {
				await ctx.db.patch(args.id, {
					status: "failed",
					error: String(error),
					completed: now
				});
				logger.error("Compaction failed after max retries", {
					document: job.document,
					error: String(error)
				});
			}
			throw error;
		}
	}
});
const stream = query({
	args: {
		collection: v.string(),
		seq: v.number(),
		limit: v.optional(v.number()),
		threshold: v.optional(v.number())
	},
	returns: streamResultValidator,
	handler: async (ctx, args) => {
		const limit = args.limit ?? 100;
		const documents = await ctx.db.query("deltas").withIndex("by_seq", (q) => q.eq("collection", args.collection).gt("seq", args.seq)).order("asc").take(limit);
		if (documents.length > 0) return {
			changes: documents.map((doc) => ({
				document: doc.document,
				bytes: doc.bytes,
				seq: doc.seq,
				type: OperationType.Delta
			})),
			seq: documents[documents.length - 1]?.seq ?? args.seq,
			more: documents.length === limit,
			compact: void 0
		};
		const oldest = await ctx.db.query("deltas").withIndex("by_seq", (q) => q.eq("collection", args.collection)).order("asc").first();
		if (oldest && args.seq < oldest.seq) {
			const snapshots = await ctx.db.query("snapshots").withIndex("by_document", (q) => q.eq("collection", args.collection)).collect();
			if (snapshots.length === 0) throw new Error(`Disparity detected but no snapshots available for collection: ${args.collection}. Client seq: ${args.seq}, Oldest delta seq: ${oldest.seq}`);
			return {
				changes: snapshots.map((s) => ({
					document: s.document,
					bytes: s.bytes,
					seq: s.seq,
					type: OperationType.Snapshot
				})),
				seq: Math.max(...snapshots.map((s) => s.seq)),
				more: false,
				compact: void 0
			};
		}
		return {
			changes: [],
			seq: args.seq,
			more: false,
			compact: void 0
		};
	}
});
const recovery = query({
	args: {
		collection: v.string(),
		document: v.string(),
		vector: v.bytes()
	},
	returns: recoveryResultValidator,
	handler: async (ctx, args) => {
		const snapshot = await ctx.db.query("snapshots").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document)).first();
		const deltas = await ctx.db.query("deltas").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document)).collect();
		if (!snapshot && deltas.length === 0) {
			const emptyDoc = new Y.Doc();
			const emptyVector = Y.encodeStateVector(emptyDoc);
			emptyDoc.destroy();
			return { vector: emptyVector.buffer };
		}
		const updates = [];
		if (snapshot) updates.push(new Uint8Array(snapshot.bytes));
		for (const delta of deltas) updates.push(new Uint8Array(delta.bytes));
		const merged = Y.mergeUpdatesV2(updates);
		const clientVector = new Uint8Array(args.vector);
		const diff = Y.diffUpdateV2(merged, clientVector);
		const serverVector = Y.encodeStateVectorFromUpdateV2(merged);
		return {
			diff: diff.byteLength > 0 ? diff.buffer : void 0,
			vector: serverVector.buffer
		};
	}
});
const getDocumentState = query({
	args: {
		collection: v.string(),
		document: v.string()
	},
	returns: documentStateValidator,
	handler: async (ctx, args) => {
		const snapshot = await ctx.db.query("snapshots").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document)).first();
		const deltas = await ctx.db.query("deltas").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document)).collect();
		if (!snapshot && deltas.length === 0) return null;
		const updates = [];
		let latestSeq = 0;
		if (snapshot) {
			updates.push(new Uint8Array(snapshot.bytes));
			latestSeq = Math.max(latestSeq, snapshot.seq);
		}
		for (const delta of deltas) {
			updates.push(new Uint8Array(delta.bytes));
			latestSeq = Math.max(latestSeq, delta.seq);
		}
		return {
			bytes: Y.mergeUpdatesV2(updates).buffer,
			seq: latestSeq
		};
	}
});
const sessions = query({
	args: {
		collection: v.string(),
		document: v.string(),
		connected: v.optional(v.boolean()),
		exclude: v.optional(v.string())
	},
	returns: v.array(sessionValidator),
	handler: async (ctx, args) => {
		let query$1 = ctx.db.query("sessions").withIndex("by_document", (q) => q.eq("collection", args.collection).eq("document", args.document));
		if (args.connected !== void 0) query$1 = query$1.filter((q) => q.eq(q.field("connected"), args.connected));
		const mapped = (await query$1.collect()).filter((p) => !args.exclude || p.client !== args.exclude).map((p) => ({
			client: p.client,
			document: p.document,
			user: p.user,
			profile: p.profile,
			cursor: p.cursor,
			seen: p.seen
		}));
		const byUser = /* @__PURE__ */ new Map();
		for (const p of mapped) {
			const key = p.user ?? p.client;
			const existing = byUser.get(key);
			if (!existing || p.seen > existing.seen) byUser.set(key, p);
		}
		return Array.from(byUser.values());
	}
});
const disconnect = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		client: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existing = await ctx.db.query("sessions").withIndex("by_client", (q) => q.eq("collection", args.collection).eq("document", args.document).eq("client", args.client)).first();
		if (existing) await ctx.db.patch(existing._id, {
			connected: false,
			cursor: void 0,
			timeout: void 0
		});
		return null;
	}
});
const presence = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		client: v.string(),
		action: presenceActionValidator,
		user: v.optional(v.string()),
		profile: v.optional(profileValidator),
		cursor: v.optional(cursorValidator),
		interval: v.optional(v.number()),
		vector: v.optional(v.bytes())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existing = await ctx.db.query("sessions").withIndex("by_client", (q) => q.eq("collection", args.collection).eq("document", args.document).eq("client", args.client)).first();
		if (args.action === "leave") {
			if (existing?.timeout) await ctx.scheduler.cancel(existing.timeout);
			if (existing) await ctx.db.patch(existing._id, {
				connected: false,
				cursor: void 0,
				timeout: void 0
			});
			return null;
		}
		const now = Date.now();
		const interval = args.interval ?? DEFAULT_HEARTBEAT_INTERVAL;
		if (existing?.timeout) await ctx.scheduler.cancel(existing.timeout);
		const timeout = await ctx.scheduler.runAfter(interval * 2.5, api.mutations.disconnect, {
			collection: args.collection,
			document: args.document,
			client: args.client
		});
		const updates = {
			connected: true,
			seen: now,
			timeout
		};
		if (args.user !== void 0) updates.user = args.user;
		if (args.profile !== void 0) updates.profile = args.profile;
		if (args.cursor !== void 0) updates.cursor = args.cursor;
		if (args.vector !== void 0) updates.vector = args.vector;
		if (existing) await ctx.db.patch(existing._id, updates);
		else await ctx.db.insert("sessions", {
			collection: args.collection,
			document: args.document,
			client: args.client,
			connected: true,
			seq: 0,
			seen: now,
			user: args.user,
			profile: args.profile,
			cursor: args.cursor,
			vector: args.vector,
			timeout
		});
		return null;
	}
});

//#endregion
export { OperationType, compact, deleteDocument, disconnect, getDocumentState, insertDocument, mark, presence, recovery, runCompaction, scheduleCompaction, sessions, stream, updateDocument };
//# sourceMappingURL=mutations.js.map