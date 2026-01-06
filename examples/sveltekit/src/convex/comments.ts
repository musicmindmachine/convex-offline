import { collection } from "@trestleinc/replicate/server";
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { authComponent } from "./auth";

async function getAuthUserId(ctx: any): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const authUser = await authComponent.getAuthUser(ctx);
  return authUser?._id ?? identity.subject;
}

export const {
  material, delta, replicate, presence, session,
} = collection.create<Doc<"comments">>(components.replicate, "comments", {
  view: async (ctx, q) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) {
      return q.filter((f: any) => f.eq(f.field("isPublic"), true)).order("desc");
    }

    return q.filter((f: any) =>
      f.or(
        f.eq(f.field("isPublic"), true),
        f.eq(f.field("ownerId"), userId),
      ),
    ).order("desc");
  },

  hooks: {
    evalWrite: async (ctx, doc) => {
      if (doc.isPublic) return;

      const userId = await getAuthUserId(ctx);
      if (!userId || doc.ownerId !== userId) {
        throw new Error("Forbidden: cannot edit private comments you don't own");
      }
    },

    evalRemove: async (ctx, docId) => {
      const doc = await ctx.db
        .query("comments")
        .withIndex("by_doc_id", (q) => q.eq("id", docId))
        .first();

      if (!doc) return;

      if (doc.isPublic) return;

      const userId = await getAuthUserId(ctx);
      if (!userId || doc.ownerId !== userId) {
        throw new Error("Forbidden: cannot delete private comments you don't own");
      }
    },
  },
});

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    return await ctx.db
      .query("comments")
      .withIndex("by_doc_id", q => q.eq("id", id))
      .first();
  },
});

export const listByInterval = query({
  args: { intervalId: v.string() },
  handler: async (ctx, { intervalId }) => {
    return await ctx.db
      .query("comments")
      .withIndex("by_interval", q => q.eq("intervalId", intervalId))
      .collect();
  },
});
