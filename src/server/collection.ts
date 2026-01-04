import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from "convex/server";
import { Replicate } from "$/server/replicate";
import type { CompactionConfig } from "$/shared/types";

export interface CollectionOptions<T extends object> {
	compaction?: Partial<CompactionConfig>;
	hooks?: {
		evalRead?: (ctx: GenericQueryCtx<GenericDataModel>, collection: string) => void | Promise<void>;
		evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
		evalRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
		evalSession?: (
			ctx: GenericMutationCtx<GenericDataModel>,
			client: string,
		) => void | Promise<void>;
		onDelta?: (ctx: GenericQueryCtx<GenericDataModel>, result: any) => void | Promise<void>;
		onInsert?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
		onUpdate?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
		onRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
		transform?: (docs: T[]) => T[] | Promise<T[]>;
	};
}

function createCollection<T extends object>(
	component: any,
	name: string,
	options?: CollectionOptions<T>,
) {
	return createCollectionInternal<T>(component, name, options);
}

export const collection = {
	create: createCollection,
} as const;

function createCollectionInternal<T extends object>(
	component: any,
	name: string,
	options?: CollectionOptions<T>,
) {
	const storage = new Replicate<T>(component, name, options?.compaction);

	const hooks = options?.hooks;

	return {
		__collection: name,

		material: storage.createMaterialQuery({
			evalRead: hooks?.evalRead,
			transform: hooks?.transform,
		}),

		delta: storage.createDeltaQuery({
			evalRead: hooks?.evalRead,
			onDelta: hooks?.onDelta,
		}),

		replicate: storage.createReplicateMutation({
			evalWrite: hooks?.evalWrite,
			evalRemove: hooks?.evalRemove,
			onInsert: hooks?.onInsert,
			onUpdate: hooks?.onUpdate,
			onRemove: hooks?.onRemove,
		}),

		presence: storage.createSessionMutation({
			evalWrite: hooks?.evalSession,
		}),

		sessions: storage.createSessionsQuery({
			evalRead: hooks?.evalRead,
		}),
	};
}
