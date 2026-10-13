# Embeddable Support Chatbot (Node.js + Convex)

## Quick test (no install needed)
```
node server.mjs
```
Open http://localhost:3000/demo.html — widget bottom-right works end-to-end.
With Ollama running (`llama3.2` + `nomic-embed-text`), replies are real AI with local RAG.

## Free 24/7 hosting (no laptop needed)
The bot runs on a free Groq key in production — embeddings are precomputed in `ollama_data.json`, so no GPU/Ollama needed on the server.
1. Free key: https://console.groq.com/keys (no card).
2. Push this folder to GitHub, then Render → New → Web Service → connect repo (`render.yaml` auto-detected).
3. Paste the key as `GROQ_API_KEY`. Deploy, then use `https://YOUR-SERVICE.onrender.com/widget.js` as the embed src.

## Full Next.js + Convex mode
```
# use npm.cmd on Windows if npm.ps1 blocked:
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run dev
# in another terminal:
& "C:\Program Files\nodejs\npm.cmd" exec convex dev
```
1. Copy `.env.example` to `.env.local`, add `NEXT_PUBLIC_CONVEX_URL` + `OPENAI_API_KEY`
2. `convex dev` generates `convex/_generated/` and creates tables from `convex/schema.ts`
3. Dashboard: http://localhost:3000/ — save site, train from URL
4. Demo: http://localhost:3000/demo.html
- API: `POST /api/chat { siteKey, messages }` -> Convex action `chat.ask` (vector search + OpenAI), falls back to local Ollama RAG
- API: `POST /api/ingest { siteKey, url }` -> scrape with cheerio, embed, store
- API: `POST /api/ticket { siteKey, email, messages }` -> save support ticket

## Embed on ANY website
```html
<script src="https://YOUR-DOMAIN/widget.js" data-key="SITE_123" data-color="#2563eb" data-name="Star Scout" data-logo="/logo.svg" data-greeting="..." data-chips="Q1|Q2"></script>
```
Widget attributes: `data-key` (required), `data-color`, `data-name`, `data-icon` (emoji/text, ignored if `data-logo` set), `data-logo` (image URL), `data-greeting`, `data-chips` (pipe-separated suggestions).

## Convex tables (`convex/schema.ts`)
- `sites`: siteKey, name, color
- `chunks`: siteKey, content, embedding[1536], sourceUrl + vector index `by_embedding`
- `conversations`: siteKey, messages, status (open/ticket)

## Env vars (bot server)
| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `GROQ_API_KEY` | (none) | If set, chat uses Groq instead of Ollama |
| `GROQ_MODEL` | llama-3.1-8b-instant | Groq chat model |
| `OLLAMA_BASE` | http://localhost:11434 | Local Ollama |
| `OLLAMA_CHAT_MODEL` | llama3.2 | Local chat model |
| `OLLAMA_EMBED_MODEL` | nomic-embed-text | Local embedding model |
| `SITE_BASE` | futurestarsweb URL | Deep links in single-player answers |
