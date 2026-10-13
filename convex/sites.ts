import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsert = mutation({
  args: { siteKey: v.string(), name: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("sites").withIndex("by_key", (q) => q.eq("siteKey", args.siteKey)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { name: args.name ?? existing.name, color: args.color ?? existing.color });
      return existing._id;
    }
    return await ctx.db.insert("sites", {
      siteKey: args.siteKey,
      name: args.name ?? args.siteKey,
      color: args.color ?? "#2563eb",
    });
  },
});

export const get = query({
  args: { siteKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("sites").withIndex("by_key", (q) => q.eq("siteKey", args.siteKey)).unique();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("sites").collect(),
});
