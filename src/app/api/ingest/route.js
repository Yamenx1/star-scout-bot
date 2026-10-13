import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";

const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const DB_FILE = path.join(process.cwd(), "ollama_data.json");

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {}
  return { chunks: [], conversations: [] };
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
}
function chunkText(text, size = 800) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.filter((t) => t.trim().length > 100).slice(0, 50);
}
async function ollamaEmbed(input) {
  const r = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  if (!r.ok) throw new Error(`Ollama embed failed: ${r.status} ${await r.text()}`);
  return (await r.json()).embeddings[0];
}

// POST { siteKey, url } or { siteKey, text } -> scrape, embed with Ollama, store locally (+ Convex if configured)
export async function POST(req) {
  const { siteKey = "SITE_DEMO", url, text } = await req.json();
  try {
    let raw = text || "";
    let sourceName = url || "pasted-text";
    if (!raw && url) {
      const html = await (await fetch(url)).text();
      const $ = cheerio.load(html);
      $("script,style,nav,footer").remove();
      raw = $("body").text().replace(/\s+/g, " ").trim();
    }
    if (!raw || raw.trim().length < 50) throw new Error("No usable text found.");

    const pieces = chunkText(raw);
    const embedded = [];
    for (const p of pieces) {
      embedded.push({ siteKey, content: p, embedding: await ollamaEmbed(p), sourceUrl: sourceName });
    }

    // always save locally (shared with server.mjs)
    const db = loadDB();
    db.chunks = db.chunks.filter((c) => c.siteKey !== siteKey).concat(embedded);
    saveDB(db);

    // bonus: also push to Convex if configured
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (convexUrl && !convexUrl.includes("localhost")) {
      try {
        const { ConvexHttpClient } = await import("convex/browser");
        const { api, internal } = await import("../../../../convex/_generated/api");
        const client = new ConvexHttpClient(convexUrl);
        await client.mutation(internal.chat.saveChunks, { siteKey, chunks: embedded });
        await client.mutation(api.sites.upsert, { siteKey, name: sourceName });
      } catch (e) {
        console.error("Convex sync failed (local save OK):", e.message);
      }
    }

    return Response.json({ ok: true, chunks: embedded.length, via: "ollama" });
  } catch (e) {
    console.error("ingest failed:", e.message);
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
