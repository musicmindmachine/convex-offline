import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

//#region src/component/encryption.ts
const registerDevice = mutation({
	args: {
		collection: v.string(),
		userId: v.string(),
		deviceId: v.string(),
		publicKey: v.bytes(),
		name: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db.query("devices").withIndex("by_device", (q) => q.eq("collection", args.collection).eq("userId", args.userId).eq("deviceId", args.deviceId)).first();
		if (existing) {
			await ctx.db.patch(existing._id, {
				publicKey: args.publicKey,
				lastSeen: Date.now(),
				name: args.name
			});
			return {
				id: existing._id,
				isNew: false
			};
		}
		const isFirstDevice = (await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("collection", args.collection).eq("userId", args.userId)).collect()).length === 0;
		return {
			id: await ctx.db.insert("devices", {
				collection: args.collection,
				userId: args.userId,
				deviceId: args.deviceId,
				publicKey: args.publicKey,
				name: args.name,
				created: Date.now(),
				lastSeen: Date.now(),
				approved: isFirstDevice
			}),
			isNew: true,
			autoApproved: isFirstDevice
		};
	}
});
const listDevices = query({
	args: {
		collection: v.string(),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		return ctx.db.query("devices").withIndex("by_user", (q) => q.eq("collection", args.collection).eq("userId", args.userId)).collect();
	}
});
const getPendingDevices = query({
	args: {
		collection: v.string(),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		return (await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("collection", args.collection).eq("userId", args.userId)).collect()).filter((d) => !d.approved);
	}
});
const approveDevice = mutation({
	args: {
		collection: v.string(),
		userId: v.string(),
		deviceId: v.string(),
		wrappedUmk: v.bytes()
	},
	handler: async (ctx, args) => {
		const device = await ctx.db.query("devices").withIndex("by_device", (q) => q.eq("collection", args.collection).eq("userId", args.userId).eq("deviceId", args.deviceId)).first();
		if (!device) throw new Error("Device not found");
		await ctx.db.patch(device._id, { approved: true });
		const existingKey = await ctx.db.query("wrappedKeys").withIndex("by_device", (q) => q.eq("collection", args.collection).eq("userId", args.userId).eq("deviceId", args.deviceId)).first();
		if (existingKey) await ctx.db.patch(existingKey._id, { wrappedUmk: args.wrappedUmk });
		else await ctx.db.insert("wrappedKeys", {
			collection: args.collection,
			userId: args.userId,
			deviceId: args.deviceId,
			wrappedUmk: args.wrappedUmk,
			created: Date.now()
		});
		return { success: true };
	}
});
const getWrappedUmk = query({
	args: {
		collection: v.string(),
		userId: v.string(),
		deviceId: v.string()
	},
	handler: async (ctx, args) => {
		return (await ctx.db.query("wrappedKeys").withIndex("by_device", (q) => q.eq("collection", args.collection).eq("userId", args.userId).eq("deviceId", args.deviceId)).first())?.wrappedUmk ?? null;
	}
});
const storeDocKey = mutation({
	args: {
		collection: v.string(),
		document: v.string(),
		userId: v.string(),
		wrappedKey: v.bytes()
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db.query("docKeys").withIndex("by_user_doc", (q) => q.eq("collection", args.collection).eq("userId", args.userId).eq("document", args.document)).first();
		if (existing) {
			await ctx.db.patch(existing._id, { wrappedKey: args.wrappedKey });
			return { id: existing._id };
		}
		return { id: await ctx.db.insert("docKeys", {
			collection: args.collection,
			document: args.document,
			userId: args.userId,
			wrappedKey: args.wrappedKey,
			created: Date.now()
		}) };
	}
});
const getDocKey = query({
	args: {
		collection: v.string(),
		document: v.string(),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		return (await ctx.db.query("docKeys").withIndex("by_user_doc", (q) => q.eq("collection", args.collection).eq("userId", args.userId).eq("document", args.document)).first())?.wrappedKey ?? null;
	}
});
const getDocKeysForUser = query({
	args: {
		collection: v.string(),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		return ctx.db.query("docKeys").withIndex("by_user_doc", (q) => q.eq("collection", args.collection).eq("userId", args.userId)).collect();
	}
});

//#endregion
export { approveDevice, getDocKey, getDocKeysForUser, getPendingDevices, getWrappedUmk, listDevices, registerDevice, storeDocKey };
//# sourceMappingURL=encryption.js.map