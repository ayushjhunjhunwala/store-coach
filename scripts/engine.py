"""SUTRA Store Coach detection engine.

Reads the raw Manyavar CSVs and, for each replay date T, produces:
  - per area manager: at most `max_alerts_per_week` issues ranked by rupees at stake
  - per rostered salesperson: one coaching card (<= 60 words)
  - data-quality flags (routed to the data team, never alerted)
  - a 7-day follow-up for every issue whose next 7 days exist in the data

Usage: python scripts/engine.py <csv-dir> <out.json> [T1 T2 ...]
Every number is computed here from the CSVs. Nothing is typed in by hand.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

CSV = Path(sys.argv[1])
OUT = Path(sys.argv[2])
DATES = sys.argv[3:] or ["2026-09-26", "2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"]
DATA_END = pd.Timestamp("2026-10-31")
STORE_WIN, BASE_WIN, BEH_WIN = 28, 56, 90
PAIRS = [("Sherwani", ("Safa", "Mojari", "Mala"), "a safa, mojari or mala"), ("Kurta Set", ("Jacket",), "a jacket")]
ADDON_WORDS = {"Sherwani": "safa or mojari", "Kurta Set": "jacket"}
MIN_BILLS, MIN_PEER_BILLS = 30, 60


def rd(n):
    return pd.read_csv(CSV / f"{n}.csv", dtype=str)


stores = rd("stores")
ams = rd("area_managers")
items = rd("items")
sp = rd("salespeople").set_index("salesperson_id")
bills = rd("bills")
lines = rd("bill_lines")
ff = rd("footfall_daily")
roster = rd("roster_daily")
stock_w = rd("stock_weekly")

bills["d"] = pd.to_datetime(bills.bill_date)
ff["d"] = pd.to_datetime(ff.date)
ff["footfall"] = ff.footfall.astype(int)
roster["d"] = pd.to_datetime(roster.date)
roster["present"] = (roster.status == "Present").astype(int)
stock_w["d"] = pd.to_datetime(stock_w.week_ending)
stock_w["on_hand"] = stock_w.closing_on_hand.astype(int)
stores["opened"] = pd.to_datetime(stores.opened_on)
S = stores.set_index("store_id")
AM = ams.set_index("area_manager_id")

lines["qty"] = lines.qty.astype(int)
lines["mrp"] = lines.mrp.astype(float)
lines["sp"] = lines.selling_price.astype(float)
lines = lines.merge(items[["sku_id", "category", "is_packaging"]], on="sku_id")
prod = lines[lines.is_packaging != "1"].copy()
prod["rev"] = prod.qty * prod.sp
prod["mrpv"] = prod.qty * prod.mrp
prod = prod.merge(bills[["bill_id", "d", "store_id", "salesperson_id", "customer_id"]], on="bill_id")
stock_w = stock_w.merge(items[["sku_id", "category"]], on="sku_id")

bt = prod.groupby("bill_id").agg(units=("qty", "sum"), rev=("rev", "sum"), cats=("category", lambda c: frozenset(c)))
B = bills.set_index("bill_id").join(bt).dropna(subset=["units"])
B["weekday"] = B.d.dt.day_name()

# Data quality: door camera shows 0 walk-ins on a day the store billed -> camera fault, exclude that day.
bills_per_day = B.groupby(["store_id", "d"]).size().rename("bills")
ffq = ff.set_index(["store_id", "d"]).join(bills_per_day).fillna({"bills": 0})
ffq["bad"] = (ffq.footfall == 0) & (ffq.bills > 0) | (ffq.bills > ffq.footfall) & (ffq.footfall > 0)
BAD_DAYS = set(ffq[ffq.bad].index)

# First-ever bill per customer (whole history) for the repeat lever.
first = B.reset_index().sort_values(["d", "bill_id"]).groupby("customer_id").first()


def pct(x):
    return f"{x * 100:.1f}%"


def inr(x):
    return f"₹{x:,.0f}"


def window(df, T, days, end_offset=0):
    end = T - pd.Timedelta(days=end_offset)
    start = end - pd.Timedelta(days=days - 1)
    return df[(df.d >= start) & (df.d <= end)], start, end


def store_kpis(T, days, end_offset=0):
    b, s, e = window(B, T, days, end_offset)
    f, _, _ = window(ff, T, days, end_offset)
    good = ~pd.Series([(r.store_id, r.d) in BAD_DAYS for r in f.itertuples()], index=f.index, dtype=bool)
    fgood = f[good]
    bgood = b[~pd.Series([(r.store_id, r.d) in BAD_DAYS for r in b.itertuples()], index=b.index, dtype=bool)]
    k = b.groupby("store_id").agg(bills=("units", "size"), units=("units", "sum"), rev=("rev", "sum"))
    k["conv_bills"] = bgood.groupby("store_id").size()
    k["footfall"] = fgood.groupby("store_id").footfall.sum()
    k["bad_days"] = f[~good].groupby("store_id").size()
    k = k.fillna({"bad_days": 0, "conv_bills": 0})
    k["conv"] = k.conv_bills / k.footfall
    k["ipb"] = k.units / k.bills
    k["atv"] = k.rev / k.bills
    k["start"], k["end"] = s.date().isoformat(), e.date().isoformat()
    return k


def staffing(T, days, end_offset=0):
    r, _, _ = window(roster, T, days, end_offset)
    return r


def stock_ok(store, cats, T):
    """Was add-on stock on hand at the store in the latest stock week ending on or before T?"""
    w = stock_w[(stock_w.store_id == store) & (stock_w.d <= T) & stock_w.category.isin(cats)]
    if w.empty:
        return None, None
    last = w.d.max()
    units = int(w[w.d == last].on_hand.sum())
    return units > 0, {"week_ending": last.date().isoformat(), "units_on_hand": units}


def word_count(t):
    return len(t.split())


def detect(T):
    T = pd.Timestamp(T)
    issues, flags, cards = [], [], {}
    cur, base = store_kpis(T, STORE_WIN), store_kpis(T, BASE_WIN, STORE_WIN)

    # --- data quality flags
    for (store, d) in sorted(BAD_DAYS):
        pass
    bad = ffq[ffq.bad].reset_index()
    bad = bad[(bad.d <= T) & (bad.d > T - pd.Timedelta(days=STORE_WIN))]
    for store, g in bad.groupby("store_id"):
        flags.append({"store_id": store, "type": "Door-camera fault",
                      "detail": f"Footfall recorded as 0 on {len(g)} day(s) between {g.d.min().date()} and {g.d.max().date()} while the store billed {int(g.bills.sum())} bills.",
                      "handling": "Those days are excluded from conversion. Routed to the data team, not alerted to the area manager.",
                      "source_rows": [f"footfall_daily {r.d.date()} {store}" for r in g.itertuples()][:20]})

    # --- store-level conversion leak, with market / seasonality guardrail
    for store in cur.index:
        st = S.loc[store]
        if (T - st.opened).days < STORE_WIN + BASE_WIN:
            flags.append({"store_id": store, "type": "New store", "detail": f"Opened {st.opened_on}; not enough history for a fair baseline.",
                          "handling": "No alerts until 84 days of history exist."})
            continue
        if store not in base.index:
            continue
        c, b0 = cur.loc[store], base.loc[store]
        peers = [s for s in stores[stores.state == st.state].store_id if s != store and s in cur.index and s in base.index
                 and (T - S.loc[s].opened).days >= STORE_WIN + BASE_WIN]
        pc = cur.loc[peers].conv_bills.sum() / cur.loc[peers].footfall.sum()
        pb = base.loc[peers].conv_bills.sum() / base.loc[peers].footfall.sum()
        peer_change = pc / pb - 1
        own_change = c.conv / b0.conv - 1
        ff_change = (c.footfall / STORE_WIN) / (b0.footfall / BASE_WIN) - 1
        excess = own_change - peer_change
        if own_change <= -0.10 and excess <= -0.08:
            expected = b0.conv * (1 + peer_change)
            rupees = (expected - c.conv) * c.footfall * c.atv
            # cause: a strong seller missing from the roster, or fewer people on the floor on busy days
            rb = staffing(T, BASE_WIN, STORE_WIN)
            rc = staffing(T, STORE_WIN)
            bb, _, _ = window(B, T, BASE_WIN, STORE_WIN)
            bb = bb[bb.store_id == store]
            share = bb.groupby("salesperson_id").size() / len(bb)
            pres_c = rc[rc.store_id == store].groupby("salesperson_id").present.sum()
            last14 = rc[(rc.store_id == store) & (rc.d > T - pd.Timedelta(days=14))].groupby("salesperson_id").present.sum()
            missing = [p for p in share.index if share[p] >= 0.08 and last14.get(p, 0) == 0]
            busy = B[(B.store_id == store)].groupby("weekday").size().sort_values(ascending=False).index[:2].tolist()
            rcs = rc[(rc.store_id == store)]
            rbs = rb[(rb.store_id == store)]
            fc = rcs[rcs.d.dt.day_name().isin(busy)].groupby("d").present.sum().mean()
            fb = rbs[rbs.d.dt.day_name().isin(busy)].groupby("d").present.sum().mean()
            evidence = [
                f"Conversion {pct(c.conv)} in the last 28 days vs {pct(b0.conv)} in the 56 days before ({c.conv_bills:.0f} bills / {c.footfall:.0f} walk-ins).",
                f"Walk-ins per day changed {ff_change * 100:+.0f}%, so the drop is not a footfall problem.",
                f"{st.state} peer stores moved {peer_change * 100:+.1f}% over the same weeks, so this is not a season or market swing (store moved {own_change * 100:+.1f}%).",
            ]
            if c.bad_days:
                evidence.append(f"{int(c.bad_days)} door-camera fault day(s) excluded.")
            present_now = pres_c[pres_c > 0].index.tolist()
            cw, _, _ = window(B, T, BEH_WIN)
            cw = cw[(cw.store_id == store) & cw.salesperson_id.isin(present_now)]
            best = cw.groupby("salesperson_id").size().sort_values(ascending=False)
            best_name = sp.loc[best.index[0], "name"] if len(best) else "your strongest seller"
            if missing:
                m = max(missing, key=lambda p: share[p])
                last_day = roster[(roster.salesperson_id == m) & (roster.present == 1) & (roster.d <= T)].d.max()
                cause = f"{sp.loc[m, 'name']} made {pct(share[m])} of the store's bills before, and has not been on the roster since {last_day.date() if pd.notna(last_day) else 'May'}."
                evidence.append(f"Roster: {sp.loc[m, 'name']} ({m}) 0 present days in the last 14 days.")
                action = f"Store team, from tomorrow: {best_name} takes {sp.loc[m, 'name'].split()[0]}'s walk-ins and regular customers; keep every rostered person on the floor on {busy[0]} and {busy[1]} and move weekly offs to quieter days."
            elif fb and fc < fb - 0.5:
                cause = f"Fewer people on the floor on the busiest days ({busy[0]}, {busy[1]}): {fc:.1f} present on average vs {fb:.1f} before."
                evidence.append(f"Roster: average present staff on {busy[0]}/{busy[1]} {fc:.1f} vs {fb:.1f}.")
                action = f"Store team: this {busy[0]} and {busy[1]}, keep all rostered staff on the floor; schedule weekly offs Tuesday to Thursday."
            else:
                cause = "Walk-ins are steady but fewer of them are buying."
                action = f"Store team, today: greet every walk-in within a minute and offer a trial; {best_name} (most bills in the last 90 days) runs a 10-minute floor huddle before opening."
            issues.append({"id": f"{T.date()}-{store}-CONV", "store_id": store, "lever": "More bills", "kpi": "conversion",
                           "title": f"{store}: conversion fell {abs(own_change) * 100:.0f}% while walk-ins held", "cause": cause,
                           "evidence": evidence, "action": action, "owner": f"{AM.loc[st.area_manager_id, 'name']} (area manager) with the {store} team",
                           "when": "From tomorrow", "rupees": round(float(rupees)), "rupees_basis": "Estimated sales at stake over the 28 days if conversion had moved with peers: (expected − actual conversion) × walk-ins × average bill value.",
                           "metric": {"value": round(float(c.conv), 4), "baseline": round(float(b0.conv), 4), "peer_change": round(float(peer_change), 4)}})

    # --- a strong seller has left / keeps missing shifts (roster covers 1 May - 31 Oct 2026)
    rc = staffing(T, 14)
    for store in cur.index:
        st = S.loc[store]
        if (T - st.opened).days < STORE_WIN + BASE_WIN or any(i["store_id"] == store and i["kpi"] == "conversion" for i in issues):
            continue
        prev, ps, pe = window(B, T, BASE_WIN, 14)
        prev = prev[prev.store_id == store]
        if prev.empty:
            continue
        share = prev.groupby("salesperson_id").size() / len(prev)
        last14 = rc[rc.store_id == store].groupby("salesperson_id").present.sum()
        for m in share[share >= 0.10].index:
            if last14.get(m, 0) > 0 or m not in set(roster.salesperson_id):
                continue
            last_day = roster[(roster.salesperson_id == m) & (roster.present == 1) & (roster.d <= T)].d.max()
            if pd.isna(last_day) or (T - last_day).days > 75:
                continue  # left long ago: already in the baseline
            mb = prev[prev.salesperson_id == m]
            rupees = mb.rev.sum() / BASE_WIN * STORE_WIN
            now = rc[(rc.store_id == store) & (rc.present == 1)].salesperson_id.unique()
            cw, _, _ = window(B, T, BEH_WIN)
            best = cw[(cw.store_id == store) & cw.salesperson_id.isin(now)].groupby("salesperson_id").size().sort_values(ascending=False)
            best_name = sp.loc[best.index[0], "name"] if len(best) else "the senior salesperson"
            busy = B[(B.store_id == store)].groupby("weekday").size().sort_values(ascending=False).index[:2].tolist()
            issues.append({"id": f"{T.date()}-{store}-{m}-ABSENT", "store_id": store, "salesperson_id": None, "lever": "More bills", "kpi": "absence",
                           "title": f"{store}: {sp.loc[m, 'name']}, a top seller, has not been on the floor since {last_day.date()}",
                           "cause": f"{sp.loc[m, 'name']} made {len(mb)} of {len(prev)} store bills ({pct(share[m])}) from {ps.date()} to {pe.date()}; 0 present days in the 14 days to {T.date()}.",
                           "evidence": [f"Roster: last Present day {last_day.date()}.", f"Bills by {sp.loc[m, 'name']} in that window: {inr(mb.rev.sum())}.",
                                        "No exit date is recorded in the data, so this may be a leaver or a long absence."],
                           "receipts": mb.index.tolist()[:12], "receipt_count": len(mb),
                           "action": f"Store team, from tomorrow: {best_name} takes over {sp.loc[m, 'name'].split()[0]}'s regular customers and walk-ins; keep every rostered person on the floor on {busy[0]} and {busy[1]}.",
                           "owner": f"{AM.loc[st.area_manager_id, 'name']} (area manager) with the {store} team", "when": "From tomorrow",
                           "rupees": round(float(rupees)), "rupees_basis": f"{sp.loc[m, 'name']}'s sales over the prior 56 days scaled to 28 days: sales that now need another seller.",
                           "metric": {"value": 0, "baseline": round(float(share[m]), 4)}})

    # --- salesperson behaviours over the last 90 days
    bw, wstart, _ = window(B, T, BEH_WIN)
    pw, _, _ = window(prod, T, BEH_WIN)
    sp_issues = []
    for store, sb in bw.groupby("store_id"):
        st = S.loc[store]
        if (T - st.opened).days < STORE_WIN + BASE_WIN:
            continue
        # attach gaps
        for base_cat, addons, addon_txt in PAIRS:
            el = sb[sb.cats.apply(lambda c: base_cat in c)]
            if len(el) < MIN_BILLS + MIN_PEER_BILLS:
                continue
            hit = el.cats.apply(lambda c: any(a in c for a in addons))
            g = pd.DataFrame({"sp": el.salesperson_id, "hit": hit})
            per = g.groupby("sp").hit.agg(["sum", "count"])
            addon_lines = pw[(pw.store_id == store) & pw.category.isin(addons)]
            price = addon_lines.rev.sum() / max(addon_lines.qty.sum(), 1)
            ok, stock = stock_ok(store, addons, T)
            for p, row in per.iterrows():
                if row["count"] < MIN_BILLS:
                    continue
                others = g[g.sp != p]
                if len(others) < MIN_PEER_BILLS:
                    continue
                rate, peer = row["sum"] / row["count"], others.hit.mean()
                if peer - rate < 0.08 or rate > 0.6 * peer:
                    continue
                if ok is False:
                    flags.append({"store_id": store, "type": "Stock guardrail", "detail": f"{sp.loc[p, 'name']} low on {addon_txt} with {base_cat.lower()}, but {'/'.join(addons)} stock was 0 at week ending {stock['week_ending']}.",
                                  "handling": "Not blamed on the salesperson; routed as a merchandising note."})
                    continue
                pr = per[per["count"] >= MIN_BILLS].drop(index=p, errors="ignore")
                pr = pr.assign(rate=pr["sum"] / pr["count"]).sort_values("rate", ascending=False)
                if pr.empty:
                    continue
                rm = pr.index[0]
                extra = (peer - rate) * row["count"]
                rupees = extra * price * STORE_WIN / BEH_WIN
                ex = el[(el.salesperson_id == p) & ~hit].index.tolist()
                sp_issues.append({
                    "id": f"{T.date()}-{p}-ATTACH-{base_cat[:3].upper()}", "store_id": store, "salesperson_id": p, "lever": "Bigger baskets",
                    "kpi": f"attach:{base_cat}", "behaviour": f"Add {addon_txt} to {base_cat.lower()} bills",
                    "title": f"{sp.loc[p, 'name']} rarely adds {addon_txt} to a {base_cat.lower()}",
                    "cause": f"{int(row['sum'])} of {int(row['count'])} {base_cat.lower()} bills ({pct(rate)}) had {addon_txt}; other {store} staff {int(others.hit.sum())} of {len(others)} ({pct(peer)}).",
                    "evidence": [f"Window {wstart.date()} to {T.date()} (90 days, for sample size).",
                                 f"Role model in the same store: {sp.loc[rm, 'name']} {int(pr.loc[rm, 'sum'])} of {int(pr.loc[rm, 'count'])} ({pct(pr.loc[rm, 'rate'])}).",
                                 f"Stock check: {stock['units_on_hand']} {'/'.join(addons)} units on hand at week ending {stock['week_ending']}." if stock else "Stock check: no weekly stock record before this date; size availability must be checked."],
                    "receipts": ex[:12], "receipt_count": len(ex),
                    "peer": {"id": rm, "name": sp.loc[rm, "name"], "num": int(pr.loc[rm, "sum"]), "den": int(pr.loc[rm, "count"])},
                    "num": int(row["sum"]), "den": int(row["count"]), "rate": round(float(rate), 4), "peer_rate": round(float(peer), 4),
                    "rupees": round(float(rupees)), "rupees_basis": f"({pct(peer)} − {pct(rate)}) × {int(row['count'])} bills × avg add-on price {inr(price)}, scaled to 28 days. Hypothetical, not guaranteed.",
                    "card": (f"{sp.loc[p, 'name'].split()[0]}, {int(row['sum'])} of your {int(row['count'])} {base_cat.lower()} bills had {addon_txt} ({rate * 100:.0f}%). "
                             f"{sp.loc[rm, 'name'].split()[0]} in your store: {int(pr.loc[rm, 'sum'])} of {int(pr.loc[rm, 'count'])} ({pr.loc[rm, 'rate'] * 100:.0f}%). "
                             f"Today, bring {addon_txt} in the customer's size to every {base_cat.lower()} trial. Ask {sp.loc[rm, 'name'].split()[0]} how he offers it."),
                })
        # discount above store norm
        sl = pw[pw.store_id == store]
        norm = (sl.mrpv.sum() - sl.rev.sum()) / sl.mrpv.sum()
        for p, g in sl.groupby("salesperson_id"):
            if g.qty.sum() < 40:
                continue
            d = (g.mrpv.sum() - g.rev.sum()) / g.mrpv.sum()
            others = sl[sl.salesperson_id != p]
            onorm = (others.mrpv.sum() - others.rev.sum()) / others.mrpv.sum()
            if d - onorm >= 0.03 and d >= 2 * onorm:
                rupees = (d - onorm) * g.mrpv.sum() * STORE_WIN / BEH_WIN
                lowest = others.groupby("salesperson_id").apply(lambda x: pd.Series({"d": (x.mrpv.sum() - x.rev.sum()) / x.mrpv.sum(), "u": x.qty.sum()}))
                lowest = lowest[lowest.u >= 40].sort_values("d")
                rm = lowest.index[len(lowest) // 2] if len(lowest) else None
                nb = g.bill_id.nunique()
                disc_bills = g[g.sp < g.mrp].bill_id.nunique()
                sp_issues.append({
                    "id": f"{T.date()}-{p}-DISC", "store_id": store, "salesperson_id": p, "lever": "Bigger baskets", "kpi": "discount",
                    "behaviour": "Sell at full price unless a scheme applies",
                    "title": f"{sp.loc[p, 'name']} discounts {pct(d)} vs store norm {pct(onorm)}",
                    "cause": f"{disc_bills} of {nb} bills carried a discount; {inr(g.mrpv.sum() - g.rev.sum())} given away on {inr(g.mrpv.sum())} MRP value in 90 days.",
                    "evidence": [f"Window {wstart.date()} to {T.date()}.", f"Rest of {store}: {pct(onorm)} average discount."],
                    "receipts": g[g.sp < g.mrp].bill_id.unique().tolist()[:12], "receipt_count": int(disc_bills),
                    "peer": {"id": rm, "name": sp.loc[rm, "name"] if rm else None, "rate": round(float(lowest.loc[rm, "d"]), 4) if rm else None},
                    "rate": round(float(d), 4), "peer_rate": round(float(onorm), 4), "num": int(disc_bills), "den": int(nb),
                    "rupees": round(float(rupees)), "rupees_basis": f"({pct(d)} − {pct(onorm)}) × {inr(g.mrpv.sum())} MRP value, scaled to 28 days.",
                    "card": (f"{sp.loc[p, 'name'].split()[0]}, your discount is {d * 100:.1f}% of MRP; the rest of your store averages {onorm * 100:.1f}%. "
                             f"Today, quote MRP first and give a discount only when a running scheme applies. "
                             f"{sp.loc[rm, 'name'].split()[0] if rm else 'Your store manager'} can show you how they hold price."),
                })
        # repeat: mature cohort of first-time customers served by each salesperson
        # mature cohort: first-ever bill at this store at least a year before T (brief: repeat = billing again 30+ days later)
        coh = first[(first.store_id == store) & (first.d <= T - pd.Timedelta(days=365))]
        if len(coh) >= 80:
            later = B[(B.d <= T) & B.customer_id.isin(coh.index)][["customer_id", "d"]]
            later = later.join(coh.d.rename("fd"), on="customer_id")
            back = set(later[later.d >= later.fd + pd.Timedelta(days=30)].customer_id)
            coh = coh.assign(back=coh.index.isin(back))
            per = coh.groupby("salesperson_id").back.agg(["sum", "count"])
            per = per[per["count"] >= 30].assign(rate=lambda x: x["sum"] / x["count"])
            if len(per) >= 3:
                avg_bill = B[(B.store_id == store) & (B.d <= T) & (B.d > T - pd.Timedelta(days=BEH_WIN))].rev.mean()
                rm = per.sort_values("rate").index[-1]
                for p, row in per.iterrows():
                    others = coh[coh.salesperson_id != p]
                    peer = others.back.mean()
                    if peer - row.rate >= 0.04 and row.rate <= 0.5 * peer and p != rm:
                        rupees = (peer - row.rate) * row["count"] * avg_bill * STORE_WIN / 365
                        sp_issues.append({
                            "id": f"{T.date()}-{p}-REPEAT", "store_id": store, "salesperson_id": p, "lever": "More repeat", "kpi": "repeat",
                            "behaviour": "Give every first-time customer a reason to come back",
                            "title": f"{sp.loc[p, 'name']}'s first-time customers rarely come back",
                            "cause": f"{int(row['sum'])} of {int(row['count'])} first-time customers ({pct(row.rate)}) billed again 30+ days later; rest of {store} {pct(peer)}.",
                            "evidence": [f"Cohort: customers whose first-ever bill was at {store} on or before {(T - pd.Timedelta(days=365)).date()} (a full year to return), followed up to {T.date()}.",
                                         f"Role model: {sp.loc[rm, 'name']} {int(per.loc[rm, 'sum'])} of {int(per.loc[rm, 'count'])} ({pct(per.loc[rm, 'rate'])})."],
                            "peer": {"id": rm, "name": sp.loc[rm, "name"], "num": int(per.loc[rm, "sum"]), "den": int(per.loc[rm, "count"])},
                            "num": int(row["sum"]), "den": int(row["count"]), "rate": round(float(row.rate), 4), "peer_rate": round(float(peer), 4),
                            "rupees": round(float(rupees)), "rupees_basis": f"({pct(peer)} − {pct(row.rate)}) × {int(row['count'])} customers × avg bill {inr(avg_bill)}, scaled to 28 days.",
                            "card": (f"{sp.loc[p, 'name'].split()[0]}, {int(row['sum'])} of your {int(row['count'])} first-time customers came back ({row.rate * 100:.0f}%); "
                                     f"{sp.loc[rm, 'name'].split()[0]} gets {per.loc[rm, 'rate'] * 100:.0f}%. Today, on every first bill, note the family's next wedding or festival date "
                                     f"and invite them for the fitting. Ask {sp.loc[rm, 'name'].split()[0]} what he says."),
                        })

    # --- category avoidance: share of a salesperson's bills containing a category vs the rest of their city (90 days)
    bwc = bw.join(S[["city"]], on="store_id")
    for cat in ["Kurta Set", "Jacket", "Mojari", "Sherwani"]:
        has = bwc.cats.apply(lambda c: cat in c)
        cat_lines = pw[pw.category == cat]
        price = cat_lines.rev.sum() / max(cat_lines.qty.sum(), 1)
        for city, g in bwc.groupby("city"):
            hc = has[g.index]
            per = pd.DataFrame({"sp": g.salesperson_id, "h": hc}).groupby("sp").h.agg(["sum", "count"])
            for p, row in per[per["count"] >= 60].iterrows():
                store = sp.loc[p, "store_id"]
                if (T - S.loc[store].opened).days < STORE_WIN + BASE_WIN:
                    continue
                rate = row["sum"] / row["count"]
                rest = hc[g.salesperson_id != p].mean()
                if rest < 0.08 or rest - rate < 0.10 or rate > 0.6 * rest:
                    continue
                same = per.loc[[q for q in per.index if sp.loc[q, "store_id"] == store and q != p and per.loc[q, "count"] >= 30]]
                if same.empty:
                    continue
                same = same.assign(rate=same["sum"] / same["count"]).sort_values("rate", ascending=False)
                rm = same.index[0]
                rupees = (rest - rate) * row["count"] * price * STORE_WIN / BEH_WIN
                ex = g[(g.salesperson_id == p) & ~hc].index.tolist()
                sp_issues.append({
                    "id": f"{T.date()}-{p}-AVOID-{cat[:3].upper()}", "store_id": store, "salesperson_id": p, "lever": "Bigger baskets", "kpi": f"avoid:{cat}",
                    "behaviour": f"Show {cat.lower()}s to every customer",
                    "title": f"{sp.loc[p, 'name']} rarely sells {cat.lower()}s, which {city} buys",
                    "cause": f"{int(row['sum'])} of {int(row['count'])} bills ({pct(rate)}) had a {cat.lower()}; other {city} salespeople {pct(rest)}.",
                    "evidence": [f"Window {wstart.date()} to {T.date()} (90 days).", f"Same-store role model: {sp.loc[rm, 'name']} {int(same.loc[rm, 'sum'])} of {int(same.loc[rm, 'count'])} ({pct(same.loc[rm, 'rate'])})."],
                    "receipts": ex[:12], "receipt_count": len(ex),
                    "peer": {"id": rm, "name": sp.loc[rm, "name"], "num": int(same.loc[rm, "sum"]), "den": int(same.loc[rm, "count"])},
                    "num": int(row["sum"]), "den": int(row["count"]), "rate": round(float(rate), 4), "peer_rate": round(float(rest), 4),
                    "rupees": round(float(rupees)), "rupees_basis": f"({pct(rest)} − {pct(rate)}) × {int(row['count'])} bills × avg {cat.lower()} price {inr(price)}, scaled to 28 days. Hypothetical.",
                    "card": (f"{sp.loc[p, 'name'].split()[0]}, {int(row['sum'])} of your {int(row['count'])} bills had a {cat.lower()} ({rate * 100:.0f}%); across {city} it is {rest * 100:.0f}%. "
                             f"Today, walk every customer past the {cat.lower()} display and offer one trial. Ask {sp.loc[rm, 'name'].split()[0]} which styles sell."),
                })

    # --- market signal: a whole city slowing down is not one store's fault (routed, never alerted against a store)
    for city, g in stores.groupby("city"):
        ids = [s for s in g.store_id if s in cur.index and s in base.index and (T - S.loc[s].opened).days >= STORE_WIN + BASE_WIN]
        if len(ids) < 2:
            continue
        state = g.state.iloc[0]
        others = [s for s in stores[stores.state == state].store_id if s not in ids and s in cur.index and s in base.index]
        cc = cur.loc[ids].conv_bills.sum() / cur.loc[ids].footfall.sum()
        cb = base.loc[ids].conv_bills.sum() / base.loc[ids].footfall.sum()
        ch = cc / cb - 1
        drops = [(cur.loc[s].conv / base.loc[s].conv - 1) for s in ids]
        if ch <= -0.10 and all(d <= -0.05 for d in drops):
            oc = (cur.loc[others].conv_bills.sum() / cur.loc[others].footfall.sum()) / (base.loc[others].conv_bills.sum() / base.loc[others].footfall.sum()) - 1 if others else None
            flags.append({"store_id": city, "type": "Market signal",
                          "detail": f"All {len(ids)} {city} stores lost conversion together ({ch * 100:+.1f}% city-wide; every store between {min(drops) * 100:+.0f}% and {max(drops) * 100:+.0f}%)"
                                    + (f"; rest of {state} {oc * 100:+.1f}%." if oc is not None else "."),
                          "handling": "Treated as a market problem: no store or salesperson is blamed for it. Shown to the area manager as context only."})

    # validate cards; keep at most one card per salesperson (biggest rupees)
    valid = []
    for i in sp_issues:
        checks = {"<=60 words": word_count(i["card"]) <= 60, "one behaviour": bool(i["behaviour"]),
                  "peer in same store": i["peer"]["id"] is None or sp.loc[i["peer"]["id"], "store_id"] == i["store_id"],
                  "owner/what/when": "Today" in i["card"]}
        i["checks"] = checks
        i["owner"] = sp.loc[i["salesperson_id"], "name"]
        i["when"] = "Today"
        i["action"] = i["card"].split(". ", 2)[-1] if i["kpi"].startswith("attach") else i["card"]
        if all(checks.values()):
            valid.append(i)
    issues += valid

    # rank per manager, at most max_alerts_per_week
    digest = {}
    for am_id, am in AM.iterrows():
        mine = [i for i in issues if S.loc[i["store_id"], "area_manager_id"] == am_id]
        mine.sort(key=lambda i: -i["rupees"])
        seen, dedup = set(), []
        for i in mine:  # one issue per salesperson: their biggest, matching their single daily card
            if i.get("salesperson_id"):
                if i["salesperson_id"] in seen:
                    continue
                seen.add(i["salesperson_id"])
            dedup.append(i)
        mine = dedup
        digest[am_id] = {"name": am["name"], "city": am["city"], "stores": [s.strip() for s in am.stores.split(",")],
                         "issues": mine[:int(am.max_alerts_per_week)], "suppressed": len(mine[int(am.max_alerts_per_week):])}

    # salesperson cards: rostered on T
    on = roster[(roster.d == T) & (roster.present == 1)]
    for p in on.salesperson_id:
        mine = sorted([i for i in valid if i["salesperson_id"] == p], key=lambda i: -i["rupees"])
        if mine:
            cards[p] = {"name": sp.loc[p, "name"], "store_id": sp.loc[p, "store_id"], "issue_id": mine[0]["id"], "text": mine[0]["card"],
                        "words": word_count(mine[0]["card"]), "lever": mine[0]["lever"], "checks": mine[0]["checks"],
                        "kpi": mine[0]["kpi"], "rate": mine[0]["rate"]}
    return {"replay_date": T.date().isoformat(), "digest": digest, "cards": cards, "flags": flags,
            "counts": {"issues_found": len(issues), "cards": len(cards), "flags": len(flags)}}


def follow_up(issue, T):
    """Re-measure the same KPI over T+1..T+7 if those days exist. Observational only."""
    T = pd.Timestamp(T)
    if T + pd.Timedelta(days=7) > DATA_END:
        return {"status": "Pending / Not measurable", "reason": f"Data ends {DATA_END.date()}; the 7 days after {T.date()} are not in the dataset."}
    s, e = T + pd.Timedelta(days=1), T + pd.Timedelta(days=7)
    nb = B[(B.d >= s) & (B.d <= e)]
    k = issue["kpi"]
    if k == "conversion":
        f = ff[(ff.d >= s) & (ff.d <= e) & (ff.store_id == issue["store_id"])]
        f = f[[(r.store_id, r.d) not in BAD_DAYS for r in f.itertuples()]]
        b = nb[(nb.store_id == issue["store_id"]) & nb.d.isin(f.d)]
        n, den = len(b), int(f.footfall.sum())
        new = n / den if den else None
        old = issue["metric"]["value"]
    elif k.startswith("attach"):
        base_cat = k.split(":")[1]
        addons = dict((a, b) for a, b, _ in PAIRS)[base_cat]
        el = nb[(nb.salesperson_id == issue["salesperson_id"]) & nb.cats.apply(lambda c: base_cat in c)]
        n, den = int(el.cats.apply(lambda c: any(a in c for a in addons)).sum()), len(el)
        new = n / den if den else None
        old = issue["rate"]
    elif k.startswith("avoid"):
        cat = k.split(":")[1]
        el = nb[nb.salesperson_id == issue["salesperson_id"]]
        n, den = int(el.cats.apply(lambda c: cat in c).sum()), len(el)
        new = n / den if den else None
        old = issue["rate"]
    elif k == "discount":
        g = prod[(prod.d >= s) & (prod.d <= e) & (prod.salesperson_id == issue["salesperson_id"])]
        den = int(g.qty.sum())
        new = (g.mrpv.sum() - g.rev.sum()) / g.mrpv.sum() if den else None
        n, old = den, issue["rate"]
    elif k == "absence":
        b = nb[nb.store_id == issue["store_id"]]
        prior = B[(B.store_id == issue["store_id"]) & (B.d > T - pd.Timedelta(days=7)) & (B.d <= T)]
        n, den = len(b), max(len(prior), 1)
        return {"status": "Observed", "window": [str(s.date()), str(e.date())], "before": len(prior), "after": n,
                "note": f"Store bills in the 7 days after: {n} vs {len(prior)} in the 7 days before. Observation only, not proof of cause."}
    else:
        return {"status": "Not measurable in 7 days", "reason": "Repeat needs 30+ days to observe a return visit."}
    if new is None or den < 8:
        return {"status": "No detectable change", "reason": f"Too little activity in {s.date()}–{e.date()} (n={den}).", "window": [str(s.date()), str(e.date())]}
    delta = new - old
    better = delta < 0 if k == "discount" else delta > 0
    thr = 0.02 if k != "conversion" else 0.01
    status = "No detectable change" if abs(delta) < thr else ("Observed improvement" if better else "Observed decline")
    return {"status": status, "window": [str(s.date()), str(e.date())], "before": round(float(old), 4), "after": round(float(new), 4),
            "n": int(n), "den": int(den), "note": "Before/after observation only, not proof that the coaching caused it."}


runs = []
for T in DATES:
    r = detect(T)
    for am in r["digest"].values():
        for i in am["issues"]:
            i["follow_up"] = follow_up(i, T)
    for p, c in r["cards"].items():
        c["follow_up"] = follow_up({**c, "salesperson_id": p}, T)
    runs.append(r)
    print(T, r["counts"], {k: [(i["store_id"], i["kpi"], i["rupees"]) for i in v["issues"]] for k, v in r["digest"].items()})

meta = {"generated_from": "Manyavar VCH3 data pack (synthetic)", "data_end": str(DATA_END.date()),
        "windows": {"store_kpis_days": STORE_WIN, "baseline_days": BASE_WIN, "behaviour_days": BEH_WIN},
        "stores": stores.drop(columns=["opened"]).to_dict("records"),
        "salespeople": {p: {"name": r["name"], "store_id": r["store_id"]} for p, r in sp.iterrows()}}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"meta": meta, "runs": runs}, default=str, ensure_ascii=False), encoding="utf-8")
print("wrote", OUT, OUT.stat().st_size)
