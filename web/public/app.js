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

// ---------- who is viewing (no login; a view-as switch)
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
let SCOPE = store.get("scope") || "AM-03";
async function initWho() {
  const s = await get("/api/stores");
  const sel = document.getElementById("am-select");
  sel.innerHTML = `<option value="network">HQ · all 20 stores</option>` +
    s.area_managers.map((a) => `<option value="${a.area_manager_id}">${esc(a.name)} · ${esc(a.city)}</option>`).join("");
  if (![...sel.options].some((o) => o.value === SCOPE)) SCOPE = "AM-03";
  sel.value = SCOPE;
  const setAvatar = () => {
    const a = s.area_managers.find((x) => x.area_manager_id === SCOPE);
    document.getElementById("avatar").textContent = a ? a.name.split(" ").map((w) => w[0]).join("").slice(0, 2) : "HQ";
  };
  setAvatar();
  sel.onchange = () => { SCOPE = sel.value; store.set("scope", SCOPE); setAvatar(); render(); };
}
const amOf = (s, id) => s.area_managers.find((a) => a.area_manager_id === id);
const storesIn = (s, scope) => scope === "network" ? s.stores.map((x) => x.store_id) : amOf(s, scope).stores.split(",").map((x) => x.trim());

// ---------- missions (D1)
let MISSIONS = null;
async function missions(force) {
  if (!MISSIONS || force) MISSIONS = Object.fromEntries((await api("/api/missions")).missions.map((m) => [m.issue_id, m]));
  return MISSIONS;
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
    s += `<span class="muted small"> ${esc(fmt(f.before))} → ${esc(fmt(f.after))} (${esc(f.window?.join(" to "))})</span>`;
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
  "/": async () => {
    const [s, m, sc] = await Promise.all([get("/api/stores"), get("/api/meta"), get(`/api/stores?scope=${SCOPE}`)]);
    const brief = await get(`/api/brief?date=${m.latest}`);
    const am = amOf(s, SCOPE);
    const c = sc.last28, p = sc.prev28;
    const top = topIssues(brief, SCOPE, 4);
    const ids = storesIn(s, SCOPE);
    const featured = SCOPE === "network" || ids.includes("PAT-02")
      ? { code: "PAT-02", line: "Aman B. adds a jacket to 3 of 60 kurta-set bills; his store peers 18.2%.", opp: 35223, note: "92-day showcase · hypothetical", href: "/demo" }
      : top[0] ? { code: top[0].store_id, line: top[0].title, opp: top[0].rupees, note: "per 28 days · estimate", href: "/missions" } : null;
    app.innerHTML = `
      <section class="hero">${archSVG}
        <div class="hello">Good morning${am ? ", " + esc(am.name.split(" ")[0]) : ""}</div>
        <h1>Command Centre</h1>
        <p class="sub">${am ? `${esc(am.city)} · ${ids.length} stores` : "All 20 stores · 6 cities"} · last 28 days to ${esc(s.as_of)}, compared with the 28 days before. Your brief was prepared at 06:00 without anyone asking.</p>
      </section>
      <div class="grid4">
        ${kpi("bag", "Total sales", inrShort(c.sales), delta(c.sales, p.sales), "vs prior 28 days")}
        ${kpi("target", "Conversion rate", pct(c.conversion), delta(c.conversion, p.conversion, "pp"), `${c.bills.toLocaleString("en-IN")} bills / ${c.footfall.toLocaleString("en-IN")} walk-ins`)}
        ${kpi("receipt", "Avg. bill value", inr(c.atv), delta(c.atv, p.atv), `${c.ipb.toFixed(2)} items per bill`)}
        ${kpi("people", "Repeat rate", pct(c.repeat), `<span class="delta flat">${c.repeat_n.toLocaleString("en-IN")} customers</span>`, "came back 30+ days later")}
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
        <section class="card"><div class="row-flex"><h2>Top rescue missions</h2><a href="/missions" data-link class="small">View all →</a></div>
          <div class="scroll"><table><tr><th>Store / owner</th><th>Reason</th><th class="num">Opportunity</th></tr>
          ${top.map((i) => `<tr class="click" data-go="/missions?am=${esc(s.stores.find((x) => x.store_id === i.store_id).area_manager_id)}"><td><div class="person"><span class="dot">${ICON.user}</span><div><b>${esc(i.salesperson_id ? i.owner : i.store_id)}</b><div class="muted small">${esc(i.store_id)} · ${esc(i.lever)}</div></div></div></td><td class="small">${esc(i.title)}</td><td class="num opp-cell">${inr(i.rupees)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Nothing needs attention this week.</td></tr>`}
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

  "/stores": async () => {
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
        ${rows.map((r) => { const c = r.last28, p = r.prev28; return `<tr class="click" data-go="/stores?id=${r.store_id}">
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

  "/missions": async () => {
    const m = await get("/api/meta");
    const qs = new URLSearchParams(location.search);
    const date = qs.get("date") || m.latest;
    let am = qs.get("am") || (SCOPE === "network" ? "AM-03" : SCOPE);
    const [brief] = await Promise.all([get(`/api/brief?date=${date}`), missions()]);
    const d = brief.digest[am];
    const opts = Object.entries(brief.digest).map(([k, v]) => `<option value="${k}" ${k === am ? "selected" : ""}>${esc(v.name)} · ${esc(v.city)}</option>`).join("");
    const dopts = m.dates.map((x) => `<option ${x === date ? "selected" : ""}>${x}</option>`).join("");
    const market = brief.flags.filter((f) => f.type === "Market signal" && d.city === f.store_id);
    app.innerHTML = `
      <div class="eyebrow">Rescue missions · weekly digest · at most 5, ranked by rupees</div>
      <div class="row-flex"><h1>${esc(d.name)}</h1><div><select class="ctl" id="am">${opts}</select> <select class="ctl" id="date" aria-label="Replay date">${dopts}</select></div></div>
      <p class="sub">${esc(d.city)} · stores ${esc(d.stores.join(", "))} · brief for ${esc(date)}${d.suppressed ? ` · ${d.suppressed} lower-value issue(s) held back to respect the 5-alert limit` : ""}. Pick an earlier date to see the 7-day follow-up measured on real later data.</p>
      ${market.map((f) => `<div class="card" style="margin-top:12px"><span class="tag warn">Market signal</span> ${esc(f.detail)} <div class="muted small">${esc(f.handling)}</div></div>`).join("")}
      ${d.issues.length ? "" : `<div class="card" style="margin-top:16px"><h3>No store needs attention this week</h3><p class="muted">Every lever is within its fair range against own history and same-state peers. Nothing is sent.</p></div>`}
      ${d.issues.map((i, n) => `
        <section class="card issue" style="animation-delay:${n * 50}ms">
          <div class="row-flex"><div><span class="tag maroon">${esc(i.lever)}</span><span class="tag">${esc(i.store_id)}</span><h3>${esc(i.title)}</h3></div>
          <div class="rupees" title="${esc(i.rupees_basis)}">${inr(i.rupees)}<div class="muted small" style="font-family:var(--sans);font-weight:400">at stake / 28 days · estimate</div></div></div>
          <p><b>Cause.</b> ${esc(i.cause)}</p>
          <p><b>Action.</b> ${esc(i.action)}</p>
          <p class="muted small"><b>Owner:</b> ${esc(i.owner)} · <b>When:</b> ${esc(i.when)}</p>
          <details><summary>Evidence, receipts & math</summary><ul>${i.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
            <p class="muted">${esc(i.rupees_basis)}</p>
            ${i.receipts ? `<p class="mono">Source bills (${i.receipt_count}): ${i.receipts.map(esc).join(", ")}${i.receipt_count > i.receipts.length ? " …" : ""}</p>` : ""}
            ${i.salesperson_id ? `<p><a href="/me?date=${date}&sp=${i.salesperson_id}" data-link>Open ${esc(i.owner)}'s coach card →</a></p>` : ""}
          </details>
          ${followUp(i.follow_up)}
          <div style="margin-top:12px">${ackButton(i.id)}</div>
        </section>`).join("")}`;
    const go = () => nav(`/missions?am=${document.getElementById("am").value}&date=${document.getElementById("date").value}`);
    document.getElementById("am").onchange = go;
    document.getElementById("date").onchange = go;
  },

  "/me": async () => {
    const m = await get("/api/meta");
    const qs = new URLSearchParams(location.search);
    const date = qs.get("date") || m.latest;
    const [brief, s] = await Promise.all([get(`/api/brief?date=${date}`), get("/api/stores"), missions()]);
    const inScope = storesIn(s, SCOPE);
    let ids = Object.keys(brief.cards).filter((p) => inScope.includes(brief.cards[p].store_id));
    if (!ids.length) ids = Object.keys(brief.cards);
    const sel = qs.get("sp") && brief.cards[qs.get("sp")] ? qs.get("sp") : ids[0];
    const c = brief.cards[sel];
    const dopts = m.dates.map((x) => `<option ${x === date ? "selected" : ""}>${x}</option>`).join("");
    const sopts = ids.map((p) => `<option value="${p}" ${p === sel ? "selected" : ""}>${esc(brief.cards[p].name)} · ${esc(brief.cards[p].store_id)}</option>`).join("");
    app.innerHTML = `
      <div class="eyebrow">Coach cards · one behaviour, one same-store peer, one action today</div>
      <div class="row-flex"><h1>Today's one thing</h1><div><select class="ctl" id="sp">${sopts}</select> <select class="ctl" id="date">${dopts}</select></div></div>
      <p class="sub">${Object.keys(brief.cards).length} salespeople rostered on ${esc(date)} get a card. Everyone else on the floor is within range, so they get no nagging.</p>
      ${c ? `<div class="grid2" style="margin-top:20px">
        <div class="phone"><div class="eyebrow">SUTRA · ${esc(c.store_id)} · ${esc(c.lever)}</div><p class="msg">${esc(c.text)}</p><p style="color:#bfb3a2" class="small">${c.words} words</p></div>
        <section class="card"><h3>Checks passed before sending</h3><ul class="checks">${Object.entries(c.checks).map(([k, v]) => `<li class="${v ? "" : "fail"}"><b>${v ? "✓" : "✗"}</b>${esc(k)}</li>`).join("")}</ul>
        <p style="margin-top:16px">${ackButton(c.issue_id)}</p></section></div>` : `<div class="card">No cards on this date.</div>`}`;
    const go = () => nav(`/me?date=${document.getElementById("date").value}&sp=${document.getElementById("sp").value}`);
    document.getElementById("sp").onchange = go;
    document.getElementById("date").onchange = () => nav(`/me?date=${document.getElementById("date").value}`);
  },

  "/insights": async () => {
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
      try { const r = await api("/api/run-now", { method: "POST" }); document.getElementById("runmsg").textContent = r.throttled ? r.note : `Done: ${r.counts.issues_found} issues, ${r.counts.cards} cards.`; await sleep(700); views["/insights"](); }
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
    await missions();
    document.getElementById("run").onclick = runCase;
  },
};

async function runCase() {
  const btn = document.getElementById("run"), loader = document.getElementById("loader"), out = document.getElementById("out");
  btn.disabled = true; out.innerHTML = "";
  const p = api("/api/case?id=PAT-02-KURTA-JACKET-92D&replay_date=2026-10-31");
  for (const s of ["Scanning 329 kurta-set bills…", "Comparing same-store peers…", "Checking jacket stock at 31 Oct close…", "Writing and checking the card…"]) { loader.textContent = s; await sleep(420); }
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
        <div class="phone"><div class="eyebrow">SUTRA · ${esc(s.store.store_id)}</div><p class="msg">${esc(r.card.text)}</p><p style="color:#bfb3a2" class="small">${r.card.words} words</p></div></div>
      <section class="card"><h3>Validated in code</h3><ul class="checks">${r.card.checks.map((c) => `<li class="${c.ok ? "" : "fail"}"><b>${c.ok ? "✓" : "✗"}</b><span>${esc(c.label)} <span class="muted">· ${esc(c.detail)}</span></span></li>`).join("")}</ul></section>
    </div>
    <div class="grid2" style="margin-top:20px">
      <section class="card"><div class="eyebrow">Assign</div><h3>Mission</h3><p>Owner ${esc(f.name)} · what: a jacket with every kurta-set trial · when: today.</p>${ackButton(s.case_id)}</section>
      <section class="card"><div class="eyebrow">Re-measure</div><h3>7-day follow-up</h3><p class="tag warn">${esc(s.follow_up.status)}</p><p class="muted small">${esc(s.follow_up.reason)}</p>
        <p class="small">Where the next 7 days do exist, see the <a href="/missions?date=2026-10-24&am=AM-03" data-link>24 Oct replay</a>: each issue shows its observed before/after.</p></section>
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
  const path = location.pathname.replace(/\/$/, "") || "/";
  document.querySelectorAll(".pills a, .rail a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === path));
  const v = views[path] || views["/"];
  try { await v(); } catch (err) { app.innerHTML = `<p class="error">Could not load: ${esc(err.message)}</p>`; }
  if (!location.search.includes("id=")) window.scrollTo(0, 0);
}
initWho().catch(() => {}).finally(render);
