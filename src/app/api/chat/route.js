import fs from "node:fs";
import path from "node:path";

const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://localhost:11434";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3.2";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const DB_FILE = path.join(process.cwd(), "ollama_data.json");

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {}
  return { chunks: [], conversations: [] };
}
function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1)); } catch {}
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
async function ollamaEmbed(input) {
  const r = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  return (await r.json()).embeddings[0];
}
async function ollamaChat(messages) {
  const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: false }),
  });
  if (!r.ok) throw new Error(`chat ${r.status}`);
  return (await r.json()).message?.content ?? "Sorry, I could not answer that.";
}

export async function POST(req) {
  const { siteKey = "SITE_DEMO", messages = [] } = await req.json();
  const last = messages?.[messages.length - 1]?.content ?? "";
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;

  // 1) Convex + OpenAI path (if configured) — dynamic import so missing _generated/ doesn't crash
  if (url && !url.includes("localhost")) {
    try {
      const { ConvexHttpClient } = await import("convex/browser");
      const { api } = await import("../../../convex/_generated/api");
      const client = new ConvexHttpClient(url);
      const { reply } = await client.action(api.chat.ask, { siteKey, messages });
      return Response.json({ reply, via: "convex" });
    } catch (e) {
      console.error("Convex path failed, falling back to Ollama:", e.message);
    }
  }

  // 2) Ticket shortcut (no LLM needed)
  if (/human|ticket|agent/i.test(last)) {
    const db = loadDB();
    db.conversations.push({ siteKey, messages, status: "ticket", at: Date.now() });
    saveDB(db);
    return Response.json({ reply: "Got it — I've created a ticket for the site owner. They'll email you shortly. Anything else?", via: "local" });
  }

  // 3) Ollama RAG (local, free)
  try {
    const db = loadDB();
    let context = "";
    const siteChunks = db.chunks.filter((c) => c.siteKey === siteKey && c.embedding?.length);
    if (siteChunks.length) {
      const qEmb = await ollamaEmbed(last);
      context = siteChunks
        .map((c) => ({ c, s: cosine(qEmb, c.embedding) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map((r) => r.c.content)
        .join("\n---\n")
        .slice(0, 6000);
    }
    const system = context
      ? `You are a customer support bot. Answer ONLY from this site context. If unsure, offer to create a ticket.\nContext:\n${context}`
      : `You are a helpful customer support bot for site ${siteKey}. No training content yet — answer generally and offer to create a ticket if unsure. Keep replies short.`;
    const reply = await ollamaChat([
      { role: "system", content: system },
      ...messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
    ]);
    db.conversations.push({ siteKey, messages: [...messages, { role: "assistant", content: reply }], status: "open", at: Date.now() });
    saveDB(db);
    return Response.json({ reply, via: "ollama" });
  } catch (e) {
    console.error("Ollama chat failed:", e.message);
    return Response.json({
      reply: `Demo reply for [${siteKey}]: you asked "${last}". (Ollama unreachable at ${OLLAMA_BASE} — run: ollama serve, ollama pull ${CHAT_MODEL})`,
      via: "stub",
    });
  }
}
