"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function Dashboard() {
  const [siteKey, setSiteKey] = useState("SITE_DEMO");
  const [color, setColor] = useState("#2563eb");
  const [trainUrl, setTrainUrl] = useState("");
  const [status, setStatus] = useState("");
  const sites = useQuery(api.sites.list) ?? [];
  const upsertSite = useMutation(api.sites.upsert);
  const embed = `<script src="${typeof window !== "undefined" ? window.location.origin : ""}/widget.js" data-key="${siteKey}" data-color="${color}"></script>`;

  async function saveSite() {
    await upsertSite({ siteKey, color, name: siteKey });
    setStatus("Site saved to Convex.");
  }

  async function train() {
    setStatus("Training...");
    const r = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteKey, url: trainUrl }),
    });
    const j = await r.json();
    setStatus(j.ok ? `Trained ${j.chunks} chunks from ${trainUrl}` : "Train failed - check Convex + OpenAI keys.");
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 24 }}>
      <h1>Support Bot — Dashboard (MVP)</h1>
      <p>Paste this on any website to embed the bot:</p>
      <label>Site key <input value={siteKey} onChange={(e) => setSiteKey(e.target.value)} /></label>
      <br /><br />
      <label>Color <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      <pre style={{ background: "#f4f4f5", padding: 12, marginTop: 16 }}>{embed}</pre>
      <button onClick={saveSite}>Save site to Convex</button>
      <p>{status}</p>

      <h2>1. Train content (Convex)</h2>
      <input placeholder="https://example.com/faq" value={trainUrl} onChange={(e) => setTrainUrl(e.target.value)} style={{ width: "100%" }} />
      <br /><br />
      <button onClick={train}>Train from URL</button>

      <h2>Sites in Convex ({sites.length})</h2>
      <ul>{sites.map((s) => <li key={s._id}>{s.siteKey} — {s.name}</li>)}</ul>

      <h2>2. Test</h2>
      <p>Open <a href="/demo.html">/demo.html</a> — widget loads bottom-right.</p>
    </main>
  );
}
