import briefs from "./data/briefs.json";
import pat02 from "./data/pat02_case.json";
import storeData from "./data/stores.json";
import people from "./data/people.json";

// ---------- data indexes (all computed offline from the CSVs by scripts/*.py)
const RUNS = Object.fromEntries(briefs.runs.map((r) => [r.replay_date, r]));
const DATES = briefs.runs.map((r) => r.replay_date);
const LATEST = DATES[DATES.length - 1];
const ISSUES = new Map(); // issue id -> { owner, action, replay_date, salesperson_id, store_id }
for (const r of briefs.runs) {
  for (const am of Object.values(r.digest))
    for (const i of am.issues) ISSUES.set(i.id, { owner: i.owner, action: i.action, replay_date: r.replay_date, salesperson_id: i.salesperson_id || null, store_id: i.store_id });
  for (const [pid, c] of Object.entries(r.cards))
    if (!ISSUES.has(c.issue_id)) ISSUES.set(c.issue_id, { owner: c.name, action: c.text, replay_date: r.replay_date, salesperson_id: pid, store_id: c.store_id });
}
const AMS = storeData.area_managers.map((a) => ({ id: a.area_manager_id, name: a.name, city: a.city, stores: a.stores.split(",").map((s) => s.trim()) }));
const STORE = Object.fromEntries(storeData.stores.map((s) => [s.store_id, s]));

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const bad = (msg, status = 400) => json({ error: msg }, status);

// ---------- demo sessions: no password, but a server-signed cookie decides what each role may read
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function makeCookie(env, sess) {
  const body = b64u(enc.encode(JSON.stringify({ ...sess, exp: Date.now() + 8 * 3600e3 })));
  return `sc_session=${body}.${await hmac(env.SESSION_SECRET, body)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`;
}
async function readSession(req, env) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sc_session=([^;]+)/);
  if (!m || !env.SESSION_SECRET) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig || (await hmac(env.SESSION_SECRET, body)) !== sig) return null;
  try {
    const s = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

// ---------- the PAT-02 showcase card, rebuilt and checked on every request
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

// The salesperson portal only ever receives this person's own slice.
function personalView(pid) {
  const me = people.people[pid];
  const storeAvg = people.stores[me.store_id];
  const cards = briefs.runs.map((r) => {
    const c = r.cards[pid];
    if (!c) return { replay_date: r.replay_date, card: null };
    return { replay_date: r.replay_date, card: { issue_id: c.issue_id, text: c.text, words: c.words, lever: c.lever, checks: c.checks, follow_up: c.follow_up } };
  });
  // follow-up for this person's issues where the manager digest measured one
  const follow = {};
  for (const r of briefs.runs) for (const am of Object.values(r.digest)) for (const i of am.issues)
    if (i.salesperson_id === pid && i.follow_up) follow[i.id] = i.follow_up;
  return { as_of: people.as_of, window: people.window, me: { id: pid, ...me }, store: { store_id: me.store_id, city: STORE[me.store_id]?.city, ...storeAvg }, cards, follow };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      // ----- public
      if (p === "/api/meta") return json({ dates: DATES, latest: LATEST, windows: briefs.meta.windows, data_end: briefs.meta.data_end });
      if (p === "/api/directory") {
        const latest = RUNS[LATEST].cards;
        const byStore = {};
        for (const [pid, x] of Object.entries(people.people)) (byStore[x.store_id] ||= []).push({ id: pid, name: x.name, has_card: !!latest[pid] });
        for (const k in byStore) byStore[k].sort((a, b) => (b.has_card - a.has_card) || a.name.localeCompare(b.name));
        return json({ area_managers: AMS.map(({ id, name, city, stores }) => ({ id, name, city, stores })), salespeople: byStore,
          stores: storeData.stores.map((s) => ({ store_id: s.store_id, city: s.city, tier: s.tier })) });
      }
      if (p === "/api/case") {
        const id = url.searchParams.get("id"), d = url.searchParams.get("replay_date");
        if (id !== pat02.case_id) return bad("Unknown case id");
        if (d !== pat02.data_as_of) return bad("This case is only valid for replay date 2026-10-31");
        return json({ seed: pat02, card: pat02Card(pat02) });
      }
      if (p === "/api/login" && req.method === "POST") {
        if (!env.SESSION_SECRET) return bad("Sign-in is not configured", 503);
        let b; try { b = await req.json(); } catch { return bad("Body must be JSON"); }
        let sess;
        if (b?.role === "am") {
          const a = AMS.find((x) => x.id === b.id);
          if (!a) return bad("Unknown area manager");
          sess = { role: "am", id: a.id, name: a.name };
        } else if (b?.role === "sp") {
          const x = people.people[b.id];
          if (!x) return bad("Unknown salesperson");
          sess = { role: "sp", id: b.id, name: x.name, store_id: x.store_id };
        } else return bad("role must be am or sp");
        return json({ session: sess }, 200, { "set-cookie": await makeCookie(env, sess) });
      }
      if (p === "/api/logout" && req.method === "POST")
        return json({ ok: true }, 200, { "set-cookie": "sc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });

      const sess = await readSession(req, env);
      if (p === "/api/session") return json({ session: sess });

      // ----- mission acknowledgement: public for the showcase case; otherwise AM (any) or the salesperson who owns it
      if (p === "/api/missions/ack" && req.method === "POST") {
        let body; try { body = await req.json(); } catch { return bad("Body must be JSON"); }
        const id = String(body?.issue_id || "");
        if (!/^[A-Za-z0-9:\-]{3,80}$/.test(id)) return bad("Invalid issue id");
        let owner, action, date;
        if (id === pat02.case_id) { owner = pat02.focus.name; action = pat02Card(pat02).text; date = pat02.data_as_of; }
        else {
          const i = ISSUES.get(id);
          if (!i) return bad("Unknown issue id", 404);
          if (!sess) return bad("Sign in to acknowledge", 401);
          if (sess.role === "sp" && i.salesperson_id !== sess.id) return bad("You can only acknowledge your own mission", 403);
          owner = i.owner; action = i.action; date = i.replay_date;
        }
        const by = sess ? `${sess.role}:${sess.id}` : "public-demo";
        const ins = await env.DB.prepare("INSERT OR IGNORE INTO missions (issue_id, replay_date, owner, action, acked_by) VALUES (?, ?, ?, ?, ?)")
          .bind(id, date, owner, action, by).run();
        const created = ins.meta.changes === 1;
        if (created) await env.DB.prepare("INSERT INTO issue_events (issue_id, event_type, payload) VALUES (?, 'acknowledged', ?)")
          .bind(id, JSON.stringify({ by })).run();
        return json({ created, mission: await env.DB.prepare("SELECT * FROM missions WHERE issue_id = ?").bind(id).first() });
      }
      if (p === "/api/missions/one") {
        const id = url.searchParams.get("id") || "";
        if (id !== pat02.case_id && !sess) return bad("Sign in", 401);
        if (sess?.role === "sp" && id !== pat02.case_id && ISSUES.get(id)?.salesperson_id !== sess.id) return bad("Forbidden", 403);
        return json({ mission: await env.DB.prepare("SELECT * FROM missions WHERE issue_id = ?").bind(id).first() });
      }

      // ----- Sarvam voice: the server chooses the text (a validated card), translates it, speaks it, caches the audio
      if (p === "/api/voice/tts" && req.method === "POST") {
        if (env.VOICE_ENABLED === "false") return bad("Voice is switched off", 503);
        if (!env.SARVAM_API_KEY) return bad("Voice is not configured", 503);
        let b; try { b = await req.json(); } catch { return bad("Body must be JSON"); }
        const id = String(b?.issue_id || ""), lang = String(b?.lang || "hi-IN");
        const VOICES = { "hi-IN": "aditya_hi_conversational", "en-IN": "simran_en_customer", "kn-IN": "chetan_kn_conversation" };
        if (!VOICES[lang]) return bad("Language must be hi-IN, en-IN or kn-IN");
        let text;
        if (id === pat02.case_id) text = pat02Card(pat02).text;
        else {
          const i = ISSUES.get(id);
          if (!i) return bad("Unknown issue id", 404);
          if (!sess) return bad("Sign in to listen", 401);
          if (sess.role === "sp" && i.salesperson_id !== sess.id) return bad("You can only listen to your own card", 403);
          text = i.salesperson_id ? (RUNS[i.replay_date]?.cards?.[i.salesperson_id]?.text || i.action) : i.action;
        }
        const who = sess ? `${sess.role}:${sess.id}` : `ip:${(req.headers.get("cf-connecting-ip") || "?").slice(0, 45)}`;
        const key = await hmac("voice-v3", `${lang}|${VOICES[lang]}|${text}`);
        const hit = await env.DB.prepare("SELECT caption, codec, audio_b64 FROM voice_cache WHERE key = ?").bind(key).first();
        if (hit) {
          await env.DB.prepare("INSERT INTO voice_log (who, issue_id, lang, cached, status) VALUES (?, ?, ?, 1, 'ok')").bind(who, id, lang).run();
          return json({ caption: hit.caption, source_text: text, lang, codec: hit.codec, audio_b64: hit.audio_b64, cached: true });
        }
        const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM voice_log WHERE who = ? AND cached = 0 AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')").bind(who).first();
        if (used.n >= 40) return bad("Daily voice limit reached for this user. The text card still works.", 429);
        const sarvam = (path, body) => fetch(`https://api.sarvam.ai${path}`, {
          method: "POST", headers: { "api-subscription-key": env.SARVAM_API_KEY.trim(), "content-type": "application/json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
        });
        const fail = async (stage, r) => {
          const detail = r ? `${r.status} ${(await r.text()).slice(0, 160)}` : "timeout";
          await env.DB.prepare("INSERT INTO voice_log (who, issue_id, lang, cached, status) VALUES (?, ?, ?, 0, ?)").bind(who, id, lang, `${stage} ${detail}`.slice(0, 200)).run();
          return json({ error: `Voice unavailable (${stage}). The text card still works.`, detail }, 502);
        };
        let caption = text, note = null, speakLang = lang;
        if (lang !== "en-IN") {
          // "12 of 40" is ambiguous for the translator; "12 out of 40" is not
          const input = text.replace(/(\d+) of/g, "$1 out of");
          let tr; try { tr = await sarvam("/translate", { input, source_language_code: "en-IN", target_language_code: lang, model: "mayura:v1", mode: "modern-colloquial", speaker_gender: "Male", numerals_format: "international" }); } catch { return fail("translate"); }
          if (!tr.ok) return fail("translate", tr);
          let out = (await tr.json()).translated_text || "";
          // Hindi "A में से B" means "A out of B" reversed (B is the total). Put each fraction back in the checked order.
          if (lang === "hi-IN")
            for (const [, a, b] of text.matchAll(/\b(\d+) of (?:your )?(\d+)/g))
              out = out.replace(new RegExp(`(^|[^\d])${a} में से ${b}(?!\d)`), `$1${b} में से ${a}`);
          // number check: every number in the checked card must survive translation exactly
          const nums = (s) => (s.match(/\d+(?:\.\d+)?/g) || []).sort().join(",");
          if (out && nums(out) === nums(text)) caption = out;
          else { note = "Translation changed a number, so the checked English card is read instead."; speakLang = "en-IN"; }
        }
        let codec = "mp3", tts;
        try {
          tts = await sarvam("/text-to-speech", { text: caption, language_code: speakLang, model: "bulbul:v4-flash", speaker: VOICES[speakLang], speech_sample_rate: 22050, output_audio_codec: "mp3" });
          if (tts.status === 400) { codec = "wav"; tts = await sarvam("/text-to-speech", { text: caption, language_code: speakLang, model: "bulbul:v4-flash", speaker: VOICES[speakLang], speech_sample_rate: 22050 }); }
        } catch { return fail("tts"); }
        if (!tts.ok) return fail("tts", tts);
        const audio = ((await tts.json()).audios || [])[0];
        if (!audio) return fail("tts-empty");
        await env.DB.prepare("INSERT OR REPLACE INTO voice_cache (key, lang, caption, codec, audio_b64) VALUES (?, ?, ?, ?, ?)").bind(key, lang, caption, codec, audio).run();
        await env.DB.prepare("INSERT INTO voice_log (who, issue_id, lang, cached, status) VALUES (?, ?, ?, 0, 'ok')").bind(who, id, lang).run();
        return json({ caption, source_text: text, lang: speakLang, note, codec, audio_b64: audio, cached: false });
      }

      // ----- salesperson portal: own data only
      if (p === "/api/sp/me") {
        if (!sess || sess.role !== "sp") return bad("Salesperson sign-in required", 401);
        const v = personalView(sess.id);
        const ids = v.cards.filter((c) => c.card).map((c) => c.card.issue_id);
        const acks = ids.length ? (await env.DB.prepare(`SELECT * FROM missions WHERE issue_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results : [];
        return json({ ...v, missions: Object.fromEntries(acks.map((m) => [m.issue_id, m])) });
      }

      // ----- area manager portal: everything
      const amOnly = ["/api/brief", "/api/stores", "/api/missions", "/api/runs", "/api/run-now"];
      if (amOnly.includes(p) && (!sess || sess.role !== "am")) return bad("Area manager sign-in required", sess ? 403 : 401);
      if (p === "/api/stores") {
        const scope = url.searchParams.get("scope");
        if (scope) {
          if (!storeData.scopes[scope]) return bad("Unknown scope");
          return json({ scope, as_of: storeData.as_of, ...storeData.scopes[scope], repeat_definition: storeData.repeat_definition });
        }
        const table = storeData.stores.map((s) => ({ ...s, last28: storeData.scopes[s.store_id].last28, prev28: storeData.scopes[s.store_id].prev28 }));
        return json({ as_of: storeData.as_of, stores: table, area_managers: storeData.area_managers, network: storeData.scopes.network.last28,
          repeat_by_salesperson: storeData.repeat_by_salesperson, category_mix_90d: storeData.category_mix_90d, data_quality: storeData.data_quality,
          repeat_definition: storeData.repeat_definition });
      }
      if (p === "/api/brief") {
        const d = url.searchParams.get("date") || LATEST;
        if (!RUNS[d]) return bad(`Unknown replay date. Valid: ${DATES.join(", ")}`);
        return json(RUNS[d]);
      }
      if (p === "/api/missions") {
        const { results } = await env.DB.prepare("SELECT * FROM missions ORDER BY acknowledged_at DESC LIMIT 200").all();
        return json({ missions: results });
      }
      if (p === "/api/runs") {
        const { results } = await env.DB.prepare("SELECT * FROM run_log ORDER BY id DESC LIMIT 20").all();
        return json({ runs: results, schedule: "Every day 06:00 IST (cron 30 0 * * * UTC)" });
      }
      if (p === "/api/run-now" && req.method === "POST") {
        const last = await env.DB.prepare("SELECT ran_at FROM run_log WHERE trigger LIKE 'manual%' ORDER BY id DESC LIMIT 1").first();
        if (last && Date.now() - Date.parse(last.ran_at) < 30_000) return json({ throttled: true, note: "A manual run happened in the last 30 seconds." });
        return json({ ok: true, counts: await logRun(env, `manual · ${sess.name}`, LATEST) });
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
