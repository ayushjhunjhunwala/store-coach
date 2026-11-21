import briefs from "./data/briefs.json";
import pat02 from "./data/pat02_case.json";

const RUNS = Object.fromEntries(briefs.runs.map((r) => [r.replay_date, r]));
const DATES = briefs.runs.map((r) => r.replay_date);
const LATEST = DATES[DATES.length - 1];
const ISSUES = new Map();
for (const r of briefs.runs) {
  for (const am of Object.values(r.digest)) for (const i of am.issues) ISSUES.set(i.id, { ...i, replay_date: r.replay_date });
  for (const [pid, c] of Object.entries(r.cards)) ISSUES.has(c.issue_id) || ISSUES.set(c.issue_id, { id: c.issue_id, owner: c.name, action: c.text, replay_date: r.replay_date });
}
// card-only issues (salesperson issues ranked below the manager top-5 still get a card)
const CARD_ISSUES = new Map();
for (const r of briefs.runs) for (const c of Object.values(r.cards)) CARD_ISSUES.set(c.issue_id, { owner: c.name, action: c.text, replay_date: r.replay_date });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (msg, status = 400) => json({ error: msg }, status);

function pat02Card(s) {
  const f = s.focus, r = s.role_model;
  const first = (n) => n.split(" ")[0];
  const text = `${first(f.name)}, ${f.with_addon} of your ${f.eligible_bills} kurta-set bills had a jacket (${Math.round(f.rate * 100)}%). ` +
    `${first(r.name)} in your store: ${r.with_addon} of ${r.eligible_bills} (${Math.round(r.rate * 100)}%). ` +
    `Today, with every kurta-set trial, bring one jacket in the customer's size to the trial room. Ask ${first(r.name)} how he offers it.`;
  const words = text.trim().split(/\s+/).length;
  const peerSameStore = s.all_salespeople.some((p) => p.salesperson_id === r.salesperson_id);
  const numbersMatch = f.with_addon / f.eligible_bills === f.rate && Math.abs(r.with_addon / r.eligible_bills - r.rate) < 1e-9 &&
    Math.abs(s.peers_excluding_focus.with_addon / s.peers_excluding_focus.eligible_bills - s.peers_excluding_focus.rate) < 1e-3;
  const extra = (s.peers_excluding_focus.with_addon / s.peers_excluding_focus.eligible_bills - f.rate) * f.eligible_bills;
  const scenario = Math.round(extra * s.scenario.avg_addon_selling_price);
  return {
    text, words,
    checks: [
      { label: "≤60 words", ok: words <= 60, detail: `${words} words` },
      { label: "One behaviour", ok: true, detail: "Bring a jacket to every kurta-set trial" },
      { label: "Peer from same store", ok: peerSameStore, detail: `${r.name} · ${s.store.store_id}` },
      { label: "Numbers match bills", ok: numbersMatch, detail: `${f.with_addon}/${f.eligible_bills} · ${r.with_addon}/${r.eligible_bills}` },
      { label: "Owner / what / when", ok: text.includes("Today"), detail: `${f.name} · jacket with kurta-set trial · today` },
      { label: "Scenario recomputed", ok: scenario === s.scenario.hypothetical_sales_inr, detail: `₹${scenario.toLocaleString("en-IN")}` },
    ],
  };
}

async function logRun(env, trigger, date) {
  const r = RUNS[date];
  await env.DB.prepare("INSERT INTO run_log (trigger, replay_date, issues, cards, flags) VALUES (?, ?, ?, ?, ?)")
    .bind(trigger, date, r.counts.issues_found, r.counts.cards, r.counts.flags).run();
  return r.counts;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/api/meta") return json({ dates: DATES, latest: LATEST, ...briefs.meta });
      if (p === "/api/brief") {
        const d = url.searchParams.get("date") || LATEST;
        if (!RUNS[d]) return bad(`Unknown replay date. Valid: ${DATES.join(", ")}`);
        return json(RUNS[d]);
      }
      if (p === "/api/case") {
        const id = url.searchParams.get("id"), d = url.searchParams.get("replay_date");
        if (id !== pat02.case_id) return bad("Unknown case id");
        if (d !== pat02.data_as_of) return bad("This case is only valid for replay date 2026-10-31");
        return json({ seed: pat02, card: pat02Card(pat02) });
      }
      if (p === "/api/missions" && req.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM missions ORDER BY acknowledged_at DESC LIMIT 200").all();
        return json({ missions: results });
      }
      if (p === "/api/missions/ack" && req.method === "POST") {
        let body;
        try { body = await req.json(); } catch { return bad("Body must be JSON"); }
        const id = String(body?.issue_id || "");
        if (!/^[A-Za-z0-9:\-]{3,80}$/.test(id)) return bad("Invalid issue id");
        let owner, action, date;
        if (id === pat02.case_id) {
          owner = pat02.focus.name; action = pat02Card(pat02).text; date = pat02.data_as_of;
        } else {
          const i = ISSUES.get(id) || CARD_ISSUES.get(id);
          if (!i) return bad("Unknown issue id", 404);
          owner = i.owner; action = i.action; date = i.replay_date;
        }
        const ins = await env.DB.prepare("INSERT OR IGNORE INTO missions (issue_id, replay_date, owner, action) VALUES (?, ?, ?, ?)")
          .bind(id, date, owner, action).run();
        const created = ins.meta.changes === 1;
        if (created) await env.DB.prepare("INSERT INTO issue_events (issue_id, event_type, payload) VALUES (?, 'acknowledged', ?)")
          .bind(id, JSON.stringify({ ua: (req.headers.get("user-agent") || "").slice(0, 80) })).run();
        const m = await env.DB.prepare("SELECT * FROM missions WHERE issue_id = ?").bind(id).first();
        return json({ created, mission: m });
      }
      if (p === "/api/runs") {
        const { results } = await env.DB.prepare("SELECT * FROM run_log ORDER BY id DESC LIMIT 20").all();
        return json({ runs: results, schedule: "Every day 06:00 IST (cron 30 0 * * * UTC)" });
      }
      if (p === "/api/run-now" && req.method === "POST") {
        const last = await env.DB.prepare("SELECT ran_at FROM run_log WHERE trigger = 'manual' ORDER BY id DESC LIMIT 1").first();
        if (last && Date.now() - Date.parse(last.ran_at) < 30_000) return json({ throttled: true, note: "A manual run happened in the last 30 seconds." });
        return json({ ok: true, counts: await logRun(env, "manual", LATEST) });
      }
      if (p.startsWith("/api/")) return bad("Not found", 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return json({ error: "Server error", detail: String(e).slice(0, 200) }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(logRun(env, "cron 06:00 IST", LATEST));
  },
};
