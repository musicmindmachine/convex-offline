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
