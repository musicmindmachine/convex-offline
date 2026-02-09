import * as Y from 'yjs';
import { v, ConvexError } from 'convex/values';
import { action, mutation, query, type ActionCtx, type MutationCtx } from '$/component/_generated/server';
import { api } from '$/component/_generated/api';
import { getLogger } from '$/shared/logger';
import { OperationType } from '$/shared';
import {
	profileValidator,
	cursorValidator,
	streamResultValidator,
	sessionValidator,
	presenceActionValidator,
	successSeqValidator,
	compactResultValidator,
	recoveryResultValidator,
	documentStateValidator,
} from '$/shared';

export { OperationType };

const DEFAULT_THRESHOLD = 500;
const DEFAULT_TIMEOUT = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const COMPACTION_PAGE_SIZE = 100;
const COMPACTION_MAX_PAGES = 8;
const COMPACTION_MAX_DELTAS = 2000;

/**
 * Atomic sequence generation using dedicated counter table.
 *
 * This pattern leverages Convex's OCC (Optimistic Concurrency Control):
 * - If two mutations try to increment the same counter concurrently,
 *   Convex detects the conflict and retries one of them automatically.
 * - This guarantees unique, monotonically increasing sequence numbers.
 *
 * Previous approach (querying max seq from deltas table) had a race condition
 * where concurrent mutations could get the same seq number.
 */
async function getNextSeq(ctx: MutationCtx, collection: string): Promise<number> {
	const existing = await ctx.db
		.query('sequences')
		.withIndex('by_collection', (q) => q.eq('collection', collection))
		.unique();

	if (existing) {
		const nextSeq = existing.seq + 1;
		await ctx.db.patch(existing._id, { seq: nextSeq });
		return nextSeq;
	}

	// Seed from existing deltas to handle migration from old getNextSeq.
	// The previous implementation queried the deltas table directly for max seq.
	// Without this seed, the counter would start at 1, creating duplicate seq
	// numbers and breaking streaming (clients with cursor > 1 would never
	// receive new changes because the stream query uses gt('seq', cursor)).
	const latest = await ctx.db
		.query('deltas')
		.withIndex('by_seq', (q) => q.eq('collection', collection))
		.order('desc')
		.first();
	const startSeq = (latest?.seq ?? 0) + 1;

	await ctx.db.insert('sequences', { collection, seq: startSeq });
	return startSeq;
}

// O(1) delta count increment - called when inserting a delta
async function incrementDeltaCount(
	ctx: MutationCtx,
	collection: string,
	document: string
): Promise<number> {
	const existing = await ctx.db
		.query('deltaCounts')
		.withIndex('by_document', (q) => q.eq('collection', collection).eq('document', document))
		.first();

	if (existing) {
		const newCount = existing.count + 1;
		await ctx.db.patch(existing._id, { count: newCount });
		return newCount;
	}

	await ctx.db.insert('deltaCounts', { collection, document, count: 1 });
	return 1;
}

// O(1) delta count decrement - called when compaction deletes deltas
async function decrementDeltaCount(
	ctx: MutationCtx,
	collection: string,
	document: string,
	amount: number
): Promise<void> {
	const existing = await ctx.db
		.query('deltaCounts')
		.withIndex('by_document', (q) => q.eq('collection', collection).eq('document', document))
		.first();

	if (existing) {
		const newCount = Math.max(0, existing.count - amount);
		await ctx.db.patch(existing._id, { count: newCount });
	}
}

// O(1) compaction threshold check using cached count
async function scheduleCompactionIfNeeded(
	ctx: MutationCtx,
	collection: string,
	document: string,
	currentCount: number,
	threshold: number = DEFAULT_THRESHOLD,
	timeout: number = DEFAULT_TIMEOUT,
	retain: number = 0,
	pageSize?: number,
	maxPages?: number,
	maxDeltas?: number
): Promise<void> {
	if (currentCount >= threshold) {
		await ctx.runMutation(api.mutations.scheduleCompaction, {
			collection,
			document,
			timeout,
			retain,
			pageSize,
			maxPages,
			maxDeltas,
		});
	}
}

const documentWriteArgs = {
	collection: v.string(),
	document: v.string(),
	bytes: v.bytes(),
	exists: v.optional(v.boolean()),
	threshold: v.optional(v.number()),
	timeout: v.optional(v.number()),
	retain: v.optional(v.number()),
	pageSize: v.optional(v.number()),
	maxPages: v.optional(v.number()),
	maxDeltas: v.optional(v.number()),
};

async function handleDocumentWrite(
	ctx: MutationCtx,
	args: {
		collection: string;
		document: string;
		bytes: ArrayBuffer;
		exists?: boolean;
		threshold?: number;
		timeout?: number;
		retain?: number;
		pageSize?: number;
		maxPages?: number;
		maxDeltas?: number;
	}
) {
	const seq = await getNextSeq(ctx, args.collection);

	await ctx.db.insert('deltas', {
		collection: args.collection,
		document: args.document,
		bytes: args.bytes,
		seq,
		exists: args.exists,
	});

	const count = await incrementDeltaCount(ctx, args.collection, args.document);
	await scheduleCompactionIfNeeded(
		ctx,
		args.collection,
		args.document,
		count,
		args.threshold ?? DEFAULT_THRESHOLD,
		args.timeout ?? DEFAULT_TIMEOUT,
		args.retain ?? 0,
		args.pageSize,
		args.maxPages,
		args.maxDeltas
	);

	return { success: true as const, seq };
}

export const insertDocument = mutation({
	args: documentWriteArgs,
	returns: successSeqValidator,
	handler: (ctx, args) => handleDocumentWrite(ctx, { ...args, exists: args.exists ?? true }),
});

export const updateDocument = mutation({
	args: documentWriteArgs,
	returns: successSeqValidator,
	handler: (ctx, args) => handleDocumentWrite(ctx, { ...args, exists: args.exists ?? true }),
});

export const deleteDocument = mutation({
	args: documentWriteArgs,
	returns: successSeqValidator,
	handler: (ctx, args) => handleDocumentWrite(ctx, { ...args, exists: args.exists ?? false }),
});

const DEFAULT_HEARTBEAT_INTERVAL = 10000;

export const mark = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		client: v.string(),
		vector: v.optional(v.bytes()),
		seq: v.optional(v.number()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const now = Date.now();

		const existing = await ctx.db
			.query('sessions')
			.withIndex('by_client', (q) =>
				q.eq('collection', args.collection).eq('document', args.document).eq('client', args.client)
			)
			.first();

		const updates: Record<string, unknown> = {
			seen: now,
		};

		if (args.vector !== undefined) updates.vector = args.vector;
		// Idempotent seq update: only update if new seq is strictly greater
		// This prevents race conditions where a lower seq overwrites a higher one
		if (args.seq !== undefined && (!existing || args.seq > existing.seq)) {
			updates.seq = args.seq;
		}

		if (existing) {
			await ctx.db.patch(existing._id, updates);
		} else {
			await ctx.db.insert('sessions', {
				collection: args.collection,
				document: args.document,
				client: args.client,
				vector: args.vector,
				connected: false,
				seq: args.seq ?? 0,
				seen: now,
			});
		}

		return null;
	},
});

export const compact = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
	},
	returns: compactResultValidator,
	handler: async (ctx, args) => {
		const logger = getLogger(['compaction']);
		const now = Date.now();

		// Get the current max seq at the START of compaction.
		// This establishes our snapshot boundary - prevents TOCTOU race conditions
		// where new deltas arrive during compaction and get incorrectly included.
		const sequenceRecord = await ctx.db
			.query('sequences')
			.withIndex('by_collection', (q) => q.eq('collection', args.collection))
			.unique();
		const snapshotBoundarySeq = sequenceRecord?.seq ?? 0;

		// Query all deltas for this document
		const allDeltas = await ctx.db
			.query('deltas')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.collect();

		// Filter to only include deltas within our boundary
		const deltas = allDeltas.filter((d) => d.seq <= snapshotBoundarySeq);

		if (deltas.length === 0) {
			return { success: true, removed: 0, retained: 0, size: 0 };
		}

		const existing = await ctx.db
			.query('snapshots')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.first();

		const updates: Uint8Array[] = [];
		if (existing) {
			updates.push(new Uint8Array(existing.bytes));
		}
		updates.push(...deltas.map((d) => new Uint8Array(d.bytes)));

		const merged = Y.mergeUpdatesV2(updates);
		const vector = Y.encodeStateVectorFromUpdateV2(merged);

		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.filter((q) => q.eq(q.field('connected'), true))
			.collect();

		let canDeleteAll = true;
		for (const session of sessions) {
			if (!session.vector) {
				canDeleteAll = false;
				logger.warn('Session without vector, skipping full compaction', {
					client: session.client,
				});
				break;
			}

			const sessionVector = new Uint8Array(session.vector);
			const missing = Y.diffUpdateV2(merged, sessionVector);

			if (missing.byteLength > 2) {
				canDeleteAll = false;
				logger.debug('Session still needs data', {
					client: session.client,
					missingSize: missing.byteLength,
				});
				break;
			}
		}

		// Use the boundary seq for the snapshot - this ensures consistency
		// with the deltas we included (all have seq <= snapshotBoundarySeq)
		const seq = snapshotBoundarySeq;

		if (existing) {
			await ctx.db.patch(existing._id, {
				bytes: merged.buffer as ArrayBuffer,
				vector: vector.buffer as ArrayBuffer,
				seq,
				created: now,
			});
		} else {
			await ctx.db.insert('snapshots', {
				collection: args.collection,
				document: args.document,
				bytes: merged.buffer as ArrayBuffer,
				vector: vector.buffer as ArrayBuffer,
				seq,
				created: now,
			});
		}

		let removed = 0;
		if (canDeleteAll) {
			for (const delta of deltas) {
				await ctx.db.delete(delta._id);
				removed++;
			}

			// Decrement delta count to keep it in sync
			if (removed > 0) {
				await decrementDeltaCount(ctx, args.collection, args.document, removed);
			}

			logger.info('Full compaction completed', {
				document: args.document,
				removed,
				size: merged.byteLength,
			});
		} else {
			logger.info('Snapshot created, deltas retained (clients still syncing)', {
				document: args.document,
				deltaCount: deltas.length,
				activeCount: sessions.length,
			});
		}

		const disconnected = await ctx.db
			.query('sessions')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.filter((q) => q.eq(q.field('connected'), false))
			.collect();

		let cleaned = 0;
		for (const session of disconnected) {
			if (!session.vector) {
				await ctx.db.delete(session._id);
				cleaned++;
				continue;
			}

			const sessionVector = new Uint8Array(session.vector);
			const missing = Y.diffUpdateV2(merged, sessionVector);

			if (missing.byteLength <= 2) {
				await ctx.db.delete(session._id);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.info('Cleaned up disconnected sessions', {
				document: args.document,
				cleaned,
			});
		}

		return {
			success: true,
			removed,
			retained: deltas.length - removed,
			size: merged.byteLength,
		};
	},
});

const applyBytesToDoc = (doc: Y.Doc, bytes?: ArrayBuffer | null) => {
	if (!bytes) return;
	Y.applyUpdate(doc, new Uint8Array(bytes));
};

const encodeDocState = (doc: Y.Doc) => {
	const bytes = Y.encodeStateAsUpdateV2(doc);
	const vector = Y.encodeStateVector(doc);
	return { bytes, vector };
};

const isActiveSession = (session: { connected: boolean; seen: number }, now: number, timeout: number) =>
	session.connected || now - session.seen < timeout;

type CompactionPatch = {
	status?: 'pending' | 'running' | 'done' | 'failed';
	phase?: 'merge' | 'finalize';
	cursor?: string;
	boundarySeq?: number;
	scratch?: ArrayBuffer;
	processed?: number;
	retries?: number;
	completed?: number;
	error?: string;
};

export const getCompactionJob = query({
	args: { id: v.id('compaction') },
	returns: v.any(),
	handler: async (ctx, args) => {
		return ctx.db.get(args.id);
	},
});

export const getCompactionSnapshot = query({
	args: { collection: v.string(), document: v.string() },
	returns: v.union(
		v.null(),
		v.object({
			bytes: v.bytes(),
			vector: v.bytes(),
			seq: v.number(),
		})
	),
	handler: async (ctx, args) => {
		const snapshot = await ctx.db
			.query('snapshots')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.first();
		if (!snapshot) return null;
		return {
			bytes: snapshot.bytes,
			vector: snapshot.vector,
			seq: snapshot.seq,
		};
	},
});

export const getCompactionDeltasPage = query({
	args: {
		collection: v.string(),
		document: v.string(),
		cursor: v.optional(v.string()),
		numItems: v.optional(v.number()),
	},
	returns: v.object({
		page: v.array(v.object({ id: v.id('deltas'), seq: v.number(), bytes: v.bytes() })),
		isDone: v.boolean(),
		continueCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, args) => {
		const numItems = Math.max(1, args.numItems ?? COMPACTION_PAGE_SIZE);
		const cursorValue = args.cursor ?? null;
		const cursorSeqRaw = cursorValue !== null ? Number(cursorValue) : 0;
		const cursorSeq =
			Number.isFinite(cursorSeqRaw) && cursorValue !== null ? cursorSeqRaw : 0;

		const batch = await ctx.db
			.query('deltas')
			.withIndex('by_document_seq', (q) =>
				q.eq('collection', args.collection).eq('document', args.document).gt('seq', cursorSeq)
			)
			.order('asc')
			.take(numItems);

		const page = batch.map((delta) => ({
			id: delta._id,
			seq: delta.seq,
			bytes: delta.bytes,
		}));
		const lastSeq = page.length > 0 ? page[page.length - 1]!.seq : cursorSeq;
		const isDone = batch.length < numItems;

		return {
			page,
			isDone,
			continueCursor: isDone ? null : String(lastSeq),
		};
	},
});

export const getDeltaCountsPage = query({
	args: {
		collection: v.string(),
		cursor: v.optional(v.string()),
		numItems: v.optional(v.number()),
	},
	returns: v.object({
		page: v.array(v.object({ document: v.string(), count: v.number() })),
		isDone: v.boolean(),
		continueCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, args) => {
		const numItems = Math.max(1, args.numItems ?? 100);
		const cursorValue = args.cursor ?? null;
		const cursorDoc = cursorValue ?? '';

		const batch = await ctx.db
			.query('deltaCounts')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).gt('document', cursorDoc)
			)
			.order('asc')
			.take(numItems);

		const page = batch.map((doc) => ({
			document: doc.document,
			count: doc.count,
		}));
		const lastDoc = page.length > 0 ? page[page.length - 1]!.document : cursorDoc;
		const isDone = batch.length < numItems;

		return {
			page,
			isDone,
			continueCursor: isDone ? null : lastDoc,
		};
	},
});

export const getCompactionLatestDeltas = query({
	args: {
		collection: v.string(),
		document: v.string(),
		boundarySeq: v.optional(v.number()),
		numItems: v.optional(v.number()),
	},
	returns: v.array(v.object({ id: v.id('deltas'), seq: v.number() })),
	handler: async (ctx, args) => {
		const numItems = Math.max(1, args.numItems ?? COMPACTION_PAGE_SIZE);

		const batch = await ctx.db
			.query('deltas')
			.withIndex('by_document_seq', (q) => {
				const base = q.eq('collection', args.collection).eq('document', args.document);
				return args.boundarySeq !== undefined ? base.lte('seq', args.boundarySeq) : base;
			})
			.order('desc')
			.take(numItems);

		return batch.map((delta) => ({ id: delta._id, seq: delta.seq }));
	},
});

export const getCompactionSessions = query({
	args: { collection: v.string(), document: v.string() },
	returns: v.array(
		v.object({
			id: v.id('sessions'),
			client: v.string(),
			vector: v.optional(v.bytes()),
			connected: v.boolean(),
			seen: v.number(),
		})
	),
	handler: async (ctx, args) => {
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.collect();
		return sessions.map((session) => ({
			id: session._id,
			client: session.client,
			vector: session.vector,
			connected: session.connected,
			seen: session.seen,
		}));
	},
});

export const getCompactionBoundarySeq = query({
	args: { collection: v.string() },
	returns: v.number(),
	handler: async (ctx, args) => {
		const sequenceRecord = await ctx.db
			.query('sequences')
			.withIndex('by_collection', (q) => q.eq('collection', args.collection))
			.unique();
		return sequenceRecord?.seq ?? 0;
	},
});

export const updateCompactionJob = mutation({
	args: {
		id: v.id('compaction'),
		patch: v.object({
			status: v.optional(
				v.union(
					v.literal('pending'),
					v.literal('running'),
					v.literal('done'),
					v.literal('failed')
				)
			),
			phase: v.optional(v.union(v.literal('merge'), v.literal('finalize'))),
			cursor: v.optional(v.string()),
			boundarySeq: v.optional(v.number()),
			scratch: v.optional(v.bytes()),
			processed: v.optional(v.number()),
			retries: v.optional(v.number()),
			completed: v.optional(v.number()),
			error: v.optional(v.string()),
		}),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.id, args.patch);
		return null;
	},
});

export const upsertCompactionSnapshot = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		bytes: v.bytes(),
		vector: v.bytes(),
		seq: v.number(),
		created: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('snapshots')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				bytes: args.bytes,
				vector: args.vector,
				seq: args.seq,
				created: args.created,
			});
			return null;
		}

		await ctx.db.insert('snapshots', {
			collection: args.collection,
			document: args.document,
			bytes: args.bytes,
			vector: args.vector,
			seq: args.seq,
			created: args.created,
		});
		return null;
	},
});

export const deleteCompactionDeltasBatch = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		ids: v.array(v.id('deltas')),
	},
	returns: v.number(),
	handler: async (ctx, args) => {
		let removed = 0;
		for (const id of args.ids) {
			await ctx.db.delete(id);
			removed++;
		}
		if (removed > 0) {
			await decrementDeltaCount(ctx, args.collection, args.document, removed);
		}
		return removed;
	},
});

export const deleteCompactionSessionsBatch = mutation({
	args: {
		ids: v.array(v.id('sessions')),
	},
	returns: v.number(),
	handler: async (ctx, args) => {
		let removed = 0;
		for (const id of args.ids) {
			await ctx.db.delete(id);
			removed++;
		}
		return removed;
	},
});

export const scheduleCompaction = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		timeout: v.optional(v.number()),
		retain: v.optional(v.number()),
		pageSize: v.optional(v.number()),
		maxPages: v.optional(v.number()),
		maxDeltas: v.optional(v.number()),
	},
	returns: v.object({
		id: v.optional(v.id('compaction')),
		status: v.union(
			v.literal('scheduled'),
			v.literal('already_running'),
			v.literal('already_pending')
		),
	}),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('compaction')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document).eq('status', 'running')
			)
			.first();

		if (existing) {
			return { id: existing._id, status: 'already_running' as const };
		}

		const pending = await ctx.db
			.query('compaction')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document).eq('status', 'pending')
			)
			.first();

		if (pending) {
			return { id: pending._id, status: 'already_pending' as const };
		}

		const id = await ctx.db.insert('compaction', {
			collection: args.collection,
			document: args.document,
			status: 'pending',
			started: Date.now(),
			retries: 0,
			timeout: args.timeout,
			pageSize: args.pageSize,
			maxPages: args.maxPages,
			maxDeltas: args.maxDeltas,
		});

		await ctx.scheduler.runAfter(0, api.mutations.runCompactionAction, {
			id,
			timeout: args.timeout,
			retain: args.retain,
		});

		return { id, status: 'scheduled' as const };
	},
});

export const sweepCompactions = action({
	args: {
		collection: v.string(),
		threshold: v.optional(v.number()),
		cursor: v.optional(v.string()),
		pageSize: v.optional(v.number()),
		intervalMs: v.optional(v.number()),
		timeout: v.optional(v.number()),
		retain: v.optional(v.number()),
		compactionPageSize: v.optional(v.number()),
		compactionMaxPages: v.optional(v.number()),
		compactionMaxDeltas: v.optional(v.number()),
	},
	returns: v.object({
		processed: v.number(),
		scheduled: v.number(),
		nextCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx: ActionCtx, args) => {
		const threshold = args.threshold ?? DEFAULT_THRESHOLD;
		const pageSize = Math.max(1, args.pageSize ?? 100);

		const page = await ctx.runQuery(api.mutations.getDeltaCountsPage, {
			collection: args.collection,
			cursor: args.cursor,
			numItems: pageSize,
		});

		let scheduled = 0;
		for (const entry of page.page) {
			if (entry.count < threshold) {
				continue;
			}
			await ctx.runMutation(api.mutations.scheduleCompaction, {
				collection: args.collection,
				document: entry.document,
				timeout: args.timeout,
				retain: args.retain,
				pageSize: args.compactionPageSize,
				maxPages: args.compactionMaxPages,
				maxDeltas: args.compactionMaxDeltas,
			});
			scheduled += 1;
		}

		const nextCursor = page.isDone ? null : page.continueCursor;

		if (nextCursor) {
			await ctx.scheduler.runAfter(0, api.mutations.sweepCompactions, {
				...args,
				cursor: nextCursor,
			});
		} else if (args.intervalMs !== undefined) {
			await ctx.scheduler.runAfter(args.intervalMs, api.mutations.sweepCompactions, {
				...args,
				cursor: undefined,
			});
		}

		return {
			processed: page.page.length,
			scheduled,
			nextCursor,
		};
	},
});

export const runCompaction = mutation({
	args: {
		id: v.id('compaction'),
		timeout: v.optional(v.number()),
		retain: v.optional(v.number()),
	},
	returns: v.union(v.null(), v.object({ removed: v.number(), retained: v.number() })),
	handler: async (ctx, args) => {
		const logger = getLogger(['compaction']);
		const job = await ctx.db.get(args.id);

		if (!job || job.status === 'done') {
			return null;
		}

		await ctx.db.patch(args.id, { status: 'running' });

		const now = Date.now();
		const timeout = args.timeout ?? DEFAULT_TIMEOUT;
		const retain = args.retain ?? 0;

		try {
			// Get the current max seq at the START of compaction.
			// This establishes our snapshot boundary - prevents TOCTOU race conditions.
			const sequenceRecord = await ctx.db
				.query('sequences')
				.withIndex('by_collection', (q) => q.eq('collection', job.collection))
				.unique();
			const snapshotBoundarySeq = sequenceRecord?.seq ?? 0;

			const allDeltas = await ctx.db
				.query('deltas')
				.withIndex('by_document', (q) =>
					q.eq('collection', job.collection).eq('document', job.document)
				)
				.collect();

			// Filter to only include deltas within our boundary
			const deltas = allDeltas.filter((d) => d.seq <= snapshotBoundarySeq);

			if (deltas.length === 0) {
				await ctx.db.patch(args.id, { status: 'done', completed: now });
				return { removed: 0, retained: 0 };
			}

			const snapshot = await ctx.db
				.query('snapshots')
				.withIndex('by_document', (q) =>
					q.eq('collection', job.collection).eq('document', job.document)
				)
				.first();

			const updates: Uint8Array[] = [];
			if (snapshot) {
				updates.push(new Uint8Array(snapshot.bytes));
			}
			updates.push(...deltas.map((d) => new Uint8Array(d.bytes)));

			const merged = Y.mergeUpdatesV2(updates);
			const vector = Y.encodeStateVectorFromUpdateV2(merged);

			const sessions = await ctx.db
				.query('sessions')
				.withIndex('by_document', (q) =>
					q.eq('collection', job.collection).eq('document', job.document)
				)
				.collect();

			let canDeleteAll = true;
			for (const session of sessions) {
				const isActive = session.connected || now - session.seen < timeout;
				if (!isActive) continue;

				if (!session.vector) {
					canDeleteAll = false;
					logger.warn('Active session without vector, skipping full compaction', {
						client: session.client,
					});
					break;
				}

				const sessionVector = new Uint8Array(session.vector);
				const missing = Y.diffUpdateV2(merged, sessionVector);

				if (missing.byteLength > 2) {
					canDeleteAll = false;
					logger.debug('Active session still needs data', {
						client: session.client,
						missingSize: missing.byteLength,
					});
					break;
				}
			}

			// Use the boundary seq for the snapshot
			const seq = snapshotBoundarySeq;

			if (snapshot) {
				await ctx.db.patch(snapshot._id, {
					bytes: merged.buffer as ArrayBuffer,
					vector: vector.buffer as ArrayBuffer,
					seq,
					created: now,
				});
			} else {
				await ctx.db.insert('snapshots', {
					collection: job.collection,
					document: job.document,
					bytes: merged.buffer as ArrayBuffer,
					vector: vector.buffer as ArrayBuffer,
					seq,
					created: now,
				});
			}

			let removed = 0;
			if (canDeleteAll) {
				const sortedDeltas = [...deltas].sort((a, b) => b.seq - a.seq);
				const deltasToRetain = sortedDeltas.slice(0, retain);
				const deltasToDelete = sortedDeltas.slice(retain);
				const retainIds = new Set(deltasToRetain.map((d) => d._id));

				for (const delta of deltasToDelete) {
					if (!retainIds.has(delta._id)) {
						await ctx.db.delete(delta._id);
						removed++;
					}
				}

				// Decrement delta count to keep it in sync
				if (removed > 0) {
					await decrementDeltaCount(ctx, job.collection, job.document, removed);
				}

				logger.info('Compaction completed', {
					document: job.document,
					removed,
					retained: deltasToRetain.length,
					size: merged.byteLength,
				});
			} else {
				logger.info('Snapshot created, deltas retained (clients still syncing)', {
					document: job.document,
					deltaCount: deltas.length,
					activeCount: sessions.filter((s) => s.connected || now - s.seen < timeout).length,
				});
			}

			for (const session of sessions) {
				if (session.connected) continue;
				if (now - session.seen > timeout) {
					await ctx.db.delete(session._id);
					logger.debug('Cleaned up stale session', { client: session.client });
				}
			}

			await ctx.db.patch(args.id, { status: 'done', completed: now });
			return { removed, retained: deltas.length - removed };
		} catch (error) {
			const retries = (job.retries ?? 0) + 1;

			if (retries < MAX_RETRIES) {
				await ctx.db.patch(args.id, { status: 'pending', retries });
				const backoff = Math.pow(2, retries) * 1000;
				await ctx.scheduler.runAfter(backoff, api.mutations.runCompaction, {
					id: args.id,
					timeout: args.timeout,
					retain: args.retain,
				});
				logger.warn('Compaction failed, scheduling retry', {
					document: job.document,
					retries,
					backoff,
				});
			} else {
				await ctx.db.patch(args.id, {
					status: 'failed',
					error: String(error),
					completed: now,
				});
				logger.error('Compaction failed after max retries', {
					document: job.document,
					error: String(error),
				});
			}
			throw error;
		}
	},
});

export const runCompactionAction = action({
	args: {
		id: v.id('compaction'),
		timeout: v.optional(v.number()),
		retain: v.optional(v.number()),
	},
	returns: v.any(),
	handler: async (ctx: ActionCtx, args) => {
		const logger = getLogger(['compaction']);
		const job = await ctx.runQuery(api.mutations.getCompactionJob, { id: args.id });

		if (!job || job.status === 'done' || job.status === 'failed') {
			return null;
		}

		const now = Date.now();
		const timeout = args.timeout ?? job.timeout ?? DEFAULT_TIMEOUT;
		const retain = args.retain ?? 0;
		const pageSize = Math.max(1, job.pageSize ?? COMPACTION_PAGE_SIZE);
		const maxPages = Math.max(1, job.maxPages ?? COMPACTION_MAX_PAGES);
		const maxDeltas = Math.max(1, job.maxDeltas ?? COMPACTION_MAX_DELTAS);

		try {
			if (job.status !== 'running') {
				await ctx.runMutation(api.mutations.updateCompactionJob, {
					id: args.id,
					patch: { status: 'running' },
				});
			}

			let boundarySeq = job.boundarySeq;
			if (boundarySeq === undefined || boundarySeq === null) {
				boundarySeq = await ctx.runQuery(api.mutations.getCompactionBoundarySeq, {
					collection: job.collection,
				});
				await ctx.runMutation(api.mutations.updateCompactionJob, {
					id: args.id,
					patch: { boundarySeq },
				});
			}

			const phase = job.phase ?? 'merge';
			if (phase === 'merge') {
				const doc = new Y.Doc();
				if (job.scratch) {
					applyBytesToDoc(doc, job.scratch);
				} else {
					const snapshot = await ctx.runQuery(api.mutations.getCompactionSnapshot, {
						collection: job.collection,
						document: job.document,
					});
					applyBytesToDoc(doc, snapshot?.bytes ?? null);
				}

				let cursor: string | undefined = job.cursor ?? undefined;
				let processed = job.processed ?? 0;
				let deltasProcessed = 0;
				let pages = 0;
				let mergeDone = false;

				while (pages < maxPages && deltasProcessed < maxDeltas) {
					const page = await ctx.runQuery(api.mutations.getCompactionDeltasPage, {
						collection: job.collection,
						document: job.document,
						cursor,
						numItems: pageSize,
					});

					let reachedBoundary = false;
					for (const delta of page.page) {
						if (delta.seq > boundarySeq) {
							reachedBoundary = true;
							break;
						}
						applyBytesToDoc(doc, delta.bytes);
						processed += 1;
						deltasProcessed += 1;
						if (deltasProcessed >= maxDeltas) {
							break;
						}
					}

					cursor = page.continueCursor ?? undefined;
					pages += 1;

					if (reachedBoundary || page.isDone) {
						mergeDone = true;
						break;
					}

				}

				const scratchBytes = Y.encodeStateAsUpdateV2(doc);
				doc.destroy();
				const patch: CompactionPatch = {
					phase: mergeDone ? 'finalize' : 'merge',
					processed,
					scratch: scratchBytes.buffer as ArrayBuffer,
				};
				if (!mergeDone && cursor) {
					patch.cursor = cursor;
				} else if (mergeDone) {
					// Reset cursor for finalize phase pagination
					patch.cursor = '0';
				}
				await ctx.runMutation(api.mutations.updateCompactionJob, {
					id: args.id,
					patch,
				});

				await ctx.scheduler.runAfter(0, api.mutations.runCompactionAction, {
					id: args.id,
					timeout,
					retain,
				});

				return { phase: mergeDone ? 'finalize' : 'merge' };
			}

			if (!job.scratch) {
				const patch: CompactionPatch = { phase: 'merge' };
				if (job.cursor) patch.cursor = job.cursor;
				await ctx.runMutation(api.mutations.updateCompactionJob, {
					id: args.id,
					patch,
				});
				await ctx.scheduler.runAfter(0, api.mutations.runCompactionAction, {
					id: args.id,
					timeout,
					retain,
				});
				return { phase: 'merge' };
			}

			const doc = new Y.Doc();
			applyBytesToDoc(doc, job.scratch);

			const { bytes: snapshotBytes, vector: snapshotVector } = encodeDocState(doc);

			await ctx.runMutation(api.mutations.upsertCompactionSnapshot, {
				collection: job.collection,
				document: job.document,
				bytes: snapshotBytes.buffer as ArrayBuffer,
				vector: snapshotVector.buffer as ArrayBuffer,
				seq: boundarySeq,
				created: now,
			});

			const sessions = await ctx.runQuery(api.mutations.getCompactionSessions, {
				collection: job.collection,
				document: job.document,
			});

			let canDeleteAll = true;
			for (const session of sessions) {
				if (!isActiveSession(session, now, timeout)) continue;
				if (!session.vector) {
					canDeleteAll = false;
					logger.warn('Active session without vector, skipping full compaction', {
						client: session.client,
					});
					break;
				}
				const sessionVector = new Uint8Array(session.vector);
				const missing = Y.encodeStateAsUpdateV2(doc, sessionVector);
				if (missing.byteLength > 2) {
					canDeleteAll = false;
					logger.debug('Active session still needs data', {
						client: session.client,
						missingSize: missing.byteLength,
					});
					break;
				}
			}

			let removed = 0;
			let retained = 0;

			if (canDeleteAll) {
				const retainCount = Math.max(0, retain);
				const retainIds = new Set<string>();
				if (retainCount > 0) {
					const retainPage = await ctx.runQuery(api.mutations.getCompactionLatestDeltas, {
						collection: job.collection,
						document: job.document,
						boundarySeq,
						numItems: retainCount,
					});
					for (const entry of retainPage) {
						retainIds.add(entry.id);
					}
				}

				let cursor: string | undefined = job.cursor ?? undefined;
				let done = false;
				let batch: string[] = [];
				let pages = 0;
				let deltasProcessed = 0;
				let lastPageDone = false;

				while (pages < maxPages && deltasProcessed < maxDeltas) {
					const page = await ctx.runQuery(api.mutations.getCompactionDeltasPage, {
						collection: job.collection,
						document: job.document,
						cursor,
						numItems: pageSize,
					});

					lastPageDone = page.isDone;

					for (const delta of page.page) {
						if (delta.seq > boundarySeq) {
							done = true;
							break;
						}

						deltasProcessed += 1;
						if (retainIds.has(delta.id)) {
							retained += 1;
						} else {
							batch.push(delta.id);
							if (batch.length >= 50) {
								removed += await ctx.runMutation(api.mutations.deleteCompactionDeltasBatch, {
									collection: job.collection,
									document: job.document,
									ids: batch as any,
								});
								batch = [];
							}
						}

						if (deltasProcessed >= maxDeltas) {
							break;
						}
					}

					cursor = page.continueCursor ?? undefined;
					pages += 1;

					if (done || page.isDone || deltasProcessed >= maxDeltas) {
						break;
					}
				}

				if (batch.length > 0) {
					removed += await ctx.runMutation(api.mutations.deleteCompactionDeltasBatch, {
						collection: job.collection,
						document: job.document,
						ids: batch as any,
					});
				}

				const finalizeDone = done || lastPageDone;
				if (!finalizeDone) {
					await ctx.runMutation(api.mutations.updateCompactionJob, {
						id: args.id,
						patch: { phase: 'finalize', cursor: cursor ?? '0' },
					});
					await ctx.scheduler.runAfter(0, api.mutations.runCompactionAction, {
						id: args.id,
						timeout,
						retain,
					});
					doc.destroy();
					return { phase: 'finalize' };
				}
			} else {
				retained = job.processed ?? 0;
			}

			const staleSessions = sessions.filter(
				(session) => !session.connected && now - session.seen > timeout
			);
			for (let i = 0; i < staleSessions.length; i += 50) {
				const chunk = staleSessions.slice(i, i + 50).map((session) => session.id);
				await ctx.runMutation(api.mutations.deleteCompactionSessionsBatch, {
					ids: chunk as any,
				});
			}

			await ctx.runMutation(api.mutations.updateCompactionJob, {
				id: args.id,
				patch: { status: 'done', completed: now, phase: 'finalize' },
			});

			doc.destroy();
			return { removed, retained };
		} catch (error) {
			const retries = (job.retries ?? 0) + 1;

			if (retries < MAX_RETRIES) {
				await ctx.runMutation(api.mutations.updateCompactionJob, {
					id: args.id,
					patch: { status: 'pending', retries, error: String(error) },
				});
				const backoff = Math.pow(2, retries) * 1000;
				await ctx.scheduler.runAfter(backoff, api.mutations.runCompactionAction, {
					id: args.id,
					timeout,
					retain,
				});
				logger.warn('Compaction failed, scheduling retry', {
					document: job.document,
					retries,
					backoff,
				});
			} else {
				await ctx.runMutation(api.mutations.updateCompactionJob, {
					id: args.id,
					patch: { status: 'failed', error: String(error), completed: now },
				});
				logger.error('Compaction failed after max retries', {
					document: job.document,
					error: String(error),
				});
			}
			throw error;
		}
	},
});

export const stream = query({
	args: {
		collection: v.string(),
		seq: v.number(),
		limit: v.optional(v.number()),
		threshold: v.optional(v.number()),
	},
	returns: streamResultValidator,
	handler: async (ctx, args) => {
		const limit = Math.max(1, args.limit ?? 50);
		// threshold arg kept for API compatibility but no longer used
		// (compaction check moved to write mutations for O(1) performance)

		const documents = await ctx.db
			.query('deltas')
			.withIndex('by_seq', (q) => q.eq('collection', args.collection).gt('seq', args.seq))
			.order('asc')
			.take(limit);

		if (documents.length > 0) {
			const changes = documents.map((doc) => ({
				document: doc.document,
				bytes: doc.bytes,
				seq: doc.seq,
				type: OperationType.Delta,
				exists: doc.exists,
			}));

			const newSeq = documents[documents.length - 1]?.seq ?? args.seq;

			// Compaction eligibility is now checked only during write mutations
			// (insertDocument, updateDocument, deleteDocument) via scheduleCompactionIfNeeded.
			// This removes the O(n) full collection scan that was running on every subscription update.

			return {
				changes,
				seq: newSeq,
				more: documents.length === limit,
				compact: undefined,
			};
		}

		const oldest = await ctx.db
			.query('deltas')
			.withIndex('by_seq', (q) => q.eq('collection', args.collection))
			.order('asc')
			.first();

		if (oldest && args.seq < oldest.seq) {
			const snapshots = await ctx.db
				.query('snapshots')
				.withIndex('by_document', (q) => q.eq('collection', args.collection))
				.collect();

			if (snapshots.length === 0) {
				throw new ConvexError(
					`Disparity detected but no snapshots available for collection: ${args.collection}. ` +
						`Client seq: ${args.seq}, Oldest delta seq: ${oldest.seq}`
				);
			}

			const changes = snapshots.map((s) => ({
				document: s.document,
				bytes: s.bytes,
				seq: s.seq,
				type: OperationType.Snapshot,
				exists: true,
			}));

			const latestSeq = Math.max(...snapshots.map((s) => s.seq));

			return {
				changes,
				seq: latestSeq,
				more: false,
				compact: undefined,
			};
		}

		return {
			changes: [],
			seq: args.seq,
			more: false,
			compact: undefined,
		};
	},
});

export const recovery = query({
	args: {
		collection: v.string(),
		document: v.string(),
		vector: v.bytes(),
	},
	returns: recoveryResultValidator,
	handler: async (ctx, args) => {
		const snapshot = await ctx.db
			.query('snapshots')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.first();

		const snapshotSeq = snapshot?.seq ?? 0;
		let deltasFound = false;

		if (!snapshot) {
			const emptyBatch = await ctx.db
				.query('deltas')
				.withIndex('by_document_seq', (q) =>
					q.eq('collection', args.collection).eq('document', args.document).gt('seq', 0)
				)
				.order('asc')
				.take(1);
			if (emptyBatch.length === 0) {
				const emptyDoc = new Y.Doc();
				const emptyVector = Y.encodeStateVector(emptyDoc);
				emptyDoc.destroy();
				return {
					vector: emptyVector.buffer as ArrayBuffer,
				};
			}
			deltasFound = true;
		}

		const doc = new Y.Doc();

		if (snapshot) {
			Y.applyUpdate(doc, new Uint8Array(snapshot.bytes));
		}

		let cursorSeq = snapshotSeq;
		while (true) {
			const batch = await ctx.db
				.query('deltas')
				.withIndex('by_document_seq', (q) =>
					q.eq('collection', args.collection).eq('document', args.document).gt('seq', cursorSeq)
				)
				.order('asc')
				.take(COMPACTION_PAGE_SIZE);

			if (batch.length === 0) {
				break;
			}

			deltasFound = true;

			for (const delta of batch) {
				Y.applyUpdate(doc, new Uint8Array(delta.bytes));
				cursorSeq = delta.seq;
			}

			if (batch.length < COMPACTION_PAGE_SIZE) {
				break;
			}
		}

		if (!snapshot && !deltasFound) {
			const emptyDoc = new Y.Doc();
			const emptyVector = Y.encodeStateVector(emptyDoc);
			emptyDoc.destroy();
			return {
				vector: emptyVector.buffer as ArrayBuffer,
			};
		}
		const clientVector = new Uint8Array(args.vector);
		const merged = Y.encodeStateAsUpdateV2(doc);
		const diff = Y.diffUpdateV2(merged, clientVector);
		const serverVector = Y.encodeStateVector(doc);
		doc.destroy();

		return {
			diff: diff.byteLength > 0 ? (diff.buffer as ArrayBuffer) : undefined,
			vector: serverVector.buffer as ArrayBuffer,
		};
	},
});

export const getDocumentState = query({
	args: {
		collection: v.string(),
		document: v.string(),
	},
	returns: documentStateValidator,
	handler: async (ctx, args) => {
		const snapshot = await ctx.db
			.query('snapshots')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.first();

		const deltas = await ctx.db
			.query('deltas')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			)
			.collect();

		if (!snapshot && deltas.length === 0) {
			return null;
		}

		const updates: Uint8Array[] = [];
		let latestSeq = 0;

		if (snapshot) {
			updates.push(new Uint8Array(snapshot.bytes));
			latestSeq = Math.max(latestSeq, snapshot.seq);
		}

		for (const delta of deltas) {
			updates.push(new Uint8Array(delta.bytes));
			latestSeq = Math.max(latestSeq, delta.seq);
		}

		const merged = Y.mergeUpdatesV2(updates);

		return {
			bytes: merged.buffer as ArrayBuffer,
			seq: latestSeq,
		};
	},
});

export const sessions = query({
	args: {
		collection: v.string(),
		document: v.string(),
		connected: v.optional(v.boolean()),
		exclude: v.optional(v.string()),
	},
	returns: v.array(sessionValidator),
	handler: async (ctx, args) => {
		let sessionsQuery = ctx.db
			.query('sessions')
			.withIndex('by_document', (q) =>
				q.eq('collection', args.collection).eq('document', args.document)
			);

		if (args.connected !== undefined) {
			sessionsQuery = sessionsQuery.filter((q) => q.eq(q.field('connected'), args.connected));
		}

		const records = await sessionsQuery.collect();

		const mapped = records
			.filter((p) => !args.exclude || p.client !== args.exclude)
			.map((p) => ({
				client: p.client,
				document: p.document,
				user: p.user,
				profile: p.profile,
				cursor: p.cursor,
				seen: p.seen,
			}));

		const byUser = new Map<string, (typeof mapped)[0]>();
		for (const p of mapped) {
			const key = p.user ?? p.client;
			const existing = byUser.get(key);
			if (!existing || p.seen > existing.seen) {
				byUser.set(key, p);
			}
		}

		return Array.from(byUser.values());
	},
});

export const disconnect = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		client: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('sessions')
			.withIndex('by_client', (q) =>
				q.eq('collection', args.collection).eq('document', args.document).eq('client', args.client)
			)
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				connected: false,
				cursor: undefined,
				timeout: undefined,
			});
		}

		return null;
	},
});

export const presence = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		client: v.string(),
		action: presenceActionValidator,
		user: v.optional(v.string()),
		profile: v.optional(profileValidator),
		cursor: v.optional(cursorValidator),
		interval: v.optional(v.number()),
		vector: v.optional(v.bytes()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('sessions')
			.withIndex('by_client', (q) =>
				q.eq('collection', args.collection).eq('document', args.document).eq('client', args.client)
			)
			.first();

		if (args.action === 'leave') {
			if (existing?.timeout) {
				await ctx.scheduler.cancel(existing.timeout);
			}
			if (existing) {
				await ctx.db.patch(existing._id, {
					connected: false,
					cursor: undefined,
					timeout: undefined,
				});
			}
			return null;
		}

		const now = Date.now();
		const interval = args.interval ?? DEFAULT_HEARTBEAT_INTERVAL;

		if (existing?.timeout) {
			await ctx.scheduler.cancel(existing.timeout);
		}

		const timeout = await ctx.scheduler.runAfter(interval * 2.5, api.mutations.disconnect, {
			collection: args.collection,
			document: args.document,
			client: args.client,
		});

		const updates: Record<string, unknown> = {
			connected: true,
			seen: now,
			timeout,
		};

		if (args.user !== undefined) updates.user = args.user;
		if (args.profile !== undefined) updates.profile = args.profile;
		if (args.cursor !== undefined) updates.cursor = args.cursor;
		if (args.vector !== undefined) updates.vector = args.vector;

		if (existing) {
			await ctx.db.patch(existing._id, updates);
		} else {
			await ctx.db.insert('sessions', {
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
				timeout,
			});
		}

		return null;
	},
});
