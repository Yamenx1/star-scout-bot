import fs from "node:fs";
import path from "node:path";

const DB_FILE = path.join(process.cwd(), "ollama_data.json");

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {}
  return { chunks: [], conversations: [] };
}

// POST { siteKey, email, messages } -> save support ticket
export async function POST(req) {
  const { siteKey = "SITE_DEMO", email = "", messages = [] } = await req.json();
  const db = loadDB();
  db.conversations.push({ siteKey, email, messages, status: "ticket", at: Date.now() });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
  return Response.json({ ok: true });
}
