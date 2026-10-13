import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sites: defineTable({
    siteKey: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
  }).index("by_key", ["siteKey"]),

  chunks: defineTable({
    siteKey: v.string(),
    content: v.string(),
    embedding: v.array(v.float64()),
    sourceUrl: v.optional(v.string()),
  }).vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["siteKey"],
  }),

  conversations: defineTable({
    siteKey: v.string(),
    messages: v.array(
      v.object({ role: v.string(), content: v.string() })
    ),
    status: v.optional(v.string()), // open | ticket
  }).index("by_site", ["siteKey"]),
});
