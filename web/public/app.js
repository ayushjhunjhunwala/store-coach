const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const pct = (x) => (x * 100).toFixed(1) + "%";
const ist = (iso) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) + " IST";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({ error: "Bad response" }));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
let META;
const meta = async () => (META ||= await api("/api/meta"));
let MISSIONS = null;
async function missions(force) {
  if (!MISSIONS || force) MISSIONS = Object.fromEntries((await api("/api/missions")).missions.map((m) => [m.issue_id, m]));
  return MISSIONS;
}

function ackButton(id) {
  const m = MISSIONS?.[id];
  if (m) return `<p class="ok" data-ack="${esc(id)}">✓ Mission acknowledged · ${esc(ist(m.acknowledged_at))}</p>`;
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
    b.disabled = false; b.textContent = "Retry acknowledge"; b.insertAdjacentHTML("afterend", `<p class="error">${esc(err.message)}</p>`);
  }
});

function followUp(f) {
  if (!f) return "";
  const cls = /Pending|Not measurable/.test(f.status) ? "warn" : "teal";
  let s = `<span class="pill ${cls}">7-day follow-up: ${esc(f.status)}</span>`;
  if (f.before !== undefined && f.after !== undefined) {
    const fmt = (v) => (v <= 1 && v >= 0 && !Number.isInteger(v) ? pct(v) : v);
    s += `<span class="muted"> ${esc(fmt(f.before))} → ${esc(fmt(f.after))} (${esc(f.window?.join(" to "))})</span>`;
  }
  if (f.reason) s += `<div class="muted" style="font-size:13px">${esc(f.reason)}</div>`;
  if (f.note) s += `<div class="muted" style="font-size:12px">${esc(f.note)}</div>`;
  return `<div style="margin-top:10px">${s}</div>`;
}

// ---------- views
const views = {
  "/": async () => {
    app.innerHTML = `
      <section class="card dark" style="padding:40px">
        <div class="eyebrow">Store Coach for Manyavar</div>
        <h1 style="color:var(--ivory)">Every morning,<br>one thing to do better.</h1>
        <p class="lede" style="color:#e9dfcf">SUTRA AI reads every bill, finds where a store is leaking sales, proves it with receipts, and gives each salesperson one action for today. No one has to ask it a question.</p>
        <p style="margin-top:22px"><a class="btn gold" href="/demo" data-link>See a live investigation →</a> <a class="btn ghost" style="color:var(--gold);border-color:var(--gold)" href="/manager" data-link>Area manager digest</a></p>
      </section>
      <hr class="rule">
      <div class="grid">
        <div class="card"><div class="lever">More bills</div><h3>Conversion</h3><p>Bills ÷ door-camera walk-ins. Finds staffing gaps, a top seller missing from the roster, and walk-ins who leave without buying.</p></div>
        <div class="card"><div class="lever">Bigger baskets</div><h3>Items per bill</h3><p>The obvious pair: a jacket with a kurta set, a safa or mojari with a sherwani. Also discounts well above the store norm.</p></div>
        <div class="card"><div class="lever">More repeat</div><h3>Return customers</h3><p>First-time customers who bill again 30+ days later. Names the role models whose customers come back.</p></div>
      </div>
      <hr class="rule">
      <div class="steps"><span>Detect</span><span>Prove</span><span>Coach</span><span>Assign</span><span>Re-measure</span></div>
      <hr class="rule">
      <div class="two">
        <div class="card"><h3>Fair comparisons only</h3><p>Salespeople are compared with peers in their own store; stores with peers in their own state over the same weeks, so festival and season swings are not alerts.</p></div>
        <div class="card"><h3>Numbers it can't trust, it doesn't send</h3><p>A broken door camera, a brand-new store, or add-on stock at zero are flagged to the data team instead of blamed on a person.</p></div>
      </div>`;
  },

  "/demo": async () => {
    app.innerHTML = `
      <div class="eyebrow">Live case · Judge mode</div>
      <h1>Store PAT-02 · Patna</h1>
      <p class="lede">Bihar · S+ flagship · data as of 31 Oct 2026. One click runs the investigation on the server; nothing on this page is typed in by hand.</p>
      <p><button class="btn" id="run">Run investigation</button></p>
      <div class="loader" id="loader"></div>
      <div id="out"></div>`;
    await missions();
    document.getElementById("run").onclick = runCase;
  },

  "/manager": async () => {
    const m = await meta();
    const qs = new URLSearchParams(location.search);
    const date = qs.get("date") || m.latest, am = qs.get("am") || "AM-03";
    const [brief] = await Promise.all([api(`/api/brief?date=${date}`), missions()]);
    const d = brief.digest[am];
    const opts = Object.entries(brief.digest).map(([k, v]) => `<option value="${k}" ${k === am ? "selected" : ""}>${esc(v.name)} · ${esc(v.city)}</option>`).join("");
    const dopts = m.dates.map((x) => `<option ${x === date ? "selected" : ""}>${x}</option>`).join("");
    const name = (id) => m.salespeople[id]?.name || id;
    app.innerHTML = `
      <div class="eyebrow">Morning digest · max ${d.issues.length ? 5 : 5} issues a week, ranked by rupees</div>
      <div class="row-flex"><h1>${esc(d.name)}</h1>
        <div><select id="am">${opts}</select> <select id="date" aria-label="Replay date">${dopts}</select></div></div>
      <p class="lede">${esc(d.city)} · stores ${esc(d.stores.join(", "))} · replay date ${esc(date)}${d.suppressed ? ` · ${d.suppressed} lower-value issue(s) held back` : ""}</p>
      ${d.issues.length ? "" : `<div class="card"><h3>No store needs attention this week</h3><p class="muted">Every lever is within its fair range against own history and same-state peers. Nothing is sent.</p></div>`}
      ${d.issues.map((i, n) => `
        <div class="card issue" style="margin-top:14px;animation-delay:${n * 60}ms">
          <div class="row-flex"><div><div class="lever">${esc(i.lever)} · ${esc(i.store_id)}</div><h3>${esc(i.title)}</h3></div>
          <div class="rupees" title="${esc(i.rupees_basis)}">${inr(i.rupees)}<div class="muted" style="font:12px var(--sans)">at stake / 28 days (estimate)</div></div></div>
          <p><b>Cause.</b> ${esc(i.cause)}</p>
          <p><b>Action.</b> ${esc(i.action)}</p>
          <p class="muted" style="font-size:13px"><b>Owner:</b> ${esc(i.owner)} · <b>When:</b> ${esc(i.when)}</p>
          <details><summary>Evidence & math</summary><ul>${i.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
            <p class="muted">${esc(i.rupees_basis)}</p>
            ${i.receipts ? `<p class="mono">Receipts (${i.receipt_count}): ${i.receipts.map(esc).join(", ")}${i.receipt_count > i.receipts.length ? " …" : ""}</p>` : ""}
            ${i.salesperson_id ? `<p><a href="/me?date=${date}&sp=${i.salesperson_id}" data-link>Open ${esc(name(i.salesperson_id))}'s card →</a></p>` : ""}
          </details>
          ${followUp(i.follow_up)}
          <div style="margin-top:12px">${ackButton(i.id)}</div>
        </div>`).join("")}`;
    const go = () => nav(`/manager?am=${document.getElementById("am").value}&date=${document.getElementById("date").value}`);
    document.getElementById("am").onchange = go;
    document.getElementById("date").onchange = go;
  },

  "/me": async () => {
    const m = await meta();
    const qs = new URLSearchParams(location.search);
    const date = qs.get("date") || m.latest;
    const [brief] = await Promise.all([api(`/api/brief?date=${date}`), missions()]);
    const ids = Object.keys(brief.cards);
    const sel = qs.get("sp") && brief.cards[qs.get("sp")] ? qs.get("sp") : ids[0];
    const c = brief.cards[sel];
    const dopts = m.dates.map((x) => `<option ${x === date ? "selected" : ""}>${x}</option>`).join("");
    const sopts = ids.map((p) => `<option value="${p}" ${p === sel ? "selected" : ""}>${esc(brief.cards[p].name)} · ${esc(brief.cards[p].store_id)}</option>`).join("");
    app.innerHTML = `
      <div class="eyebrow">Salesperson card · one behaviour, one peer, one action</div>
      <div class="row-flex"><h1>Today's one thing</h1><div><select id="sp">${sopts}</select> <select id="date">${dopts}</select></div></div>
      <p class="lede">${ids.length} rostered salespeople on ${esc(date)} have a coaching card. Everyone else on the floor is within range, so they get no nagging.</p>
      ${c ? `<div class="two" style="margin-top:18px">
        <div class="phone"><div class="eyebrow">SUTRA · ${esc(c.store_id)} · ${esc(c.lever)}</div><p class="msg">${esc(c.text)}</p><p class="muted" style="color:#bfb3a2">${c.words} words</p></div>
        <div class="card"><h3>Checks passed before sending</h3><ul class="checks">${Object.entries(c.checks).map(([k, v]) => `<li class="${v ? "" : "fail"}"><b>${v ? "✓" : "✗"}</b>${esc(k)}</li>`).join("")}</ul>
        <p style="margin-top:16px">${ackButton(c.issue_id)}</p></div></div>` : `<div class="card">No cards on this date.</div>`}`;
    const go = () => nav(`/me?date=${document.getElementById("date").value}&sp=${document.getElementById("sp").value}`);
    document.getElementById("sp").onchange = go;
    document.getElementById("date").onchange = () => nav(`/me?date=${document.getElementById("date").value}`);
  },

  "/trust": async () => {
    const m = await meta();
    const date = new URLSearchParams(location.search).get("date") || m.latest;
    const [brief, runs] = await Promise.all([api(`/api/brief?date=${date}`), api("/api/runs")]);
    app.innerHTML = `
      <div class="eyebrow">Trust · what we did not alert, and why</div>
      <h1>Runs on its own</h1>
      <p class="lede">${esc(runs.schedule)}. Each run reads the data as of the latest close and writes its result to the run log below.</p>
      <p><button class="btn" id="runnow">Run today's brief now</button> <span id="runmsg" class="muted"></span></p>
      <div class="card" style="margin-top:12px"><table><tr><th>Ran at</th><th>Trigger</th><th>Data as of</th><th>Issues</th><th>Cards</th><th>Flags</th></tr>
        ${runs.runs.map((r) => `<tr><td>${esc(ist(r.ran_at))}</td><td>${esc(r.trigger)}</td><td>${esc(r.replay_date)}</td><td>${r.issues}</td><td>${r.cards}</td><td>${r.flags}</td></tr>`).join("") || `<tr><td colspan=6 class="muted">No runs logged yet. The first scheduled run is at 06:00 IST.</td></tr>`}</table></div>
      <hr class="rule">
      <h2>Data issues flagged on ${esc(date)}</h2>
      ${brief.flags.map((f) => `<div class="card" style="margin-top:10px"><span class="pill warn">${esc(f.type)}</span><b>${esc(f.store_id)}</b><p>${esc(f.detail)}</p><p class="muted">${esc(f.handling)}</p></div>`).join("") || `<p class="muted">None.</p>`}
      <hr class="rule">
      <h2>Method</h2>
      <div class="grid">
        <div class="card"><h3>Windows</h3><p>Store KPIs: last ${m.windows.store_kpis_days} days vs the ${m.windows.baseline_days} days before. Salesperson behaviours: last ${m.windows.behaviour_days} days, minimum 30 eligible bills.</p></div>
        <div class="card"><h3>Seasonality</h3><p>A store is only flagged if it fell at least 8 points more than its same-state peers over the same weeks. Diwali moving from 20 Oct 2025 to 8 Nov 2026 is not an alert.</p></div>
        <div class="card"><h3>Rupees</h3><p>Every rupee figure is an estimate with its formula shown. It is not guaranteed recovery and not proof of cause.</p></div>
      </div>`;
    document.getElementById("runnow").onclick = async (e) => {
      e.target.disabled = true;
      try { const r = await api("/api/run-now", { method: "POST" }); document.getElementById("runmsg").textContent = r.throttled ? r.note : `Done: ${r.counts.issues_found} issues, ${r.counts.cards} cards.`; await sleep(600); views["/trust"](); }
      catch (err) { document.getElementById("runmsg").textContent = err.message; e.target.disabled = false; }
    };
  },
};

async function runCase() {
  const btn = document.getElementById("run"), loader = document.getElementById("loader"), out = document.getElementById("out");
  btn.disabled = true; out.innerHTML = "";
  const steps = ["Scanning 316 kurta-set bills…", "Comparing same-store peers…", "Checking jacket stock at 31 Oct close…", "Writing and checking the card…"];
  const p = api("/api/case?id=PAT-02-KURTA-JACKET-92D&replay_date=2026-10-31");
  for (const s of steps) { loader.textContent = s; await sleep(450); }
  let r;
  try { r = await p; } catch (err) { loader.textContent = ""; out.innerHTML = `<p class="error">${esc(err.message)} <button class="btn ghost" id="retry">Retry</button></p>`; btn.disabled = false; document.getElementById("retry").onclick = runCase; return; }
  loader.textContent = ""; btn.textContent = "Run again"; btn.disabled = false;
  const s = r.seed, f = s.focus, rm = s.role_model, pe = s.peers_excluding_focus;
  const max = Math.max(...s.all_salespeople.map((x) => x.rate));
  out.innerHTML = `
    <section class="card" style="margin-top:10px">
      <div class="eyebrow">Prove · Evidence room</div>
      <h2>Attach a jacket to kurta-set bills</h2>
      <p><span class="pill teal">Lever · ${esc(s.lever)}</span><span class="pill">1 Aug – 31 Oct 2026 (92 days)</span><span class="pill warn">Historical 92-day showcase, not the 28-day daily detector</span></p>
      <p class="muted" style="font-size:13px"><b>Rule.</b> ${esc(s.rule)}</p>
      <div class="bars" style="margin:18px 0">${s.all_salespeople.map((x) => {
        const cls = x.salesperson_id === f.salesperson_id ? "focus" : x.salesperson_id === rm.salesperson_id ? "model" : x.eligible_bills < 30 ? "low" : "";
        return `<div class="row ${cls}"><span>${esc(x.name)}${cls === "focus" ? " · focus" : cls === "model" ? " · role model" : ""}</span><div class="track"><div class="fill" style="width:${(x.rate / max) * 100}%"></div></div><span>${x.with_addon}/${x.eligible_bills} · ${pct(x.rate)}${x.eligible_bills < 30 ? " · low sample" : ""}</span></div>`;
      }).join("")}<p class="muted" style="font-size:12px">Fewer than 30 eligible bills = low sample, never blamed.</p></div>
      <div class="grid">
        <div class="card"><div class="stat">${pct(f.rate)}<small>${esc(f.name)} · ${f.with_addon} of ${f.eligible_bills} bills</small></div></div>
        <div class="card"><div class="stat" style="color:var(--teal)">${pct(rm.rate)}<small>${esc(rm.name)} · ${rm.with_addon} of ${rm.eligible_bills} bills</small></div></div>
        <div class="card"><div class="stat" style="color:var(--charcoal)">${pct(pe.rate)}<small>Other same-store peers · ${pe.with_addon} of ${pe.eligible_bills}</small></div></div>
      </div>
      <div class="two" style="margin-top:14px">
        <div class="card"><div class="eyebrow">Proven fact</div><p>From bills: ${esc(f.name)} ${f.with_addon}/${f.eligible_bills}; ${esc(rm.name)} ${rm.with_addon}/${rm.eligible_bills}; other peers ${pe.with_addon}/${pe.eligible_bills}.</p></div>
        <div class="card"><div class="eyebrow">Tested hypothesis</div><p>${esc(f.name.split(" ")[0])} is not offering a jacket during kurta-set trials. Observational, not a proven cause.</p></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="eyebrow">Stock check</div><p>${s.stock_at_cutoff.units_on_hand} jacket units across ${s.stock_at_cutoff.skus_on_hand} SKUs on hand at 31 Oct close.</p>
        <p>${Object.entries(s.stock_at_cutoff.by_size).map(([k, v]) => `<span class="pill">${esc(k)} ${v}</span>`).join("")}</p><p class="muted">${esc(s.stock_at_cutoff.caveat)}</p></div>
      <details><summary>Receipts · ${f.eligible_bills} source bills for ${esc(f.name)}</summary>
        <p><b>With jacket (${f.bills_with_addon.length}):</b> <span class="mono">${f.bills_with_addon.join(", ")}</span></p>
        <p><b>Without jacket (${f.bills_without_addon.length}):</b> <span class="mono">${f.bills_without_addon.join(", ")}</span></p></details>
      <details><summary>Show the math</summary>
        <p>(${pct(pe.rate)} − ${pct(f.rate)}) × ${f.eligible_bills} bills = <b>${s.scenario.extra_bills_with_addon}</b> extra jacket bills × average jacket price ${inr(s.scenario.avg_addon_selling_price)} ≈ <b>${inr(s.scenario.hypothetical_sales_inr)}</b>.</p>
        <p class="pill warn">Hypothetical historical scenario. Not guaranteed recovery, not proof of cause.</p></details>
    </section>
    <section class="two" style="margin-top:18px">
      <div><div class="eyebrow">Coach · daily employee card</div><h2>For ${esc(f.name)}, today</h2>
        <div class="phone"><div class="eyebrow">SUTRA · ${esc(s.store.store_id)}</div><p class="msg">${esc(r.card.text)}</p><p style="color:#bfb3a2">${r.card.words} words</p></div></div>
      <div class="card"><h3>Validated in code</h3><ul class="checks">${r.card.checks.map((c) => `<li class="${c.ok ? "" : "fail"}"><b>${c.ok ? "✓" : "✗"}</b><span>${esc(c.label)} <span class="muted">· ${esc(c.detail)}</span></span></li>`).join("")}</ul></div>
    </section>
    <section class="two" style="margin-top:18px">
      <div class="card"><div class="eyebrow">Assign</div><h3>Mission</h3><p>Owner ${esc(f.name)} · what: a jacket with every kurta-set trial · when: today.</p>${ackButton(s.case_id)}</div>
      <div class="card"><div class="eyebrow">Re-measure</div><h3>7-day follow-up</h3><p class="pill warn">${esc(s.follow_up.status)}</p><p class="muted">${esc(s.follow_up.reason)}</p>
        <p style="font-size:13px">For cases where the next 7 days exist, see the <a href="/manager?date=2026-10-24&am=AM-03" data-link>24 Oct replay</a>: each issue shows the observed before/after.</p></div>
    </section>`;
}

// ---------- router
function nav(to) { history.pushState({}, "", to); render(); }
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault(); nav(a.getAttribute("href"));
});
window.addEventListener("popstate", render);
async function render() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  document.querySelectorAll(".nav nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === path));
  const v = views[path] || views["/"];
  try { await v(); } catch (err) { app.innerHTML = `<p class="error">Could not load: ${esc(err.message)}</p>`; }
  window.scrollTo(0, 0);
}
render();
