import { expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollection } from '@tanstack/db';
import { makeFunctionReference } from 'convex/server';
import { convexCollectionOptions } from '$/client/collection';
import { memoryPersistence } from '$/client/persistence/memory';

test('persisted documents become ready even when network recovery never resolves', async () => {
  const disk = new Y.Doc();
  disk.getMap('fields').set('name', 'Offline edit');
  const persistence = memoryPersistence();
  persistence.listDocuments = async () => ['song1'];
  persistence.createDocPersistence = (_key, doc) => {
    Y.applyUpdateV2(doc, Y.encodeStateAsUpdateV2(disk));
    return { whenSynced: Promise.resolve(), destroy() {} };
  };
  const query = vi.fn(() => new Promise(() => {}));
  const collection = createCollection(convexCollectionOptions<{ id: string; name: string }>({
    getKey: doc => doc.id, persistence,
    convexClient: { query, onUpdate: () => () => {}, mutation: vi.fn() } as any,
    api: Object.fromEntries(['delta','material','session','replicate','presence'].map(name => [name, makeFunctionReference(`offline-startup:${name}`)])) as any,
    material: { documents: [], count: 0 },
  }));
  await collection.preload();
  expect(collection.get('song1')?.name).toBe('Offline edit');
  expect(query).toHaveBeenCalled();
  await collection.cleanup();
  disk.destroy();
});

test('durable transports recover remote state without republishing untouched cached documents', async () => {
  const events = new EventTarget();
  const registered = vi.spyOn(events, 'addEventListener');
  vi.stubGlobal('window', events);
  vi.stubGlobal('navigator', { onLine: false });
  const disk = new Y.Doc();
  disk.getMap('fields').set('name', 'Cached song');
  const persistence = memoryPersistence();
  persistence.listDocuments = async () => ['song1'];
  persistence.createDocPersistence = (_key, doc) => {
    Y.applyUpdateV2(doc, Y.encodeStateAsUpdateV2(disk));
    return { whenSynced: Promise.resolve(), destroy() {} };
  };
  const query = vi.fn(async () => ({ mode: 'recovery', vector: new Uint8Array([0]).buffer }));
  const mutation = vi.fn();
  const collection = createCollection(convexCollectionOptions<{ id: string; name: string }>({
    getKey: doc => doc.id, persistence, replayLocalOnReconnect: false,
    convexClient: { query, onUpdate: () => () => {}, mutation } as any,
    api: Object.fromEntries(['delta','material','session','replicate','presence'].map(name => [name, makeFunctionReference(`durable-reconnect:${name}`)])) as any,
    material: { documents: [], count: 0 },
  }));
  try {
    await collection.preload();
    await vi.waitFor(() => expect(query).toHaveBeenCalled());
    await vi.waitFor(() => expect(registered.mock.calls.some(call => call[0] === 'online')).toBe(true));
    const before = query.mock.calls.length;
    events.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(query.mock.calls.length).toBeGreaterThan(before));
    expect(mutation).not.toHaveBeenCalled();
    expect(collection.get('song1')?.name).toBe('Cached song');
  } finally {
    await collection.cleanup();
    disk.destroy();
    vi.unstubAllGlobals();
  }
});
