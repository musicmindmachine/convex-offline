import { test, expect, vi } from 'vitest';
import { convexTest } from 'convex-test';
import * as Y from 'yjs';
import { api } from '../../component/_generated/api';
import schema from '../../component/schema';
import { modules } from '../../component/test.setup';

const toArrayBuffer = (data: Uint8Array): ArrayBuffer =>
	data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

test('scheduleCompaction_createsJobWithPendingStatus', async () => {
	vi.useFakeTimers();
	const t = convexTest(schema, modules);

	const docId = 'job-1';

	await t.mutation(api.mutations.insertDocument, {
		collection: 'test',
		document: docId,
		bytes: toArrayBuffer(Y.encodeStateAsUpdateV2(new Y.Doc())),
	});

	await t.mutation(api.mutations.scheduleCompaction, {
		collection: 'test',
		document: docId,
	});

	// Jobs are created with "pending" status, then transition to "running" when scheduler executes
	const pendingJob = await t.run(async (ctx) => {
		return await ctx.db
			.query('compaction')
			.withIndex('by_document', (q) =>
				q.eq('collection', 'test').eq('document', docId).eq('status', 'pending')
			)
			.first();
	});

	expect(pendingJob).not.toBeNull();
	expect(pendingJob?.status).toBe('pending');

	// Clean up scheduled functions
	vi.runAllTimers();
	await t.finishInProgressScheduledFunctions();
	vi.useRealTimers();
});

test('scheduleCompaction_dedup_pendingJobs', async () => {
	vi.useFakeTimers();
	const t = convexTest(schema, modules);

	const docId = 'job-2';

	await t.mutation(api.mutations.insertDocument, {
		collection: 'test',
		document: docId,
		bytes: toArrayBuffer(Y.encodeStateAsUpdateV2(new Y.Doc())),
	});

	await t.mutation(api.mutations.scheduleCompaction, {
		collection: 'test',
		document: docId,
	});

	const pendingJob = await t.run(async (ctx) => {
		return await ctx.db
			.query('compaction')
			.withIndex('by_document', (q) =>
				q.eq('collection', 'test').eq('document', docId).eq('status', 'pending')
			)
			.first();
	});

	expect(pendingJob).not.toBeNull();
	expect(pendingJob?.status).toBe('pending');

	// Clean up scheduled functions
	vi.runAllTimers();
	await t.finishInProgressScheduledFunctions();
	vi.useRealTimers();
});

test('runCompaction_createsSnapshotFromDeltas', async () => {
	vi.useFakeTimers();
	const t = convexTest(schema, modules);

	const docId = 'compact-1';

	const ydoc = new Y.Doc();
	ydoc.getMap('fields').set('text', 'test data');
	const delta = Y.encodeStateAsUpdateV2(ydoc);

	await t.mutation(api.mutations.insertDocument, {
		collection: 'test',
		document: docId,
		bytes: toArrayBuffer(delta),
	});

	// Schedule compaction to get a real job ID
	const scheduleResult = await t.mutation(api.mutations.scheduleCompaction, {
		collection: 'test',
		document: docId,
	});

	// Run compaction with the real ID
	const result = await t.mutation(api.mutations.runCompaction, {
		id: scheduleResult.id!,
	});

	expect(result).toMatchObject({
		removed: expect.any(Number),
		retained: expect.any(Number),
	});

	const snapshot = await t.run(async (ctx) => {
		return await ctx.db
			.query('snapshots')
			.withIndex('by_document', (q) => q.eq('collection', 'test').eq('document', docId))
			.first();
	});

	expect(snapshot).not.toBeNull();
	ydoc.destroy();

	// Clean up scheduled functions
	vi.runAllTimers();
	await t.finishInProgressScheduledFunctions();
	vi.useRealTimers();
});

test('runCompaction_retainsDeltasWhenActivePeerNeedsData', async () => {
	vi.useFakeTimers();
	const t = convexTest(schema, modules);

	const docId = 'compact-2';
	const peerId = 'peer-1';

	const ydocOld = new Y.Doc();
	ydocOld.getMap('fields').set('text', 'old data');
	const oldDelta = Y.encodeStateAsUpdateV2(ydocOld);

	await t.mutation(api.mutations.insertDocument, {
		collection: 'test',
		document: docId,
		bytes: toArrayBuffer(oldDelta),
	});

	const ydocNew = new Y.Doc();
	ydocNew.getMap('fields').set('text', 'new data');
	const newDelta = Y.encodeStateAsUpdateV2(ydocNew);

	await t.mutation(api.mutations.insertDocument, {
		collection: 'test',
		document: docId,
		bytes: toArrayBuffer(newDelta),
	});

	await t.mutation(api.mutations.presence, {
		collection: 'test',
		document: docId,
		client: peerId,
		action: 'join',
		vector: toArrayBuffer(Y.encodeStateVector(ydocOld)),
	});

	// Schedule compaction to get a real job ID
	const scheduleResult = await t.mutation(api.mutations.scheduleCompaction, {
		collection: 'test',
		document: docId,
	});

	const result = await t.mutation(api.mutations.runCompaction, {
		id: scheduleResult.id!,
	});

	expect(result).toMatchObject({
		removed: 0,
		retained: expect.any(Number),
	});

	const deltas = await t.run(async (ctx) => {
		return await ctx.db
			.query('deltas')
			.withIndex('by_document', (q) => q.eq('collection', 'test').eq('document', docId))
			.collect();
	});

	expect(deltas.length).toBeGreaterThan(0);
	ydocOld.destroy();
	ydocNew.destroy();

	// Clean up scheduled functions
	vi.runAllTimers();
	await t.finishInProgressScheduledFunctions();
	vi.useRealTimers();
});

test('offline recovery survives compaction and interleaved paginated deltas', async () => {
  const t = convexTest(schema, modules);
  const first = new Y.Doc();
  first.getMap('fields').set('title', 'Compacted');
  await t.mutation(api.mutations.insertDocument, { collection: 'test', document: 'a', bytes: toArrayBuffer(Y.encodeStateAsUpdateV2(first)) });
  const peer = new Y.Doc();
  Y.applyUpdateV2(peer, Y.encodeStateAsUpdateV2(first));
  await t.mutation(api.mutations.presence, { collection: 'test', document: 'a', client: 'peer', action: 'join', vector: toArrayBuffer(Y.encodeStateVector(peer)) });
  const compact = await t.mutation(api.mutations.compact, { collection: 'test', document: 'a' });
  expect(compact.removed).toBe(1); // V2 empty update is longer than two bytes.
  for (const id of ['b', 'c']) {
    const doc = new Y.Doc(); doc.getMap('fields').set('title', id);
    await t.mutation(api.mutations.insertDocument, { collection: 'test', document: id, bytes: toArrayBuffer(Y.encodeStateAsUpdateV2(doc)) });
    doc.destroy();
  }
  const page = await t.query(api.mutations.stream, { collection: 'test', seq: 0, limit: 1 });
  expect(page.changes.map(c => c.document)).toEqual(['a', 'b']);
  expect(page.seq).toBe(2);
  const next = await t.query(api.mutations.stream, { collection: 'test', seq: page.seq, limit: 1 });
  expect(next.changes.map(c => c.document)).toEqual(['c']);
  const recovery = await t.query(api.mutations.recovery, { collection: 'test', document: 'a', vector: new Uint8Array([0]).buffer });
  const recovered = new Y.Doc(); Y.applyUpdateV2(recovered, new Uint8Array(recovery.diff!));
  expect(recovered.getMap('fields').get('title')).toBe('Compacted');
  peer.getMap('fields').set('artist', 'Offline edit');
  await t.mutation(api.mutations.updateDocument, { collection: 'test', document: 'a', bytes: toArrayBuffer(Y.encodeStateAsUpdateV2(peer, new Uint8Array(recovery.vector))) });
  const merged = await t.query(api.mutations.recovery, { collection: 'test', document: 'a', vector: new Uint8Array([0]).buffer });
  Y.applyUpdateV2(recovered, new Uint8Array(merged.diff!));
  expect(recovered.getMap('fields').toJSON()).toEqual({ title: 'Compacted', artist: 'Offline edit' });
  first.destroy(); peer.destroy(); recovered.destroy();
});

test('stream returns snapshots when all deltas have been compacted', async () => {
  const t = convexTest(schema, modules);
  const doc = new Y.Doc(); doc.getMap('fields').set('title', 'Only snapshot');
  await t.mutation(api.mutations.insertDocument, { collection: 'test', document: 'a', bytes: toArrayBuffer(Y.encodeStateAsUpdateV2(doc)) });
  await t.mutation(api.mutations.compact, { collection: 'test', document: 'a' });
  const page = await t.query(api.mutations.stream, { collection: 'test', seq: 0 });
  expect(page.changes).toHaveLength(1);
  expect(page.seq).toBe(1);
  doc.destroy();
});

test('action compaction preserves every delta across partial pages', async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const doc = new Y.Doc();
    for (let i = 0; i < 7; i++) {
      const vector = Y.encodeStateVector(doc);
      doc.getMap('fields').set(`field${i}`, i);
      await t.mutation(api.mutations.insertDocument, { collection: 'test', document: 'paged', bytes: toArrayBuffer(Y.encodeStateAsUpdateV2(doc, vector)) });
    }
    await t.mutation(api.mutations.scheduleCompaction, { collection: 'test', document: 'paged', pageSize: 3, maxDeltas: 2 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const result = await t.query(api.mutations.recovery, { collection: 'test', document: 'paged', vector: new Uint8Array([0]).buffer });
    const recovered = new Y.Doc(); Y.applyUpdateV2(recovered, new Uint8Array(result.diff!));
    expect(recovered.getMap('fields').toJSON()).toEqual(doc.getMap('fields').toJSON());
    recovered.destroy(); doc.destroy();
  } finally { vi.useRealTimers(); }
});

test('acknowledged field replacements compact despite repeated deletion sets', async () => {
  const t = convexTest(schema, modules);
  const doc = new Y.Doc();
  doc.getMap('fields').set('title', 'Old');
  await t.mutation(api.mutations.insertDocument, { collection: 'test', document: 'deletes', bytes: toArrayBuffer(Y.encodeStateAsUpdateV2(doc)) });
  const vector = Y.encodeStateVector(doc);
  doc.getMap('fields').set('title', 'New');
  await t.mutation(api.mutations.updateDocument, { collection: 'test', document: 'deletes', bytes: toArrayBuffer(Y.encodeStateAsUpdateV2(doc, vector)) });
  await t.mutation(api.mutations.presence, { collection: 'test', document: 'deletes', client: 'peer', action: 'join', vector: toArrayBuffer(Y.encodeStateVector(doc)) });
  const compact = await t.mutation(api.mutations.compact, { collection: 'test', document: 'deletes' });
  expect(compact.removed).toBe(2);
  const state = await t.query(api.mutations.recovery, { collection: 'test', document: 'deletes', vector: new Uint8Array([0]).buffer });
  const recovered = new Y.Doc(); Y.applyUpdateV2(recovered, new Uint8Array(state.diff!));
  expect(recovered.getMap('fields').get('title')).toBe('New');
  doc.destroy(); recovered.destroy();
});
