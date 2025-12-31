import { collection, persistence } from "@trestleinc/replicate/client";
import { ConvexClient } from "convex/browser";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { api } from "$convex/_generated/api";
import { commentSchema } from "$lib/types";

export const comments = collection.create({
  persistence: async () => {
    const module = await import("@sqlite.org/sqlite-wasm");
    return persistence.sqlite.browser(module, "comments");
  },
  config: () => ({
    schema: commentSchema,
    convexClient: new ConvexClient(PUBLIC_CONVEX_URL),
    api: api.comments,
    getKey: (comment) => comment.id,
  }),
});

export type { Comment } from "$lib/types";
