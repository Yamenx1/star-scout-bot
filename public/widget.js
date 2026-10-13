/* Star Scout embeddable chatbot - vanilla JS, no dependencies.
   Usage: <script src="https://your-domain/widget.js" data-key="SITE_123" data-color="#16a34a"
     data-name="Star Scout" data-icon="⚽" data-greeting="..." data-chips="Q1|Q2|Q3"></script>
*/
(function () {
  const script = document.currentScript;
  const SITE_KEY = script?.getAttribute("data-key") || "SITE_DEMO";
  const COLOR = script?.getAttribute("data-color") || "#2563eb";
  const NAME = script?.getAttribute("data-name") || "Support Chat";
  const LOGO = script?.getAttribute("data-logo") || "";
  const ICON = script?.getAttribute("data-icon") || "";
  const BUBBLE_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  const GREETING = script?.getAttribute("data-greeting") || "Hi! How can I help you today? (type 'human' to reach support)";
  const CHIPS = (script?.getAttribute("data-chips") || "").split("|").map((s) => s.trim()).filter(Boolean);
  const API_BASE = new URL(script?.src || location.href).origin;
  const API_URL = API_BASE + "/api/chat";
  const TICKET_URL = API_BASE + "/api/ticket";

  const history = [{ role: "assistant", content: GREETING }];

  const btn = document.createElement("button");
  btn.setAttribute("aria-label", NAME);
  if (LOGO) {
    const img = document.createElement("img");
    img.src = LOGO; img.alt = NAME;
    Object.assign(img.style, { width: "32px", height: "32px", objectFit: "contain", display: "block" });
    btn.appendChild(img);
  } else if (ICON) {
    btn.textContent = ICON;
  } else {
    btn.innerHTML = BUBBLE_SVG;
  }
  Object.assign(btn.style, {
    position: "fixed", bottom: "20px", right: "20px", width: "56px", height: "56px",
    borderRadius: "50%", border: "none", background: COLOR, color: "#fff", display: "flex",
    alignItems: "center", justifyContent: "center",
    fontSize: "24px", cursor: "pointer", zIndex: 999999, boxShadow: "0 4px 16px rgba(0,0,0,.25)"
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "fixed", bottom: "88px", right: "20px", width: "min(360px, calc(100vw - 40px))", maxHeight: "520px",
    display: "none", flexDirection: "column", background: "#fff", borderRadius: "12px",
    overflow: "hidden", zIndex: 999999, boxShadow: "0 8px 32px rgba(0,0,0,.25)",
    fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#111"
  });
  panel.innerHTML =
    '<div style="padding:12px;color:#fff;font-weight:600">' + escapeHtml(NAME) + '</div>' +
    '<div id="sbc-msgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:200px;max-height:360px"></div>' +
    '<div id="sbc-chips" style="display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 8px"></div>' +
    '<div id="sbc-email" style="display:none;padding:12px;border-top:1px solid #eee"></div>' +
    '<form id="sbc-form" style="display:flex;border-top:1px solid #eee"><input id="sbc-in" placeholder="Ask something..." autocomplete="off" style="flex:1;border:none;padding:12px;outline:none;min-width:0"/><button style="border:none;padding:0 16px;cursor:pointer">➤</button></form>';

  panel.firstChild.style.background = COLOR;
  panel.querySelector("#sbc-form button").style.background = COLOR;
  panel.querySelector("#sbc-form button").style.color = "#fff";

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // markdown-lite: escape HTML, then bold, lists, tables, links
  function appendRich(el, text) {
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (s) => {
      let h = esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      const parts = h.split(/(https?:\/\/[^\s)<]+)/g);
      return parts.map((p, i) => (i % 2 === 1
        ? '<a href="' + p + '" target="_blank" rel="noopener" style="color:inherit">Open full file</a>'
        : p)).join("");
    };
    const lines = String(text).split("\n");
    let html = "", inList = false, table = [];
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.map((r) => r.split("|").map((c) => c.trim()).filter((c) => c && !/^-+$/.test(c)));
      const head = rows[0] || [];
      html += '<table style="border-collapse:collapse;margin:6px 0;font-size:12px;width:100%"><thead><tr>' +
        head.map((c) => '<th style="border-bottom:1px solid #ccc;text-align:left;padding:3px 6px 3px 0">' + inline(c) + "</th>").join("") +
        "</tr></thead><tbody>" +
        rows.slice(1).map((r) => "<tr>" + r.map((c) => '<td style="border-bottom:1px solid #eee;padding:3px 6px 3px 0">' + inline(c) + "</td>").join("") + "</tr>").join("") +
        "</tbody></table>";
      table = [];
    };
    lines.forEach((ln) => {
      const t = ln.trim();
      if (/^\|.*\|$/.test(t)) { if (inList) { html += "</ul>"; inList = false; } table.push(t); return; }
      flushTable();
      const li = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)/);
      if (li) {
        if (!inList) { html += '<ul style="margin:4px 0;padding-left:18px">'; inList = true; }
        html += "<li>" + inline(li[1]) + "</li>";
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        if (t) html += "<div>" + inline(ln) + "</div>";
      }
    });
    flushTable();
    if (inList) html += "</ul>";
    el.innerHTML = html;
  }

  function render() {
    const box = panel.querySelector("#sbc-msgs");
    box.innerHTML = "";
    history.forEach((m) => {
      const d = document.createElement("div");
      Object.assign(d.style, {
        alignSelf: m.role === "user" ? "flex-end" : "flex-start",
        background: m.role === "user" ? COLOR : "#f4f4f5",
        color: m.role === "user" ? "#fff" : "#111",
        padding: "8px 12px", borderRadius: "12px", maxWidth: "85%", overflowWrap: "anywhere"
      });
      if (m.content) {
        const body = document.createElement("div");
        appendRich(body, m.content);
        d.appendChild(body);
      } else if (!m.photo && !(m.photos && m.photos.length)) {
        d.appendChild(document.createTextNode("…"));
      }
      const shots = [];
      if (m.photo) shots.push(m.photo);
      (m.photos || []).forEach((p) => { if (p && !shots.includes(p)) shots.push(p); });
      if (shots.length === 1 && !m.content) {
        const img = document.createElement("img");
        img.src = shots[0]; img.alt = ""; img.loading = "lazy";
        Object.assign(img.style, { width: "100%", borderRadius: "8px", display: "block" });
        d.appendChild(img);
      } else if (shots.length) {
        const row = document.createElement("div");
        Object.assign(row.style, { display: "flex", gap: "6px", marginTop: m.content ? "6px" : "0" });
        shots.slice(0, 3).forEach((src) => {
          const img = document.createElement("img");
          img.src = src; img.alt = ""; img.loading = "lazy";
          Object.assign(img.style, { width: "64px", height: "80px", objectFit: "cover", objectPosition: "top center", borderRadius: "8px", display: "block", background: "#e4e4e7" });
          row.appendChild(img);
        });
        d.appendChild(row);
      }
      // per-answer follow-ups (latest assistant message only)
      const isLastAssistant = m.role === "assistant" && history[history.length - 1] === m;
      if (isLastAssistant && m.suggestions && m.suggestions.length) {
        const sug = document.createElement("div");
        Object.assign(sug.style, { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" });
        m.suggestions.forEach((q) => {
          const b = document.createElement("button");
          b.type = "button"; b.textContent = q;
          Object.assign(b.style, {
            border: "1px solid " + COLOR, color: COLOR, background: "#fff",
            borderRadius: "999px", padding: "3px 9px", fontSize: "11px", cursor: "pointer"
          });
          b.onclick = () => send(q);
          sug.appendChild(b);
        });
        d.appendChild(sug);
      }
      box.appendChild(d);
      m._el = d;
    });
    box.scrollTop = box.scrollHeight;
  }

  function renderChips() {
    const wrap = panel.querySelector("#sbc-chips");
    wrap.innerHTML = "";
    if (history.length > 3) { wrap.style.display = "none"; return; }
    wrap.style.display = "flex";
    CHIPS.forEach((q) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = q;
      Object.assign(b.style, {
        border: "1px solid " + COLOR, color: COLOR, background: "#fff",
        borderRadius: "999px", padding: "4px 10px", fontSize: "12px", cursor: "pointer"
      });
      b.onclick = () => send(q);
      wrap.appendChild(b);
    });
  }

  function showEmailForm() {
    const form = panel.querySelector("#sbc-form");
    const box = panel.querySelector("#sbc-email");
    form.style.display = "none";
    box.style.display = "block";
    box.innerHTML = "";
    const label = document.createElement("div");
    label.textContent = "Leave your email and the site owner will reply:";
    label.style.marginBottom = "6px";
    const row = document.createElement("div");
    row.style.display = "flex"; row.style.gap = "6px";
    const inp = document.createElement("input");
    inp.type = "email"; inp.placeholder = "you@example.com"; inp.required = true;
    Object.assign(inp.style, { flex: "1", padding: "8px", border: "1px solid #ddd", borderRadius: "8px", minWidth: "0" });
    const go = document.createElement("button");
    go.textContent = "Send";
    Object.assign(go.style, { background: COLOR, color: "#fff", border: "none", borderRadius: "8px", padding: "0 14px", cursor: "pointer" });
    go.onclick = async () => {
      const email = inp.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { inp.focus(); return; }
      go.disabled = true;
      try {
        await fetch(TICKET_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteKey: SITE_KEY, email, messages: history.map(({ role, content }) => ({ role, content })) })
        });
        history.push({ role: "assistant", content: "Thanks! Ticket saved for " + email + ". Anything else?" });
      } catch {
        history.push({ role: "assistant", content: "Couldn't save that email. Please try again." });
      }
      box.style.display = "none"; form.style.display = "flex";
      render();
    };
    row.appendChild(inp); row.appendChild(go);
    box.appendChild(label); box.appendChild(row);
    inp.focus();
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text) return;
    const input = panel.querySelector("#sbc-in");
    history.push({ role: "user", content: text });
    input.value = "";
    const pending = { role: "assistant", content: "" };
    history.push(pending);
    render(); renderChips();

    const finalize = (reply, extra) => {
      pending.content = reply || "Sorry, no reply.";
      if (extra?.photo) pending.photo = extra.photo;
      if (extra?.photos?.length) pending.photos = extra.photos;
      if (extra?.suggestions?.length) pending.suggestions = extra.suggestions;
      render();
      if (extra?.ticket) showEmailForm();
    };

    // Try streaming first, fall back to plain JSON
    try {
      const res = await fetch(API_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteKey: SITE_KEY, messages: history.slice(0, -1), stream: true })
      });
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("ndjson")) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", meta = null;
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
            if (ev.t) { pending.content += ev.t; if (pending._el) { pending._el.textContent = pending.content; panel.querySelector("#sbc-msgs").scrollTop = 1e9; } }
            if (ev.done) meta = ev;
          } catch { /* partial line */ }
        }
      }
      render();
      if (meta?.ticket) showEmailForm();
      if (meta?.photo) pending.photo = meta.photo;
      if (meta?.photos?.length) pending.photos = meta.photos;
      if (meta?.suggestions?.length) pending.suggestions = meta.suggestions;
      if (meta?.photo || meta?.photos || meta?.suggestions) render();
      if (!pending.content) throw new Error("empty stream");
    } catch {
      try {
        const res = await fetch(API_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteKey: SITE_KEY, messages: history.slice(0, -1).map(({ role, content }) => ({ role, content })) })
        });
        const data = await res.json();
        finalize(data.reply, data);
      } catch {
        finalize("Connection error. Please try again.");
      }
    }
    renderChips();
  }

  panel.querySelector("#sbc-form").addEventListener("submit", (e) => {
    e.preventDefault();
    send(panel.querySelector("#sbc-in").value);
  });

  btn.onclick = () => {
    const open = panel.style.display === "flex";
    panel.style.display = open ? "none" : "flex";
    if (!open) { render(); renderChips(); }
  };

  document.body.appendChild(panel);
  document.body.appendChild(btn);
})();
