import { Effect, Context, Ref, Scope, HashMap, Option, Exit } from "effect";
import * as Y from "yjs";
import {
	createDocumentActor,
	type DocumentActor,
	type SyncFn,
	type ActorConfig,
} from "$/client/services/actor";

export interface ActorManager {
	readonly register: (
		documentId: string,
		ydoc: Y.Doc,
		syncFn: SyncFn,
		debounceMs?: number,
	) => Effect.Effect<DocumentActor>;

	readonly get: (documentId: string) => Effect.Effect<DocumentActor | null>;

	readonly onLocalChange: (documentId: string) => Effect.Effect<void>;

	readonly onServerUpdate: (documentId: string) => Effect.Effect<void>;

	readonly unregister: (documentId: string) => Effect.Effect<void>;

	readonly destroy: () => Effect.Effect<void>;
}

export class ActorManagerService extends Context.Tag("ActorManager")<
	ActorManagerService,
	ActorManager
>() {}

export interface ActorManagerConfig {
	readonly debounceMs?: number;
	readonly maxRetries?: number;
}

const DEFAULT_DEBOUNCE_MS = 200;
const DEFAULT_MAX_RETRIES = 3;

interface ManagedActor {
	readonly actor: DocumentActor;
	readonly scope: Scope.CloseableScope;
}

// Sentinel value to indicate actor creation is in progress
interface PendingActor {
	readonly _tag: "pending";
	readonly promise: Promise<DocumentActor>;
}

type ActorEntry = ManagedActor | PendingActor;

const isPending = (entry: ActorEntry): entry is PendingActor =>
	"_tag" in entry && entry._tag === "pending";

export const createActorManager = (
	config: ActorManagerConfig = {},
): Effect.Effect<ActorManager, never, Scope.Scope> =>
	Effect.gen(function* () {
		const actorConfig: ActorConfig = {
			debounceMs: config.debounceMs ?? DEFAULT_DEBOUNCE_MS,
			maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
		};

		const actorsRef = yield* Ref.make(HashMap.empty<string, ActorEntry>());

		const manager: ActorManager = {
			register: (documentId, ydoc, syncFn, debounceMs) =>
				Effect.gen(function* () {
					// Atomic check-and-set: check for existing entry and mark as pending in one operation
					const checkResult = yield* Ref.modify(actorsRef, actors => {
						const existing = HashMap.get(actors, documentId);
						if (Option.isSome(existing)) {
							// Already exists or pending - return existing entry, don't modify map
							return [{ action: "existing" as const, entry: existing.value }, actors];
						}
						// Create a deferred promise that we'll resolve after actor creation
						let resolvePromise: (actor: DocumentActor) => void;
						let rejectPromise: (error: Error) => void;
						const promise = new Promise<DocumentActor>((resolve, reject) => {
							resolvePromise = resolve;
							rejectPromise = reject;
						});
						const pending: PendingActor = { _tag: "pending", promise };
						return [
							{
								action: "create" as const,
								resolvePromise: resolvePromise!,
								rejectPromise: rejectPromise!,
							},
							HashMap.set(actors, documentId, pending),
						];
					});

					// If already exists, wait for it if pending, or return directly
					if (checkResult.action === "existing") {
						const entry = checkResult.entry;
						if (isPending(entry)) {
							// Wait for the in-progress registration to complete
							return yield* Effect.promise(() => entry.promise);
						}
						return entry.actor;
					}

					// We won the race - create the actor with proper resource cleanup on failure
					const { resolvePromise, rejectPromise } = checkResult;

					const createActorWithCleanup = Effect.acquireRelease(Scope.make(), (scope, exit) =>
						Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void,
					).pipe(
						Effect.flatMap(scope => {
							const resolvedConfig: ActorConfig =
								debounceMs !== undefined ? { ...actorConfig, debounceMs } : actorConfig;

							return createDocumentActor(documentId, ydoc, syncFn, resolvedConfig).pipe(
								Effect.provideService(Scope.Scope, scope),
								Effect.map(actor => ({ actor, scope })),
							);
						}),
					);

					const result = yield* Effect.either(createActorWithCleanup);

					if (result._tag === "Left") {
						// Creation failed - remove pending entry and reject waiters
						yield* Ref.update(actorsRef, HashMap.remove(documentId));
						rejectPromise(new Error(`Failed to create actor for ${documentId}`));
						return yield* Effect.fail(result.left);
					}

					const { actor, scope } = result.right;
					const managed: ManagedActor = { actor, scope };

					// Update from pending to managed
					yield* Ref.update(actorsRef, HashMap.set(documentId, managed));
					resolvePromise(actor);

					yield* Effect.log(`Actor registered for document ${documentId}`);

					return actor;
				}),

			get: documentId =>
				Ref.get(actorsRef).pipe(
					Effect.map(actors => {
						const opt = HashMap.get(actors, documentId);
						if (Option.isNone(opt)) return null;
						const entry = opt.value;
						// Only return if fully registered, not pending
						return isPending(entry) ? null : entry.actor;
					}),
				),

			onLocalChange: documentId =>
				Effect.gen(function* () {
					const actor = yield* manager.get(documentId);
					if (actor) {
						yield* actor.send({ _tag: "LocalChange" });
					}
				}),

			onServerUpdate: documentId =>
				Effect.gen(function* () {
					const actor = yield* manager.get(documentId);
					if (actor) {
						yield* actor.send({ _tag: "ExternalUpdate" });
					}
				}),

			unregister: documentId =>
				Effect.gen(function* () {
					const actors = yield* Ref.get(actorsRef);
					const entry = HashMap.get(actors, documentId);

					if (Option.isNone(entry)) {
						return;
					}

					const value = entry.value;
					if (isPending(value)) {
						// Wait for pending registration to complete before unregistering
						yield* Effect.tryPromise(() => value.promise);
						// Re-fetch after await
						const updatedActors = yield* Ref.get(actorsRef);
						const updatedEntry = HashMap.get(updatedActors, documentId);
						if (Option.isNone(updatedEntry) || isPending(updatedEntry.value)) {
							return;
						}
						yield* updatedEntry.value.actor.shutdown;
						yield* Scope.close(updatedEntry.value.scope, Exit.void);
					} else {
						yield* value.actor.shutdown;
						yield* Scope.close(value.scope, Exit.void);
					}

					yield* Ref.update(actorsRef, HashMap.remove(documentId));
					yield* Effect.log(`Actor unregistered for document ${documentId}`);
				}),

			destroy: () =>
				Effect.gen(function* () {
					const actors = yield* Ref.get(actorsRef);

					yield* Effect.all(
						Array.from(HashMap.values(actors)).map(entry =>
							Effect.gen(function* () {
								if (isPending(entry)) {
									// Wait for pending registration then clean up
									const actor = yield* Effect.tryPromise(() => entry.promise).pipe(
										Effect.catchAll(() => Effect.succeed(null)),
									);
									if (actor) {
										// Re-fetch to get the managed entry with scope
										const currentActors = yield* Ref.get(actorsRef);
										const currentEntry = HashMap.values(currentActors).find(
											e => !isPending(e) && e.actor === actor,
										);
										if (currentEntry && !isPending(currentEntry)) {
											yield* currentEntry.actor.shutdown;
											yield* Scope.close(currentEntry.scope, Exit.void);
										}
									}
								} else {
									yield* entry.actor.shutdown;
									yield* Scope.close(entry.scope, Exit.void);
								}
							}),
						),
						{ concurrency: "unbounded" },
					);

					yield* Ref.set(actorsRef, HashMap.empty());

					yield* Effect.log("ActorManager destroyed");
				}),
		};

		return manager;
	});
