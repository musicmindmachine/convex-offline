import { Effect, TestClock, SubscriptionRef, Fiber, Ref, Scope, Exit } from "effect";
import * as Y from "yjs";

export { Effect, TestClock, SubscriptionRef, Fiber, Ref, Scope, Exit };

export const createTestYDoc = (fields: Record<string, unknown> = {}) => {
	const doc = new Y.Doc();
	const map = doc.getMap("fields");
	for (const [key, value] of Object.entries(fields)) {
		map.set(key, value);
	}
	return doc;
};

export const createMockSyncFn = (opts: { failCount?: number } = {}) => {
	let callCount = 0;
	const { failCount = 0 } = opts;

	return {
		fn: async () => {
			callCount++;
			if (callCount <= failCount) {
				throw new Error(`Sync failed (attempt ${callCount})`);
			}
		},
		getCallCount: () => callCount,
	};
};
