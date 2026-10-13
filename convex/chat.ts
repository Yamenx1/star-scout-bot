import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";

// Log widget messages + create ticket when user asks for human
export const log = mutation({
  args: {
    siteKey: v.string(),
    messages: v.array(v.object({ role: v.string(), content: v.string() })),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversations", args);
  },
});

export const history = query({
  args: { siteKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("conversations").withIndex("by_site", (q) => q.eq("siteKey", args.siteKey)).order("desc").take(50);
  },
});

export const saveChunks = internalMutation({
  args: {
    siteKey: v.string(),
    chunks: v.array(v.object({ content: v.string(), embedding: v.array(v.float64()), sourceUrl: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    // replace old chunks for this site
    const old = await ctx.db.query("chunks").filter((q) => q.eq(q.field("siteKey"), args.siteKey)).collect();
    await Promise.all(old.map((d) => ctx.db.delete(d._id)));
    await Promise.all(args.chunks.map((c) => ctx.db.insert("chunks", { siteKey: args.siteKey, ...c })));
  },
});

export const similarChunks = internalQuery({
  args: { siteKey: v.string(), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    return await ctx.vectorSearch("chunks", "by_embedding", {
      vector: args.embedding,
      limit: 5,
      filter: (q) => q.eq("siteKey", args.siteKey),
    });
  },
});

// Main AI answer: vector search in Convex + OpenAI, constrained to site content
export const ask = action({
  args: { siteKey: v.string(), messages: v.array(v.object({ role: v.string(), content: v.string() })) },
  handler: async (ctx, args): Promise<{ reply: string }> => {
    const last = args.messages[args.messages.length - 1]?.content ?? "";
    if (/human|ticket|agent/i.test(last)) {
      await ctx.runMutation(internal.chat.saveTicket, { siteKey: args.siteKey, messages: args.messages });
      return { reply: "Got it — I've created a ticket for the site owner. They'll email you shortly. Anything else?" };
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { reply: `Demo reply for [${args.siteKey}]: you asked "${last}". Add OPENAI_API_KEY for real answers.` };

    const openai = new OpenAI({ apiKey });
    const emb = await openai.embeddings.create({ model: "text-embedding-3-small", input: last });
    const hits = await ctx.runQuery(internal.chat.similarChunks, { siteKey: args.siteKey, embedding: emb.data[0].embedding });
    const context = hits.map((h: any) => h.content ?? "").join("\n---\n").slice(0, 6000);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are a customer support bot. Answer ONLY from this site context. If unsure, offer to create a ticket.\nContext:\n${context}` },
        ...args.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
    });
    const reply = completion.choices[0]?.message?.content ?? "Sorry, I could not answer that.";
    return { reply };
  },
});

export const saveTicket = internalMutation({
  args: { siteKey: v.string(), messages: v.array(v.object({ role: v.string(), content: v.string() })) },
  handler: async (ctx, args) => {
    await ctx.db.insert("conversations", { ...args, status: "ticket" });
  },
});
