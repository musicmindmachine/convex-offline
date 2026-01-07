export type { StorageAdapter, Persistence } from "./types.js";

import { memoryPersistence } from "./memory.js";
import { createNativeSqlitePersistence } from "./sqlite/native.js";
import { createWebSqlitePersistence, onceWebSqlitePersistence } from "./sqlite/web.js";
import { createCustomPersistence } from "./custom.js";
import { createWebEncryptedPersistence } from "./encrypted/web.js";
import { isPRFSupported } from "./encrypted/webauthn.js";

export type {
	WebEncryptedConfig,
	NativeEncryptedConfig,
	EncryptedPersistence,
	EncryptionState,
} from "./encrypted/types.js";

export const persistence = {
	web: {
		sqlite: Object.assign(createWebSqlitePersistence, {
			once: onceWebSqlitePersistence,
		}),
		encrypted: Object.assign(createWebEncryptedPersistence, {
			webauthn: {
				supported: isPRFSupported,
			},
		}),
	},
	native: {
		sqlite: createNativeSqlitePersistence,
		encrypted: Object.assign(
			(): never => {
				throw new Error("persistence.native.encrypted() not yet implemented");
			},
			{
				biometric: {
					supported: (): Promise<boolean> => Promise.resolve(false),
				},
			},
		),
	},
	memory: memoryPersistence,
	custom: createCustomPersistence,
} as const;
