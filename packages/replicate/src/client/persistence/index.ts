export type { StorageAdapter, Persistence } from "./types.js";

import { memoryPersistence } from "./memory.js";
import { createNativeSqlitePersistence } from "./sqlite/native.js";
import { createWebSqlitePersistence, onceWebSqlitePersistence } from "./sqlite/web.js";
import { createCustomPersistence } from "./custom.js";
import { createWebEncryptionPersistence } from "./encrypted/web.js";
import { isPRFSupported } from "./encrypted/webauthn.js";
import { createEncryptionManager } from "./encrypted/manager.js";

export type {
	WebEncryptionConfig,
	NativeEncryptionConfig,
	EncryptionPersistence,
	EncryptionState,
} from "./encrypted/types.js";

export type {
	EncryptionManager,
	EncryptionManagerConfig,
	EncryptionManagerState,
	EncryptionManagerHooks,
	EncryptionPreference,
} from "./encrypted/manager.js";

export const persistence = {
	web: {
		sqlite: Object.assign(createWebSqlitePersistence, {
			once: onceWebSqlitePersistence,
		}),
		encryption: Object.assign(createWebEncryptionPersistence, {
			manager: createEncryptionManager,
			webauthn: {
				supported: isPRFSupported,
			},
		}),
	},
	native: {
		sqlite: createNativeSqlitePersistence,
		encryption: Object.assign(
			(): never => {
				throw new Error("persistence.native.encryption() not yet implemented");
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
