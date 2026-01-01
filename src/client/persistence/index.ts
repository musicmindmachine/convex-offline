export type { StorageAdapter, Persistence } from "./types.js";

import { memoryPersistence } from "./memory.js";
import { createBrowserSqlitePersistence } from "./sqlite/browser.js";
import { createNativeSqlitePersistence } from "./sqlite/native.js";
import { createIndexedDBPersistence } from "./indexeddb.js";
import { createCustomPersistence } from "./custom.js";
import { createPGlitePersistence, oncePGlitePersistence } from "./pglite.js";

export const persistence = {
  memory: memoryPersistence,
  sqlite: {
    browser: createBrowserSqlitePersistence,
    native: createNativeSqlitePersistence,
  },
  pglite: Object.assign(createPGlitePersistence, {
    once: oncePGlitePersistence,
  }),
  indexeddb: createIndexedDBPersistence,
  custom: createCustomPersistence,
} as const;
