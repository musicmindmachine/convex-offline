import * as Y from "yjs";
import { getLogger } from "$/client/logger";
import type { PersistenceProvider } from "$/client/persistence/types";
import { fragmentToJSON } from "$/client/merge";

const logger = getLogger(["replicate", "subdocs"]);

export type SubdocPersistenceFactory = (documentId: string, subdoc: Y.Doc) => PersistenceProvider;

export interface SubdocManager {
  readonly rootDoc: Y.Doc;
  readonly subdocsMap: Y.Map<Y.Doc>;
  readonly collection: string;

  getOrCreate(documentId: string): Y.Doc;
  get(documentId: string): Y.Doc | undefined;
  has(documentId: string): boolean;
  getFields(documentId: string): Y.Map<unknown> | null;
  getFragment(documentId: string, field: string): Y.XmlFragment | null;
  applyUpdate(documentId: string, update: Uint8Array, origin?: string): void;
  transactWithDelta(
    documentId: string,
    fn: (fieldsMap: Y.Map<unknown>) => void,
    origin: string,
  ): Uint8Array;
  encodeStateVector(documentId: string): Uint8Array;
  encodeState(documentId: string): Uint8Array;
  delete(documentId: string): void;
  unload(documentId: string): void;
  documentIds(): string[];
  enablePersistence(factory: SubdocPersistenceFactory): void;
  destroy(): void;
}

export function createSubdocManager(collection: string): SubdocManager {
  const rootDoc = new Y.Doc({ guid: collection });
  const subdocsMap = rootDoc.getMap<Y.Doc>("documents");
  const loadedSubdocs = new Map<string, Y.Doc>();
  const subdocPersistence = new Map<string, PersistenceProvider>();
  let persistenceFactory: SubdocPersistenceFactory | null = null;

  const makeGuid = (documentId: string): string => `${collection}:${documentId}`;

  const getDocumentIdFromGuid = (guid: string): string | null => {
    const prefix = `${collection}:`;
    return guid.startsWith(prefix) ? guid.slice(prefix.length) : null;
  };

  rootDoc.on("subdocs", ({ added, removed, loaded }: {
    added: Set<Y.Doc>;
    removed: Set<Y.Doc>;
    loaded: Set<Y.Doc>;
  }) => {
    for (const subdoc of added) {
      logger.debug("Subdoc added", { collection, guid: subdoc.guid });
      if (persistenceFactory) {
        const documentId = getDocumentIdFromGuid(subdoc.guid);
        if (documentId && !subdocPersistence.has(documentId)) {
          const provider = persistenceFactory(documentId, subdoc);
          subdocPersistence.set(documentId, provider);
          logger.debug("Created persistence for subdoc", { collection, documentId });
        }
      }
    }
    for (const subdoc of loaded) {
      loadedSubdocs.set(subdoc.guid, subdoc);
      logger.debug("Subdoc loaded", { collection, guid: subdoc.guid });
    }
    for (const subdoc of removed) {
      loadedSubdocs.delete(subdoc.guid);
      const documentId = getDocumentIdFromGuid(subdoc.guid);
      if (documentId) {
        const provider = subdocPersistence.get(documentId);
        if (provider) {
          provider.destroy();
          subdocPersistence.delete(documentId);
          logger.debug("Destroyed persistence for removed subdoc", { collection, documentId });
        }
      }
      logger.debug("Subdoc removed", { collection, guid: subdoc.guid });
    }
  });

  const manager: SubdocManager = {
    rootDoc,
    subdocsMap,
    collection,

    getOrCreate(documentId: string): Y.Doc {
      const guid = makeGuid(documentId);
      let subdoc = subdocsMap.get(documentId);

      if (!subdoc) {
        subdoc = new Y.Doc({ guid });
        subdocsMap.set(documentId, subdoc);
        logger.debug("Created subdoc", { collection, documentId, guid });
      }

      if (!subdoc.isLoaded) {
        subdoc.load();
      }

      return subdoc;
    },

    get(documentId: string): Y.Doc | undefined {
      return subdocsMap.get(documentId);
    },

    has(documentId: string): boolean {
      return subdocsMap.has(documentId);
    },

    getFields(documentId: string): Y.Map<unknown> | null {
      const subdoc = subdocsMap.get(documentId);
      if (!subdoc) return null;
      return subdoc.getMap("fields");
    },

    getFragment(documentId: string, field: string): Y.XmlFragment | null {
      const fields = this.getFields(documentId);
      if (!fields) return null;

      const fragment = fields.get(field);
      if (fragment instanceof Y.XmlFragment) {
        return fragment;
      }

      return null;
    },

    applyUpdate(documentId: string, update: Uint8Array, origin?: string): void {
      const subdoc = this.getOrCreate(documentId);
      Y.applyUpdateV2(subdoc, update, origin);
      logger.debug("Applied update to subdoc", {
        collection,
        documentId,
        updateSize: update.byteLength,
        origin,
      });
    },

    transactWithDelta(
      documentId: string,
      fn: (fieldsMap: Y.Map<unknown>) => void,
      origin: string,
    ): Uint8Array {
      const subdoc = this.getOrCreate(documentId);
      const fieldsMap = subdoc.getMap<unknown>("fields");
      const beforeVector = Y.encodeStateVector(subdoc);

      subdoc.transact(() => {
        fn(fieldsMap);
      }, origin);

      const delta = Y.encodeStateAsUpdateV2(subdoc, beforeVector);

      logger.debug("Transaction completed", {
        collection,
        documentId,
        deltaSize: delta.byteLength,
        origin,
      });

      return delta;
    },

    encodeStateVector(documentId: string): Uint8Array {
      const subdoc = subdocsMap.get(documentId);
      if (!subdoc) {
        const emptyDoc = new Y.Doc();
        const vector = Y.encodeStateVector(emptyDoc);
        emptyDoc.destroy();
        return vector;
      }
      return Y.encodeStateVector(subdoc);
    },

    encodeState(documentId: string): Uint8Array {
      const subdoc = subdocsMap.get(documentId);
      if (!subdoc) {
        return new Uint8Array();
      }
      return Y.encodeStateAsUpdateV2(subdoc);
    },

    delete(documentId: string): void {
      const subdoc = subdocsMap.get(documentId);
      if (subdoc) {
        subdocsMap.delete(documentId);
        subdoc.destroy();
        loadedSubdocs.delete(makeGuid(documentId));
        logger.debug("Deleted subdoc", { collection, documentId });
      }
    },

    unload(documentId: string): void {
      const subdoc = subdocsMap.get(documentId);
      if (subdoc) {
        subdoc.destroy();
        loadedSubdocs.delete(makeGuid(documentId));
        logger.debug("Unloaded subdoc", { collection, documentId });
      }
    },

    documentIds(): string[] {
      return Array.from(subdocsMap.keys());
    },

    enablePersistence(factory: SubdocPersistenceFactory): void {
      for (const [documentId, subdoc] of subdocsMap.entries()) {
        if (!subdocPersistence.has(documentId)) {
          const provider = factory(documentId, subdoc);
          subdocPersistence.set(documentId, provider);
          logger.debug("Enabled persistence for existing subdoc", { collection, documentId });
        }
      }

      persistenceFactory = factory;
      logger.info("Subdoc persistence enabled", { collection });
    },

    destroy(): void {
      for (const [documentId, provider] of subdocPersistence) {
        provider.destroy();
        logger.debug("Destroyed subdoc persistence", { collection, documentId });
      }
      subdocPersistence.clear();

      for (const [docId, subdoc] of loadedSubdocs) {
        subdoc.destroy();
        logger.debug("Destroyed subdoc", { collection, guid: docId });
      }
      loadedSubdocs.clear();
      rootDoc.destroy();
      logger.info("SubdocManager destroyed", { collection });
    },
  };

  logger.info("SubdocManager created", { collection });
  return manager;
}

export function serializeSubdocFields(fieldsMap: Y.Map<unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  fieldsMap.forEach((value, key) => {
    if (value instanceof Y.XmlFragment) {
      // Use fragmentToJSON for proper { type: "doc", content: [...] } format
      // Native toJSON() returns "" for empty fragments which breaks schema validation
      result[key] = fragmentToJSON(value);
    }
    else if (value instanceof Y.Map) {
      result[key] = value.toJSON();
    }
    else if (value instanceof Y.Array) {
      result[key] = value.toJSON();
    }
    else {
      result[key] = value;
    }
  });

  return result;
}

export function extractDocumentFromSubdoc(
  subdocManager: SubdocManager,
  documentId: string,
): Record<string, unknown> | null {
  const fieldsMap = subdocManager.getFields(documentId);
  if (!fieldsMap) return null;

  const doc = serializeSubdocFields(fieldsMap);
  doc.id = documentId;

  return doc;
}

export function extractAllDocuments(
  subdocManager: SubdocManager,
): Record<string, unknown>[] {
  const documents: Record<string, unknown>[] = [];

  for (const documentId of subdocManager.documentIds()) {
    const doc = extractDocumentFromSubdoc(subdocManager, documentId);
    if (doc) {
      documents.push(doc);
    }
  }

  return documents;
}
