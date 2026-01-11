import { collection, identity } from "@trestleinc/replicate/client";
import { api } from "$convex/_generated/api";
import { commentSchema } from "$convex/schema";
import { createPersistence } from "$lib/sqlite";
import { convexClient } from "$lib/convex";
import { authClient } from "$lib/auth-client";
import type { Infer } from "convex/values";

/**
 * Comments collection using the new versioned schema API.
 *
 * Features:
 * - Automatic client-side migrations when schema version changes
 * - Type-safe with Convex validators
 * - Optional migration error handling
 */
export const comments = collection.create({
	schema: commentSchema,
	persistence: createPersistence,
	config: () => ({
		convexClient,
		api: api.comments,
		getKey: (comment: Comment) => comment.id,
		user: () => {
			const store = authClient.useSession();
			const session = store.get();
			if (!session.data?.user) return undefined;
			return identity.from({
				id: session.data.user.id,
				name: session.data.user.name,
				avatar: session.data.user.image ?? undefined,
				color: identity.color.generate(session.data.user.id),
			});
		},
	}),
	// Optional: Handle migration errors gracefully
	onMigrationError: async (error, context) => {
		console.error("Migration error:", error);
		// If no pending changes, safe to reset
		if (context.canResetSafely) {
			return { action: "reset" };
		}
		// Otherwise keep old schema and let sync resolve it
		return { action: "keep-old-schema" };
	},
});

// Type inference from the versioned schema
export type Comment = Infer<typeof commentSchema.shape>;
