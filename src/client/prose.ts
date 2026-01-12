import * as Y from "yjs";
import type { Collection } from "@tanstack/db";
import { Effect, SubscriptionRef, Stream, Fiber } from "effect";
import { getLogger } from "$/client/logger";
import { serializeYMapValue } from "$/client/merge";
import { getContext, hasContext } from "$/client/services/context";
import { runWithRuntime } from "$/client/services/engine";

const SERVER_ORIGIN = "server";
const noop = (): void => undefined;

const logger = getLogger(["replicate", "prose"]);

export interface ProseObserverConfig {
	collection: string;
	document: string;
	field: string;
	fragment: Y.XmlFragment;
	ydoc: Y.Doc;
	ymap: Y.Map<unknown>;
	collectionRef: Collection<any>;
	debounceMs?: number;
}

function createSyncFn(
	document: string,
	ydoc: Y.Doc,
	ymap: Y.Map<unknown>,
	collectionRef: Collection<any>,
): () => Promise<void> {
	return async () => {
		const material = serializeYMapValue(ymap);
		const delta = Y.encodeStateAsUpdateV2(ydoc);
		const bytes = delta.buffer as ArrayBuffer;

		const result = collectionRef.update(
			document,
			{ metadata: { contentSync: { bytes, material } } },
			(draft: any) => {
				draft.timestamp = Date.now();
			},
		);
		await result.isPersisted.promise;
	};
}

export function observeFragment(config: ProseObserverConfig): () => void {
	const { collection, document, field, fragment, ydoc, ymap, collectionRef, debounceMs } = config;

	if (!hasContext(collection)) {
		logger.warn("Cannot observe fragment - collection not initialized", { collection, document });
		return noop;
	}

	const ctx = getContext(collection);
	const actorManager = ctx.actorManager;
	const runtime = ctx.runtime;

	if (!actorManager || !runtime) {
		logger.warn("Cannot observe fragment - actor system not initialized", { collection, document });
		return noop;
	}

	const existingCleanup = ctx.fragmentObservers.get(document);
	if (existingCleanup) {
		logger.debug("Fragment already being observed", { collection, document, field });
		return existingCleanup;
	}

	const syncFn = createSyncFn(document, ydoc, ymap, collectionRef);

	// Track registration state for cleanup safety
	let isRegistered = false;
	let registrationError: Error | null = null;

	// Await actor registration - use void to explicitly acknowledge floating promise
	// The registration must complete before local changes can be processed
	void runWithRuntime(runtime, actorManager.register(document, ydoc, syncFn, debounceMs))
		.then(() => {
			isRegistered = true;
		})
		.catch((error: Error) => {
			registrationError = error;
			logger.error("Failed to register actor for fragment", {
				collection,
				document,
				field,
				error: error.message,
			});
		});

	const observerHandler = (_events: Y.YEvent<any>[], transaction: Y.Transaction) => {
		if (transaction.origin === SERVER_ORIGIN) {
			return;
		}

		// Only send local changes if registration succeeded
		if (registrationError) {
			logger.warn("Skipping local change - actor registration failed", { collection, document });
			return;
		}

		// Fire-and-forget for local changes is acceptable - they are queued in the actor
		void runWithRuntime(runtime, actorManager.onLocalChange(document));
	};

	fragment.observeDeep(observerHandler);

	const cleanup = () => {
		fragment.unobserveDeep(observerHandler);
		// Only unregister if registration was attempted
		if (isRegistered || !registrationError) {
			void runWithRuntime(runtime, actorManager.unregister(document));
		}
		ctx.fragmentObservers.delete(document);
		logger.debug("Fragment observer cleaned up", { collection, document, field });
	};

	ctx.fragmentObservers.set(document, cleanup);
	logger.debug("Fragment observer registered", { collection, document, field });

	return cleanup;
}

export function isPending(collection: string, document: string): boolean {
	if (!hasContext(collection)) return false;
	const ctx = getContext(collection);
	if (!ctx.actorManager || !ctx.runtime) return false;

	let result = false;

	const effect = Effect.gen(function* () {
		const actor = yield* ctx.actorManager!.get(document);
		if (!actor) return false;
		return yield* SubscriptionRef.get(actor.pending);
	});

	try {
		result = Effect.runSync(Effect.provide(effect, ctx.runtime.runtime));
	} catch {
		result = false;
	}

	return result;
}

export function subscribePending(
	collection: string,
	document: string,
	callback: (pending: boolean) => void,
): () => void {
	if (!hasContext(collection)) return noop;
	const ctx = getContext(collection);
	if (!ctx.actorManager || !ctx.runtime) return noop;

	let fiber: Fiber.RuntimeFiber<void, never> | null = null;
	let isCleanedUp = false;

	const setupSubscription = async (): Promise<void> => {
		try {
			// Use runWithRuntime (async) to properly await actor readiness
			await runWithRuntime(
				ctx.runtime!,
				Effect.gen(function* () {
					const actor = yield* ctx.actorManager!.get(document);
					if (!actor || isCleanedUp) return;

					const stream = actor.pending.changes;

					fiber = yield* Effect.fork(
						Stream.runForEach(stream, (pending: boolean) =>
							Effect.sync(() => {
								// Don't call callback if already cleaned up
								if (!isCleanedUp) {
									callback(pending);
								}
							}),
						),
					);
				}),
			);
		} catch (error) {
			logger.warn("Failed to subscribe to pending state", {
				collection,
				document,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	// Start subscription asynchronously
	void setupSubscription();

	return () => {
		isCleanedUp = true;
		if (fiber) {
			// Properly interrupt the fiber and handle the promise
			void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => {
				// Ignore interrupt errors - fiber may already be done
			});
			fiber = null;
		}
	};
}

export function cleanup(collection: string): void {
	if (!hasContext(collection)) return;
	const ctx = getContext(collection);

	for (const [, cleanupFn] of ctx.fragmentObservers) {
		cleanupFn();
	}
	ctx.fragmentObservers.clear();

	if (ctx.runtime) {
		ctx.runtime.cleanup();
	}

	logger.debug("Prose cleanup complete", { collection });
}
