const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const inrShort = (n) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : inr(n);
const pct = (x, d = 1) => x == null ? "—" : (x * 100).toFixed(d) + "%";
const ist = (iso) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ICON = {
  bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-7M16 5h3v3"/></svg>',
  receipt: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.3 2.5 3.5 5.2"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c.7-4 4-6 8-6s7.3 2 8 6"/></svg>',
};

async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({ error: "Bad response" }));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const cache = {};
const get = (path) => (cache[path] ||= api(path).catch((e) => { delete cache[path]; throw e; }));

// ---------- session (demo sign-in, no password; the server enforces what each role may read)
let SESSION = null;
let SCOPE = "AM-03"; // area-manager portal: which region the screens focus on (all data stays visible)
const initials = (n) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const RAIL = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  store: '<svg viewBox="0 0 24 24"><path d="M4 9l1.5-5h13L20 9M4 9h16v11H4zM4 9c0 1.7 1.3 3 3 3s3-1.3 3-3m0 0c0 1.7 1.3 3 2 3s2-1.3 2-3m0 0c0 1.7 1.3 3 3 3s3-1.3 3-3"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M5 20V11M10 20V6M15 20v-8M20 20V4"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/></svg>',
};
function paintChrome() {
  const pills = document.getElementById("pills"), who = document.getElementById("who"), rail = document.getElementById("rail");
  let links = [];
  if (SESSION?.role === "am") links = [["/am", "Morning brief", "home"], ["/am/missions", "Actions", "target"], ["/am/cards", "Staff focus", "card"], ["/am/stores", "Stores", "store"], ["/am/insights", "Data & follow-up", "chart"]];
  else if (SESSION?.role === "sp") links = [["/sp", "My Coach", "card"], ["/demo", "Live case", "spark"]];
  else links = [["/", "Home", "home"], ["/demo", "Live case", "spark"], ["/login/am", "Area Manager portal", "target"], ["/login/sp", "Salesperson portal", "card"]];
  pills.innerHTML = links.map(([h, l]) => `<a href="${h}" data-link>${l}</a>`).join("");
  rail.innerHTML = links.map(([h, l, i]) => `<a href="${h}" data-link title="${l}">${RAIL[i]}</a>`).join("");
  if (!SESSION) { who.innerHTML = ""; return; }
  const portal = SESSION.role === "am" ? "Area Manager portal" : `Salesperson portal · ${esc(SESSION.store_id)}`;
  who.innerHTML = `<span class="avatar">${esc(initials(SESSION.name))}</span><div class="small"><b>${esc(SESSION.name)}</b><div class="muted">${portal} · demo</div></div>
    ${SESSION.role === "am" ? `<select id="am-select" class="ctl" aria-label="Region in focus" style="padding:6px 8px"></select>` : ""}
    <button class="btn ghost" id="signout" style="padding:7px 14px">Sign out</button>`;
  document.getElementById("signout").onclick = async () => { await api("/api/logout", { method: "POST" }); SESSION = null; MISSIONS = null; for (const k in cache) delete cache[k]; nav("/"); };
  if (SESSION.role === "am") {
    get("/api/directory").then((d) => {
      const sel = document.getElementById("am-select");
      if (!sel) return;
      sel.innerHTML = `<option value="network">Focus: HQ · all 20 stores</option>` + d.area_managers.map((a) => `<option value="${a.id}">Focus: ${esc(a.city)}${a.id === SESSION.id ? " (mine)" : ""}</option>`).join("");
      sel.value = SCOPE;
      sel.onchange = () => { SCOPE = sel.value; render(); };
    });
  }
}
async function signIn(role, id) {
  const r = await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, id }) });
  SESSION = r.session; MISSIONS = null; for (const k in cache) delete cache[k];
  if (role === "am") SCOPE = id;
  nav(role === "am" ? "/am" : "/sp");
}
const amOf = (s, id) => s.area_managers.find((a) => a.area_manager_id === id);
const storesIn = (s, scope) => scope === "network" ? s.stores.map((x) => x.store_id) : amOf(s, scope).stores.split(",").map((x) => x.trim());

// ---------- missions (D1)
let MISSIONS = null;
async function missions(force) {
  if (SESSION?.role !== "am") return (MISSIONS ||= {});
  if (!MISSIONS || force) MISSIONS = Object.fromEntries((await api("/api/missions")).missions.map((m) => [m.issue_id, m]));
  return MISSIONS;
}
async function loadOne(id) {
  const r = await api(`/api/missions/one?id=${encodeURIComponent(id)}`).catch(() => ({ mission: null }));
  MISSIONS = { ...(MISSIONS || {}) };
  if (r.mission) MISSIONS[id] = r.mission;
}
function ackButton(id) {
  const m = MISSIONS?.[id];
  if (m) return `<p class="ok">✓ Mission acknowledged · ${esc(ist(m.acknowledged_at))}</p>`;
  return `<button class="btn" data-ack-btn="${esc(id)}">Acknowledge mission</button>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-ack-btn]");
  if (!b) return;
  const id = b.dataset.ackBtn;
  b.disabled = true; b.textContent = "Saving…";
  try {
    const r = await api("/api/missions/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issue_id: id }) });
    MISSIONS = { ...(MISSIONS || {}), [id]: r.mission };
    b.outerHTML = ackButton(id);
  } catch (err) {
    b.disabled = false; b.textContent = "Retry"; b.insertAdjacentHTML("afterend", `<p class="error">${esc(err.message)}</p>`);
  }
});

// ---------- Sarvam voice: "Listen to my mission"
function voiceBar(issueId) {
  return `<div class="voice" data-voice-wrap="${esc(issueId)}" style="margin-top:14px">
    <div class="row-flex" style="align-items:center;justify-content:flex-start;gap:8px">
      <select class="ctl" data-voice-lang aria-label="Language"><option value="hi-IN">हिन्दी Hindi</option><option value="en-IN">English</option><option value="kn-IN">ಕನ್ನಡ Kannada</option></select>
      <button class="btn gold" data-voice="${esc(issueId)}" style="background:var(--gold);color:#211b1c">▶ Listen to my mission</button>
    </div>
    <div data-voice-out class="small" style="margin-top:10px"></div>
    <div class="muted small">Voice by Sarvam AI (Bulbul). Numbers come from the checked card; the voice only reads them.</div></div>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-voice]");
  if (!b) return;
  const wrap = b.closest("[data-voice-wrap]"), out = wrap.querySelector("[data-voice-out]"), lang = wrap.querySelector("[data-voice-lang]").value;
  b.disabled = true; const label = b.textContent; b.textContent = "Preparing audio…"; out.innerHTML = "";
  try {
    const r = await api("/api/voice/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issue_id: b.dataset.voice, lang }) });
    const mime = r.codec === "mp3" ? "audio/mpeg" : "audio/wav";
    out.innerHTML = `<audio controls autoplay src="data:${mime};base64,${r.audio_b64}" style="width:100%;max-width:360px"></audio>
      <p style="margin:6px 0 0"><b>${esc(r.caption)}</b></p>${r.note ? `<p class="tag warn">${esc(r.note)}</p>` : ""}${r.cached ? `<span class="tag">cached · no credits used</span>` : `<span class="tag teal">fresh from Sarvam</span>`}`;
  } catch (err) {
    out.innerHTML = `<p class="error">${esc(err.message)} You can still read the card above.</p>`;
  } finally { b.disabled = false; b.textContent = label; }
});

// ---------- grounded AI explanation
const explainButton = (id) => `<div data-explain-wrap="${esc(id)}" style="margin-top:10px"><button class="btn ghost" data-explain="${esc(id)}" style="padding:8px 14px">Explain this recommendation</button><div data-explain-out></div></div>`;
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-explain]");
  if (!b) return;
  const out = b.parentElement.querySelector("[data-explain-out]");
  b.disabled = true; b.textContent = "Asking Sarvam AI to explain the evidence…";
  try {
    const r = await api("/api/ai/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issue_id: b.dataset.explain }) });
    const cite = (ids) => (ids || []).map((x) => `<span class="tag" title="${esc((r.facts.find((f) => f.id === x) || {}).text || "")}">${esc(x)}</span>`).join("");
    out.innerHTML = `<div class="card" style="margin-top:10px;box-shadow:none">
      <p><b>What the data shows.</b> ${esc(r.observation)}</p>
      <p><b>Check first.</b> ${esc(r.likely_check)}</p>
      <p><b>Suggested coaching.</b> ${esc(r.coaching_text)}</p>
      <p class="muted small"><b>Limits.</b> ${esc(r.limitations)}</p>
      <p class="small">Evidence used: ${cite(r.evidence_ids)}</p>
      <p class="small">${r.source === "ai" ? `<span class="tag teal">AI · ${esc(r.model)} · every number and name checked against the evidence${r.cached ? " · cached" : ""}</span>` : `<span class="tag warn">Template fallback · AI output not used: ${esc((r.failed_checks || []).join("; "))}</span>`}</p>
      <details><summary class="small">Facts given to the model</summary><ul class="small">${r.facts.map((f) => `<li><b>${esc(f.id)}</b> ${esc(f.text)}</li>`).join("")}</ul></details></div>`;
    b.remove();
  } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)} The evidence above is still complete.</p>`; b.disabled = false; b.textContent = "Explain this recommendation"; }
});

// ---------- action lifecycle (server enforces who may do what; buttons are only hints)
let ACTIONS = {};
async function loadActions(ids) {
  ids = ids.filter(Boolean);
  if (!ids.length || !SESSION) return;
  const r = await api(`/api/actions?ids=${encodeURIComponent(ids.join(","))}`).catch(() => ({ actions: {} }));
  Object.assign(ACTIONS, r.actions);
}
const STATUS_LABEL = { new: "New", accepted: "Accepted", blocked: "Blocked", attempted: "Tried / done", reviewed: "Reviewed by manager", dismissed: "Dismissed" };
const BLOCKERS = [["stock_or_size_unavailable", "Stock or size not available"], ["peer_unavailable", "Peer not available"], ["wrong_attribution", "Bills wrongly attributed to me"], ["too_few_relevant_customers", "Too few relevant customers"], ["action_unsuitable", "Action not suitable"], ["other", "Other"]];
function actionPanel(id) {
  const a = ACTIONS[id] || { status: "new", version: 0, events: [] };
  const am = SESSION?.role === "am", sp = SESSION?.role === "sp";
  const btn = (to, label, cls = "btn") => `<button class="${cls}" data-act="${esc(id)}" data-to="${to}" style="padding:9px 16px">${label}</button>`;
  const opts = [];
  if (["new", "blocked"].includes(a.status)) opts.push(btn("accepted", sp ? "I'll do this today" : "Accept"));
  if (a.status === "accepted" && sp) opts.push(btn("attempted", "I tried it"));
  if (a.status === "accepted" && am) opts.push(btn("attempted", "Mark tried (store action)", "btn ghost"));
  if (["new", "accepted"].includes(a.status) && sp) opts.push(`<select class="ctl" data-blocker="${esc(id)}" aria-label="Blocker reason"><option value="">Something is stopping me…</option>${BLOCKERS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>`);
  if (a.status === "attempted" && am) opts.push(btn("reviewed", "Mark reviewed"));
  if (["new", "accepted", "blocked"].includes(a.status) && am) opts.push(btn("dismissed", "Dismiss…", "btn ghost"));
  const hist = a.events.length ? `<details><summary>History (${a.events.length})</summary><ul class="small">${a.events.map((e) => `<li>${esc(ist(e.created_at))}: ${esc(STATUS_LABEL[e.from_status] || e.from_status)} → <b>${esc(STATUS_LABEL[e.to_status] || e.to_status)}</b> by ${esc(e.actor.split(":").slice(2).join(":") || e.actor)}${e.reason ? ` · ${esc(e.reason.replace(/_/g, " "))}` : ""}</li>`).join("")}</ul></details>` : "";
  return `<div data-action-wrap="${esc(id)}"><span class="tag ${a.status === "blocked" ? "warn" : a.status === "new" ? "maroon" : "teal"}">Action: ${esc(STATUS_LABEL[a.status] || a.status)}</span>
    <div class="row-flex" style="justify-content:flex-start;gap:8px;margin-top:8px">${opts.join("") || '<span class="muted small">No further step for your role.</span>'}</div>${hist}<div data-act-msg class="small" role="status"></div></div>`;
}
async function transition(id, to, reason) {
  const wrap = document.querySelector(`[data-action-wrap="${CSS.escape(id)}"]`);
  const msg = wrap?.querySelector("[data-act-msg]");
  try {
    await api("/api/actions/transition", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issue_id: id, to, reason, version: (ACTIONS[id] || { version: 0 }).version }) });
  } catch (e) { if (msg) msg.innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  await loadActions([id]);
  if (wrap) wrap.outerHTML = actionPanel(id);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  let reason;
  if (b.dataset.to === "dismissed") { reason = prompt("Why dismiss this issue? (short reason)"); if (!reason) return; }
  b.disabled = true;
  transition(b.dataset.act, b.dataset.to, reason);
});
document.addEventListener("change", (e) => {
  const s = e.target.closest("[data-blocker]");
  if (s && s.value) transition(s.dataset.blocker, "blocked", s.value);
});

// ---------- small components
function delta(cur, prev, kind) {
  if (cur == null || prev == null || !prev) return `<span class="delta flat">—</span>`;
  const isPP = kind === "pp";
  const d = isPP ? (cur - prev) * 100 : (cur / prev - 1) * 100;
  const cls = Math.abs(d) < (isPP ? 0.1 : 0.5) ? "flat" : d > 0 ? "up" : "down";
  const arrow = cls === "up" ? "↗" : cls === "down" ? "↘" : "→";
  return `<span class="delta ${cls}">${arrow} ${d > 0 ? "+" : ""}${d.toFixed(1)}${isPP ? " pp" : "%"}</span>`;
}
function kpi(icon, label, value, deltaHtml, note) {
  return `<div class="card kpi"><div class="ic">${ICON[icon]}</div><div><div class="lab">${label}</div><div class="val">${value}</div>${deltaHtml} <span class="muted small">${note || ""}</span></div></div>`;
}
function lineChart(id, pts, fmt) {
  // pts: [{label, value}]
  const W = 720, H = 240, L = 64, R = 16, T = 24, B = 34;
  const vals = pts.map((p) => p.value), max = Math.max(...vals) * 1.1, min = Math.min(0, ...vals);
  const x = (i) => L + (i * (W - L - R)) / Math.max(pts.length - 1, 1);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  let d = "";
  pts.forEach((p, i) => {
    if (!i) { d = `M${x(0)},${y(p.value)}`; return; }
    const cx = (x(i - 1) + x(i)) / 2;
    d += ` C${cx},${y(pts[i - 1].value)} ${cx},${y(p.value)} ${x(i)},${y(p.value)}`;
  });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));
  const every = Math.ceil(pts.length / 8);
  return `<div style="position:relative" id="${id}">
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Trend chart">
      <defs><linearGradient id="${id}g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#b8863b" stop-opacity=".28"/><stop offset="1" stop-color="#b8863b" stop-opacity="0"/></linearGradient></defs>
      <g class="grid">${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`).join("")}</g>
      <path d="${d} L${x(pts.length - 1)},${H - B} L${x(0)},${H - B}Z" fill="url(#${id}g)"/>
      <path d="${d}" fill="none" stroke="#b8863b" stroke-width="2.5"/>
      ${pts.map((p, i) => (i % every === 0 || i === pts.length - 1) ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(p.label)}</text>` : "").join("")}
      <circle class="hov" r="6" fill="#b8863b" stroke="#fff" stroke-width="2" style="display:none"/>
    </svg><div class="tip" style="display:none"></div></div>`;
}
function wireChart(id, pts, fmt) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  const svg = wrap.querySelector("svg"), dot = svg.querySelector(".hov"), tip = wrap.querySelector(".tip");
  const W = 720, H = 240, L = 64, R = 16, T = 24, B = 34;
  const vals = pts.map((p) => p.value), max = Math.max(...vals) * 1.1, min = Math.min(0, ...vals);
  const show = (i) => {
    const cx = L + (i * (W - L - R)) / Math.max(pts.length - 1, 1), cy = T + (1 - (pts[i].value - min) / (max - min || 1)) * (H - T - B);
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.style.display = "";
    const rect = svg.getBoundingClientRect();
    tip.style.left = (cx / W) * rect.width + "px"; tip.style.top = (cy / H) * rect.height + "px";
    tip.textContent = `${pts[i].label} · ${fmt(pts[i].value)}`; tip.style.display = "";
  };
  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect(), px = ((e.clientX - rect.left) / rect.width) * W;
    show(Math.max(0, Math.min(pts.length - 1, Math.round(((px - L) / (W - L - R)) * (pts.length - 1)))));
  });
  svg.addEventListener("mouseleave", () => show(pts.length - 1));
  show(pts.length - 1);
}
const archSVG = `<svg class="arch" viewBox="0 0 170 130" fill="none" stroke="#b8863b" stroke-width="1.2"><path d="M85 4v8M85 12c-10 10-22 14-22 30v6h44v-6c0-16-12-20-22-30zM30 128V78c0-14 10-20 16-26 6 6 16 12 16 26v50M108 128V78c0-14 10-20 16-26 6 6 16 12 16 26v50M60 128V64c0-12 12-18 25-22 13 4 25 10 25 22v64M72 128v-34c0-8 6-13 13-15 7 2 13 7 13 15v34M10 128h150"/></svg>`;
const motifSVG = `<svg viewBox="0 0 300 180" preserveAspectRatio="xMidYMid slice"><defs><pattern id="p" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M22 4c6 8 6 14 0 18-6-4-6-10 0-18zM22 40c-6-8-6-14 0-18 6 4 6 10 0 18zM4 22c8-6 14-6 18 0-4 6-10 6-18 0zM40 22c-8 6-14 6-18 0 4-6 10-6 18 0z" fill="none" stroke="#e8c98f" stroke-width=".9" opacity=".55"/><circle cx="22" cy="22" r="2" fill="#e8c98f" opacity=".7"/></pattern></defs><rect width="300" height="180" fill="#7a1e2c"/><rect width="300" height="180" fill="url(#p)"/><path d="M0 0h60c-30 60-30 120 0 180H0z" fill="#f3e2cc" opacity=".9"/><path d="M60 0c-30 60-30 120 0 180" stroke="#b8863b" stroke-width="2" fill="none"/><circle cx="34" cy="90" r="11" fill="#c99a4b" stroke="#8a6326" stroke-width="2"/><circle cx="34" cy="90" r="5" fill="none" stroke="#8a6326"/></svg>`;

function followUp(f) {
  if (!f) return "";
  const cls = /Pending|Not measurable/.test(f.status) ? "warn" : "teal";
  let s = `<span class="tag ${cls}">7-day follow-up: ${esc(f.status)}</span>`;
  if (f.before !== undefined && f.after !== undefined) {
    const fmt = (v) => (v <= 1 && v >= 0 && !Number.isInteger(v) ? pct(v) : v);
    s += `<span class="muted small"> ${esc(fmt(f.before))} → ${esc(fmt(f.after))} (${esc(f.window?.join(" to "))}${f.den ? `, n=${f.den}` : ""})</span>`;
  }
  if (f.reason) s += `<div class="muted small">${esc(f.reason)}</div>`;
  if (f.note) s += `<div class="muted small">${esc(f.note)}</div>`;
  return `<div style="margin-top:10px">${s}</div>`;
}
function topIssues(brief, scope, n) {
  const all = Object.entries(brief.digest).filter(([k]) => scope === "network" || k === scope).flatMap(([, v]) => v.issues);
  return all.sort((a, b) => b.rupees - a.rupees).slice(0, n);
}

// ---------- views
const views = {
  "/am": async () => {
    const [s, m, sc] = await Promise.all([get("/api/stores"), get("/api/meta"), get(`/api/stores?scope=${SCOPE}`)]);
    const brief = await get(`/api/brief?date=${m.latest}`);
    const am = amOf(s, SCOPE);
    const c = sc.last28, p = sc.prev28;
    const top = topIssues(brief, SCOPE, 4);
    const ids = storesIn(s, SCOPE);
    const featured = SCOPE === "network" || ids.includes("PAT-02")
      ? { code: "PAT-02", line: "Aman B. adds a jacket to 3 of 60 kurta-set bills; his store peers 18.2%.", opp: 35223, note: "92-day showcase · hypothetical", href: "/demo" }
      : top[0] ? { code: top[0].store_id, line: top[0].title, opp: top[0].rupees, note: "per 28 days · estimate", href: "/am/missions" } : null;
    app.innerHTML = `
      <section class="hero">${archSVG}
        <div class="hello">Good morning${am ? ", " + esc(am.name.split(" ")[0]) : ""}</div>
        <h1>Morning brief</h1>
        <p class="sub">${am ? `${esc(am.city)} · ${ids.length} stores` : "All 20 stores · 6 cities"} · last 28 days to ${esc(s.as_of)}, compared with the 28 days before. Historical replay: the data pack ends 31 Oct 2026, so this is the brief for that date.</p>
      </section>
      <div class="grid4">
        ${kpi("bag", "Total sales", inrShort(c.sales), delta(c.sales, p.sales), "vs prior 28 days")}
        ${kpi("target", "Conversion rate", pct(c.conversion), delta(c.conversion, p.conversion, "pp"), `${c.bills.toLocaleString("en-IN")} bills / ${c.footfall.toLocaleString("en-IN")} walk-ins`)}
        ${kpi("receipt", "Avg. bill value", inr(c.atv), delta(c.atv, p.atv), `${c.ipb.toFixed(2)} items per bill`)}
        ${kpi("people", "Repeat rate", pct(c.repeat), `<span class="delta flat">${c.repeat_num.toLocaleString("en-IN")} of ${c.repeat_den.toLocaleString("en-IN")}</span>`, "eligible customers billed again 30+ days after their first bill")}
      </div>
      ${featured ? `<section class="card featured">
        <div><div class="eyebrow">Featured opportunity</div><div class="code">${esc(featured.code)}</div><div class="muted">${esc(featured.line)}</div></div>
        <div class="divider"></div>
        <div><div class="muted">Estimated opportunity</div><div class="opp">${inr(featured.opp)}</div><div class="muted small">${esc(featured.note)}</div></div>
        <a class="btn" href="${featured.href}" data-link>View mission →</a>
        <div class="art">${motifSVG}</div></section>` : ""}
      <div class="grid2" style="margin-top:22px">
        <section class="card"><div class="row-flex"><h2>Sales performance</h2><div class="seg" id="seg"><button data-k="week">Week</button><button data-k="month" class="on">Month</button></div></div>
          <div id="chartbox"></div><p class="muted small">Sales incl. GST from every bill line (packaging excluded). Oct 2025 peaked on Diwali (20 Oct); Diwali 2026 falls on 8 Nov, after the data ends.</p></section>
        <section class="card"><div class="row-flex"><h2>Top rescue missions</h2><a href="/am/missions" data-link class="small">View all →</a></div>
          <div class="scroll"><table><tr><th>Store / owner</th><th>Reason</th><th class="num">Opportunity</th></tr>
          ${top.map((i) => `<tr class="click" data-go="/am/missions?am=${esc(s.stores.find((x) => x.store_id === i.store_id).area_manager_id)}"><td><div class="person"><span class="dot">${ICON.user}</span><div><b>${esc(i.salesperson_id ? i.owner : i.store_id)}</b><div class="muted small">${esc(i.store_id)} · ${esc(i.lever)}</div></div></div></td><td class="small">${esc(i.title)}</td><td class="num opp-cell">${inr(i.rupees)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Nothing needs attention this week.</td></tr>`}
          </table></div><p class="muted small">Ranked by estimated rupees at stake per 28 days. Brief for ${esc(m.latest)}.</p></section>
      </div>`;
    const draw = (k) => {
      const pts = k === "month"
        ? sc.monthly.map((r) => ({ label: `${MONTHS[+r.month.slice(5) - 1]} ${r.month.slice(2, 4)}`, value: r.sales }))
        : sc.weekly.map((r) => ({ label: r.week.slice(5), value: r.sales }));
      document.getElementById("chartbox").innerHTML = lineChart("ch", pts, inrShort);
      wireChart("ch", pts, inrShort);
      document.querySelectorAll("#seg button").forEach((b) => b.classList.toggle("on", b.dataset.k === k));
    };
    document.querySelectorAll("#seg button").forEach((b) => (b.onclick = () => draw(b.dataset.k)));
    draw("month");
  },

  "/am/stores": async () => {
    const s = await get("/api/stores");
    const qs = new URLSearchParams(location.search);
    const ids = storesIn(s, SCOPE), net = s.network;
    const rows = s.stores.filter((x) => ids.includes(x.store_id));
    const sel = qs.get("id") && rows.find((r) => r.store_id === qs.get("id")) ? qs.get("id") : null;
    const flagged = new Set(s.data_quality.map((d) => d.store_id));
    app.innerHTML = `
      <div class="eyebrow">Stores · last 28 days to ${esc(s.as_of)}</div><h1>Stores</h1>
      <p class="sub">Every number is computed from bills, bill lines and door-camera footfall. Coloured arrows compare with each store's previous 28 days. Click a store for its 24-month trend and repeat role models.</p>
      <section class="card scroll" style="margin-top:18px"><table>
        <tr><th>Store</th><th>City · tier</th><th class="num">Sales</th><th class="num">vs prior</th><th class="num">Conversion</th><th class="num">Avg bill</th><th class="num">Items / bill</th><th class="num">Discount</th><th class="num">Repeat</th></tr>
        ${rows.map((r) => { const c = r.last28, p = r.prev28; return `<tr class="click" data-go="/am/stores?id=${r.store_id}">
          <td><b>${esc(r.store_id)}</b>${r.store_id === sel ? " ◂" : ""}${flagged.has(r.store_id) ? ` <span class="tag warn" title="Door-camera fault days excluded">data flag</span>` : ""}${r.opened_on > "2026-08-01" ? ` <span class="tag">new ${esc(r.opened_on)}</span>` : ""}</td>
          <td class="small">${esc(r.city)} · ${esc(r.tier)}</td><td class="num">${inrShort(c.sales)}</td><td class="num">${delta(c.sales, p.sales)}</td>
          <td class="num">${pct(c.conversion)} ${delta(c.conversion, p.conversion, "pp")}</td><td class="num">${c.atv ? inr(c.atv) : "—"}</td><td class="num">${c.ipb?.toFixed(2) ?? "—"}</td>
          <td class="num">${pct(c.discount)}</td><td class="num">${pct(c.repeat)}</td></tr>`; }).join("")}
        <tr><td><b>Network</b></td><td class="small">20 stores</td><td class="num">${inrShort(net.sales)}</td><td></td><td class="num">${pct(net.conversion)}</td><td class="num">${inr(net.atv)}</td><td class="num">${net.ipb.toFixed(2)}</td><td class="num">${pct(net.discount)}</td><td class="num">${pct(net.repeat)}</td></tr>
      </table></section>
      <div id="detail"></div>
      <p class="muted small" style="margin-top:12px">Repeat: ${esc(s.repeat_definition)}</p>`;
    if (sel) {
      const d = await get(`/api/stores?scope=${sel}`);
      const rm = (s.repeat_by_salesperson[sel] || []);
      const pts = d.monthly.map((r) => ({ label: `${MONTHS[+r.month.slice(5) - 1]} ${r.month.slice(2, 4)}`, value: r.conversion ?? 0 }));
      document.getElementById("detail").innerHTML = `<div class="grid2" style="margin-top:18px">
        <section class="card"><h2>${esc(sel)} · monthly conversion</h2>${lineChart("sc", pts, (v) => pct(v))}</section>
        <section class="card"><h2>Repeat role models</h2><p class="muted small">Salespeople whose first-time customers came back 30+ days later (cohort ≥ 30).</p>
          <table><tr><th>Salesperson</th><th class="num">Came back</th><th class="num">Rate</th></tr>
          ${rm.length ? rm.map((x, i) => `<tr><td>${i === 0 ? "★ " : ""}${esc(x.name)}</td><td class="num">${x.back} / ${x.cohort}</td><td class="num">${pct(x.rate)}</td></tr>`).join("") : `<tr><td colspan=3 class="muted">Not enough mature customers yet.</td></tr>`}</table></section></div>`;
      wireChart("sc", pts, (v) => pct(v));
      document.getElementById("detail").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  },

  "/am/missions": async () => {
    const m = await get("/api/meta");
    const qs = new URLSearchParams(location.search);
    const date = qs.get("date") || m.latest;
    let am = qs.get("am") || (SCOPE === "network" ? "AM-03" : SCOPE);
    const [brief] = await Promise.all([get(`/api/brief?date=${date}`), missions()]);
    const d = brief.digest[am];
    await loadActions(d.issues.map((i) => i.id));
    const opts = Object.entries(brief.digest).map(([k, v]) => `<option value="${k}" ${k === am ? "selected" : ""}>${esc(v.name)} · ${esc(v.city)}</option>`).join("");
    const dopts = m.dates.map((x) => `<option ${x === date ? "selected" : ""}>${x}</option>`).join("");
    const market = brief.flags.filter((f) => f.type === "Market signal" && d.city === f.store_id);
    app.innerHTML = `
      <div class="eyebrow">Actions · at most ${d.budget} new issues per manager in any 7 days · ongoing issues update without using the budget</div>
      <div class="row-flex"><h1>${esc(d.name)}</h1><div><select class="ctl" id="am">${opts}</select> <select class="ctl" id="date" aria-label="Replay date">${dopts}</select></div></div>
      <p class="sub">${esc(d.city)} · stores ${esc(d.stores.join(", "))} · brief for ${esc(date)} · <b>${d.new_count} new</b> this week (budget ${d.budget})${d.suppressed ? ` · ${d.suppressed} new issue(s) held back by the weekly budget` : ""}. Pick an earlier date to see the 7-day follow-up measured on real later data. Historical replays observed no real action execution.</p>
      ${market.map((f) => `<div class="card" style="margin-top:12px"><span class="tag warn">Market signal</span> ${esc(f.detail)} <div class="muted small">${esc(f.handling)}</div></div>`).join("")}
      ${d.issues.length ? "" : `<div class="card" style="margin-top:16px"><h3>No store needs attention this week</h3><p class="muted">Every lever is within its fair range against own history and same-state peers. Nothing is sent.</p></div>`}
      ${d.issues.map((i, n) => `
        <section class="card issue" style="animation-delay:${n * 50}ms">
          <div class="row-flex"><div><span class="tag maroon">${esc(i.lever)}</span><span class="tag">${esc(i.store_id)}</span>${i.alert === "new" ? `<span class="tag teal">New this week</span>` : `<span class="tag">Ongoing since ${esc(i.first_raised)}</span>`}<h3>${esc(i.title)}</h3></div>
          <div class="rupees" title="${esc(i.rupees_basis)}">${inr(i.rupees)}<div class="muted small" style="font-family:var(--sans);font-weight:400">at stake / 28 days · estimate</div></div></div>
          <p><b>Cause.</b> ${esc(i.cause)}</p>
          <p><b>Action.</b> ${esc(i.action)}</p>
          <p class="muted small"><b>Owner:</b> ${esc(i.owner)} · <b>When:</b> ${esc(i.when)}</p>
          <details><summary>Evidence, receipts & math</summary><ul>${i.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
            <p class="muted">${esc(i.rupees_basis)}</p>
            ${i.receipts ? `<p class="mono">Source bills (${i.receipt_count}): ${i.receipts.map(esc).join(", ")}${i.receipt_count > i.receipts.length ? " …" : ""}</p>` : ""}
            ${i.salesperson_id ? `<p><a href="/am/cards?date=${date}&sp=${i.salesperson_id}" data-link>Open ${esc(i.owner)}'s coach card →</a></p>` : ""}
          </details>
          ${explainButton(i.id)}
          ${followUp(i.follow_up)}
          <div style="margin-top:12px">${actionPanel(i.id)}</div>
        </section>`).join("")}`;
    const go = () => nav(`/am/missions?am=${document.getElementById("am").value}&date=${document.getElementById("date").value}`);
    document.getElementById("am").onchange = go;
    document.getElementById("date").onchange = go;
  },

  "/am/cards": async () => {
    const m = await get("/api/meta");
    const qs = new URLSearchParams(location.search);
    const date = qs.get("date") || m.latest;
    const [brief, s] = await Promise.all([get(`/api/brief?date=${date}`), get("/api/stores")]);
    const inScope = storesIn(s, SCOPE);
    const LABEL = { improvement: "Improvement card", maintain: "Practice focus", insufficient_evidence: "Not enough evidence", off_duty: "Off duty", no_roster: "No roster record" };
    const people = Object.entries(brief.states).filter(([, x]) => inScope.includes(x.store_id));
    const counts = {}; for (const [, x] of people) counts[x.state] = (counts[x.state] || 0) + 1;
    const filter = qs.get("state") || "improvement";
    const list = people.filter(([, x]) => filter === "all" || x.state === filter);
    const sel = qs.get("sp") && brief.states[qs.get("sp")] ? qs.get("sp") : (list[0] || [])[0];
    const st = sel ? brief.states[sel] : null, c = sel ? brief.cards[sel] : null;
    if (c) await loadActions([c.issue_id]);
    const dopts = m.dates.map((x) => `<option ${x === date ? "selected" : ""}>${x}</option>`).join("");
    app.innerHTML = `
      <div class="eyebrow">Staff focus · every active salesperson gets one honest state for ${esc(date)}</div>
      <div class="row-flex"><h1>Staff focus</h1><div><select class="ctl" id="date" aria-label="Brief date">${dopts}</select></div></div>
      <p class="sub">${people.length} salespeople with bills in the last 90 days in this focus. No card never means "on track": each person is in exactly one state below.</p>
      <div class="row-flex" style="justify-content:flex-start;gap:6px;margin:14px 0">${["improvement", "maintain", "insufficient_evidence", "off_duty", "no_roster", "all"].map((k) =>
        `<a class="tag ${k === filter ? "maroon" : ""}" href="/am/cards?date=${date}&state=${k}" data-link ${k === filter ? 'aria-current="true"' : ""}>${k === "all" ? "All" : LABEL[k]} · ${k === "all" ? people.length : counts[k] || 0}</a>`).join("")}</div>
      <div class="grid2">
        <section class="card scroll"><table><tr><th>Salesperson</th><th>Store</th><th class="num">Bills 90d</th><th>State</th></tr>
          ${list.map(([pid, x]) => `<tr><td><a href="/am/cards?date=${date}&state=${filter}&sp=${pid}" data-link ${pid === sel ? 'aria-current="true"' : ""}>${esc(m.people?.[pid] || pid)}${pid === sel ? " ◂" : ""}</a></td><td>${esc(x.store_id)}</td><td class="num">${x.bills_90d}</td><td class="small">${esc(LABEL[x.state])}</td></tr>`).join("") || `<tr><td colspan=4 class="muted">Nobody in this state.</td></tr>`}</table></section>
        <div>${st ? `
          <div class="phone"><div class="eyebrow">SUTRA · ${esc(st.store_id)} · ${esc(LABEL[st.state])}</div><p class="msg">${esc(st.text)}</p>${c ? `<p style="color:#bfb3a2" class="small">${c.words} words</p>` : ""}</div>
          ${c ? `<section class="card" style="margin-top:14px"><h3>Checked in code before sending</h3><ul class="checks">${Object.entries(c.checks).map(([k, v]) => `<li class="${v ? "" : "fail"}"><b>${v ? "✓" : "✗"}</b>${esc(k)}</li>`).join("")}</ul>
          ${voiceBar(c.issue_id)}<div style="margin-top:16px">${actionPanel(c.issue_id)}</div></section>` : `<p class="muted small" style="margin-top:10px">No coaching action for this state, so nothing to acknowledge.</p>`}` : ""}</div>
      </div>`;
    document.getElementById("date").onchange = (e) => nav(`/am/cards?date=${e.target.value}&state=${filter}`);
  },

  "/am/insights": async () => {
    const m = await get("/api/meta");
    const date = new URLSearchParams(location.search).get("date") || m.latest;
    const [brief, runs, s] = await Promise.all([get(`/api/brief?date=${date}`), api("/api/runs"), get("/api/stores")]);
    const cats = ["Kurta Set", "Jacket", "Mojari", "Sherwani", "Indo-Western", "Safa", "Stole", "Mala"];
    app.innerHTML = `
      <div class="eyebrow">Insights · how SUTRA decides, and what it refuses to alert</div>
      <h1>Insights & trust</h1>
      <div class="grid2" style="margin-top:18px">
        <section class="card"><h2>Runs on its own</h2><p class="muted small">${esc(runs.schedule)}. Each run reads the data as of the latest close and logs its result.</p>
          <p><button class="btn" id="runnow">Run today's brief now</button> <span id="runmsg" class="muted small"></span></p>
          <div class="scroll"><table><tr><th>Ran at</th><th>Trigger</th><th>Data as of</th><th class="num">Issues</th><th class="num">Cards</th></tr>
          ${runs.runs.map((r) => `<tr><td>${esc(ist(r.ran_at))}</td><td>${esc(r.trigger)}</td><td>${esc(r.replay_date)}</td><td class="num">${r.issues}</td><td class="num">${r.cards}</td></tr>`).join("") || `<tr><td colspan=5 class="muted">No runs logged yet.</td></tr>`}</table></div></section>
        <section class="card"><h2>Not alerted on ${esc(date)}</h2>
          ${brief.flags.map((f) => `<div style="margin:10px 0"><span class="tag warn">${esc(f.type)}</span><b>${esc(f.store_id)}</b><div class="small">${esc(f.detail)}</div><div class="muted small">${esc(f.handling)}</div></div>`).join("") || `<p class="muted">No data issues on this date.</p>`}
          <p class="muted small">All door-camera faults in the data: ${s.data_quality.length} store-days (${esc([...new Set(s.data_quality.map((d) => d.store_id))].join(", "))}).</p></section>
      </div>
      <section class="card" style="margin-top:18px"><h2>What each city buys · last 90 days</h2><p class="muted small">Share of units (packaging excluded). A salesperson is only flagged for avoiding a category their own city buys.</p>
        <div class="scroll"><table><tr><th>City</th>${cats.map((c) => `<th class="num">${c}</th>`).join("")}</tr>
        ${Object.entries(s.category_mix_90d).map(([city, mix]) => `<tr><td>${esc(city)}</td>${cats.map((c) => `<td class="num">${pct(mix[c] || 0)}</td>`).join("")}</tr>`).join("")}</table></div></section>
      <div class="grid3" style="margin-top:18px">
        <section class="card"><h3>Fair comparisons</h3><p class="small">Salespeople vs peers in their own store (min. 30 eligible bills). Stores vs their own previous 56 days and must fall 8+ points more than same-state peers, so festival swings such as Diwali moving from 20 Oct 2025 to 8 Nov 2026 are not alerts.</p></section>
        <section class="card"><h3>Guardrails</h3><p class="small">Door-camera faults are excluded from conversion. A new store gets no alerts until it has 84 days of history. Add-on gaps are not blamed when that add-on was out of stock that week. A city-wide drop is a market signal, never a store alert.</p></section>
        <section class="card"><h3>Rupees & follow-up</h3><p class="small">Every rupee figure is an estimate with its formula shown, not guaranteed recovery. Follow-ups compare the next 7 days only when they exist in the data, and never claim cause.</p></section>
      </div>`;
    document.getElementById("runnow").onclick = async (e) => {
      e.target.disabled = true;
      try { const r = await api("/api/run-now", { method: "POST" }); document.getElementById("runmsg").textContent = r.throttled ? r.note : `Done: ${r.counts.issues_found} issues, ${r.counts.cards} cards.`; await sleep(700); views["/am/insights"](); }
      catch (err) { document.getElementById("runmsg").textContent = err.message; e.target.disabled = false; }
    };
  },

  "/demo": async () => {
    app.innerHTML = `
      <div class="eyebrow">Live case · judge mode</div>
      <h1>Store PAT-02 · Patna</h1>
      <p class="sub">Bihar · S+ flagship · data as of 31 Oct 2026. One click runs the investigation on the server. Nothing on this page is typed in by hand.</p>
      <div class="steps"><span>Detect</span><span>Prove</span><span>Coach</span><span>Assign</span><span>Re-measure</span></div>
      <p style="margin-top:18px"><button class="btn" id="run">Run investigation</button></p>
      <div class="loader" id="loader"></div>
      <div id="out"></div>`;
    await loadOne("PAT-02-KURTA-JACKET-92D");
    document.getElementById("run").onclick = runCase;
  },

  "/": async () => {
    app.innerHTML = `
      <section class="hero">${archSVG}
        <div class="hello">SUTRA AI · Store Coach for Manyavar</div>
        <h1>Every morning,<br>one thing to do better.</h1>
        <p class="sub">SUTRA reads every bill, finds where a store is leaking sales, proves it with receipts, and tells each area manager which stores need attention, and each salesperson one thing to do today. No one has to ask it a question.</p>
      </section>
      <div class="grid2" style="margin-top:26px">
        <a class="card" href="/login/am" data-link style="text-decoration:none;color:inherit">
          <div class="kpi"><div class="ic">${ICON.target}</div><div><div class="eyebrow">Portal 1</div><h2>Area Manager</h2>
          <p class="muted">Full view of all 20 stores: the morning brief, ranked actions with receipts, every salesperson's focus, store trends, data-quality flags and the run log.</p>
          <span class="btn">Enter Area Manager portal →</span></div></div></a>
        <a class="card" href="/login/sp" data-link style="text-decoration:none;color:inherit">
          <div class="kpi"><div class="ic">${ICON.user}</div><div><div class="eyebrow">Portal 2</div><h2>Salesperson</h2>
          <p class="muted">Limited view: only your own coach card, your own numbers against your store average, your own recent bills and your card history. Nobody else's data.</p>
          <span class="btn">Enter Salesperson portal →</span></div></div></a>
      </div>
      <section class="card featured" style="margin-top:22px">
        <div><div class="eyebrow">No sign-in needed</div><div class="code">PAT-02</div><div class="muted">Watch one live investigation end to end: detect, prove, coach, assign, re-measure.</div></div>
        <div class="divider"></div>
        <div><div class="muted">Estimated opportunity</div><div class="opp">₹35,223</div><div class="muted small">92-day showcase · hypothetical</div></div>
        <a class="btn" href="/demo" data-link>Open live case →</a>
        <div class="art">${motifSVG}</div></section>
      <div class="grid3" style="margin-top:22px">
        <div class="card"><span class="tag teal">More bills</span><h3>Conversion</h3><p class="small">Bills ÷ door-camera walk-ins. Finds a top seller missing from the roster and walk-ins who leave without buying.</p></div>
        <div class="card"><span class="tag teal">Bigger baskets</span><h3>Items per bill</h3><p class="small">A jacket with a kurta set; a safa or mojari with a sherwani; categories a city buys; discounts above the store norm.</p></div>
        <div class="card"><span class="tag teal">More repeat</span><h3>Return customers</h3><p class="small">First-time customers who bill again 30+ days later, and the role models whose customers do.</p></div>
      </div>
      <p class="muted small" style="margin-top:16px">Demo sign-in: pick a person, no password. Data is the synthetic Manyavar VCH3 pack; no real store, salesperson or customer.</p>`;
  },

  "/login/am": async () => {
    const d = await get("/api/directory");
    app.innerHTML = `
      <div class="eyebrow">Area Manager portal · demo sign-in</div><h1>Who is signing in?</h1>
      <p class="sub">One area manager per city. Area managers see all data; their own city is the default focus. No password in this demo.</p>
      <div class="grid3" style="margin-top:20px">${d.area_managers.map((a) => `
        <button class="card" data-am="${a.id}" style="text-align:left;cursor:pointer;font:inherit;color:inherit">
          <div class="person"><span class="avatar">${esc(initials(a.name))}</span><div><b>${esc(a.name)}</b><div class="muted small">${esc(a.city)} · ${a.stores.length} stores</div></div></div>
          <p class="muted small" style="margin:10px 0 0">${esc(a.stores.join(", "))}</p></button>`).join("")}</div>
      <p class="small" style="margin-top:16px"><a href="/login/sp" data-link>Are you a salesperson? Use the Salesperson portal →</a></p>`;
    app.querySelectorAll("[data-am]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { await signIn("am", b.dataset.am); } catch (e) { b.disabled = false; b.insertAdjacentHTML("beforeend", `<p class="error">${esc(e.message)}</p>`); } }));
  },

  "/login/sp": async () => {
    const d = await get("/api/directory");
    const qs = new URLSearchParams(location.search);
    const st = qs.get("store") || "PAT-02";
    const list = d.salespeople[st] || [];
    app.innerHTML = `
      <div class="eyebrow">Salesperson portal · demo sign-in</div><h1>Find yourself</h1>
      <p class="sub">Pick your store, then your name. You will only see your own card and numbers. No password in this demo.</p>
      <p style="margin-top:14px"><select class="ctl" id="store">${d.stores.map((s) => `<option value="${s.store_id}" ${s.store_id === st ? "selected" : ""}>${esc(s.store_id)} · ${esc(s.city)} · ${esc(s.tier)}</option>`).join("")}</select></p>
      <div class="grid3" style="margin-top:14px">${list.map((x) => `
        <button class="card" data-sp="${x.id}" style="text-align:left;cursor:pointer;font:inherit;color:inherit">
          <div class="person"><span class="avatar">${esc(initials(x.name))}</span><div><b>${esc(x.name)}</b><div class="muted small">${esc(x.id)}</div></div></div>
          ${x.has_card ? `<span class="tag maroon" style="margin-top:10px">Card waiting today</span>` : `<span class="tag" style="margin-top:10px">On track</span>`}</button>`).join("") || `<p class="muted">No active salespeople in the last 90 days.</p>`}</div>`;
    document.getElementById("store").onchange = (e) => nav(`/login/sp?store=${e.target.value}`);
    app.querySelectorAll("[data-sp]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { await signIn("sp", b.dataset.sp); } catch (e) { b.disabled = false; b.insertAdjacentHTML("beforeend", `<p class="error">${esc(e.message)}</p>`); } }));
  },

  "/sp": async () => {
    const v = await api("/api/sp/me");
    await loadActions(v.cards.filter((c) => c.card).map((c) => c.card.issue_id));
    const me = v.me, m = me.metrics, st = v.store;
    MISSIONS = { ...(MISSIONS || {}), ...v.missions };
    const today = [...v.cards].reverse().find((c) => c.card);
    const latest = v.cards[v.cards.length - 1];
    const cmp = (label, mine, store, fmt, higherBetter = true, note = "") => {
      const better = mine == null || store == null ? null : higherBetter ? mine >= store : mine <= store;
      return `<tr><td>${label}${note ? `<div class="muted small">${note}</div>` : ""}</td><td class="num"><b>${fmt(mine)}</b></td><td class="num muted">${fmt(store)}</td>
        <td class="num">${better == null ? "" : better ? '<span class="delta up">at or above store</span>' : '<span class="delta down">below store</span>'}</td></tr>`;
    };
    const rate = (o) => (o && o.den ? o.num / o.den : null);
    const frac = (o) => (o && o.den ? `${o.num}/${o.den} · ${pct(o.num / o.den)}` : "—");
    app.innerHTML = `
      <div class="hello">Good morning, ${esc(me.name.split(" ")[0])}</div>
      <h1>My Coach</h1>
      <p class="sub">${esc(me.store_id)} · ${esc(st.city)} · your last 90 days (${esc(v.window.join(" to "))}). This page shows only your own data.</p>
      <div class="grid2" style="margin-top:20px">
        <div>
          <div class="eyebrow">${latest.card ? `Today's one thing · brief for ${esc(latest.replay_date)}` : "Today"}</div>
          ${latest.card ? `<div class="phone"><div class="eyebrow">SUTRA · ${esc(me.store_id)} · ${esc(latest.card.lever)}</div><p class="msg">${esc(latest.card.text)}</p><p class="small" style="color:#bfb3a2">${latest.card.words} words</p></div>
            ${voiceBar(latest.card.issue_id)}${explainButton(latest.card.issue_id)}<div style="margin-top:14px">${actionPanel(latest.card.issue_id)}</div>`
          : `<div class="phone"><div class="eyebrow">SUTRA · ${esc(me.store_id)} · ${esc(({ maintain: "Practice focus", insufficient_evidence: "Not enough evidence yet", off_duty: "Off duty", no_roster: "No roster record", not_generated: "Not generated" })[latest.state?.state] || "Today")}</div><p class="msg">${esc(latest.state?.text || "No brief was generated for you on this date.")}</p></div>`}
        </div>
        <section class="card"><h3>You vs your store</h3><p class="muted small">Store column = average of everyone in ${esc(me.store_id)} over the same 90 days. Other people's names and numbers are not shown here.</p>
          <div class="scroll"><table><tr><th></th><th class="num">You</th><th class="num">Store</th><th></th></tr>
          ${cmp("Bills", m.bills, st.bills_per_person, (x) => x == null ? "—" : Math.round(x).toLocaleString("en-IN"), true, "store = per person")}
          ${cmp("Sales", m.sales, st.sales_per_person, (x) => x == null ? "—" : inrShort(x), true, "store = per person")}
          ${cmp("Avg bill value", m.atv, st.atv, (x) => x == null ? "—" : inr(x))}
          ${cmp("Items per bill", m.ipb, st.ipb, (x) => x == null ? "—" : x.toFixed(2))}
          ${cmp("Discount", m.discount, st.discount, (x) => pct(x), false)}
          ${cmp("Jacket with kurta set", rate(m.jacket_attach), rate(st.jacket_attach), (x) => pct(x), true, `you ${frac(m.jacket_attach)}`)}
          ${cmp("Safa/mojari/mala with sherwani", rate(m.sherwani_addon), rate(st.sherwani_addon), (x) => pct(x), true, `you ${frac(m.sherwani_addon)}`)}
          ${cmp("Customers who came back", rate(m.repeat), rate(st.repeat), (x) => pct(x), true, `you ${frac(m.repeat)} first-time customers`)}
          </table></div>
          <p class="muted small">Roster, last 28 days: ${me.roster_28d.present} days present, ${me.roster_28d.off} off.</p></section>
      </div>
      <div class="grid2" style="margin-top:20px">
        <section class="card"><h3>My card history</h3><p class="muted small">One brief per replay date. Follow-ups are measured only where the next 7 days exist in the data.</p>
          <table><tr><th>Brief</th><th>Card</th><th>Status</th></tr>
          ${v.cards.map((c) => `<tr><td class="small">${esc(c.replay_date)}</td><td class="small">${c.card ? esc(c.card.text) : '<span class="muted">No card: within range</span>'}</td>
            <td class="small">${c.card ? (v.missions[c.card.issue_id] ? '<span class="ok">✓ acknowledged</span>' : '<span class="muted">open</span>') + ((v.follow[c.card.issue_id] || c.card.follow_up) ? `<div>${esc((v.follow[c.card.issue_id] || c.card.follow_up).status)}${(v.follow[c.card.issue_id] || c.card.follow_up).after !== undefined ? ` · ${pct((v.follow[c.card.issue_id] || c.card.follow_up).before)} → ${pct((v.follow[c.card.issue_id] || c.card.follow_up).after)}` : ""}</div>` : "") : ""}</td></tr>`).join("")}</table></section>
        <section class="card"><h3>My recent bills</h3><div class="scroll"><table><tr><th>Bill</th><th>Date</th><th>Items</th><th class="num">Value</th></tr>
          ${me.recent_bills.map((b) => `<tr><td class="mono">${esc(b.bill_id)}</td><td class="small">${esc(b.date)}</td><td class="small">${esc(b.categories.join(", "))}</td><td class="num">${inr(b.value)}</td></tr>`).join("")}</table></div></section>
      </div>`;
  },
};

async function runCase() {
  const btn = document.getElementById("run"), loader = document.getElementById("loader"), out = document.getElementById("out");
  btn.disabled = true; out.innerHTML = "";
  const p = api("/api/case?id=PAT-02-KURTA-JACKET-92D&replay_date=2026-10-31");
  loader.textContent = "Loading the case from the server…";
  let r;
  try { r = await p; } catch (err) { loader.textContent = ""; out.innerHTML = `<p class="error">${esc(err.message)} <button class="btn ghost" id="retry">Retry</button></p>`; btn.disabled = false; document.getElementById("retry").onclick = runCase; return; }
  loader.textContent = ""; btn.textContent = "Run again"; btn.disabled = false;
  const s = r.seed, f = s.focus, rm = s.role_model, pe = s.peers_excluding_focus;
  const max = Math.max(...s.all_salespeople.map((x) => x.rate));
  out.innerHTML = `
    <section class="card">
      <div class="eyebrow">Prove · evidence room</div>
      <h2>Attach a jacket to kurta-set bills</h2>
      <p><span class="tag teal">Lever · ${esc(s.lever)}</span><span class="tag">1 Aug – 31 Oct 2026 (92 days)</span><span class="tag warn">Historical 92-day showcase, not the 28-day daily detector</span></p>
      <p class="muted small"><b>Rule.</b> ${esc(s.rule)}</p>
      <div class="bars" style="margin:18px 0">${s.all_salespeople.map((x) => {
        const cls = x.salesperson_id === f.salesperson_id ? "focus" : x.salesperson_id === rm.salesperson_id ? "model" : x.eligible_bills < 30 ? "low" : "";
        return `<div class="row ${cls}"><span>${esc(x.name)}${cls === "focus" ? " · focus" : cls === "model" ? " · role model" : ""}</span><div class="track"><div class="fill" style="width:${(x.rate / max) * 100}%"></div></div><span>${x.with_addon}/${x.eligible_bills} · ${pct(x.rate)}${x.eligible_bills < 30 ? " · low sample" : ""}</span></div>`;
      }).join("")}<p class="muted small">Fewer than 30 eligible bills = low sample, never blamed.</p></div>
      <div class="grid3">
        <div class="card"><div class="stat">${pct(f.rate)}<small>${esc(f.name)} · ${f.with_addon} of ${f.eligible_bills} bills</small></div></div>
        <div class="card"><div class="stat" style="color:var(--teal)">${pct(rm.rate)}<small>${esc(rm.name)} · ${rm.with_addon} of ${rm.eligible_bills} bills</small></div></div>
        <div class="card"><div class="stat" style="color:var(--charcoal)">${pct(pe.rate)}<small>Other same-store peers · ${pe.with_addon} of ${pe.eligible_bills}</small></div></div>
      </div>
      <div class="grid2" style="margin-top:16px">
        <div class="card"><div class="eyebrow">Proven fact</div><p>From bills: ${esc(f.name)} ${f.with_addon}/${f.eligible_bills}; ${esc(rm.name)} ${rm.with_addon}/${rm.eligible_bills}; other peers ${pe.with_addon}/${pe.eligible_bills}.</p></div>
        <div class="card"><div class="eyebrow">Tested hypothesis</div><p>${esc(f.name.split(" ")[0])} is not offering a jacket during kurta-set trials. Observational, not a proven cause.</p></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="eyebrow">Stock check</div><p>${s.stock_at_cutoff.units_on_hand} jacket units across ${s.stock_at_cutoff.skus_on_hand} SKUs on hand at 31 Oct close.</p>
        <p>${Object.entries(s.stock_at_cutoff.by_size).map(([k, v]) => `<span class="tag">${esc(k)} ${v}</span>`).join("")}</p><p class="muted small">${esc(s.stock_at_cutoff.caveat)}</p></div>
      <details><summary>Receipts · ${f.eligible_bills} source bills for ${esc(f.name)}</summary>
        <p><b>With jacket (${f.bills_with_addon.length}):</b> <span class="mono">${f.bills_with_addon.join(", ")}</span></p>
        <p><b>Without jacket (${f.bills_without_addon.length}):</b> <span class="mono">${f.bills_without_addon.join(", ")}</span></p></details>
      <details><summary>Show the math</summary>
        <p>(${pct(pe.rate)} − ${pct(f.rate)}) × ${f.eligible_bills} bills = <b>${s.scenario.extra_bills_with_addon}</b> extra jacket bills × average jacket price ${inr(s.scenario.avg_addon_selling_price)} ≈ <b>${inr(s.scenario.hypothetical_sales_inr)}</b>.</p>
        <p class="tag warn">Hypothetical historical scenario. Not guaranteed recovery, not proof of cause.</p></details>
    </section>
    <div class="grid2" style="margin-top:20px">
      <div><div class="eyebrow">Coach · daily employee card</div><h2>For ${esc(f.name)}, today</h2>
        <div class="phone"><div class="eyebrow">SUTRA · ${esc(s.store.store_id)}</div><p class="msg">${esc(r.card.text)}</p><p style="color:#bfb3a2" class="small">${r.card.words} words</p></div>${voiceBar(s.case_id)}</div>
      <section class="card"><h3>Validated in code</h3><ul class="checks">${r.card.checks.map((c) => `<li class="${c.ok ? "" : "fail"}"><b>${c.ok ? "✓" : "✗"}</b><span>${esc(c.label)} <span class="muted">· ${esc(c.detail)}</span></span></li>`).join("")}</ul>${explainButton(s.case_id)}</section>
    </div>
    <div class="grid2" style="margin-top:20px">
      <section class="card"><div class="eyebrow">Assign</div><h3>Mission</h3><p>Owner ${esc(f.name)} · what: a jacket with every kurta-set trial · when: today.</p>${ackButton(s.case_id)}</section>
      <section class="card"><div class="eyebrow">Re-measure</div><h3>7-day follow-up</h3><p class="tag warn">${esc(s.follow_up.status)}</p><p class="muted small">${esc(s.follow_up.reason)}</p>
        <p class="small">Where the next 7 days do exist, see the <a href="/am/missions?date=2026-10-24&am=AM-03" data-link>24 Oct replay</a> in the Area Manager portal: each issue shows its observed before/after.</p></section>
    </div>`;
}

// ---------- router
function nav(to) { history.pushState({}, "", to); render(); }
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); nav(a.getAttribute("href")); return; }
  const row = e.target.closest("[data-go]");
  if (row) nav(row.dataset.go);
});
window.addEventListener("popstate", render);
async function render() {
  let path = location.pathname.replace(/\/$/, "") || "/";
  // portal guards (the server enforces the same rules on every API call)
  if (path.startsWith("/am") && SESSION?.role !== "am") { history.replaceState({}, "", "/login/am"); path = "/login/am"; }
  if (path === "/sp" && SESSION?.role !== "sp") { history.replaceState({}, "", "/login/sp"); path = "/login/sp"; }
  if (path === "/" && SESSION) { const to = SESSION.role === "am" ? "/am" : "/sp"; history.replaceState({}, "", to); path = to; }
  paintChrome();
  document.querySelectorAll(".pills a, .rail a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === path));
  const v = views[path] || views["/"];
  const TITLES = { "/": "Welcome", "/demo": "Live case PAT-02", "/login/am": "Area manager sign-in", "/login/sp": "Salesperson sign-in", "/sp": "Today's focus",
    "/am": "Morning brief", "/am/missions": "Actions", "/am/cards": "Staff focus", "/am/stores": "Stores", "/am/insights": "Data & follow-up" };
  document.title = `${TITLES[path] || "SUTRA"} · SUTRA Store Coach`;
  const token = (render.token = (render.token || 0) + 1);
  app.innerHTML = `<p class="muted" role="status">Loading…</p>`;
  try { await v(); } catch (err) {
    if (token !== render.token) return;
    app.innerHTML = `<div class="error" role="alert">Could not load this page: ${esc(err.message)}. <button class="btn ghost" id="retry-route">Try again</button></div>`;
    document.getElementById("retry-route").onclick = render;
  }
  if (token === render.token) app.querySelector("h1")?.setAttribute("tabindex", "-1");
  if (!location.search.includes("id=")) window.scrollTo(0, 0);
}
api("/api/session").then((r) => { SESSION = r.session; if (SESSION?.role === "am") SCOPE = SESSION.id; }).catch(() => {}).finally(render);
