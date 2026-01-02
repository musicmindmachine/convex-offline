import * as Y from "yjs";

export function createDeleteDelta(): Uint8Array {
  return new Uint8Array(0);
}

export function createUpdateDelta(
  ydoc: Y.Doc,
  changes: Record<string, unknown>,
  proseFields: Set<string>,
): Uint8Array {
  const fields = ydoc.getMap("fields");
  const beforeVector = Y.encodeStateVector(ydoc);

  ydoc.transact(() => {
    for (const [key, value] of Object.entries(changes)) {
      if (key === "id") continue;
      if (proseFields.has(key)) continue;

      fields.set(key, value);
    }
  });

  return Y.encodeStateAsUpdateV2(ydoc, beforeVector);
}
