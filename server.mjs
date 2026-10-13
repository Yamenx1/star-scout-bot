// Star Scout bot server — RAG + exact stats, streaming, tickets.
// Run: node server.mjs -> demo http://localhost:3000/demo.html, admin http://localhost:3000/admin.html
// Local LLM (default): requires Ollama (ollama pull llama3.2 + nomic-embed-text).
// Hosted LLM (for Render/VPS): set GROQ_API_KEY (+ optional GROQ_MODEL) and chat uses Groq instead.
//   Embeddings are precomputed in ollama_data.json, so no embedding model is needed at runtime.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(__dirname, "public");
const DB_FILE = path.join(__dirname, "ollama_data.json");
const PLAYERS_FILE = path.join(__dirname, "future_stars_players.json");

const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://localhost:11434";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3.2";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const PORT = process.env.PORT || 3000;

const types = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".css": "text/css" };

// ---------- tiny JSON db ----------
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {}
  return { chunks: [], conversations: [] };
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
}

// ---------- player database (Future Stars) ----------
let FS_PLAYERS = [];
try {
  FS_PLAYERS = JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8")).players || [];
  console.log(`Loaded ${FS_PLAYERS.length} players for stats engine.`);
} catch { /* optional */ }

const POS_GROUPS = {
  forward: ["CF", "RW", "LW"], striker: ["CF", "RW", "LW"], attacker: ["CF", "RW", "LW"], winger: ["RW", "LW"],
  midfielder: ["AM", "CM"], midfield: ["AM", "CM"],
  defender: ["CB", "LB", "RB"], defence: ["CB", "LB", "RB"], defense: ["CB", "LB", "RB"],
  goalkeeper: ["GK"], keeper: ["GK"],
};
const num = (v) => parseFloat(v) || 0;
function fmtLine(p, i) {
  return `${i != null ? i + ". " : ""}${p.Name} (${p.Club}, ${p.League}) — ${p.Goals} goals, ${p.Assists} assists, score ${p.FutureStarScore}`;
}
function card(p) {
  const gkExtra = p.Position === "GK" && (p.CleanSheets || p.Saves)
    ? ` ${p.CleanSheets} clean sheets, ${p.Saves} saves.`
    : "";
  return `${p.Name}, ${p.Age}, ${p.Nationality}, ${p.Position} at ${p.Club} (${p.League}): ${p.MinutesPlayed} mins, ${p.Goals} goals, ${p.Assists} assists, ${p.ShotsOnTarget} shots on target, ${p.DribblesCompleted} dribbles, ${p.PassAccuracy}% pass accuracy, ${p.Tackles} tackles, ${p.Interceptions} interceptions (${p.GoalsPer90} goals/90, ${p.AssistsPer90} assists/90).${gkExtra} Future Star Score: ${p.FutureStarScore}.`;
}
function findPlayer(q) {
  const s = q.toLowerCase();
  const cands = FS_PLAYERS.filter((p) => {
    const n = p.Name.toLowerCase();
    if (s.includes(n)) return true;
    const parts = n.split(" ").filter((w) => w.length > 2);
    return parts.some((w) => s.includes(w));
  });
  // prefer full-name matches, then longest name
  cands.sort((a, b) => {
    const fa = s.includes(a.Name.toLowerCase()) ? 1 : 0, fb = s.includes(b.Name.toLowerCase()) ? 1 : 0;
    return fb - fa || b.Name.length - a.Name.length;
  });
  return cands;
}

// Exact-match stats engine. Returns { reply, photo?, photos?[] } or null.
const topPhotos = (list) => list.slice(0, 3).map((p) => p.photo).filter(Boolean);
function answerStats(siteKey, q) {
  if (siteKey !== "SITE_DEMO" || !FS_PLAYERS.length) return null;
  const s = q.toLowerCase();

  // compare X vs Y
  const vsM = s.match(/(.+?)\s+(vs\.?|versus|or)\s+(.+)/);
  if (vsM) {
    const aList = findPlayer(vsM[1]);
    const bList = findPlayer(vsM[3]);
    const a = aList.find((p) => !bList.some((q) => q.Name === p.Name)) || aList[0];
    const b = (bList.find((p) => a && p.Name !== a.Name) || bList[0]);
    if (a && b && a.Name !== b.Name) {
      return { reply: `Head to head:\n• ${card(a)}\n• ${card(b)}`, photos: [a.photo, b.photo].filter(Boolean) };
    }
  }

  // top N / highest rated / best prospects
  let m = s.match(/top\s+(\d{1,2})/);
  if (!m && /highest rated|best prospects|best players|top prospects|top rated/.test(s)) m = ["", "5"];
  if (m) {
    const n = Math.min(parseInt(m[1] || "5"), 10);
    const top = [...FS_PLAYERS].sort((a, b) => num(b.FutureStarScore) - num(a.FutureStarScore)).slice(0, n);
    return {
      reply: `Top ${n} by Future Star Score:\n` + top.map((p, i) => fmtLine(p, i + 1)).join("\n"),
      photo: n === 1 ? top[0].photo : null,
      photos: n > 1 ? topPhotos(top) : undefined,
      top,
    };
  }
  // best by position group
  for (const [word, poss] of Object.entries(POS_GROUPS)) {
    if (new RegExp(`best ${word}s?|top ${word}s?`).test(s)) {
      const top = FS_PLAYERS.filter((p) => poss.includes(p.Position))
        .sort((a, b) => num(b.FutureStarScore) - num(a.FutureStarScore)).slice(0, 5);
      if (top.length) return { reply: `Best ${word}s by Future Star Score:\n` + top.map((p, i) => fmtLine(p, i + 1)).join("\n"), photo: top[0].photo, photos: topPhotos(top), top };
    }
  }
  // top scorer / most goals / most assists
  if (/top scorer|most goals|leading scorer|best finisher/.test(s)) {
    const top = [...FS_PLAYERS].sort((a, b) => num(b.Goals) - num(a.Goals) || num(b.FutureStarScore) - num(a.FutureStarScore)).slice(0, 5);
    return { reply: `Most goals:\n` + top.map((p, i) => fmtLine(p, i + 1)).join("\n"), photo: top[0].photo, photos: topPhotos(top), top };
  }
  if (/most assists|best playmaker|top assists/.test(s)) {
    const top = [...FS_PLAYERS].sort((a, b) => num(b.Assists) - num(a.Assists) || num(b.FutureStarScore) - num(a.FutureStarScore)).slice(0, 5);
    return { reply: `Most assists:\n` + top.map((p, i) => fmtLine(p, i + 1)).join("\n"), photo: top[0].photo, photos: topPhotos(top), top };
  }
  // youngest / oldest
  if (/youngest/.test(s)) {
    const top = [...FS_PLAYERS].sort((a, b) => num(a.Age) - num(b.Age) || num(b.FutureStarScore) - num(a.FutureStarScore)).slice(0, 5);
    return { reply: `Youngest prospects:\n` + top.map((p, i) => `${i + 1}. ${p.Name} (${p.Club}) — age ${p.Age}, score ${p.FutureStarScore}`).join("\n"), photos: topPhotos(top), top };
  }
  // club filter: "who plays for X" / "X players" / "players at X"
  const clubM = s.match(/(?:plays? for|players? (?:at|of|from)|show (?:me )?)(.+)/) || s.match(/(.+?)\s+players?$/);
  if (clubM) {
    const want = clubM[1].trim();
    const hit = FS_PLAYERS.filter((p) => p.Club.toLowerCase().includes(want) && want.length > 2)
      .sort((a, b) => num(b.FutureStarScore) - num(a.FutureStarScore));
    if (hit.length) {
      const shown = hit.slice(0, 8);
      return { reply: `${hit[0].Club} prospects (${hit.length} tracked):\n` + shown.map((p, i) => fmtLine(p, i + 1)).join("\n") + (hit.length > 8 ? `\n…and ${hit.length - 8} more.` : ""), photos: topPhotos(hit), top: hit.slice(0, 5) };
    }
  }
  // single player card (+ deep link the widget turns into a button)
  const found = findPlayer(s);
  if (found.length && /(who is|tell me|about|stats|stat|profile|score of|how good|age of)/.test(s)) {
    const siteBase = process.env.SITE_BASE || "https://futurestarsweb.vercel.app/webapp/";
    const link = siteBase + "?player=" + encodeURIComponent(found[0].Name);
    return { reply: card(found[0]) + "\nFull file: " + link, photo: found[0].photo, player: found[0] };
  }
  return null;
}

// Follow-up suggestions tailored to what was just answered.
function buildSuggestions(direct, last) {
  const out = [];
  const push = (s) => { if (s && !out.includes(s) && out.length < 3) out.push(s); };
  if (direct?.player) {
    const p = direct.player;
    push(`Best ${p.Position}s?`);
    push(`${p.Club} prospects?`);
    push("Top 5 prospects?");
  } else if (direct?.top?.length) {
    push(`Tell me about ${direct.top[0].Name}`);
    if (direct.top[1]) push(`Compare ${direct.top[0].Name} vs ${direct.top[1].Name}`);
    push("How is the score calculated?");
  } else if (/score|formula|calculated|rating/i.test(last)) {
    push("Top 5 prospects?");
    push("Best midfielders?");
    push("Youngest prospects?");
  } else {
    push("Top 5 prospects?");
    push("Best teenagers?");
    push("Top scorer?");
  }
  return out;
}

// ---------- LLM backends ----------
async function ollamaEmbed(input) {
  const r = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  if (!r.ok) throw new Error(`embed failed: ${r.status}`);
  return (await r.json()).embeddings[0];
}

const GROQ_BIG = process.env.GROQ_BIG_MODEL || "openai/gpt-oss-120b";

// hard questions go to the big model, quick ones stay on the fast model
function pickModel(last) {
  if (/compar| vs\.? |versus|why|explain|analy|difference|rank|top \d+|best \d+|all |list|between/i.test(last) || last.length > 140) return GROQ_BIG;
  return GROQ_MODEL;
}

async function groqChat(messages, onToken, model) {
  const useModel = model || GROQ_MODEL;
  const body = { model: useModel, messages, stream: !!onToken };
  if (/gpt-oss/.test(useModel)) body.reasoning_effort = "low"; // else replies come back empty
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`groq ${r.status}: ${await r.text()}`);
  if (!onToken) return (await r.json()).choices[0]?.message?.content ?? "Sorry, I could not answer that.";
  // SSE -> tokens
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const t = JSON.parse(payload).choices?.[0]?.delta?.content || "";
        if (t) { out += t; onToken(t); }
      } catch {}
    }
  }
  return out;
}

async function ollamaStreamChat(messages, onToken) {
  const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: true }),
  });
  if (!r.ok) throw new Error(`chat failed: ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.message?.content) { out += ev.message.content; onToken(ev.message.content); }
        if (ev.done) return out;
      } catch {}
    }
  }
  return out;
}

async function llmChat(messages, onToken, model) {
  if (GROQ_KEY) return groqChat(messages, onToken, model);
  if (onToken) return ollamaStreamChat(messages, onToken);
  // non-stream ollama
  const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: false }),
  });
  if (!r.ok) throw new Error(`chat failed: ${r.status}`);
  return (await r.json()).message?.content ?? "Sorry, I could not answer that.";
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
function chunkText(text, size = 800) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.filter((t) => t.trim().length > 100).slice(0, 50);
}
function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}

async function buildContext(siteKey, last) {
  const db = loadDB();
  const siteChunks = db.chunks.filter((c) => c.siteKey === siteKey && c.embedding?.length);
  if (!siteChunks.length) return { context: "", db };
  let qEmb;
  try { qEmb = await ollamaEmbed(last); }
  catch {
    // No embedding model (e.g. hosted without Ollama): keyword fallback
    const words = last.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);
    const ranked = siteChunks.map((c) => {
      const t = c.content.toLowerCase();
      return { c, s: words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0) };
    }).sort((a, b) => b.s - a.s).slice(0, 4);
    return { context: ranked.map((r) => r.c.content).join("\n---\n").slice(0, 6000), db };
  }
  const ranked = siteChunks.map((c) => ({ c, s: cosine(qEmb, c.embedding) }))
    .sort((a, b) => b.s - a.s).slice(0, 4);
  return { context: ranked.map((r) => r.c.content).join("\n---\n").slice(0, 6000), db };
}

function sendNDJSON(res, obj) {
  res.write(JSON.stringify(obj) + "\n");
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && url === "/api/status") {
    let ollama = false, models = [];
    try {
      const tags = await (await fetch(`${OLLAMA_BASE}/api/tags`)).json();
      models = (tags.models || []).map((m) => m.name); ollama = true;
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true, llm: GROQ_KEY ? "groq:" + GROQ_MODEL : "ollama:" + CHAT_MODEL,
      ollama, embedModel: EMBED_MODEL, models, players: FS_PLAYERS.length,
    }));
    return;
  }

  // Save ticket with email (from widget email form)
  if (req.method === "POST" && url === "/api/ticket") {
    const { siteKey = "SITE_DEMO", email = "", messages = [] } = await readBody(req);
    const db = loadDB();
    db.conversations.push({ siteKey, email, messages, status: "ticket", at: Date.now() });
    saveDB(db);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && url === "/api/chat") {
    const { siteKey = "SITE_DEMO", messages = [], stream = false } = await readBody(req);
    let last = messages[messages.length - 1]?.content ?? "";
    const arabic = /[\u0600-\u06FF]/.test(last);
    const langNote = arabic ? " The user wrote in Arabic — reply in Arabic (keep player and club names in English)." : "";
    // Arabic: map to an English pipeline query (the small model mistranslates, so rules beat it)
    const AR_CLUBS = {
      "برشلونة": "Barcelona", "ريال مدريد": "Real Madrid", "تشيلسي": "Chelsea", "ليفربول": "Liverpool",
      "أرسنال": "Arsenal", "السيتي": "Man City", "توتنهام": "Tottenham", "يونايتد": "Man United",
      "أياكس": "Ajax", "باريس": "PSG", "بايرن": "Bayern", "دورتموند": "Dortmund", "إنتر": "Inter",
      "ميلان": "Milan", "يوفنتوس": "Juventus", "بورتو": "Porto", "سبورتينغ": "Sporting", "بنفيكا": "Benfica",
      "أتلتيكو": "Atletico", "ليفركوزن": "Leverkusen", "نابولي": "Napoli", "روما": "Roma", "إشبيلية": "Sevilla",
      "مارسيليا": "Marseille", "موناكو": "Monaco", "ليل": "Lille", "ليون": "Lyon", "أستون فيلا": "Aston Villa",
      "نيوكاسل": "Newcastle", "توتنهام": "Tottenham", "إيفرتون": "Everton",
    };
    function arabicToQuery(q) {
      if (/أعلى|الأفضل|تقييم|تصنيف/.test(q)) return "highest rated";
      if (/هداف|أهداف|سجل|الأكثر تسجيل/.test(q)) return "top scorer";
      if (/تمرير|صناعة|أسيست|صانع اللعب/.test(q)) return "most assists";
      if (/أصغر|سنا|عمرا|الأصغر/.test(q)) return "youngest";
      if (/نقاط|معادلة|حساب|مقياس|كيف يتم/.test(q)) return "how is the score calculated";
      for (const [ar, en] of Object.entries(AR_CLUBS)) if (q.includes(ar)) return en + " players";
      const hit = typeof findPlayer === "function" ? findPlayer(q) : [];
      if (hit.length) return "tell me about " + hit[0].Name;
      return "highest rated";
    }
    const AR_INTRO = "إليك الإجابة من قاعدة بيانات Future Stars:\n";
    if (arabic) last = arabicToQuery(last);
    const arabicPrefix = arabic ? AR_INTRO : "";

    // human handoff -> ticket flag (widget shows email form)
    if (/human|ticket|agent/i.test(last)) {
      const payload = { reply: "Got it — I'll create a ticket for the site owner. What's your email so they can reach you?", ticket: true };
      if (stream) {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        sendNDJSON(res, { t: payload.reply });
        sendNDJSON(res, { done: true, ticket: true });
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      }
      return;
    }

    // 1) exact stats (instant, no LLM) — via LLM when Arabic is needed
    let direct = null;
    try { direct = answerStats(siteKey, last); } catch (e) { console.error("stats:", e.message); }
    if (direct) {
      const sug = buildSuggestions(direct, last);
      const text = arabicPrefix + direct.reply;
      const db = loadDB();
      db.conversations.push({ siteKey, messages: [...messages, { role: "assistant", content: text }], status: "open", at: Date.now() });
      saveDB(db);
      const meta = { photo: direct.photo || undefined, photos: direct.photos?.length ? direct.photos : undefined, suggestions: sug };
      if (stream) {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        const parts = text.match(/[\s\S]{1,60}/g) || [text];
        for (const p of parts) sendNDJSON(res, { t: p });
        sendNDJSON(res, { done: true, ...meta });
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: text, ...meta }));
      }
      return;
    }

    // 2) RAG + LLM (also used to phrase stats answers in Arabic)
    try {
      const { context, db } = await buildContext(siteKey, last);
      const extraFacts = direct ? `\nVerified facts (use these numbers exactly):\n${direct.reply}` : "";
      const system = context
        ? `You are Star Scout, a sharp football scout for Future Stars (U22 prospects, 2026-27 season). Talk like a scout: short sentences, confident, no fluff, no filler intros. Answer ONLY from the site context below. Use markdown when it helps: a tight table for comparisons, bullets for lists. Keep it under 120 words unless asked for more. If the answer is not in the context, say so in one line and offer a ticket.${langNote}\nContext:\n${context}${extraFacts}`
        : `You are Star Scout, a sharp football scouting assistant for site ${siteKey}. No training content yet — say so briefly and offer a ticket. Keep it under 60 words.${langNote}${extraFacts}`;
      const chatMsgs = [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      ];
      const model = pickModel(last);
      const sug = buildSuggestions(direct, last);
      const meta = { photo: direct?.photo || undefined, photos: direct?.photos?.length ? direct.photos : undefined, suggestions: sug };
      if (stream) {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        let full = "";
        const out = await llmChat(chatMsgs, (t) => { full += t; sendNDJSON(res, { t }); }, model);
        sendNDJSON(res, { done: true, ...meta });
        res.end();
        db.conversations.push({ siteKey, messages: [...messages, { role: "assistant", content: full || out }], status: "open", at: Date.now() });
        saveDB(db);
      } else {
        const reply = await llmChat(chatMsgs, null, model);
        db.conversations.push({ siteKey, messages: [...messages, { role: "assistant", content: reply }], status: "open", at: Date.now() });
        saveDB(db);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply, ...meta }));
      }
    } catch (e) {
      console.error("chat error:", e.message);
      const msg = GROQ_KEY
        ? `Chat error: ${e.message}`
        : `Ollama error: ${e.message}. Is Ollama running? (ollama serve + ollama pull ${CHAT_MODEL})`;
      if (stream) {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        sendNDJSON(res, { t: msg });
        sendNDJSON(res, { done: true });
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: msg }));
      }
    }
    return;
  }

  if (req.method === "POST" && url === "/api/ingest") {
    const { siteKey = "SITE_DEMO", url: pageUrl, text, sourceUrl } = await readBody(req);
    try {
      let raw = text || "";
      if (!raw && pageUrl) raw = stripHtml(await (await fetch(pageUrl)).text());
      if (!raw || raw.trim().length < 50) throw new Error("No usable text found.");
      const pieces = chunkText(raw);
      let embedded = [];
      try {
        for (const p of pieces) embedded.push({ siteKey, content: p, embedding: await ollamaEmbed(p), sourceUrl: pageUrl || sourceUrl || "" });
      } catch {
        // No embedding model available (hosted): store without vectors, keyword search will be used
        embedded = pieces.map((p) => ({ siteKey, content: p, embedding: [], sourceUrl: pageUrl || sourceUrl || "" }));
      }
      const db = loadDB();
      db.chunks = db.chunks.filter((c) => c.siteKey !== siteKey).concat(embedded);
      saveDB(db);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, chunks: embedded.length }));
    } catch (e) {
      console.error("ingest error:", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === "GET" && url === "/api/conversations") {
    const db = loadDB();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ conversations: db.conversations.slice(-50).reverse() }));
    return;
  }

  const file = path.join(pub, url === "/" ? "demo.html" : url.slice(1));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "text/plain" });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Demo:  http://localhost:${PORT}/demo.html`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
  console.log(`LLM: ${GROQ_KEY ? "groq:" + GROQ_MODEL : OLLAMA_BASE + " chat=" + CHAT_MODEL}`);
});
