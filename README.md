# SUTRA · Store Coach (Jugaad Labs)

Vibe Coders Hackathon Edition 3, Kolkata · problem statement **Store Coach** for Manyavar (Vedant Fashions).

**Live:** https://sutra-store-coach.pages.dev (no sign-in needed for the landing page and the PAT-02 live case; the two portals use one-click *demo* identities, no passwords).

Every morning SUTRA tells each area manager which stores need attention and why, and gives each salesperson one thing to do better today, on three levers: **more bills, bigger baskets, more repeat**. Everything runs on the synthetic Manyavar VCH3 data pack (sales 1 Nov 2024 – 31 Oct 2026). No real store, salesperson or customer.

## What a judge can do
| Where | What it shows |
|---|---|
| `/demo` (public) | One investigation end to end: evidence room with receipts (all 60 source bills), same-store peers, stock check, scenario math, a 60-word card checked in code, Hindi/Kannada audio (Sarvam Bulbul), an AI explanation (Sarvam-105B, validated), acknowledgement saved in D1 |
| Area Manager portal | Morning brief (real KPIs, 24-month trend), **Actions** (max 5 *new* issues per manager per 7 days, ongoing issues tracked by identity, evidence, receipts, ₹ scenario, 7-day follow-up on real later data), **Staff focus** (every active salesperson in exactly one state), Stores, Data & follow-up (run log, data-quality flags, city category mix) |
| Salesperson portal | Only that person's card, numbers vs their store average, card history with follow-ups, recent bills; accept / tried / blocked-with-reason; audio; explanation |

## How it works
```
CSV pack ──► scripts/contract.py (one metric contract) ──► scripts/engine.py (detectors + guardrails + budget + cards)
                                                    └────► scripts/store_metrics.py, sp_metrics.py (KPIs, trends, per-person views)
        ──► web/src/data/*.json (derived facts only; raw data is never committed)
        ──► Cloudflare Pages (web/pages) serves web/public + web/src/worker.js as _worker.js
            D1 (sutra-coach): missions, actions + action_events, run_log, voice_cache/voice_log, ai_cache/ai_log
            Cron Worker (web/wrangler.jsonc, no public URL): 06:00 IST daily run → run_log
```

### Detectors (engine.py)
- **More bills:** store conversion drop with steady walk-ins that is ≥8 pts worse than same-state peers (seasonality/market guardrail); a previously strong seller not observed on the roster (no exit dates exist, so "manager to confirm"); fewer people present on the store's busiest weekdays (as-of history only); city-wide drops become a *market signal*, never a store alert.
- **Bigger baskets:** add-on attach (Sherwani → Safa/Mojari/Mala, Kurta Set → Jacket) vs same-store peers excluding the subject, min 30 eligible bills, suppressed when the add-on had zero stock that week; category avoidance vs the rest of the city; discount above the store norm (a check against policy, not an accusation).
- **More repeat:** first-time customers who billed again 30+ days later, mature cohort (≥1 year to return), vs same-store peers; names the role model.
- **Not alerts:** door-camera faults (0 walk-ins on a billing day; PAT-03 5–16 Oct), new store BLR-05 (<84 days of history), low samples.

### Metric contract (scripts/contract.py)
Revenue = qty × selling_price incl. GST; product units exclude packaging; conversion = bills / footfall on the same non-faulty store-days; repeat = numerator/denominator stored explicitly; every recommendation uses only data up to its date (later data only in the separately labelled follow-up).

### Weekly alert budget
Issue identity = issue id without its date. At most `max_alerts_per_week` (5) **new** identities per manager in any rolling 7 days; an identity raised within the last 14 days is shown as **ongoing** and costs nothing.

### Action lifecycle (D1)
`new → accepted → attempted → reviewed`, plus `blocked` (reasons: stock/size, peer unavailable, wrong attribution, too few customers, unsuitable, other) and `dismissed` (manager, reason). Server checks the actor's role and ownership, uses optimistic versions (409 on conflict) and keeps append-only events. Execution state is separate from the observed outcome.

### AI (Sarvam)
- **Voice:** `/translate` (mayura:v1) + `/text-to-speech` (bulbul:v4-flash). Server picks the text from the checked card; translations must keep every number (Hindi fraction order corrected) or the English card is spoken; cached in D1.
- **Explain:** `/v1/chat/completions` (sarvam-105b) sees only a server-built evidence packet (fact ids + approved action). Output is rejected unless every number and staff name traces to the facts, it cites fact ids, stays ≤60 words, avoids discounts and affirmative causal claims; one repair retry, then a labelled template fallback. Provenance shown in the UI.

## Run it
```bash
# data (organiser pack, not committed) at manyavar-vch3-data/manyavar-vch3-data/csv
python scripts/engine.py        manyavar-vch3-data/manyavar-vch3-data/csv web/src/data/briefs.json
python scripts/store_metrics.py manyavar-vch3-data/manyavar-vch3-data/csv web/src/data/stores.json
python scripts/sp_metrics.py    manyavar-vch3-data/manyavar-vch3-data/csv web/src/data/people.json
python scripts/build_seed.py    manyavar-vch3-data/manyavar-vch3-data/csv seed/pat02_case.json

python -m pytest tests -q        # golden numbers + no-future-leakage test
bash tests/live_api_check.sh     # roles + lifecycle against the live API (writes demo events)

cd web && npx wrangler d1 migrations apply sutra-coach --remote
./build_pages.ps1                # bundles worker → pages/dist/_worker.js and deploys Pages
npx wrangler deploy              # cron Worker (06:00 IST)
```
Secrets (names only): `SESSION_SECRET`, `SARVAM_API_KEY` on the Pages project. Optional vars: `AI_MODEL`, `AI_ENABLED`, `VOICE_ENABLED`.

## Tests that pass
`pytest` (7): one row per bill after joins and no rejected keys; network 4–31 Oct 2026 = 3,735 bills, ₹34,848,213, 6,759 units, 1.8096 items/bill; PAT-03 camera mask = 11 days / 24 bills excluded from conversion only; repeat network 4,783/40,183 and AM-01 1,188/9,988; SP1083 jacket 2/57 and sherwani add-on 0/5; published data carries explicit repeat fractions; **the 24 Oct brief is identical with and without data after 24 Oct**. Live API: 401/403 for wrong roles, 409 on stale versions and illegal transitions.

## Honest limits
- Historical replay only: the pack ends 31 Oct 2026, so the daily run re-publishes that brief and logs "no new data". Detection runs offline in Python; the Worker serves its output (runtime detection over D1 facts is the next step).
- Demo identities are not authentication; a pilot needs real sign-in (e.g. the company IdP) and per-region scoping for managers.
- ₹ figures are scenarios, not recovered revenue. Follow-ups are observational. Roster is daily Present/Off only (no shift hours). Customer IDs are hashed; no customer contact.
- Not connected to POS, CRM or VFL Parivaar; WhatsApp delivery is not built.
